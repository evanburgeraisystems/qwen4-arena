/* renderer.js — raw WebGL voxel renderer: chunk meshing (AO + cutout + water),
   day/night sky with real sunset, sun/moon, drifting clouds, mobs, particles,
   selection wireframe + break-crack overlay. GLSL ES 1.00 (webgl2 or webgl1). */
window.Renderer = (function () {
  'use strict';

  var CHUNK = 16, HEIGHT = 128;
  var VIEW_DIST = 96;              // 6 chunks * 16
  var MESH_RADIUS = 6;
  var MAX_PARTICLES = 2048;
  var AO_MULT = [0.45, 0.62, 0.80, 1.0];
  var IDX_STD = [0, 1, 2, 0, 2, 3];   /* quad diagonal 0-2 */
  var IDX_FLIP = [0, 1, 3, 1, 2, 3];  /* quad diagonal 1-3 (AO flip) */
  var FACE_SHADE = [1.0, 0.5, 0.8, 0.8, 0.6, 0.6]; // +Y -Y +Z -Z +X -X
  var HALF_TEXEL = 0.5 / 256;

  var canvas = null, gl = null, ready = false;
  var dpr = 1, viewW = 2, viewH = 2;

  /* programs: chunk, sky, billboard (sun/moon), cloud, entity, particle, line */
  var P = {};
  var texAtlas = null, texSun = null, texMoon = null, texCloud = null;
  var cubeBuf = null, skyBuf = null, selBuf = null, cloudBuf = null, bbBuf = null;
  var crackBuf = null, crackStage = -1, crackVertCount = 0, crackKey = '';
  var particleBuf = null;

  var selection = null;
  var crackHit = null, crackProgress = null;

  /* scratch (reused, no per-frame allocation in hot paths) */
  var bbData = new Float32Array(24);           // billboard: 6 verts * (pos3+uv2)
  var transList = [];                          // visible trans chunks, sorted per frame
  var transDist = [];
  var enabledAttrs = [];                       // currently enabled attrib indices
  var lastTime = 0, elapsed = 0;

  /* block opacity lookup + inset tile UVs */
  var OPAQUE = new Uint8Array(256);
  var UV = [];                                 // per tile: [u0,v0,u1,v1] inset half texel

  /* ------------------------------------------------------------------ */
  var IDENT = Util.m4.identity();

  /* shaders (GLSL ES 1.00 — valid on both webgl1 and webgl2 contexts)   */
  /* ------------------------------------------------------------------ */

  var CHUNK_VS = [
    'attribute vec3 aPos;',
    'attribute vec2 aUV;',
    'attribute float aShade;',
    'attribute float aWave;',
    'uniform mat4 uProj, uView, uModel;',
    'uniform float uTime;',
    'uniform vec3 uCamPos;',
    'varying vec2 vUV;',
    'varying float vShade;',
    'varying float vDist;',
    'void main() {',
    '  vec3 p = (uModel * vec4(aPos, 1.0)).xyz;',
    '  if (aWave > 0.5) { p.y += sin(uTime * 1.7 + p.x * 0.8 + p.z * 0.9) * 0.05; }',
    '  vUV = aUV;',
    '  vShade = aShade;',
    '  vDist = distance(p, uCamPos);',
    '  gl_Position = uProj * uView * vec4(p, 1.0);',
    '}'
  ].join('\n');

  var CHUNK_FS = [
    'precision mediump float;',
    'varying vec2 vUV;',
    'varying float vShade;',
    'varying float vDist;',
    'uniform sampler2D uAtlas;',
    'uniform vec3 uLightColor;',
    'uniform vec3 uFogColor;',
    'uniform float uFogNear, uFogFar, uAlphaTest;',
    'void main() {',
    '  vec4 t = texture2D(uAtlas, vUV);',
    '  if (t.a < uAlphaTest) discard;',
    '  vec3 rgb = t.rgb * uLightColor * vShade;',
    '  float f = clamp((vDist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);',
    '  gl_FragColor = vec4(mix(rgb, uFogColor, f), t.a);',
    '}'
  ].join('\n');

  var SKY_VS = [
    'attribute vec3 aPos;',
    'uniform mat4 uProj, uView;',
    'varying vec3 vDir;',
    'void main() {',
    '  vDir = aPos;',
    '  gl_Position = uProj * uView * vec4(aPos, 1.0);',
    '}'
  ].join('\n');

  var SKY_FS = [
    'precision mediump float;',
    'varying vec3 vDir;',
    'uniform vec3 uZenith, uHorizon, uSunsetBand, uSunDir;',
    'uniform float uSunsetWeight, uDayFactor, uTime;',
    'float hash13(vec3 p) {',
    '  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);',
    '}',
    'void main() {',
    '  vec3 dir = normalize(vDir);',
    '  float up = clamp(dir.y, 0.0, 1.0);',
    '  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));',
    /* sunset band: warm glow hugging the horizon near the sun azimuth */
    '  vec2 dxz = dir.xz;',
    '  float dl = max(length(dxz), 0.0001);',
    '  vec2 sunH = normalize(uSunDir.xz + vec2(0.0001, 0.0));',
    '  float prox = pow(clamp(dot(dxz / dl, sunH), 0.0, 1.0), 2.0);',
    '  float band = uSunsetWeight * pow(1.0 - abs(dir.y), 3.0) * prox;',
    '  col = mix(col, uSunsetBand, clamp(band, 0.0, 1.0));',
    /* sun halo */
    '  float sunUp = clamp(uSunDir.y * 4.0 + 0.4, 0.0, 1.0);',
    '  float glow = pow(max(dot(dir, uSunDir), 0.0), 24.0);',
    '  col += vec3(1.0, 0.72, 0.42) * glow * (0.5 * sunUp + 0.55 * uSunsetWeight);',
    /* stars: hash grid on direction, sub-cell points, twinkle, night only */
    '  float night = 1.0 - uDayFactor;',
    '  if (night > 0.02 && dir.y > 0.05) {',
    '    vec3 g = dir * 220.0;',
    '    vec3 cell = floor(g);',
    '    float h = hash13(cell);',
    '    if (h > 0.995) {',
    '      vec3 f = fract(g) - 0.5;',
    '      vec3 off = vec3(hash13(cell + 1.7), hash13(cell + 3.1), hash13(cell + 5.3)) - 0.5;',
    '      float d = length(f - off * 0.6);',
    '      float star = smoothstep(0.16, 0.02, d);',
    '      float tw = 0.65 + 0.35 * sin(uTime * 2.0 + h * 40.0);',
    '      col += vec3(0.9, 0.95, 1.0) * star * tw * night * smoothstep(0.05, 0.2, dir.y);',
    '    }',
    '  }',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var BB_VS = [
    'attribute vec3 aPos;',
    'attribute vec2 aUV;',
    'uniform mat4 uProj, uView;',
    'varying vec2 vUV;',
    'void main() {',
    '  vUV = aUV;',
    '  gl_Position = uProj * uView * vec4(aPos, 1.0);',
    '}'
  ].join('\n');

  var BB_FS = [
    'precision mediump float;',
    'varying vec2 vUV;',
    'uniform sampler2D uTex;',
    'uniform vec3 uTint;',
    'void main() {',
    '  vec4 t = texture2D(uTex, vUV);',
    '  gl_FragColor = vec4(t.rgb * uTint, t.a);',
    '}'
  ].join('\n');

  var CLOUD_VS = [
    'attribute vec3 aPos;',
    'uniform mat4 uProj, uView;',
    'uniform vec3 uOffset;',
    'varying vec3 vWorld;',
    'void main() {',
    '  vec3 w = aPos + uOffset;',
    '  vWorld = w;',
    '  gl_Position = uProj * uView * vec4(w, 1.0);',
    '}'
  ].join('\n');

  var CLOUD_FS = [
    'precision mediump float;',
    'varying vec3 vWorld;',
    'uniform sampler2D uClouds;',
    'uniform vec3 uTint, uCenter;',
    'uniform float uTime;',
    'void main() {',
    '  vec2 uv = (vWorld.xz + vec2(uTime * 1.2, uTime * 0.4)) / 256.0;',
    '  float a = texture2D(uClouds, uv).a;',
    '  float d = distance(vWorld.xz, uCenter.xz);',
    '  float fade = 1.0 - smoothstep(700.0, 1000.0, d);',
    '  gl_FragColor = vec4(uTint, a * 0.85 * fade);',
    '}'
  ].join('\n');

  var ENT_VS = [
    'attribute vec3 aPos;',
    'attribute float aShade;',
    'uniform mat4 uProj, uView, uModel;',
    'uniform vec3 uCamPos;',
    'varying float vShade;',
    'varying float vDist;',
    'void main() {',
    '  vec4 w = uModel * vec4(aPos, 1.0);',
    '  vShade = aShade;',
    '  vDist = distance(w.xyz, uCamPos);',
    '  gl_Position = uProj * uView * w;',
    '}'
  ].join('\n');

  var ENT_FS = [
    'precision mediump float;',
    'varying float vShade;',
    'varying float vDist;',
    'uniform vec3 uColor, uLightColor, uFogColor;',
    'uniform float uFogNear, uFogFar;',
    'void main() {',
    '  vec3 rgb = uColor * uLightColor * vShade;',
    '  float f = clamp((vDist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);',
    '  gl_FragColor = vec4(mix(rgb, uFogColor, f), 1.0);',
    '}'
  ].join('\n');

  var PART_VS = [
    'attribute vec3 aPos;',
    'attribute vec2 aUVOrigin;',
    'attribute vec2 aUVScale;',
    'attribute float aSize;',
    'attribute float aAlpha;',
    'attribute float aShade;',
    'uniform mat4 uProj, uView;',
    'uniform vec3 uCamPos;',
    'uniform float uViewportH;',
    'varying vec2 vUVOrigin;',
    'varying vec2 vUVScale;',
    'varying float vAlpha;',
    'varying float vShade;',
    'varying float vDist;',
    'void main() {',
    '  vUVOrigin = aUVOrigin;',
    '  vUVScale = aUVScale;',
    '  vAlpha = aAlpha;',
    '  vShade = aShade;',
    '  vDist = distance(aPos, uCamPos);',
    '  gl_Position = uProj * uView * vec4(aPos, 1.0);',
    '  gl_PointSize = clamp(aSize * uViewportH / max(vDist, 0.1), 2.0, 48.0);',
    '}'
  ].join('\n');

  var PART_FS = [
    'precision mediump float;',
    'varying vec2 vUVOrigin;',
    'varying vec2 vUVScale;',
    'varying float vAlpha;',
    'varying float vShade;',
    'varying float vDist;',
    'uniform sampler2D uAtlas;',
    'uniform vec3 uLightColor, uFogColor;',
    'uniform float uFogNear, uFogFar;',
    'void main() {',
    /* gl_PointCoord is top-down; atlas v is top-down too (no flipY) */
    '  vec2 uv = vUVOrigin + gl_PointCoord * vUVScale;',
    '  vec4 t = texture2D(uAtlas, uv);',
    '  if (t.a < 0.4) discard;',
    '  vec3 rgb = t.rgb * uLightColor * vShade;',
    '  float f = clamp((vDist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);',
    '  gl_FragColor = vec4(mix(rgb, uFogColor, f), t.a * vAlpha);',
    '}'
  ].join('\n');

  var LINE_VS = [
    'attribute vec3 aPos;',
    'uniform mat4 uMVP;',
    'void main() { gl_Position = uMVP * vec4(aPos, 1.0); }'
  ].join('\n');

  var LINE_FS = [
    'precision mediump float;',
    'uniform vec4 uColor;',
    'void main() { gl_FragColor = uColor; }'
  ].join('\n');

  /* ------------------------------------------------------------------ */
  /* GL helpers                                                          */
  /* ------------------------------------------------------------------ */

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('Shader compile failed: ' + log);
    }
    return s;
  }

  function makeProgram(vsSrc, fsSrc, attribs) {
    var vs = compile(gl.VERTEX_SHADER, vsSrc);
    var fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    var p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    /* fixed attribute locations so enabled-array bookkeeping is trivial */
    for (var i = 0; i < attribs.length; i++) gl.bindAttribLocation(p, i, attribs[i]);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      var log = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new Error('Program link failed: ' + log);
    }
    var u = {};
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var k = 0; k < n; k++) {
      var info = gl.getActiveUniform(p, k);
      var name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, info.name);
    }
    return { p: p, u: u };
  }

  function makeTexture(src, repeat) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    var wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
  }

  function makeBuffer(data, dynamic) {
    var b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    return b;
  }

  /* enable exactly the attribs needed for this draw; disable stale ones */
  function useAttribs(list) {
    for (var i = 0; i < enabledAttrs.length; i++) gl.disableVertexAttribArray(enabledAttrs[i]);
    enabledAttrs.length = 0;
    for (var j = 0; j < list.length; j++) {
      var a = list[j];
      gl.enableVertexAttribArray(a[0]);
      gl.vertexAttribPointer(a[0], a[1], gl.FLOAT, false, a[2], a[3]);
      enabledAttrs.push(a[0]);
    }
  }

  var CHUNK_ATTRS = [[0, 3, 28, 0], [1, 2, 28, 12], [2, 1, 28, 20], [3, 1, 28, 24]];
  var PART_ATTRS = [[0, 3, 40, 0], [1, 2, 40, 12], [2, 2, 40, 20], [3, 1, 40, 28], [4, 1, 40, 32], [5, 1, 40, 36]];

  /* ------------------------------------------------------------------ */
  /* geometry builders                                                   */
  /* ------------------------------------------------------------------ */

  /* Face table. Corners are CCW seen from OUTSIDE (cull BACK).
     Each face: 4 corners {p:[x,y,z], uv:[u,v]}, shade, and per-corner AO
     sample offsets [side1, side2, corner] on the face's outer side.
     UV rule: v0 = TOP of tile image; on side faces higher world Y gets v0. */
  var FACES = [
    { /* +Y (top) */ shade: 1.0, c: [
      { p: [0, 1, 1], uv: [0, 1], ao: [[-1, 1, 0], [0, 1, 1], [-1, 1, 1]] },
      { p: [1, 1, 1], uv: [1, 1], ao: [[1, 1, 0], [0, 1, 1], [1, 1, 1]] },
      { p: [1, 1, 0], uv: [1, 0], ao: [[1, 1, 0], [0, 1, -1], [1, 1, -1]] },
      { p: [0, 1, 0], uv: [0, 0], ao: [[-1, 1, 0], [0, 1, -1], [-1, 1, -1]] }
    ] },
    { /* -Y (bottom) */ shade: 0.5, c: [
      { p: [0, 0, 0], uv: [0, 0], ao: [[-1, -1, 0], [0, -1, -1], [-1, -1, -1]] },
      { p: [1, 0, 0], uv: [1, 0], ao: [[1, -1, 0], [0, -1, -1], [1, -1, -1]] },
      { p: [1, 0, 1], uv: [1, 1], ao: [[1, -1, 0], [0, -1, 1], [1, -1, 1]] },
      { p: [0, 0, 1], uv: [0, 1], ao: [[-1, -1, 0], [0, -1, 1], [-1, -1, 1]] }
    ] },
    { /* +Z (south) */ shade: 0.8, c: [
      { p: [0, 0, 1], uv: [0, 1], ao: [[-1, 0, 1], [0, -1, 1], [-1, -1, 1]] },
      { p: [1, 0, 1], uv: [1, 1], ao: [[1, 0, 1], [0, -1, 1], [1, -1, 1]] },
      { p: [1, 1, 1], uv: [1, 0], ao: [[1, 0, 1], [0, 1, 1], [1, 1, 1]] },
      { p: [0, 1, 1], uv: [0, 0], ao: [[-1, 0, 1], [0, 1, 1], [-1, 1, 1]] }
    ] },
    { /* -Z (north) */ shade: 0.8, c: [
      { p: [1, 0, 0], uv: [0, 1], ao: [[1, 0, -1], [0, -1, -1], [1, -1, -1]] },
      { p: [0, 0, 0], uv: [1, 1], ao: [[-1, 0, -1], [0, -1, -1], [-1, -1, -1]] },
      { p: [0, 1, 0], uv: [1, 0], ao: [[-1, 0, -1], [0, 1, -1], [-1, 1, -1]] },
      { p: [1, 1, 0], uv: [0, 0], ao: [[1, 0, -1], [0, 1, -1], [1, 1, -1]] }
    ] },
    { /* +X (east) */ shade: 0.6, c: [
      { p: [1, 0, 1], uv: [0, 1], ao: [[1, 0, 1], [1, -1, 0], [1, -1, 1]] },
      { p: [1, 0, 0], uv: [1, 1], ao: [[1, 0, -1], [1, -1, 0], [1, -1, -1]] },
      { p: [1, 1, 0], uv: [1, 0], ao: [[1, 0, -1], [1, 1, 0], [1, 1, -1]] },
      { p: [1, 1, 1], uv: [0, 0], ao: [[1, 0, 1], [1, 1, 0], [1, 1, 1]] }
    ] },
    { /* -X (west) */ shade: 0.6, c: [
      { p: [0, 0, 0], uv: [0, 1], ao: [[-1, 0, -1], [0, -1, 0], [-1, -1, -1]] },
      { p: [0, 0, 1], uv: [1, 1], ao: [[-1, 0, 1], [0, -1, 0], [-1, -1, 1]] },
      { p: [0, 1, 1], uv: [1, 0], ao: [[-1, 0, 1], [0, 1, 0], [-1, 1, 1]] },
      { p: [0, 1, 0], uv: [0, 0], ao: [[-1, 0, -1], [0, 1, 0], [-1, 1, -1]] }
    ] }
  ];
  /* neighbor direction per face (for visibility test) */
  var FACE_DIR = [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]];

  function buildUnitCube() {
    var arr = [];
    for (var f = 0; f < 6; f++) {
      var face = FACES[f], c = face.c;
      var order = [0, 1, 2, 0, 2, 3];
      for (var i = 0; i < 6; i++) {
        var v = c[order[i]];
        arr.push(v.p[0] - 0.5, v.p[1] - 0.5, v.p[2] - 0.5, face.shade);
      }
    }
    return makeBuffer(new Float32Array(arr), false);
  }

  function buildSkyCube() {
    var s = 450, arr = [];
    for (var f = 0; f < 6; f++) {
      var c = FACES[f].c, order = [0, 1, 2, 0, 2, 3];
      for (var i = 0; i < 6; i++) {
        var p = c[order[i]].p;
        arr.push((p[0] * 2 - 1) * s, (p[1] * 2 - 1) * s, (p[2] * 2 - 1) * s);
      }
    }
    return makeBuffer(new Float32Array(arr), false);
  }

  function buildSelectionCube() {
    /* unit cube edges, 24 line verts, centered at origin */
    var v = [];
    for (var i = 0; i < 8; i++) v.push([(i & 1) ? 0.5 : -0.5, (i & 2) ? 0.5 : -0.5, (i & 4) ? 0.5 : -0.5]);
    var edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    var arr = [];
    for (var e = 0; e < edges.length; e++) {
      var a = v[edges[e][0]], b = v[edges[e][1]];
      arr.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
    return makeBuffer(new Float32Array(arr), false);
  }

  function buildCloudPlane() {
    var s = 1024, y = 132;
    return makeBuffer(new Float32Array([
      -s, y, -s, s, y, -s, s, y, s,
      -s, y, -s, s, y, s, -s, y, s
    ]), false);
  }

  /* crack overlay cube in WORLD space: pos3+uv2+shade1+wave1, inflate 1.004 */
  function buildCrackBuffer(hit, stage) {
    var uv = UV[Blocks.CRACK_TILES[stage]];
    var u0 = uv[0], v0 = uv[1], u1 = uv[2], v1 = uv[3];
    var lo = -0.002, hi = 1.002;
    var arr = [];
    for (var f = 0; f < 6; f++) {
      var c = FACES[f].c, order = [0, 1, 2, 0, 2, 3];
      for (var i = 0; i < 6; i++) {
        var v = c[order[i]];
        arr.push(
          hit.x + (v.p[0] ? hi : lo), hit.y + (v.p[1] ? hi : lo), hit.z + (v.p[2] ? hi : lo),
          v.uv[0] ? u1 : u0, v.uv[1] ? v1 : v0,
          1.0, 0.0
        );
      }
    }
    var data = new Float32Array(arr);
    if (!crackBuf) crackBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, crackBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    crackVertCount = 36;
  }

  /* ------------------------------------------------------------------ */
  /* chunk meshing                                                       */
  /* ------------------------------------------------------------------ */

  function buildChunkMesh(chunk) {
    var cx = chunk.cx, cz = chunk.cz;
    var bx = cx * CHUNK, bz = cz * CHUNK;
    var blocks = chunk.blocks;
    var nXm = World.chunks.get((cx - 1) + ',' + cz);
    var nXp = World.chunks.get((cx + 1) + ',' + cz);
    var nZm = World.chunks.get(cx + ',' + (cz - 1));
    var nZp = World.chunks.get(cx + ',' + (cz + 1));
    var bXm = nXm ? nXm.blocks : null, bXp = nXp ? nXp.blocks : null;
    var bZm = nZm ? nZm.blocks : null, bZp = nZp ? nZp.blocks : null;

    /* fast block read: own chunk + 4 direct neighbors, else World.get */
    function get(x, y, z) {
      if (y < 0) return 12;
      if (y >= HEIGHT) return 0;
      var lx = x - bx, lz = z - bz;
      if (lx >= 0 && lx < CHUNK && lz >= 0 && lz < CHUNK) return blocks[(y * CHUNK + lz) * CHUNK + lx];
      if (lx === -1 && lz >= 0 && lz < CHUNK && bXm) return bXm[(y * CHUNK + lz) * CHUNK + 15];
      if (lx === CHUNK && lz >= 0 && lz < CHUNK && bXp) return bXp[(y * CHUNK + lz) * CHUNK];
      if (lz === -1 && lx >= 0 && lx < CHUNK && bZm) return bZm[(y * CHUNK + 15) * CHUNK + lx];
      if (lz === CHUNK && lx >= 0 && lx < CHUNK && bZp) return bZp[(y * CHUNK) * CHUNK + lx];
      return World.get(x, y, z);
    }

    var solid = [], trans = [];
    var ao = [0, 0, 0, 0];

    /* sky exposure per column (18x18 incl. 1-cell margin): topmost opaque block.
       Faces below it darken with depth -> dark caves, lit entrances/cliffs. */
    var tops = new Int16Array(18 * 18);
    for (var tz = -1; tz <= CHUNK; tz++) {
      for (var tx = -1; tx <= CHUNK; tx++) {
        var top = -1;
        for (var ty = HEIGHT - 1; ty >= 0; ty--) {
          if (OPAQUE[get(bx + tx, ty, bz + tz)]) { top = ty; break; }
        }
        tops[(tz + 1) * 18 + (tx + 1)] = top;
      }
    }
    function colFactor(lx, lz, wy) {
      var t = tops[(lz + 1) * 18 + (lx + 1)];
      if (wy >= t) return 1;
      var d = t - wy;
      return d >= 6 ? 0.32 : 1 - d * 0.113;
    }

    for (var y = 0; y < HEIGHT; y++) {
      for (var z = 0; z < CHUNK; z++) {
        var rowBase = (y * CHUNK + z) * CHUNK;
        for (var x = 0; x < CHUNK; x++) {
          var id = blocks[rowBase + x];
          if (id === 0) continue;
          var def = Blocks.BY_ID[id];
          var isWater = (id === 11);
          var isTrans = (def.pass === 'trans');
          var out = isTrans ? trans : solid;
          var wx = bx + x, wy = y, wz = bz + z;

          /* surface water: lowered top (y+0.88) + wave on top verts */
          var lowered = false;
          if (isWater) {
            var above = get(wx, y + 1, wz);
            lowered = (above !== 11 && !OPAQUE[above]);
          }

          var tiles = def.tiles;
          for (var f = 0; f < 6; f++) {
            var d = FACE_DIR[f];
            var nid = get(wx + d[0], wy + d[1], wz + d[2]);
            if (nid !== 0 && (OPAQUE[nid] || nid === id)) continue;

            var face = FACES[f];
            var tile = (f === 0) ? tiles.top : (f === 1 ? tiles.bottom : tiles.side);
            var tuv = UV[tile];
            var shade = FACE_SHADE[f];
            /* sky light: own column or the column the face looks into, whichever is brighter */
            var sky = colFactor(x, z, wy);
            var fx = x + d[0], fz = z + d[2];
            if (fx >= -1 && fx <= CHUNK && fz >= -1 && fz <= CHUNK) {
              var sky2 = colFactor(fx, fz, wy);
              if (sky2 > sky) sky = sky2;
            }
            shade *= sky;

            /* vertex AO: opaque neighbors only */
            for (var k = 0; k < 4; k++) {
              var o = face.c[k].ao;
              var s1 = OPAQUE[get(wx + o[0][0], wy + o[0][1], wz + o[0][2])];
              var s2 = OPAQUE[get(wx + o[1][0], wy + o[1][1], wz + o[1][2])];
              var co = OPAQUE[get(wx + o[2][0], wy + o[2][1], wz + o[2][2])];
              ao[k] = (s1 && s2) ? 0 : (3 - (s1 + s2 + co));
            }

            /* flip quad diagonal to avoid AO interpolation artifacts */
            var idx = (ao[0] + ao[2] > ao[1] + ao[3]) ? IDX_FLIP : IDX_STD;
            for (var i = 0; i < 6; i++) {
              var ci = idx[i];
              var corner = face.c[ci];
              var px = wx + corner.p[0];
              var py = wy + corner.p[1];
              var pz = wz + corner.p[2];
              var wave = 0;
              if (lowered && corner.p[1] === 1) { py = wy + 0.88; wave = 1; }
              out.push(
                px, py, pz,
                corner.uv[0] ? tuv[2] : tuv[0],
                corner.uv[1] ? tuv[3] : tuv[1],
                shade * AO_MULT[ao[ci]],
                wave
              );
            }
          }
        }
      }
    }

    /* replace GL buffers (delete old first) */
    if (chunk.mesh) gl.deleteBuffer(chunk.mesh);
    if (chunk.meshTrans) gl.deleteBuffer(chunk.meshTrans);
    chunk.mesh = solid.length ? makeBuffer(new Float32Array(solid), false) : null;
    chunk.meshTrans = trans.length ? makeBuffer(new Float32Array(trans), false) : null;
    chunk.solidCount = solid.length / 7;
    chunk.transCount = trans.length / 7;
    chunk.dirty = false;
  }

  function updateMeshes(px, pz, budget) {
    if (!ready) return;
    var pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    var list = [];
    for (var dz = -MESH_RADIUS; dz <= MESH_RADIUS; dz++) {
      for (var dx = -MESH_RADIUS; dx <= MESH_RADIUS; dx++) {
        var cx = pcx + dx, cz = pcz + dz;
        var c = World.chunks.get(cx + ',' + cz);
        if (!c || !c.dirty) continue;
        if (!World.hasChunk(cx - 1, cz) || !World.hasChunk(cx + 1, cz) ||
            !World.hasChunk(cx, cz - 1) || !World.hasChunk(cx, cz + 1)) continue;
        list.push({ c: c, d: dx * dx + dz * dz });
      }
    }
    list.sort(function (a, b) { return a.d - b.d; });
    var n = Math.min(budget == null ? 2 : budget, list.length);
    for (var i = 0; i < n; i++) buildChunkMesh(list[i].c);
  }

  function onChunkUnload(chunk) {
    if (gl) {
      if (chunk.mesh) gl.deleteBuffer(chunk.mesh);
      if (chunk.meshTrans) gl.deleteBuffer(chunk.meshTrans);
    }
    chunk.mesh = null;
    chunk.meshTrans = null;
    chunk.solidCount = 0;
    chunk.transCount = 0;
  }

  /* ------------------------------------------------------------------ */
  /* held-block viewmodel (first-person hand)                            */
  /* ------------------------------------------------------------------ */

  var vmBuf = null, vmId = -1;
  var vmData = new Float32Array(36 * 7);
  function buildViewmodel(id) {
    var def = Blocks.BY_ID[id] || Blocks.BY_ID[1];
    var tiles = def.tiles, o = 0;
    for (var f = 0; f < 6; f++) {
      var face = FACES[f];
      var tile = (f === 0) ? tiles.top : (f === 1 ? tiles.bottom : tiles.side);
      var tuv = UV[tile];
      var order = [0, 1, 2, 0, 2, 3];
      for (var i = 0; i < 6; i++) {
        var c = face.c[order[i]];
        vmData[o++] = c.p[0] - 0.5; vmData[o++] = c.p[1] - 0.5; vmData[o++] = c.p[2] - 0.5;
        vmData[o++] = c.uv[0] ? tuv[2] : tuv[0];
        vmData[o++] = c.uv[1] ? tuv[3] : tuv[1];
        vmData[o++] = FACE_SHADE[f];
        vmData[o++] = 0;
      }
    }
    if (!vmBuf) vmBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vmBuf);
    gl.bufferData(gl.ARRAY_BUFFER, vmData, gl.STATIC_DRAW);
  }
  function renderViewmodel(state, proj, lightColor) {
    if (!state.showViewmodel || !ready) return;
    var id = state.selectedBlock || 1;
    if (id !== vmId) { buildViewmodel(id); vmId = id; }
    var sw = Math.sin((state.swing || 0) * Math.PI);
    var model = Util.m4.boxModel(
      0.40 + (state.bobX || 0) * 0.6,
      -0.36 + (state.bobY || 0) * 0.8 - sw * 0.10,
      -0.62 - sw * 0.12,
      0.30, 0.30, 0.30, 0.18 + sw * 0.45, -0.55);
    var cp = P.chunk;
    gl.useProgram(cp.p);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix4fv(cp.u.uProj, false, proj);
    gl.uniformMatrix4fv(cp.u.uView, false, IDENT);
    gl.uniformMatrix4fv(cp.u.uModel, false, model);
    gl.uniform3f(cp.u.uCamPos, 0, 0, 0);
    gl.uniform3fv(cp.u.uLightColor, lightColor);
    gl.uniform1f(cp.u.uFogNear, 1000);
    gl.uniform1f(cp.u.uFogFar, 1001);
    gl.uniform1f(cp.u.uAlphaTest, 0.05);
    gl.uniform1f(cp.u.uTime, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texAtlas);
    gl.uniform1i(cp.u.uAtlas, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, vmBuf);
    useAttribs(CHUNK_ATTRS);
    gl.drawArrays(gl.TRIANGLES, 0, 36);
  }

  /* ------------------------------------------------------------------ */
  /* particles                                                           */
  /* ------------------------------------------------------------------ */

  var pCount = 0, pHead = 0;
  var pPos = new Float32Array(MAX_PARTICLES * 3);
  var pVel = new Float32Array(MAX_PARTICLES * 3);
  var pLife = new Float32Array(MAX_PARTICLES);
  var pMaxLife = new Float32Array(MAX_PARTICLES);
  var pSize = new Float32Array(MAX_PARTICLES);
  var pUVo = new Float32Array(MAX_PARTICLES * 2);
  var pUVs = new Float32Array(MAX_PARTICLES * 2);
  var pShade = new Float32Array(MAX_PARTICLES);
  var pVertData = new Float32Array(MAX_PARTICLES * 10);

  function spawnParticle(x, y, z, vx, vy, vz, life, size, uo0, uo1, us0, us1, shade) {
    var i;
    if (pCount < MAX_PARTICLES) { i = pCount++; }
    else { i = pHead; pHead = (pHead + 1) % MAX_PARTICLES; } /* drop oldest */
    var i3 = i * 3, i2 = i * 2;
    pPos[i3] = x; pPos[i3 + 1] = y; pPos[i3 + 2] = z;
    pVel[i3] = vx; pVel[i3 + 1] = vy; pVel[i3 + 2] = vz;
    pLife[i] = life; pMaxLife[i] = life; pSize[i] = size;
    pUVo[i2] = uo0; pUVo[i2 + 1] = uo1;
    pUVs[i2] = us0; pUVs[i2 + 1] = us1;
    pShade[i] = shade;
  }

  function spawnBlockParticles(x, y, z, id, count) {
    if (!ready || !id) return;
    var def = Blocks.BY_ID[id];
    if (!def) return;
    var uv = UV[def.tiles.side];
    var tileW = uv[2] - uv[0], tileH = uv[3] - uv[1];
    var sub = 4 / 256; /* random 4x4-pixel sub-region of the side tile */
    for (var n = 0; n < count; n++) {
      var ox = uv[0] + Math.random() * (tileW - sub);
      var oy = uv[1] + Math.random() * (tileH - sub);
      spawnParticle(
        x + (Math.random() - 0.5) * 0.6,
        y + (Math.random() - 0.5) * 0.6,
        z + (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 3.5,
        Math.random() * 3.0 + 1.2,
        (Math.random() - 0.5) * 3.5,
        0.6 + Math.random() * 0.6,
        0.08 + Math.random() * 0.08,
        ox, oy, sub, sub,
        1.0
      );
    }
  }

  function spawnSplash(x, y, z) {
    if (!ready) return;
    /* white-blue droplets: sample the water tile, brightened via shade */
    var uv = UV[Blocks.BY_ID[11].tiles.side];
    var tileW = uv[2] - uv[0], tileH = uv[3] - uv[1];
    var sub = 4 / 256;
    for (var n = 0; n < 14; n++) {
      var ox = uv[0] + Math.random() * (tileW - sub);
      var oy = uv[1] + Math.random() * (tileH - sub);
      spawnParticle(
        x + (Math.random() - 0.5) * 0.7,
        y + Math.random() * 0.2,
        z + (Math.random() - 0.5) * 0.7,
        (Math.random() - 0.5) * 3.0,
        2.5 + Math.random() * 3.5,
        (Math.random() - 0.5) * 3.0,
        0.4 + Math.random() * 0.4,
        0.06 + Math.random() * 0.06,
        ox, oy, sub, sub,
        1.4 + Math.random() * 0.5
      );
    }
  }

  function updateParticles(dt) {
    var i = 0;
    while (i < pCount) {
      pLife[i] -= dt;
      if (pLife[i] <= 0) {
        /* swap-remove with last alive */
        pCount--;
        if (i !== pCount) {
          var a = i * 3, b = pCount * 3, a2 = i * 2, b2 = pCount * 2;
          pPos[a] = pPos[b]; pPos[a + 1] = pPos[b + 1]; pPos[a + 2] = pPos[b + 2];
          pVel[a] = pVel[b]; pVel[a + 1] = pVel[b + 1]; pVel[a + 2] = pVel[b + 2];
          pUVo[a2] = pUVo[b2]; pUVo[a2 + 1] = pUVo[b2 + 1];
          pUVs[a2] = pUVs[b2]; pUVs[a2 + 1] = pUVs[b2 + 1];
          pLife[i] = pLife[pCount]; pMaxLife[i] = pMaxLife[pCount];
          pSize[i] = pSize[pCount]; pShade[i] = pShade[pCount];
        }
        continue;
      }
      var i3 = i * 3;
      pVel[i3 + 1] -= 20 * dt;
      var nx = pPos[i3] + pVel[i3] * dt;
      var ny = pPos[i3 + 1] + pVel[i3 + 1] * dt;
      var nz = pPos[i3 + 2] + pVel[i3 + 2] * dt;
      /* cheap collision: only when moving down; settle then fade */
      if (pVel[i3 + 1] < 0 && World.isSolid(Math.floor(nx), Math.floor(ny), Math.floor(nz))) {
        pVel[i3] = 0; pVel[i3 + 1] = 0; pVel[i3 + 2] = 0;
      } else {
        pPos[i3] = nx; pPos[i3 + 1] = ny; pPos[i3 + 2] = nz;
      }
      i++;
    }
    if (pHead >= pCount) pHead = 0;
  }

  function renderParticles(proj, view, camX, camY, camZ, light, fogColor, fogNear, fogFar) {
    if (pCount === 0) return;
    var d = pVertData, o = 0;
    for (var i = 0; i < pCount; i++) {
      var i3 = i * 3, i2 = i * 2;
      var frac = pLife[i] / pMaxLife[i];
      var alpha = frac < 0.3 ? frac / 0.3 : 1.0; /* fade last 30% */
      d[o] = pPos[i3]; d[o + 1] = pPos[i3 + 1]; d[o + 2] = pPos[i3 + 2];
      d[o + 3] = pUVo[i2]; d[o + 4] = pUVo[i2 + 1];
      d[o + 5] = pUVs[i2]; d[o + 6] = pUVs[i2 + 1];
      d[o + 7] = pSize[i]; d[o + 8] = alpha; d[o + 9] = pShade[i];
      o += 10;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, particleBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.subarray(0, pCount * 10));
    var pr = P.particle;
    gl.useProgram(pr.p);
    gl.uniformMatrix4fv(pr.u.uProj, false, proj);
    gl.uniformMatrix4fv(pr.u.uView, false, view);
    gl.uniform3f(pr.u.uCamPos, camX, camY, camZ);
    gl.uniform1f(pr.u.uViewportH, viewH);
    gl.uniform3fv(pr.u.uLightColor, light);
    gl.uniform3fv(pr.u.uFogColor, fogColor);
    gl.uniform1f(pr.u.uFogNear, fogNear);
    gl.uniform1f(pr.u.uFogFar, fogFar);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texAtlas);
    gl.uniform1i(pr.u.uAtlas, 0);
    useAttribs(PART_ATTRS);
    gl.drawArrays(gl.POINTS, 0, pCount);
  }

  /* ------------------------------------------------------------------ */
  /* init / resize                                                       */
  /* ------------------------------------------------------------------ */

  function init(cnv) {
    canvas = cnv;
    var opts = { antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance' };
    gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('WebGL is not supported on this device/browser.');

    P.chunk = makeProgram(CHUNK_VS, CHUNK_FS, ['aPos', 'aUV', 'aShade', 'aWave']);
    P.sky = makeProgram(SKY_VS, SKY_FS, ['aPos']);
    P.billboard = makeProgram(BB_VS, BB_FS, ['aPos', 'aUV']);
    P.cloud = makeProgram(CLOUD_VS, CLOUD_FS, ['aPos']);
    P.entity = makeProgram(ENT_VS, ENT_FS, ['aPos', 'aShade']);
    P.particle = makeProgram(PART_VS, PART_FS, ['aPos', 'aUVOrigin', 'aUVScale', 'aSize', 'aAlpha', 'aShade']);
    P.line = makeProgram(LINE_VS, LINE_FS, ['aPos']);

    texAtlas = makeTexture(Blocks.atlasCanvas, false);
    texSun = makeTexture(Blocks.sunCanvas, false);
    texMoon = makeTexture(Blocks.moonCanvas, false);
    texCloud = makeTexture(Blocks.cloudCanvas, true);

    /* block opacity table + inset UV table */
    for (var id = 0; id < 256; id++) {
      var def = Blocks.BY_ID[id];
      OPAQUE[id] = (def && def.opaque) ? 1 : 0;
    }
    for (var t = 0; t < 256; t++) {
      var uv = Blocks.tileUV(t);
      UV[t] = [uv[0] + HALF_TEXEL, uv[1] + HALF_TEXEL, uv[2] - HALF_TEXEL, uv[3] - HALF_TEXEL];
    }

    cubeBuf = buildUnitCube();
    skyBuf = buildSkyCube();
    selBuf = buildSelectionCube();
    cloudBuf = buildCloudPlane();
    bbBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bbBuf);
    gl.bufferData(gl.ARRAY_BUFFER, bbData.byteLength, gl.DYNAMIC_DRAW);
    particleBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, particleBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pVertData.byteLength, gl.DYNAMIC_DRAW);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.clearDepth(1);

    ready = true;
    resize();
    return true;
  }

  function resize() {
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    var h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    viewW = w; viewH = h;
    if (gl) gl.viewport(0, 0, w, h);
  }

  /* ------------------------------------------------------------------ */
  /* selection / crack                                                   */
  /* ------------------------------------------------------------------ */

  function setSelection(hit) { selection = hit || null; }

  function setCrack(hit, progress) {
    crackHit = hit || null;
    crackProgress = (progress === null || progress === undefined) ? null : progress;
    if (!ready || !crackHit || crackProgress === null || crackProgress <= 0) { crackStage = -1; return; }
    var stage = Math.min(3, Math.floor(crackProgress * 4));
    var key = crackHit.x + ',' + crackHit.y + ',' + crackHit.z + ',' + stage;
    if (key !== crackKey) {
      buildCrackBuffer(crackHit, stage);
      crackStage = stage;
      crackKey = key;
    }
  }

  /* ------------------------------------------------------------------ */
  /* day/night palette                                                   */
  /* ------------------------------------------------------------------ */

  function pulse(t, center, width) {
    var d = Math.abs(t - center);
    d = Math.min(d, 1 - d); /* wrap around cycle */
    if (d >= width) return 0;
    var x = 1 - d / width;
    return x * x * (3 - 2 * x);
  }
  function mix3(out, a, b, t) {
    out[0] = a[0] + (b[0] - a[0]) * t;
    out[1] = a[1] + (b[1] - a[1]) * t;
    out[2] = a[2] + (b[2] - a[2]) * t;
    return out;
  }

  var MID_Z = [0x05 / 255, 0x07 / 255, 0x0f / 255], MID_H = [0x0b / 255, 0x0e / 255, 0x1a / 255];
  var DAY_Z = [0x4a / 255, 0x90 / 255, 0xe2 / 255], DAY_H = [0xa8 / 255, 0xcf / 255, 0xf0 / 255];
  var SET_Z = [0x35 / 255, 0x50 / 255, 0x7e / 255], SET_H = [0xff / 255, 0x9a / 255, 0x40 / 255];
  var NIGHT_LIGHT = [0.30, 0.34, 0.48], DAY_LIGHT = [1, 1, 1], WARM = [1.0, 0.85, 0.7];
  var SUNSET_BAND = [1.0, 0.45, 0.18];
  var UW_FOG = [0.05, 0.18, 0.42];
  var CLOUD_NIGHT = [0.16, 0.18, 0.26], CLOUD_WARM = [1.0, 0.62, 0.45];

  var zenith = [0, 0, 0], horizon = [0, 0, 0], tmpA = [0, 0, 0], tmpB = [0, 0, 0];
  var lightColor = [0, 0, 0], fogColor = [0, 0, 0], cloudTint = [0, 0, 0], sunTint = [0, 0, 0];

  /* ------------------------------------------------------------------ */
  /* render                                                              */
  /* ------------------------------------------------------------------ */

  var stats = { chunks: 0, tris: 0, fps: 0 };

  function drawBillboard(proj, view, cx, cy, cz, dir, size, tex, tint, yaw, pitch) {
    var r = Util.right(yaw);
    var f = Util.forward(yaw, pitch);
    /* up = right x forward */
    var ux = r[1] * f[2] - r[2] * f[1];
    var uy = r[2] * f[0] - r[0] * f[2];
    var uz = r[0] * f[1] - r[1] * f[0];
    var hx = r[0] * size * 0.5, hy = r[1] * size * 0.5, hz = r[2] * size * 0.5;
    var vx = ux * size * 0.5, vy = uy * size * 0.5, vz = uz * size * 0.5;
    var px = cx + dir[0] * 400, py = cy + dir[1] * 400, pz = cz + dir[2] * 400;
    /* 6 verts: pos3+uv2; v0 = top of canvas (no flipY) */
    var d = bbData, o = 0;
    function put(x, y, z, u, v) { d[o++] = x; d[o++] = y; d[o++] = z; d[o++] = u; d[o++] = v; }
    put(px - hx - vx, py - hy - vy, pz - hz - vz, 0, 1);
    put(px + hx - vx, py + hy - vy, pz + hz - vz, 1, 1);
    put(px + hx + vx, py + hy + vy, pz + hz + vz, 1, 0);
    put(px - hx - vx, py - hy - vy, pz - hz - vz, 0, 1);
    put(px + hx + vx, py + hy + vy, pz + hz + vz, 1, 0);
    put(px - hx + vx, py - hy + vy, pz - hz + vz, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bbBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d);
    var pr = P.billboard;
    gl.useProgram(pr.p);
    gl.uniformMatrix4fv(pr.u.uProj, false, proj);
    gl.uniformMatrix4fv(pr.u.uView, false, view);
    gl.uniform3fv(pr.u.uTint, tint);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(pr.u.uTex, 0);
    useAttribs([[0, 3, 20, 0], [1, 2, 20, 12]]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function render(state) {
    if (!ready) return;
    var now = performance.now();
    var dt = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 0.016;
    lastTime = now;
    elapsed += dt;

    var camX = state.camX, camY = state.camY, camZ = state.camZ;
    var yaw = state.yaw, pitch = state.pitch;
    var time = state.time || 0;
    var dayFactor = Util.clamp(state.dayFactor === undefined ? 1 : state.dayFactor, 0, 1);

    /* ---- sun / sky palette ---- */
    var a = (time - 0.25) * Math.PI * 2;
    var sinA = Math.sin(a), cosA = Math.cos(a);
    var sl = Math.sqrt(cosA * cosA + sinA * sinA + 0.0625);
    var sunDir = [cosA / sl, sinA / sl, 0.25 / sl];
    var moonDir = [-sunDir[0], -sunDir[1], -sunDir[2]];
    var dayWeight = Util.clamp(sinA * 2.2, 0, 1);
    var sunsetWeight = Math.max(pulse(time, 0.25, 0.06), pulse(time, 0.75, 0.06));

    mix3(tmpA, MID_Z, DAY_Z, dayWeight);
    mix3(zenith, tmpA, SET_Z, sunsetWeight * 0.85);
    mix3(tmpA, MID_H, DAY_H, dayWeight);
    mix3(horizon, tmpA, SET_H, sunsetWeight);

    mix3(lightColor, NIGHT_LIGHT, DAY_LIGHT, dayFactor);
    mix3(lightColor, lightColor, WARM, sunsetWeight * 0.55);
    mix3(sunTint, [1, 1, 1], [1.0, 0.62, 0.35], sunsetWeight * 0.85);
    mix3(tmpB, CLOUD_NIGHT, [1, 1, 1], dayFactor);
    mix3(cloudTint, tmpB, CLOUD_WARM, sunsetWeight * 0.8);

    var underwater = !!state.underwater;
    var fogNear, fogFar;
    if (underwater) {
      fogColor[0] = UW_FOG[0]; fogColor[1] = UW_FOG[1]; fogColor[2] = UW_FOG[2];
      fogNear = 1; fogFar = 20;
    } else {
      fogColor[0] = horizon[0]; fogColor[1] = horizon[1]; fogColor[2] = horizon[2];
      fogNear = 0.55 * VIEW_DIST; fogFar = 0.95 * VIEW_DIST;
    }

    /* ---- matrices ---- */
    var aspect = viewW / Math.max(1, viewH);
    var fovRad = (state.fov || 70) * Math.PI / 180;
    var proj = Util.m4.perspective(fovRad, aspect, 0.1, 1000);
    var fwd = Util.forward(yaw, pitch);
    var view = Util.m4.lookAt([camX, camY, camZ], [camX + fwd[0], camY + fwd[1], camZ + fwd[2]], [0, 1, 0]);
    var vp = Util.m4.mul(proj, view);
    var planes = Util.frustumPlanes(vp);

    updateParticles(dt);

    gl.viewport(0, 0, viewW, viewH);
    gl.clearColor(fogColor[0], fogColor[1], fogColor[2], 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    stats.chunks = 0;
    stats.tris = 0;

    /* ---- 1. sky (rotation-only view, inside cube, no depth) ---- */
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    var skyView = Util.m4.lookAt([0, 0, 0], fwd, [0, 1, 0]);
    var sp = P.sky;
    gl.useProgram(sp.p);
    gl.uniformMatrix4fv(sp.u.uProj, false, proj);
    gl.uniformMatrix4fv(sp.u.uView, false, skyView);
    gl.uniform3fv(sp.u.uZenith, zenith);
    gl.uniform3fv(sp.u.uHorizon, horizon);
    gl.uniform3fv(sp.u.uSunsetBand, SUNSET_BAND);
    gl.uniform3fv(sp.u.uSunDir, sunDir);
    gl.uniform1f(sp.u.uSunsetWeight, sunsetWeight);
    gl.uniform1f(sp.u.uDayFactor, dayFactor);
    gl.uniform1f(sp.u.uTime, elapsed);
    gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
    useAttribs([[0, 3, 12, 0]]);
    gl.drawArrays(gl.TRIANGLES, 0, 36);

    /* ---- 2. sun & moon billboards ---- */
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (sunDir[1] > -0.12) drawBillboard(proj, view, camX, camY, camZ, sunDir, 55, texSun, sunTint, yaw, pitch);
    if (moonDir[1] > -0.12) drawBillboard(proj, view, camX, camY, camZ, moonDir, 38, texMoon, [1, 1, 1], yaw, pitch);
    gl.disable(gl.BLEND);

    /* ---- 3. opaque + cutout chunks ---- */
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    var cp = P.chunk;
    gl.useProgram(cp.p);
    gl.uniformMatrix4fv(cp.u.uModel, false, IDENT);
    gl.uniformMatrix4fv(cp.u.uProj, false, proj);
    gl.uniformMatrix4fv(cp.u.uView, false, view);
    gl.uniform1f(cp.u.uTime, elapsed);
    gl.uniform3fv(cp.u.uLightColor, lightColor);
    gl.uniform3fv(cp.u.uFogColor, fogColor);
    gl.uniform1f(cp.u.uFogNear, fogNear);
    gl.uniform1f(cp.u.uFogFar, fogFar);
    gl.uniform1f(cp.u.uAlphaTest, 0.5);
    gl.uniform3f(cp.u.uCamPos, camX, camY, camZ);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texAtlas);
    gl.uniform1i(cp.u.uAtlas, 0);

    transList.length = 0;
    transDist.length = 0;
    for (var entry of World.chunks) {
      var c = entry[1];
      var minx = c.cx * CHUNK, minz = c.cz * CHUNK;
      if (!Util.aabbInFrustum(planes, minx, 0, minz, minx + CHUNK, HEIGHT, minz + CHUNK)) continue;
      if (c.mesh && c.solidCount > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, c.mesh);
        useAttribs(CHUNK_ATTRS);
        gl.drawArrays(gl.TRIANGLES, 0, c.solidCount);
        stats.chunks++;
        stats.tris += c.solidCount / 3;
      }
      if (c.meshTrans && c.transCount > 0) {
        var dcx = minx + 8 - camX, dcz = minz + 8 - camZ;
        transList.push(c);
        transDist.push(dcx * dcx + dcz * dcz);
      }
    }

    /* ---- 4. clouds ---- */
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    var cl = P.cloud;
    gl.useProgram(cl.p);
    gl.uniformMatrix4fv(cl.u.uProj, false, proj);
    gl.uniformMatrix4fv(cl.u.uView, false, view);
    gl.uniform3fv(cl.u.uTint, cloudTint);
    var snapX = Math.round(camX / 8) * 8, snapZ = Math.round(camZ / 8) * 8;
    gl.uniform3f(cl.u.uOffset, snapX, 0, snapZ);
    gl.uniform3f(cl.u.uCenter, snapX, 132, snapZ);
    gl.uniform1f(cl.u.uTime, elapsed);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texCloud);
    gl.uniform1i(cl.u.uClouds, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, cloudBuf);
    useAttribs([[0, 3, 12, 0]]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.enable(gl.CULL_FACE);

    /* ---- 5. mobs ---- */
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    var mobs = state.mobs;
    if (mobs && mobs.length) {
      var ep = P.entity;
      gl.useProgram(ep.p);
      gl.uniformMatrix4fv(ep.u.uProj, false, proj);
      gl.uniformMatrix4fv(ep.u.uView, false, view);
      gl.uniform3f(ep.u.uCamPos, camX, camY, camZ);
      gl.uniform3fv(ep.u.uLightColor, lightColor);
      gl.uniform3fv(ep.u.uFogColor, fogColor);
      gl.uniform1f(ep.u.uFogNear, fogNear);
      gl.uniform1f(ep.u.uFogFar, fogFar);
      gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuf);
      useAttribs([[0, 3, 16, 0], [1, 1, 16, 12]]);
      for (var m = 0; m < mobs.length; m++) {
        var boxes = mobs[m].getBoxes();
        for (var b = 0; b < boxes.length; b++) {
          var box = boxes[b];
          var model = Util.m4.boxModel(box.cx, box.cy, box.cz, box.sx, box.sy, box.sz, box.rx || 0, box.ry || 0);
          gl.uniformMatrix4fv(ep.u.uModel, false, model);
          gl.uniform3f(ep.u.uColor, box.color[0] / 255, box.color[1] / 255, box.color[2] / 255);
          gl.drawArrays(gl.TRIANGLES, 0, 36);
          stats.tris += 12;
        }
      }
    }

    /* ---- 6. transparent chunks, far -> near ---- */
    if (transList.length > 1) {
      /* insertion sort on parallel arrays (small n, no allocation) */
      for (var i = 1; i < transList.length; i++) {
        var cc = transList[i], dd = transDist[i], j = i - 1;
        while (j >= 0 && transDist[j] < dd) {
          transList[j + 1] = transList[j];
          transDist[j + 1] = transDist[j];
          j--;
        }
        transList[j + 1] = cc;
        transDist[j + 1] = dd;
      }
    }
    gl.useProgram(cp.p);
    gl.uniform1f(cp.u.uAlphaTest, 0.02);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texAtlas); /* clouds bound their texture to unit 0 */
    gl.uniform1i(cp.u.uAtlas, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE); /* water & glass must render from below/inside too */
    for (var ti = 0; ti < transList.length; ti++) {
      var tc = transList[ti];
      gl.bindBuffer(gl.ARRAY_BUFFER, tc.meshTrans);
      useAttribs(CHUNK_ATTRS);
      gl.drawArrays(gl.TRIANGLES, 0, tc.transCount);
      stats.chunks++;
      stats.tris += tc.transCount / 3;
    }
    gl.enable(gl.CULL_FACE);

    /* ---- 7. particles ---- */
    renderParticles(proj, view, camX, camY, camZ, lightColor, fogColor, fogNear, fogFar);

    /* ---- 8. selection wireframe ---- */
    if (selection) {
      gl.depthMask(false);
      var lp = P.line;
      gl.useProgram(lp.p);
      var s = 1.002;
      var sm = Util.m4.boxModel(selection.x + 0.5, selection.y + 0.5, selection.z + 0.5, s, s, s, 0, 0);
      gl.uniformMatrix4fv(lp.u.uMVP, false, Util.m4.mul(vp, sm));
      gl.uniform4f(lp.u.uColor, 0.1, 0.1, 0.1, 0.6);
      gl.bindBuffer(gl.ARRAY_BUFFER, selBuf);
      useAttribs([[0, 3, 12, 0]]);
      gl.drawArrays(gl.LINES, 0, 24);
    }

    /* ---- 9. crack overlay (chunk program, LEQUAL, light-independent) ---- */
    if (crackHit && crackStage >= 0 && crackBuf) {
      gl.useProgram(cp.p);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthFunc(gl.LEQUAL);
      gl.uniform1f(cp.u.uAlphaTest, 0.05);
      gl.uniform3f(cp.u.uLightColor, 1, 1, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texAtlas);
      gl.uniform1i(cp.u.uAtlas, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, crackBuf);
      useAttribs(CHUNK_ATTRS);
      gl.drawArrays(gl.TRIANGLES, 0, crackVertCount);
      gl.depthFunc(gl.LESS);
    }

    /* ---- 10. held-block viewmodel ---- */
    renderViewmodel(state, proj, lightColor);

    /* restore steady state */
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
  }

  return {
    init: init,
    resize: resize,
    updateMeshes: updateMeshes,
    onChunkUnload: onChunkUnload,
    render: render,
    setSelection: setSelection,
    setCrack: setCrack,
    spawnBlockParticles: spawnBlockParticles,
    spawnSplash: spawnSplash,
    stats: stats
  };
})();
