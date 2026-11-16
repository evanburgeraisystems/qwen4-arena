/* ============================================================
   TERRA — globe.js  (SYSTEM A)
   Earth + clouds + atmosphere limb + sky dome + stars + sun
   sprite + sun lighting. Plain IIFE, THREE r128, no assets.
   All custom ShaderMaterials obey the 5 contract rules:
   logdepthbuf chunks, encodings_fragment, manual fog uniforms,
   floating-origin safe (ctx.earthCenter), shared sun model.
   ============================================================ */
(function () {
  'use strict';

  var T = window.TERRA;
  var C = T.C;
  var U = T.util;

  /* ---------- reusable temps (zero per-frame allocs) ---------- */
  var _up = new THREE.Vector3();
  var _tmpN = new THREE.Vector3();
  var _lightPos = new THREE.Vector3();
  var _axisY = new THREE.Vector3(0, 1, 0);
  var _horizon = new THREE.Color();
  var _sunTint = new THREE.Color();
  var TWO_PI = Math.PI * 2;

  /* ---------- palette (linear-ish; gamma pass at the end) ---------- */
  var DAY_HOR = [0.60, 0.76, 0.92], DAY_ZEN = [0.10, 0.30, 0.70];
  var SET_HOR = [0.98, 0.44, 0.16], SET_ZEN = [0.15, 0.13, 0.36];
  var NIGHT_HOR = [0.016, 0.028, 0.055], NIGHT_ZEN = [0.003, 0.006, 0.016];

  function skyWeights(elev, out) {
    var dayW = U.smoothstep(0.02, 0.32, elev);
    var nightW = 1 - U.smoothstep(-0.22, -0.04, elev);
    out.day = dayW;
    out.night = nightW;
    out.sunset = (1 - dayW) * (1 - nightW);
    return out;
  }
  var _w = { day: 0, night: 0, sunset: 0 };

  /* ---------- canvas sprite textures (procedural) ---------- */
  function makeSunTexture() {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    var g = cv.getContext('2d');
    var gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0.00, 'rgba(255,255,255,1)');
    gr.addColorStop(0.12, 'rgba(255,248,230,0.95)');
    gr.addColorStop(0.28, 'rgba(255,214,150,0.45)');
    gr.addColorStop(0.55, 'rgba(255,170,90,0.12)');
    gr.addColorStop(1.00, 'rgba(255,150,60,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(cv);
  }

  function makeNebulaTexture(r, gc, b) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    var g = cv.getContext('2d');
    var gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0.0, 'rgba(' + r + ',' + gc + ',' + b + ',0.55)');
    gr.addColorStop(0.4, 'rgba(' + r + ',' + gc + ',' + b + ',0.22)');
    gr.addColorStop(1.0, 'rgba(' + r + ',' + gc + ',' + b + ',0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(cv);
  }

  /* ---------- GLSL helpers ---------- */
  var VERT_COMMON = [
    'varying vec3 vWorldPos;',
    'varying vec3 vNormalW;',
    'varying vec2 vUv;',
    'varying float vFogDist;',
    'void main() {',
    '  vUv = uv;',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vWorldPos = wp.xyz;',
    // group/worldRoot carry rotation+translation only (uniform scale 1),
    // so mat3(modelMatrix) gives a correct world normal.
    '  vNormalW = normalize(mat3(modelMatrix) * normal);',
    '  vec4 mvPosition = viewMatrix * wp;',
    '  vFogDist = -mvPosition.z;',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  #include <logdepthbuf_vertex>',
    '}'
  ].join('\n');

  var FRAG_FOG = [
    'uniform vec3 uFogColor;',
    'uniform float uFogDensity;',
    'varying float vFogDist;'
  ].join('\n');

  var FOG_APPLY = [
    '  float ff = 1.0 - exp(-uFogDensity * uFogDensity * vFogDist * vFogDist);',
    '  col = mix(col, uFogColor, clamp(ff, 0.0, 1.0));'
  ].join('\n');

  /* ============================================================
     init
     ============================================================ */
  function init(scene, worldRoot, tex) {
    var group = new THREE.Group();
    group.name = 'globe';
    worldRoot.add(group);

    var skyGroup = new THREE.Group();
    skyGroup.name = 'sky';
    scene.add(skyGroup);

    /* Shared uniform objects — sunDir references TERRA.state.sunDir
       directly, so setSunDirection propagates to every shader. */
    var uSunDir = { value: T.state.sunDir };
    var uTime = { value: 0 };
    var uFogColor = { value: new THREE.Color(0x000000) };
    var uFogDensity = { value: 0 };

    /* ---------- 1. EARTH ---------- */
    var earthUniforms = {
      dayMap: { value: tex.day },
      nightMap: { value: tex.night },
      specMap: { value: tex.spec },
      bumpMap: { value: tex.bump },
      uSunDir: uSunDir,
      uTime: uTime,
      uFogColor: uFogColor,
      uFogDensity: uFogDensity
    };
    if (tex.day) tex.day.anisotropy = 4;
    if (tex.night) tex.night.anisotropy = 4;

    var earthMat = new THREE.ShaderMaterial({
      uniforms: earthUniforms,
      vertexShader: '#include <common>\n#include <logdepthbuf_pars_vertex>\n' + VERT_COMMON,
      fragmentShader: [
        '#include <logdepthbuf_pars_fragment>',
        'uniform sampler2D dayMap;',
        'uniform sampler2D nightMap;',
        'uniform sampler2D specMap;',
        'uniform sampler2D bumpMap;',
        'uniform vec3 uSunDir;',
        'uniform float uTime;',
        'varying vec3 vWorldPos;',
        'varying vec3 vNormalW;',
        'varying vec2 vUv;',
        FRAG_FOG,
        'void main() {',
        '  #include <logdepthbuf_fragment>',
        '  vec3 N = normalize(vNormalW);',
        '  vec3 V = normalize(cameraPosition - vWorldPos);',
        '  float ocean = texture2D(specMap, vUv).r;',
        // cheap bump perturb: 2 extra taps, land only
        '  float b0 = texture2D(bumpMap, vUv).r;',
        '  float bx = texture2D(bumpMap, vUv + vec2(0.002, 0.0)).r;',
        '  float by = texture2D(bumpMap, vUv + vec2(0.0, 0.004)).r;',
        '  vec3 Tg = cross(vec3(0.0, 1.0, 0.0), N);',
        '  float tl = length(Tg);',
        '  Tg = tl > 1e-4 ? Tg / tl : vec3(1.0, 0.0, 0.0);',
        '  vec3 Bt = normalize(cross(N, Tg));',
        '  N = normalize(N + (Tg * (b0 - bx) + Bt * (b0 - by)) * 1.8 * (1.0 - ocean));',
        '  float ndl = dot(N, uSunDir);',
        '  vec3 day = pow(texture2D(dayMap, vUv).rgb, vec3(2.2));',
        '  float dayF = clamp(ndl, 0.0, 1.0);',
        '  vec3 col = day * (0.05 + 1.15 * dayF);',
        // orange twilight band hugging the terminator
        '  float tw = exp(-abs(ndl) * 9.0);',
        '  col *= mix(vec3(1.0), vec3(1.3, 0.74, 0.48), tw * 0.7);',
        '  col += vec3(0.30, 0.10, 0.02) * tw * 0.30 * smoothstep(-0.25, 0.05, ndl);',
        // night side: city lights (bloom picks these up)
        '  float nightMix = 1.0 - smoothstep(-0.12, 0.09, ndl);',
        '  col += pow(texture2D(nightMap, vUv).rgb, vec3(2.2)) * nightMix * 2.6;',
        '  col += day * 0.014 * nightMix;', // faint earthshine silhouette
        // aurora curtains: night-side polar ovals, green-teal → magenta tops
        '  float aLat = abs(asin(clamp(N.y, -1.0, 1.0))) * 57.2958;',
        '  float aBand = smoothstep(64.0, 69.0, aLat) * (1.0 - smoothstep(75.0, 81.0, aLat));',
        '  float aTh = atan(N.z, N.x);',
        '  float aCurt = pow(0.5 + 0.5 * sin(aTh * 40.0 + uTime * 0.45 + 2.2 * sin(aTh * 9.0 - uTime * 0.21)), 3.0);',
        '  aCurt *= 0.55 + 0.45 * sin(aLat * 1.7 + aTh * 5.0 - uTime * 0.27);', // break spokes into curtain patches
        '  float aOval = 0.55 + 0.45 * sin(aTh * 3.0 + uTime * 0.13 + 1.7);',
        '  float aNight = nightMix * (1.0 - smoothstep(-0.18, 0.06, ndl));',
        '  vec3 aCol = mix(vec3(0.12, 0.95, 0.45), vec3(0.72, 0.22, 0.85), smoothstep(69.0, 80.0, aLat));',
        '  col += aCol * aBand * aCurt * aOval * aNight * (0.62 + 0.18 * sin(uTime * 1.9 + aTh * 17.0)) * 0.5;',
        // ocean specular glint
        '  float spec = ocean * pow(max(dot(reflect(-uSunDir, N), V), 0.0), 160.0)',
        '             * smoothstep(-0.05, 0.25, ndl) * 0.4;',
        '  col += vec3(1.0, 0.92, 0.78) * spec;',
        // inner atmosphere fresnel rim
        '  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.5);',
        '  float rimDay = smoothstep(-0.12, 0.25, ndl);',
        '  col += fres * mix(vec3(0.04, 0.09, 0.22), vec3(0.3, 0.6, 1.0), rimDay) * 0.32;',
        FOG_APPLY,
        '  gl_FragColor = vec4(col, 1.0);',
        '  #include <encodings_fragment>',
        '}'
      ].join('\n')
    });
    var earthMesh = new THREE.Mesh(new THREE.SphereGeometry(C.R, 96, 64), earthMat);
    earthMesh.name = 'earth';
    group.add(earthMesh);

    /* ---------- 2. CLOUDS ---------- */
    var uCloudOpacity = { value: 1 };
    var cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        cloudMap: { value: tex.clouds },
        uSunDir: uSunDir,
        uCloudOpacity: uCloudOpacity,
        uFogColor: uFogColor,
        uFogDensity: uFogDensity
      },
      vertexShader: '#include <common>\n#include <logdepthbuf_pars_vertex>\n' + VERT_COMMON,
      fragmentShader: [
        '#include <logdepthbuf_pars_fragment>',
        'uniform sampler2D cloudMap;',
        'uniform vec3 uSunDir;',
        'uniform float uCloudOpacity;',
        'varying vec3 vWorldPos;',
        'varying vec3 vNormalW;',
        'varying vec2 vUv;',
        FRAG_FOG,
        'void main() {',
        '  #include <logdepthbuf_fragment>',
        '  vec4 ct = texture2D(cloudMap, vUv);',
        '  if (ct.a * uCloudOpacity < 0.004) discard;',
        '  vec3 N = normalize(vNormalW);',
        '  float ndl = dot(N, uSunDir);',
        '  float wrap = clamp((ndl + 0.18) / 1.18, 0.0, 1.0);',
        '  vec3 col = mix(vec3(0.05, 0.07, 0.12), vec3(0.92, 0.91, 0.89), wrap);',
        // silver lining near the terminator, stronger on thin cloud edges
        '  float term = exp(-abs(ndl) * 6.0);',
        '  col += vec3(1.0, 0.88, 0.72) * term * (0.22 + 0.30 * (1.0 - ct.a));',
        FOG_APPLY,
        '  gl_FragColor = vec4(col, ct.a * uCloudOpacity * 0.9);',
        '  #include <encodings_fragment>',
        '}'
      ].join('\n'),
      transparent: true,
      depthWrite: false
    });
    var cloudsMesh = new THREE.Mesh(new THREE.SphereGeometry(C.R + 0.35, 64, 48), cloudMat);
    cloudsMesh.name = 'clouds';
    cloudsMesh.renderOrder = 1;
    group.add(cloudsMesh);

    /* ---------- 3. ATMOSPHERE LIMB GLOW ---------- */
    var uAtmoIntensity = { value: 1 };
    var atmoMat = new THREE.ShaderMaterial({
      uniforms: { uSunDir: uSunDir, uIntensity: uAtmoIntensity },
      vertexShader: '#include <common>\n#include <logdepthbuf_pars_vertex>\n' + VERT_COMMON,
      fragmentShader: [
        '#include <logdepthbuf_pars_fragment>',
        'uniform vec3 uSunDir;',
        'uniform float uIntensity;',
        'varying vec3 vWorldPos;',
        'varying vec3 vNormalW;',
        'void main() {',
        '  #include <logdepthbuf_fragment>',
        '  vec3 V = normalize(cameraPosition - vWorldPos);',
        '  vec3 N = normalize(vNormalW);',
        // BackSide: dot(N,V) in [-1,0]; rim formula tuned so the glow
        // is brightest hugging the planet limb and fades outward.
        '  float rim = pow(clamp(dot(N, V) + 1.04, 0.0, 1.0), 6.0);',
        '  float glow = pow(1.0 - rim, 3.0);',
        '  float sf = dot(N, uSunDir);',
        '  float dayGlow = smoothstep(-0.4, 0.3, sf);',
        '  float sunset = exp(-abs(sf) * 4.5);',
        '  vec3 col = mix(vec3(0.3, 0.6, 1.0), vec3(1.0, 0.42, 0.16), sunset * 0.85);',
        '  float a = glow * (0.10 + 0.90 * dayGlow) * uIntensity * 0.5;',
        '  gl_FragColor = vec4(col * 1.1, a);',
        '  #include <encodings_fragment>',
        '}'
      ].join('\n'),
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    });
    var atmoMesh = new THREE.Mesh(new THREE.SphereGeometry(C.R + 3.2, 64, 48), atmoMat);
    atmoMesh.name = 'atmosphere';
    atmoMesh.renderOrder = 2;
    group.add(atmoMesh);

    /* ---------- 4. SKY DOME (follows camera) ---------- */
    var uSkyMix = { value: 0 };
    var uUp = { value: new THREE.Vector3(0, 1, 0) };
    var skyMat = new THREE.ShaderMaterial({
      uniforms: { uSunDir: uSunDir, uUp: uUp, uSkyMix: uSkyMix },
      vertexShader: [
        '#include <common>',
        '#include <logdepthbuf_pars_vertex>',
        'varying vec3 vWorldPos;',
        'void main() {',
        '  vec4 wp = modelMatrix * vec4(position, 1.0);',
        '  vWorldPos = wp.xyz;',
        '  vec4 mvPosition = viewMatrix * wp;',
        '  gl_Position = projectionMatrix * mvPosition;',
        '  #include <logdepthbuf_vertex>',
        '}'
      ].join('\n'),
      fragmentShader: [
        '#include <logdepthbuf_pars_fragment>',
        'uniform vec3 uSunDir;',
        'uniform vec3 uUp;',
        'uniform float uSkyMix;',
        'varying vec3 vWorldPos;',
        'void main() {',
        '  #include <logdepthbuf_fragment>',
        '  vec3 vd = normalize(vWorldPos - cameraPosition);',
        '  float elev = dot(uUp, uSunDir);',
        '  float dayW = smoothstep(0.02, 0.32, elev);',
        '  float nightW = 1.0 - smoothstep(-0.22, -0.04, elev);',
        '  float sunsetW = (1.0 - dayW) * (1.0 - nightW);',
        '  float hh = dot(vd, uUp);',
        // sun azimuth along the local horizon (sunset glow direction)
        '  vec3 sunH = uSunDir - uUp * elev;',
        '  float sl = length(sunH);',
        '  vec3 sh = sl > 1e-4 ? sunH / sl : vec3(0.0);',
        '  vec3 vdH = vd - uUp * hh;',
        '  float vl = length(vdH);',
        '  float az = vl > 1e-4 ? dot(vdH / vl, sh) : 0.0;',
        '  float sunAz = pow(max(az, 0.0), 3.0);',
        '  vec3 dayHor = vec3(0.60, 0.76, 0.92);',
        '  vec3 dayZen = vec3(0.10, 0.30, 0.70);',
        '  vec3 setHor = vec3(0.98, 0.44, 0.16) + sunAz * vec3(0.55, 0.22, 0.10);',
        '  vec3 setZen = vec3(0.15, 0.13, 0.36);',
        '  vec3 nightHor = vec3(0.016, 0.028, 0.055);',
        '  vec3 nightZen = vec3(0.003, 0.006, 0.016);',
        '  vec3 hor = dayHor * dayW + setHor * sunsetW + nightHor * nightW;',
        '  vec3 zen = dayZen * dayW + setZen * sunsetW + nightZen * nightW;',
        '  float t = pow(clamp(hh, 0.0, 1.0), 0.58);',
        '  vec3 col = mix(hor, zen, t);',
        '  col *= 1.0 - 0.45 * clamp(-hh * 4.0, 0.0, 1.0);',
        // sun disc + halo
        '  float s = max(dot(vd, uSunDir), 0.0);',
        '  vec3 sunTint = mix(vec3(1.0, 0.96, 0.86), vec3(1.0, 0.55, 0.25), sunsetW);',
        '  col += (pow(s, 350.0) * 2.0 + pow(s, 24.0) * 0.35) * sunTint;',
        '  col *= uSkyMix;',
        '  gl_FragColor = vec4(col, 1.0);',
        '  #include <encodings_fragment>',
        '}'
      ].join('\n'),
      side: THREE.BackSide,
      depthWrite: false
    });
    var skyDome = new THREE.Mesh(new THREE.SphereGeometry(6000, 32, 24), skyMat);
    skyDome.name = 'skyDome';
    skyDome.renderOrder = -10;
    skyGroup.add(skyDome);

    /* ---------- 5. STARS + MILKY WAY + NEBULAE ---------- */
    var STAR_COUNT = 2600;
    var BAND_FRAC = 0.35;
    var bandN = new THREE.Vector3(0.42, 0.86, 0.28).normalize();
    var rng = U.rng(9042);
    var positions = new Float32Array(STAR_COUNT * 3);
    var sizes = new Float32Array(STAR_COUNT);
    var phases = new Float32Array(STAR_COUNT);
    var colors = new Float32Array(STAR_COUNT * 3);
    var sv = new THREE.Vector3();
    for (var i = 0; i < STAR_COUNT; i++) {
      // uniform-ish direction on sphere
      var z = rng() * 2 - 1;
      var a = rng() * TWO_PI;
      var rr = Math.sqrt(Math.max(0, 1 - z * z));
      sv.set(rr * Math.cos(a), z, rr * Math.sin(a));
      var inBand = i < STAR_COUNT * BAND_FRAC;
      if (inBand) {
        // pull toward the milky-way great circle (thin fuzzy band)
        var d = sv.dot(bandN);
        sv.addScaledVector(bandN, -d * (0.86 + rng() * 0.12));
        sv.normalize();
      }
      sv.multiplyScalar(5500);
      positions[i * 3] = sv.x; positions[i * 3 + 1] = sv.y; positions[i * 3 + 2] = sv.z;
      var bright = rng() < 0.06;
      sizes[i] = (inBand ? 0.8 : 1.0) + rng() * 2.1 + (bright ? 1.6 : 0);
      phases[i] = rng() * TWO_PI;
      var temp = rng();
      var cr, cg, cb;
      if (temp < 0.15) { cr = 1.0; cg = 0.82; cb = 0.62; }       // warm
      else if (temp < 0.30) { cr = 0.72; cg = 0.82; cb = 1.0; }  // cool
      else { cr = 0.95; cg = 0.95; cb = 1.0; }                   // white
      var lum = 0.6 + rng() * 0.4;
      colors[i * 3] = cr * lum; colors[i * 3 + 1] = cg * lum; colors[i * 3 + 2] = cb * lum;
    }
    var starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    starGeo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    starGeo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    var uStarFade = { value: 1 };
    var starMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: uTime,
        uStarFade: uStarFade,
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) }
      },
      vertexShader: [
        '#include <common>',
        '#include <logdepthbuf_pars_vertex>',
        'attribute float aSize;',
        'attribute float aPhase;',
        'attribute vec3 aColor;',
        'uniform float uTime;',
        'uniform float uPixelRatio;',
        'varying vec3 vColor;',
        'varying float vTw;',
        'void main() {',
        '  vColor = aColor;',
        '  vTw = 0.72 + 0.28 * sin(uTime * (0.6 + fract(aPhase * 0.37) * 2.4) + aPhase);',
        '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
        '  gl_PointSize = aSize * uPixelRatio;',
        '  gl_Position = projectionMatrix * mvPosition;',
        '  #include <logdepthbuf_vertex>',
        '}'
      ].join('\n'),
      fragmentShader: [
        '#include <logdepthbuf_pars_fragment>',
        'uniform float uStarFade;',
        'varying vec3 vColor;',
        'varying float vTw;',
        'void main() {',
        '  #include <logdepthbuf_fragment>',
        '  float d = length(gl_PointCoord - vec2(0.5));',
        '  float a = 1.0 - smoothstep(0.05, 0.5, d);',
        '  a *= a;',
        '  a += (1.0 - smoothstep(0.0, 0.18, d)) * 0.6;',
        '  gl_FragColor = vec4(vColor * vTw * uStarFade, a);',
        '  #include <encodings_fragment>',
        '}'
      ].join('\n'),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    });
    var stars = new THREE.Points(starGeo, starMat);
    stars.name = 'stars';
    stars.renderOrder = -5;
    skyGroup.add(stars);

    // a few soft nebula sprites along the band
    var nebulae = [];
    var nebulaColors = [[110, 120, 200], [150, 110, 180], [90, 150, 170], [140, 130, 210], [100, 110, 190]];
    for (var n = 0; n < 5; n++) {
      var nz = rng() * 2 - 1, na = rng() * TWO_PI;
      var nr = Math.sqrt(Math.max(0, 1 - nz * nz));
      sv.set(nr * Math.cos(na), nz, nr * Math.sin(na));
      var nd = sv.dot(bandN);
      sv.addScaledVector(bandN, -nd * 0.95).normalize().multiplyScalar(5450);
      var nc = nebulaColors[n];
      var nmat = new THREE.SpriteMaterial({
        map: makeNebulaTexture(nc[0], nc[1], nc[2]),
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        fog: false,
        opacity: 0
      });
      var spr = new THREE.Sprite(nmat);
      spr.position.copy(sv);
      var ns = 800 + rng() * 900;
      spr.scale.set(ns, ns, 1);
      spr.renderOrder = -5;
      spr.userData.baseOpacity = 0.06 + rng() * 0.07;
      skyGroup.add(spr);
      nebulae.push(spr);
    }

    /* ---------- 6. SUN SPRITE ---------- */
    var sunSpriteMat = new THREE.SpriteMaterial({
      map: makeSunTexture(),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: false,
      opacity: 1
    });
    var sunSprite = new THREE.Sprite(sunSpriteMat);
    sunSprite.scale.set(700, 700, 1);
    sunSprite.renderOrder = -4;
    skyGroup.add(sunSprite);

    /* ---------- 6b. LIVE SATELLITES (ISS + 2, worldRoot-local) ---------- */
    function makeSatTexture() {
      var cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      var g = cv.getContext('2d');
      var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0.00, 'rgba(255,255,255,1)');
      gr.addColorStop(0.18, 'rgba(255,255,255,0.9)');
      gr.addColorStop(0.42, 'rgba(190,225,255,0.26)');
      gr.addColorStop(1.00, 'rgba(150,200,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(cv);
    }
    function makeLabelTexture(text) {
      var cv = document.createElement('canvas');
      cv.width = 192; cv.height = 56;
      var g = cv.getContext('2d');
      g.font = '600 30px Consolas, Menlo, monospace';
      try { g.letterSpacing = '5px'; } catch (e) { /* older canvas */ }
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = 'rgba(0,0,0,0.85)';
      g.shadowBlur = 7;
      g.fillStyle = 'rgba(214,236,255,0.95)';
      g.fillText(text, 96, 30);
      return new THREE.CanvasTexture(cv);
    }
    var satGroup = new THREE.Group();
    satGroup.name = 'satellites';
    worldRoot.add(satGroup);
    var satTex = makeSatTexture();
    var TRAIL_N = 48, TRAIL_SPAN = 0.5, SAT_TIME_SCALE = 60; // 1 min sim = 1 h orbit
    var satDefs = [
      { name: 'ISS',   altKm: 400, inc: 51.6, node: 20,  periodMin: 92.0,  phase: 0.4, tint: 0xfff4e0 },
      { name: 'SAT-2', altKm: 550, inc: 97.5, node: 140, periodMin: 95.6,  phase: 2.3, tint: 0xbfe4ff },
      { name: 'SAT-3', altKm: 800, inc: 28.5, node: 262, periodMin: 100.9, phase: 4.4, tint: 0xffd9a8 }
    ];
    var sats = [];
    var _satU = new THREE.Vector3(), _satV = new THREE.Vector3(), _satP = new THREE.Vector3();
    for (var si = 0; si < satDefs.length; si++) {
      var sd = satDefs[si];
      var sr = C.R + (sd.altKm / C.EARTH_KM) * C.R;
      // orbit basis: equatorial circle tilted by inclination, then node about Y
      _satU.set(1, 0, 0);
      _satV.set(0, -Math.sin(sd.inc * C.DEG), Math.cos(sd.inc * C.DEG));
      _satU.applyAxisAngle(_axisY, sd.node * C.DEG);
      _satV.applyAxisAngle(_axisY, sd.node * C.DEG);
      var dotMat = new THREE.SpriteMaterial({
        map: satTex, color: sd.tint, blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false, fog: false, opacity: 0
      });
      var dot = new THREE.Sprite(dotMat);
      dot.scale.set(2.2, 2.2, 1);
      dot.renderOrder = 3;
      var labMat = new THREE.SpriteMaterial({
        map: makeLabelTexture(sd.name), blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false, fog: false, opacity: 0
      });
      var lab = new THREE.Sprite(labMat);
      lab.scale.set(11.0, 3.2, 1);
      lab.renderOrder = 3;
      var tPos = new Float32Array(TRAIL_N * 3);
      var tCol = new Float32Array(TRAIL_N * 3);
      var tc = new THREE.Color(sd.tint);
      for (var ti = 0; ti < TRAIL_N; ti++) {
        var f = Math.pow(1 - ti / (TRAIL_N - 1), 1.8) * 0.5;
        tCol[ti * 3] = tc.r * f; tCol[ti * 3 + 1] = tc.g * f; tCol[ti * 3 + 2] = tc.b * f;
      }
      var tGeo = new THREE.BufferGeometry();
      tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage));
      tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
      var tMat = new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false
      });
      var trail = new THREE.Line(tGeo, tMat);
      trail.frustumCulled = false;
      trail.renderOrder = 3;
      satGroup.add(dot); satGroup.add(lab); satGroup.add(trail);
      sats.push({
        r: sr, omega: TWO_PI / (sd.periodMin * 60 / SAT_TIME_SCALE), phase: sd.phase,
        u: _satU.clone(), v: _satV.clone(),
        dot: dot, lab: lab, dotMat: dotMat, labMat: labMat,
        tPos: tPos, tAttr: tGeo.attributes.position, tMat: tMat
      });
    }
    function updateSats(dt, ctx) {
      var vis = U.smoothstep(500000, 2200000, ctx.altitudeM); // space view only
      satGroup.visible = vis > 0.01;
      if (!satGroup.visible) return;
      var t = ctx.time || 0;
      for (var i = 0; i < sats.length; i++) {
        var s = sats[i];
        var a = s.phase + s.omega * t;
        var ca = Math.cos(a), sa = Math.sin(a);
        _satP.copy(s.u).multiplyScalar(ca * s.r).addScaledVector(s.v, sa * s.r);
        s.dot.position.copy(_satP);
        s.lab.position.copy(_satP).multiplyScalar(1 + 2.8 / s.r);
        var step = TRAIL_SPAN / (TRAIL_N - 1);
        for (var j = 0; j < TRAIL_N; j++) {
          var aj = a - j * step, cj = Math.cos(aj), sj = Math.sin(aj);
          s.tPos[j * 3]     = (s.u.x * cj + s.v.x * sj) * s.r;
          s.tPos[j * 3 + 1] = (s.u.y * cj + s.v.y * sj) * s.r;
          s.tPos[j * 3 + 2] = (s.u.z * cj + s.v.z * sj) * s.r;
        }
        s.tAttr.needsUpdate = true;
        s.dotMat.opacity = vis;
        s.labMat.opacity = vis * 0.9;
        s.tMat.opacity = vis * 0.85;
      }
    }

    /* ---------- 7. LIGHTS ---------- */
    var sunLight = new THREE.DirectionalLight(0xfff2e0, 1.35);
    scene.add(sunLight);
    scene.add(sunLight.target);
    var ambient = new THREE.AmbientLight(0x223344, 0.5);
    scene.add(ambient);
    var hemi = new THREE.HemisphereLight(0x3a4a6a, 0x14100c, 0.3);
    scene.add(hemi);

    /* ---------- state ---------- */
    var spinFlag = !!T.state.spinEnabled;
    var lastCenter = new THREE.Vector3().copy(worldRoot.position);
    var cloudOpacityCur = 1;

    function placeSunLight(center) {
      _lightPos.copy(T.state.sunDir).multiplyScalar(500).add(center);
      sunLight.position.copy(_lightPos);
      sunLight.target.position.copy(center);
    }
    placeSunLight(lastCenter);
    sunSprite.position.copy(T.state.sunDir).multiplyScalar(5200);

    /* ---------- sun model ---------- */
    function setSunDirection(v) {
      T.state.sunDir.copy(v).normalize(); // shared uniform object sees it
      placeSunLight(lastCenter);
      sunSprite.position.copy(T.state.sunDir).multiplyScalar(5200);
    }
    function getSunDirection() { return T.state.sunDir; }

    function sunForLocalTime(lat, lon, hours) {
      var lonE = lon + group.rotation.y * C.RAD;
      var L = lonE - (hours - 12) * 15;
      return U.latLonToVec3(12, L, 1).normalize();
    }

    function getNightFactor(lat, lon) {
      U.latLonToVec3(lat, lon, 1, _tmpN);
      _tmpN.applyAxisAngle(_axisY, group.rotation.y);
      return U.smoothstep(0.06, -0.14, _tmpN.dot(T.state.sunDir));
    }

    function setSpinEnabled(b) {
      spinFlag = !!b;
      T.state.spinEnabled = spinFlag;
    }

    /* ---------- horizon color (matches dome palette at hh=0) ---------- */
    function computeHorizon(elev) {
      skyWeights(elev, _w);
      _horizon.setRGB(
        DAY_HOR[0] * _w.day + SET_HOR[0] * _w.sunset + NIGHT_HOR[0] * _w.night,
        DAY_HOR[1] * _w.day + SET_HOR[1] * _w.sunset + NIGHT_HOR[1] * _w.night,
        DAY_HOR[2] * _w.day + SET_HOR[2] * _w.sunset + NIGHT_HOR[2] * _w.night
      );
      return _horizon;
    }
    function getHorizonColor() { return _horizon; }
    computeHorizon(_up.copy(uUp.value).dot(T.state.sunDir));

    /* ---------- per-frame update ---------- */
    function update(dt, ctx) {
      var alt = ctx.altitudeM;
      uTime.value = ctx.time || (uTime.value + dt);

      // spin (Y only) + cloud drift
      if (spinFlag && ctx.allowSpin) {
        group.rotation.y += 0.018 * dt;
        if (group.rotation.y > TWO_PI) group.rotation.y -= TWO_PI;
      }
      cloudsMesh.rotation.y += 0.0045 * dt;

      // sky follows the camera (floating origin safe)
      skyGroup.position.copy(ctx.cameraPos);
      lastCenter.copy(ctx.earthCenter);

      // local up + sun elevation
      _up.copy(ctx.cameraPos).sub(ctx.earthCenter);
      if (_up.lengthSq() < 1e-10) _up.set(0, 1, 0);
      _up.normalize();
      uUp.value.copy(_up);
      var elev = _up.dot(T.state.sunDir);

      // sky / star fades
      var skyMix = U.smoothstep(120000, 8000, alt);
      uSkyMix.value = skyMix;
      var starFade = 1 - skyMix;
      uStarFade.value = starFade;
      var starsVisible = starFade > 0.003;
      stars.visible = starsVisible;
      for (var i = 0; i < nebulae.length; i++) {
        var nb = nebulae[i];
        nb.visible = starsVisible;
        nb.material.opacity = nb.userData.baseOpacity * starFade;
      }
      computeHorizon(elev);

      // sun sprite: hide below horizon at low altitude, warm tint at sunset
      var lowAlt = alt < 100000;
      sunSprite.visible = !(lowAlt && elev < -0.08);
      if (sunSprite.visible) {
        sunSprite.position.copy(T.state.sunDir).multiplyScalar(5200);
        sunSpriteMat.opacity = lowAlt ? U.smoothstep(-0.08, 0.06, elev) : 1;
        skyWeights(elev, _w);
        _sunTint.setRGB(1, 0.96 - 0.41 * _w.sunset, 0.86 - 0.61 * _w.sunset);
        sunSpriteMat.color.copy(_sunTint);
      }

      // clouds fade out below 2500 m so streets get clear sky
      var cloudTarget = U.smoothstep(2500, 6500, alt);
      cloudOpacityCur = U.damp(cloudOpacityCur, cloudTarget, 4, dt);
      uCloudOpacity.value = cloudOpacityCur;
      cloudsMesh.visible = cloudOpacityCur > 0.004;

      // atmosphere limb fades as camera enters the atmosphere
      uAtmoIntensity.value = U.smoothstep(60000, 120000, alt);
      atmoMesh.visible = uAtmoIntensity.value > 0.004;

      // manual fog uniforms (earth + clouds share these objects)
      if (ctx.fogColor) uFogColor.value.copy(ctx.fogColor);
      uFogDensity.value = ctx.fogDensity || 0;

      // sun light tracks the floating origin
      placeSunLight(ctx.earthCenter);
    }

    /* ---------- public api ---------- */
    return {
      group: group,
      skyGroup: skyGroup,
      earthMesh: earthMesh,
      cloudsMesh: cloudsMesh,
      setSunDirection: setSunDirection,
      getSunDirection: getSunDirection,
      sunForLocalTime: sunForLocalTime,
      getNightFactor: getNightFactor,
      setSpinEnabled: setSpinEnabled,
      getHorizonColor: getHorizonColor,
      update: update,
      updateSats: updateSats
    };
  }

  T.globe = { init: init };
})();
