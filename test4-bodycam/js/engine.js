/* ============================================================
   BODYCAM: OUTBREAK — core engine (raw WebGL2, zero dependencies)
   Everything is generated in code. No external assets.
   ============================================================ */
'use strict';

/* ---------------- math ---------------- */
const M4 = {
  ident() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  mul(a, b) { // a * b  (b applied first)
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  },
  persp(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
    m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = 2 * far * near / (near - far);
    return m;
  },
  translate(x, y, z) { const m = M4.ident(); m[12] = x; m[13] = y; m[14] = z; return m; },
  scale(x, y, z) { const m = M4.ident(); m[0] = x; m[5] = y; m[10] = z; return m; },
  rotX(a) { const c = Math.cos(a), s = Math.sin(a), m = M4.ident(); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; },
  rotY(a) { const c = Math.cos(a), s = Math.sin(a), m = M4.ident(); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; },
  rotZ(a) { const c = Math.cos(a), s = Math.sin(a), m = M4.ident(); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; },
  // model = T * Ry * Rx * Rz * S
  trs(pos, rot, scl) {
    let m = M4.translate(pos[0], pos[1], pos[2]);
    if (rot) {
      if (rot[1]) m = M4.mul(m, M4.rotY(rot[1]));
      if (rot[0]) m = M4.mul(m, M4.rotX(rot[0]));
      if (rot[2]) m = M4.mul(m, M4.rotZ(rot[2]));
    }
    if (scl) m = M4.mul(m, M4.scale(scl[0], scl[1], scl[2]));
    return m;
  },
  // view = Rz(-roll) * Rx(-pitch) * Ry(-yaw) * T(-pos)
  view(pos, yaw, pitch, roll) {
    let m = M4.translate(-pos[0], -pos[1], -pos[2]);
    if (yaw) m = M4.mul(M4.rotY(-yaw), m);
    if (pitch) m = M4.mul(M4.rotX(-pitch), m);
    if (roll) m = M4.mul(M4.rotZ(-roll), m);
    return m;
  },
  xform(m, p) {
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
    ];
  }
};
const V3 = {
  add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; },
  sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; },
  scl(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; },
  dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
  len(a) { return Math.hypot(a[0], a[1], a[2]); },
  dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); },
  distXZ(a, b) { return Math.hypot(a[0] - b[0], a[2] - b[2]); },
  norm(a) { const l = V3.len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; },
  cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
};
// forward vector for yaw/pitch (yaw=0 faces -Z, +yaw turns left, +pitch looks up)
function fwdVec(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}
function rightVec(yaw) { return [Math.cos(yaw), 0, -Math.sin(yaw)]; }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function lerp(a, b, t) { return a + (b - a) * t; }
function rnd(a = 1, b) { return b === undefined ? Math.random() * a : a + Math.random() * (b - a); }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

/* ---------------- engine ---------------- */
const Eng = {
  canvas: null, gl: null, time: 0, dt: 0.016, frame: 0,
  camera: { pos: [0, 1.62, 8], yaw: 0, pitch: 0, roll: 0, fov: 1.32 },
  ambient: [0.045, 0.05, 0.065],
  fog: { color: [0.012, 0.014, 0.02], density: 0.055 },
  lights: [],           // {pos:[x,y,z], color:[r,g,b], radius}  (max 20 used)
  spot: { pos: [0, 1.6, 8], dir: [0, 0, -1], color: [1.0, 0.97, 0.9], intensity: 4.2, inner: 0.975, outer: 0.88, range: 24, on: 1 },
  MAX_LIGHTS: 20,
  scene: { items: [], add(r) { this.items.push(r); return r; }, remove(r) { const i = this.items.indexOf(r); if (i >= 0) this.items.splice(i, 1); } },
  input: { keys: new Set(), dx: 0, dy: 0, buttons: [false, false, false], locked: false },
  fx: null, sparks: null,
  internalW: 960, internalH: 540,

  init(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) { alert('WebGL2 required'); throw new Error('no webgl2'); }
    this.gl = gl;
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.clearColor(0.01, 0.012, 0.02, 1);
    this._makeProgram();
    this._makePrimitives();
    this._spotCookie = this.texFromCanvas(this._makeCookieCanvas(), false);
    this.texShadow = this.texFromCanvas(this._makeShadowCanvas(), false);
    this.fx = new ParticleSys(600, 'alpha');
    this.sparks = new ParticleSys(256, 'add');
    this._makeFBO();
    this._bindInput();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  },

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(320, Math.floor(window.innerWidth * dpr));
    const h = Math.max(240, Math.floor(window.innerHeight * dpr));
    this.canvas.width = w; this.canvas.height = h;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    const aspect = w / h;
    const sc = this._internalScale || 1;
    this.internalH = Math.max(240, Math.round(540 * sc));
    this.internalW = clamp(Math.round(540 * aspect * sc), 384, 1280);
    this._makeFBO();
    if (window.PostFX) PostFX.resize(w, h);
  },

  /* recreate scene FBO at a resolution scale (0.6..1); PostFX stays at canvas res */
  setInternalScale(s) {
    this._internalScale = clamp(s, 0.6, 1);
    if (!this.canvas) return; // pre-init call (Perf loads before main) — resize() applies it
    const sc = this._internalScale;
    const aspect = this.canvas.width / this.canvas.height;
    this.internalH = Math.max(240, Math.round(540 * sc));
    this.internalW = clamp(Math.round(540 * aspect * sc), 384, 1280);
    this._makeFBO();
    if (window.PostFX) PostFX.resize(this.canvas.width, this.canvas.height);
  },

  /* procedural dirty-lens cookie: subtle smudges, dust specks, fingerprint arcs */
  _makeCookieCanvas() {
    const S = 128, c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    x.fillStyle = '#f4f4f4'; x.fillRect(0, 0, S, S);
    // soft radial smudges
    for (let i = 0; i < 14; i++) {
      const px = rnd(S), py = rnd(S), r = rnd(8, 34);
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      const v = (200 + rnd(30)) | 0;
      g.addColorStop(0, 'rgba(' + v + ',' + v + ',' + v + ',' + rnd(0.10, 0.30).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(' + v + ',' + v + ',' + v + ',0)');
      x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
    }
    // fingerprint arcs (concentric partial rings, off-center)
    const fx = rnd(S * 0.3, S * 0.7), fy = rnd(S * 0.3, S * 0.7);
    x.lineWidth = 1.4;
    for (let i = 0; i < 9; i++) {
      const a0 = rnd(Math.PI * 2);
      x.strokeStyle = 'rgba(190,190,190,' + rnd(0.08, 0.2).toFixed(3) + ')';
      x.beginPath(); x.arc(fx, fy, 5 + i * 3.2, a0, a0 + rnd(1.2, 3.4)); x.stroke();
    }
    // wipe streaks: elongated soft arcs left by a shirt-tail lens clean
    for (let i = 0; i < 3; i++) {
      x.save();
      x.translate(rnd(S), rnd(S));
      x.rotate(rnd(Math.PI * 2));
      x.scale(rnd(2.4, 3.6), 1);
      const r = rnd(10, 20);
      const g = x.createRadialGradient(0, 0, 0, 0, 0, r);
      const v = (205 + rnd(25)) | 0;
      g.addColorStop(0, 'rgba(' + v + ',' + v + ',' + v + ',' + rnd(0.06, 0.12).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(' + v + ',' + v + ',' + v + ',0)');
      x.fillStyle = g; x.beginPath(); x.arc(0, 0, r, 0, 7); x.fill();
      x.restore();
    }
    // dust specks
    for (let i = 0; i < 40; i++) {
      const v = (170 + rnd(60)) | 0;
      x.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + rnd(0.15, 0.4).toFixed(3) + ')';
      x.beginPath(); x.arc(rnd(S), rnd(S), rnd(0.5, 1.8), 0, 7); x.fill();
    }
    return c;
  },

  /* radial-gradient alpha blob for soft shadows (white rgb, alpha 1 -> 0) */
  _makeShadowCanvas() {
    const S = 128, c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    return c;
  },

  _makeFBO() {
    const gl = this.gl;
    if (this._fbo) { gl.deleteFramebuffer(this._fbo.fb); gl.deleteTexture(this._fbo.tex); gl.deleteRenderbuffer(this._fbo.depth); }
    const w = this.internalW, h = this.internalH;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._fbo = { fb, tex, depth, w, h };
  },

  _makeProgram() {
    const gl = this.gl;
    const vs = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUV;
layout(location=3) in vec4 aCol;
uniform mat4 uModel, uVP;
out vec3 vWorld; out vec3 vNrm; out vec2 vUV; out vec4 vCol;
void main(){
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNrm = normalize(mat3(uModel) * aNrm);
  vUV = aUV; vCol = aCol;
  gl_Position = uVP * w;
}`;
    const fs = `#version 300 es
precision highp float;
in vec3 vWorld; in vec3 vNrm; in vec2 vUV; in vec4 vCol;
out vec4 frag;
uniform vec3 uColor; uniform float uEmissive, uAlpha, uUseTex; uniform vec2 uTexScale;
uniform sampler2D uTex;
uniform vec3 uCamPos, uAmbient, uFogColor; uniform float uFogDensity;
uniform int uLightCount;
uniform vec3 uLightPos[20]; uniform vec3 uLightCol[20]; uniform float uLightRad[20];
uniform vec3 uSpotPos, uSpotDir, uSpotCol;
uniform float uSpotInner, uSpotOuter, uSpotOn, uSpotRange;
uniform sampler2D uSpotCookie;
void main(){
  vec4 base = vec4(uColor, uAlpha) * vCol;
  if (uUseTex > 0.5) { vec4 t = texture(uTex, vUV * uTexScale); base.rgb *= t.rgb; base.a *= t.a; }
  if (base.a < 0.02) discard;
  vec3 N = normalize(vNrm);
  vec3 V = normalize(uCamPos - vWorld);
  vec3 lit = uAmbient;
  float spec = 0.0;
  for (int i = 0; i < 20; i++) {
    if (i >= uLightCount) break;
    vec3 L = uLightPos[i] - vWorld; float d = length(L); L /= max(d, 0.001);
    float att = clamp(1.0 - d / uLightRad[i], 0.0, 1.0); att *= att;
    lit += uLightCol[i] * max(dot(N, L), 0.0) * att;
    vec3 H = normalize(L + V);
    spec += pow(max(dot(N, H), 0.0), 24.0) * att * 0.22;
  }
  if (uSpotOn > 0.5) {
    vec3 L = uSpotPos - vWorld; float d = length(L); L /= max(d, 0.001);
    float att = clamp(1.0 - d / uSpotRange, 0.0, 1.0); att *= att;
    float cd = dot(-L, normalize(uSpotDir));
    float cone = smoothstep(uSpotOuter, uSpotInner, cd);
    // dirty-lens cookie: project world pos into spot-cone uv
    vec3 D = normalize(uSpotDir);
    vec3 upRef = abs(D.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 T = normalize(cross(upRef, D));
    vec3 B = cross(D, T);
    vec3 rel = vWorld - uSpotPos;
    float fwd = max(dot(rel, D), 0.05);
    float tanO = sqrt(max(1.0 - uSpotOuter * uSpotOuter, 1e-4)) / max(uSpotOuter, 0.05);
    vec2 cuv = clamp(0.5 + vec2(dot(rel, T), dot(rel, B)) / (2.0 * fwd * tanO), 0.0, 1.0);
    float ck = dot(texture(uSpotCookie, cuv).rgb, vec3(0.3333));
    float cookie = 0.75 + 0.25 * ck;
    lit += uSpotCol * max(dot(N, L), 0.0) * att * cone * cookie;
    vec3 H = normalize(L + V);
    spec += pow(max(dot(N, H), 0.0), 32.0) * att * cone * cookie * 0.5;
  }
  vec3 col = base.rgb * lit + vec3(spec * 0.55);
  col = mix(col, base.rgb, uEmissive);
  float dist = length(uCamPos - vWorld);
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  frag = vec4(col, base.a);
}`;
    const compile = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s) + '\n' + src);
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    this.prog = p;
    this.u = {};
    const names = ['uModel', 'uVP', 'uColor', 'uEmissive', 'uAlpha', 'uUseTex', 'uTexScale', 'uTex', 'uCamPos', 'uAmbient', 'uFogColor', 'uFogDensity', 'uLightCount', 'uLightPos[0]', 'uLightCol[0]', 'uLightRad[0]', 'uSpotPos', 'uSpotDir', 'uSpotCol', 'uSpotInner', 'uSpotOuter', 'uSpotOn', 'uSpotRange', 'uSpotCookie'];
    for (const n of names) this.u[n] = gl.getUniformLocation(p, n);
  },

  createMesh(data) {
    const gl = this.gl;
    const n = data.pos.length / 3;
    const nrm = data.nrm || new Array(n * 3).fill(0);
    const uv = data.uv || new Array(n * 2).fill(0);
    const col = data.col || new Array(n * 4).fill(1);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const bind = (loc, arr, size) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    bind(0, data.pos, 3); bind(1, nrm, 3); bind(2, uv, 2); bind(3, col, 4);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(data.idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: data.idx.length };
  },

  _makePrimitives() {
    // unit cube centered at origin, per-face normals + uvs, white vertex colors
    const P = [], N = [], U = [], I = [];
    const faces = [
      { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
      { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
      { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
      { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
      { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
      { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] }
    ];
    faces.forEach((f, fi) => {
      const base = fi * 4;
      const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
      f.v.forEach((v, vi) => {
        P.push(v[0] * 0.5, v[1] * 0.5, v[2] * 0.5);
        N.push(...f.n); U.push(...uvs[vi]);
      });
      I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    this.meshCube = this.createMesh({ pos: P, nrm: N, uv: U, idx: I });
    // unit quad XY plane facing +Z
    this.meshQuad = this.createMesh({
      pos: [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0],
      nrm: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
      uv: [0, 0, 1, 0, 1, 1, 0, 1],
      idx: [0, 1, 2, 0, 2, 3]
    });
    // cylinder radius .5 height 1 along Y, 12 segments
    const CP = [], CN = [], CU = [], CI = []; const seg = 12;
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      CP.push(c * 0.5, -0.5, s * 0.5, c * 0.5, 0.5, s * 0.5);
      CN.push(c, 0, s, c, 0, s); CU.push(i / seg, 0, i / seg, 1);
    }
    for (let i = 0; i < seg; i++) { const b = i * 2; CI.push(b, b + 2, b + 3, b, b + 3, b + 1); }
    // caps
    let base = CP.length / 3;
    CP.push(0, 0.5, 0); CN.push(0, 1, 0); CU.push(0.5, 0.5);
    for (let i = 0; i <= seg; i++) { const a = i / seg * Math.PI * 2; CP.push(Math.cos(a) * 0.5, 0.5, Math.sin(a) * 0.5); CN.push(0, 1, 0); CU.push(0, 0); }
    for (let i = 0; i < seg; i++) CI.push(base, base + 1 + i + 1, base + 1 + i);
    base = CP.length / 3;
    CP.push(0, -0.5, 0); CN.push(0, -1, 0); CU.push(0.5, 0.5);
    for (let i = 0; i <= seg; i++) { const a = i / seg * Math.PI * 2; CP.push(Math.cos(a) * 0.5, -0.5, Math.sin(a) * 0.5); CN.push(0, -1, 0); CU.push(0, 0); }
    for (let i = 0; i < seg; i++) CI.push(base, base + 1 + i, base + 1 + i + 1);
    this.meshCyl = this.createMesh({ pos: CP, nrm: CN, uv: CU, idx: CI });
  },

  texFromCanvas(canvas, repeat = true) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const w = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    return t;
  },

  /* merged static geometry builder (per-vertex colors, one texture per builder) */
  builder(texScaleDefault = 1) {
    const pos = [], nrm = [], uv = [], col = [], idx = [];
    const B = {
      texScale: texScaleDefault,
      // box: center, size, color [r,g,b] (0..1), opts {rotY, uvScale, alpha}
      box(cx, cy, cz, sx, sy, sz, color, opts = {}) {
        const rotY = opts.rotY || 0, us = (opts.uvScale === undefined ? B.texScale : opts.uvScale);
        const c = Math.cos(rotY), s = Math.sin(rotY);
        const faces = [
          { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], w: sx, h: sy },
          { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]], w: sx, h: sy },
          { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]], w: sz, h: sy },
          { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]], w: sz, h: sy },
          { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]], w: sx, h: sz },
          { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]], w: sx, h: sz }
        ];
        const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
        const a = opts.alpha === undefined ? 1 : opts.alpha;
        for (const f of faces) {
          const base = pos.length / 3;
          f.v.forEach((v, vi) => {
            let x = v[0] * sx * 0.5, y = v[1] * sy * 0.5, z = v[2] * sz * 0.5;
            const rx = x * c + z * s, rz = -x * s + z * c;
            pos.push(cx + rx, cy + y, cz + rz);
            const nx = f.n[0] * c + f.n[2] * s, nz = -f.n[0] * s + f.n[2] * c;
            nrm.push(nx, f.n[1], nz);
            uv.push(uvs[vi][0] * f.w * us, uvs[vi][1] * f.h * us);
            col.push(color[0], color[1], color[2], a);
          });
          idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
        return B;
      },
      build() { return Eng.createMesh({ pos, nrm, uv, col, idx }); }
    };
    return B;
  },

  /* add a simple renderable */
  add(mesh, model, color, opts = {}) {
    const r = {
      mesh, model, color: color || [1, 1, 1],
      alpha: opts.alpha === undefined ? 1 : opts.alpha,
      emissive: opts.emissive || 0,
      tex: opts.tex || null,
      texScale: opts.texScale || [1, 1],
      blend: opts.blend || 'none',
      depthWrite: opts.depthWrite === undefined ? true : opts.depthWrite,
      doubleSided: opts.doubleSided || false,
      viewSpace: opts.viewSpace || false,
      visible: true
    };
    this.scene.add(r);
    return r;
  },

  _bindInput() {
    const inp = this.input;
    window.addEventListener('keydown', e => {
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF', 'KeyL', 'Space', 'ShiftLeft', 'Tab'].includes(e.code)) e.preventDefault();
      inp.keys.add(e.code);
    });
    window.addEventListener('keyup', e => inp.keys.delete(e.code));
    window.addEventListener('blur', () => { inp.keys.clear(); inp.buttons = [false, false, false]; });
    window.addEventListener('mousemove', e => {
      if (inp.locked) { inp.dx += e.movementX || 0; inp.dy += e.movementY || 0; }
    });
    window.addEventListener('mousedown', e => { if (inp.locked) inp.buttons[e.button] = true; });
    window.addEventListener('mouseup', e => { inp.buttons[e.button] = false; });
    window.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      inp.locked = document.pointerLockElement === this.canvas;
      if (window.Main) Main.onLockChange(inp.locked);
    });
  },
  mouseDelta() { const d = { dx: this.input.dx, dy: this.input.dy }; this.input.dx = 0; this.input.dy = 0; return d; },

  /* ------------- render ------------- */
  render() {
    const gl = this.gl, f = this._fbo;
    // particles
    this.fx.update(this.dt, this.camera);
    this.sparks.update(this.dt, this.camera);
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb);
    gl.viewport(0, 0, f.w, f.h);
    gl.clearColor(this.fog.color[0], this.fog.color[1], this.fog.color[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    gl.useProgram(this.prog);
    const cam = this.camera;
    const proj = M4.persp(cam.fov, f.w / f.h, 0.05, 140);
    const view = M4.view(cam.pos, cam.yaw, cam.pitch, cam.roll);
    const vp = M4.mul(proj, view);
    this._proj = proj;
    gl.uniformMatrix4fv(this.u.uVP, false, vp);
    gl.uniform3fv(this.u.uCamPos, cam.pos);
    gl.uniform3fv(this.u.uAmbient, this.ambient);
    gl.uniform3fv(this.u.uFogColor, this.fog.color);
    gl.uniform1f(this.u.uFogDensity, this.fog.density);
    // lights
    const L = this.lights, n = Math.min(L.length, this.MAX_LIGHTS);
    const lp = new Float32Array(60), lc = new Float32Array(60), lr = new Float32Array(20);
    for (let i = 0; i < n; i++) {
      lp.set(L[i].pos, i * 3); lc.set(L[i].color, i * 3); lr[i] = L[i].radius;
    }
    gl.uniform1i(this.u.uLightCount, n);
    gl.uniform3fv(this.u['uLightPos[0]'], lp);
    gl.uniform3fv(this.u['uLightCol[0]'], lc);
    gl.uniform1fv(this.u['uLightRad[0]'], lr);
    const sp = this.spot;
    gl.uniform3fv(this.u.uSpotPos, sp.pos);
    gl.uniform3fv(this.u.uSpotDir, sp.dir);
    gl.uniform3fv(this.u.uSpotCol, [sp.color[0] * sp.intensity, sp.color[1] * sp.intensity, sp.color[2] * sp.intensity]);
    gl.uniform1f(this.u.uSpotInner, sp.inner);
    gl.uniform1f(this.u.uSpotOuter, sp.outer);
    gl.uniform1f(this.u.uSpotOn, sp.on ? 1 : 0);
    gl.uniform1f(this.u.uSpotRange, sp.range);
    gl.uniform1i(this.u.uTex, 0);
    gl.uniform1i(this.u.uSpotCookie, 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._spotCookie);
    gl.activeTexture(gl.TEXTURE0);

    const items = this.scene.items;
    const opaque = [], trans = [], viewItems = [];
    for (const r of items) {
      if (!r.visible) continue;
      if (r.viewSpace) viewItems.push(r);
      else if (r.blend === 'none' && r.alpha >= 1) opaque.push(r);
      else trans.push(r);
    }
    const draw = r => {
      gl.uniformMatrix4fv(this.u.uModel, false, r.model);
      gl.uniform3fv(this.u.uColor, r.color);
      gl.uniform1f(this.u.uAlpha, r.alpha);
      gl.uniform1f(this.u.uEmissive, r.emissive);
      gl.uniform2fv(this.u.uTexScale, r.texScale);
      if (r.tex) { gl.bindTexture(gl.TEXTURE_2D, r.tex); gl.uniform1f(this.u.uUseTex, 1); }
      else gl.uniform1f(this.u.uUseTex, 0);
      if (r.doubleSided) gl.disable(gl.CULL_FACE); else gl.enable(gl.CULL_FACE);
      gl.depthMask(r.depthWrite);
      if (r.blend === 'alpha') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
      else if (r.blend === 'add') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); }
      else gl.disable(gl.BLEND);
      gl.bindVertexArray(r.mesh.vao);
      gl.drawElements(gl.TRIANGLES, r.mesh.count, gl.UNSIGNED_SHORT, 0);
    };
    for (const r of opaque) draw(r);
    // transparent: far to near
    trans.sort((a, b) => {
      const da = (a.model[12] - cam.pos[0]) ** 2 + (a.model[13] - cam.pos[1]) ** 2 + (a.model[14] - cam.pos[2]) ** 2;
      const db = (b.model[12] - cam.pos[0]) ** 2 + (b.model[13] - cam.pos[1]) ** 2 + (b.model[14] - cam.pos[2]) ** 2;
      return db - da;
    });
    for (const r of trans) draw(r);
    // particles (world space)
    gl.disable(gl.CULL_FACE);
    this.fx.draw(gl, this); this.sparks.draw(gl, this);
    gl.enable(gl.CULL_FACE);
    // view-space (weapon): clear depth so it never clips walls
    if (viewItems.length) {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(this.u.uVP, false, proj);
      gl.uniform3fv(this.u.uCamPos, [0, 0, 0]);
      // dedicated viewmodel lighting: flashlight bounce off the weapon/hands
      gl.uniform3fv(this.u.uAmbient, [0.22, 0.22, 0.24]);
      gl.uniform1i(this.u.uLightCount, 1);
      gl.uniform3fv(this.u['uLightPos[0]'], new Float32Array([0.3, 0.25, -0.2]));
      const vl = this.spot.on ? 2.2 : 0.10;
      gl.uniform3fv(this.u['uLightCol[0]'], new Float32Array([vl, vl * 0.97, vl * 0.9]));
      gl.uniform1fv(this.u['uLightRad[0]'], new Float32Array([2.4]));
      gl.uniform1f(this.u.uSpotOn, 0);
      for (const r of viewItems) draw(r);
      gl.uniform3fv(this.u.uCamPos, cam.pos);
      gl.uniform3fv(this.u.uAmbient, this.ambient);
      gl.uniform1f(this.u.uSpotOn, sp.on ? 1 : 0);
    }
    gl.bindVertexArray(null);
    gl.depthMask(true); gl.disable(gl.BLEND);
    // post
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    if (window.PostFX) PostFX.render(f.tex, this.dt);
    else { // fallback: plain blit (should not happen)
      gl.clearColor(1, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    }
    this.frame++;
  },

  start(loopFn) {
    let last = performance.now();
    this._loopFn = loopFn;
    const tick = now => {
      const dt = clamp((now - last) / 1000, 0.001, 0.05);
      last = now; this.dt = dt; this.time += dt;
      try { loopFn(dt, this.time); } catch (err) { console.error('LOOP ERROR', err); }
      this.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // watchdog: rAF is fully paused in occluded/hidden tabs — keep simulating at ~30 fps
    setInterval(() => {
      const now = performance.now();
      if (now - last > 200) {
        const dt = clamp((now - last) / 1000, 0.001, 0.05);
        last = now; this.dt = dt; this.time += dt;
        try { loopFn(dt, this.time); } catch (err) { console.error('LOOP ERROR', err); }
        this.render();
      }
    }, 33);
  },
  // deterministic manual stepping for automated playtests
  step(n = 1, dt = 1 / 60) {
    for (let i = 0; i < n; i++) {
      this.dt = dt; this.time += dt;
      try { this._loopFn(dt, this.time); } catch (err) { console.error('STEP ERROR', err); }
      this.render();
    }
  }
};

/* ---------------- particle system (billboard quads, one draw call) ---------------- */
class ParticleSys {
  constructor(max, blend) {
    this.max = max; this.drawCap = max; this.blend = blend; this.list = [];
    this.posArr = new Float32Array(max * 4 * 3);
    this.colArr = new Float32Array(max * 4 * 4);
    this.nrmArr = new Float32Array(max * 4 * 3);
    this.uvArr = new Float32Array(max * 4 * 2);
    const idx = new Uint16Array(max * 6);
    for (let i = 0; i < max; i++) { const b = i * 4; idx.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6); }
    const gl = Eng.gl;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const mk = (loc, arr, size) => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, arr.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      return b;
    };
    this.bPos = mk(0, this.posArr, 3); this.bNrm = mk(1, this.nrmArr, 3);
    this.bUV = mk(2, this.uvArr, 2); this.bCol = mk(3, this.colArr, 4);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.count = 0;
  }
  /* trim particle budget: drop oldest beyond n, cap future spawns/draws */
  cap(n) {
    this.drawCap = Math.max(0, Math.min(n | 0, this.max));
    if (this.list.length > this.drawCap) this.list.splice(0, this.list.length - this.drawCap);
  }
  spawn(o) {
    if (this.drawCap <= 0) return;
    if (this.list.length >= this.drawCap) this.list.shift();
    this.list.push({
      p: o.p.slice(), v: o.v ? o.v.slice() : [0, 0, 0],
      col: o.col || [1, 1, 1, 1], size: o.size || 0.05,
      life: o.life || 0.6, maxLife: o.life || 0.6,
      grav: o.grav === undefined ? 4 : o.grav, drag: o.drag === undefined ? 1.2 : o.drag,
      grow: o.grow || 0
    });
  }
  burst(pos, n, opt) {
    for (let i = 0; i < n; i++) {
      const a = rnd(Math.PI * 2), e = rnd(-1, 1), sp = rnd(opt.speed || 2);
      this.spawn({
        p: pos, v: [Math.cos(a) * sp * (0.4 + Math.abs(e)), e * sp * 0.7 + (opt.up || 0), Math.sin(a) * sp * (0.4 + Math.abs(e))],
        col: opt.col, size: rnd(opt.size || 0.04, (opt.size || 0.04) * 2.2), life: rnd(opt.life || 0.5, (opt.life || 0.5) * 1.8),
        grav: opt.grav, drag: opt.drag, grow: opt.grow
      });
    }
  }
  update(dt, cam) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.life -= dt;
      if (p.life <= 0) { L.splice(i, 1); continue; }
      p.v[1] -= p.grav * dt;
      const dr = Math.max(0, 1 - p.drag * dt);
      p.v[0] *= dr; p.v[1] *= dr; p.v[2] *= dr;
      p.p[0] += p.v[0] * dt; p.p[1] += p.v[1] * dt; p.p[2] += p.v[2] * dt;
      if (p.grow) p.size += p.grow * dt;
    }
    // build billboards
    const yaw = cam.yaw, pitch = cam.pitch;
    const f = fwdVec(yaw, pitch), r = rightVec(yaw);
    const u = V3.cross(r, f);
    let vi = 0, ci = 0;
    for (const p of L) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      const s = p.size * 0.5;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (const c of corners) {
        this.posArr[vi++] = p.p[0] + (r[0] * c[0] + u[0] * c[1]) * s;
        this.posArr[vi++] = p.p[1] + (r[1] * c[0] + u[1] * c[1]) * s;
        this.posArr[vi++] = p.p[2] + (r[2] * c[0] + u[2] * c[1]) * s;
        this.colArr[ci++] = p.col[0]; this.colArr[ci++] = p.col[1]; this.colArr[ci++] = p.col[2];
        this.colArr[ci++] = p.col[3] * a;
      }
    }
    this.count = L.length;
    if (this.count) {
      const gl = Eng.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bPos); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.posArr, 0, this.count * 12);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bCol); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.colArr, 0, this.count * 16);
    }
  }
  draw(gl, eng) {
    if (!this.count) return;
    gl.uniformMatrix4fv(eng.u.uModel, false, M4.ident());
    gl.uniform3fv(eng.u.uColor, [1, 1, 1]);
    gl.uniform1f(eng.u.uAlpha, 1);
    gl.uniform1f(eng.u.uEmissive, this.blend === 'add' ? 1 : 0.55);
    gl.uniform1f(eng.u.uUseTex, 0);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, this.blend === 'add' ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count * 6, gl.UNSIGNED_SHORT, 0);
    gl.depthMask(true); gl.disable(gl.BLEND);
  }
}
window.Eng = Eng; window.M4 = M4; window.V3 = V3;
window.fwdVec = fwdVec; window.rightVec = rightVec;
window.clamp = clamp; window.lerp = lerp; window.rnd = rnd; window.pick = pick;
