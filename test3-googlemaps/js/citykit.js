/* ============================================================
   TERRA — citykit.js (agent B0)
   Shared builder toolkit for the procedural city districts.
   Exact public API per CONTRACT-CITIES.md. Plain IIFE on
   window.TERRA, THREE r128 global, meters, +Y up, ground y=0.
   No modules, no fetch, no external assets.
   ============================================================ */
(function () {
  'use strict';

  var T = (window.TERRA = window.TERRA || {});
  var util = T.util;

  /* ---------- internal night-ticker registry (keyed by U) ---------- */
  var tickers = []; // [{u: uniforms, fn: function(U, dt)}]
  function bind(U, fn) { tickers.push({ u: U, fn: fn }); }

  /* ---------- shared temps (no per-frame allocations) ---------- */
  var _m4 = new THREE.Matrix4();
  var _p = new THREE.Vector3();
  var _q = new THREE.Quaternion();
  var _s = new THREE.Vector3(1, 1, 1);
  var _col = new THREE.Color();
  var _up = new THREE.Vector3(0, 1, 0);

  /* ---------- uniforms ---------- */
  var DBG = { value: 0 };
  function newUniforms() {
    return { uNight: { value: 0 }, uTime: { value: 0 } };
  }

  /* ---------- procedural window material ---------- */
  var WIN_VERT_PARS = [
    'attribute vec3 aSize;',
    'attribute float aSeed;',
    'varying vec3 vLocalM;',
    'varying float vSeed;',
    'varying vec3 vObjNormal;',
    'varying float vHeight;'
  ].join('\n');

  var WIN_VERT_BODY = [
    'vLocalM = position * aSize;',
    'vSeed = aSeed;',
    'vObjNormal = normal;',
    'vHeight = aSize.y;'
  ].join('\n');

  var WIN_FRAG_PARS = [
    'uniform float uNight;',
    'uniform float uTime;',
    'uniform float uLit;',
    'uniform float uDbg;',
    'uniform vec3 uWarm;',
    'varying vec3 vLocalM;',
    'varying float vSeed;',
    'varying vec3 vObjNormal;',
    'varying float vHeight;',
    'float tkHash21(vec2 p){',
    '  p = fract(p * vec2(123.34, 456.21));',
    '  p += dot(p, p + 45.32);',
    '  return fract(p.x * p.y);',
    '}'
  ].join('\n');

  var WIN_FRAG_BODY = [
    '{',
    '  if (vHeight > 0.001) {', // skip when used on non-instanced geometry (aSize defaults 0)
    '    vec3 tkN = vObjNormal;',
    '    vec3 tkP = vLocalM;',
    // fake base AO: darken first ~6 m
    '    diffuseColor.rgb *= mix(0.5, 1.0, smoothstep(0.0, 6.0, tkP.y));',
    '    if (tkN.y > 0.5) {',
    // roof: gravel, no windows
    '      float tkG = tkHash21(floor(tkP.xz * 0.9 + 0.5) + floor(vSeed + 0.5));',
    '      diffuseColor.rgb *= mix(0.38, 0.58, tkG);',
    // red beacon blink on tall roofs
    '      float tkTall = step(120.0, vHeight);',
    '      float tkC = 1.0 - smoothstep(0.6, 2.2, length(tkP.xz));',
    '      float tkPh = fract(uTime * 0.55 + vSeed * 3.71);',
    '      float tkBlink = smoothstep(0.0, 0.06, tkPh) * (1.0 - smoothstep(0.22, 0.32, tkPh));',
    '      totalEmissiveRadiance += vec3(1.0, 0.06, 0.04) * tkBlink * tkTall * tkC * 2.5;',
    '    } else if (tkN.y > -0.5) {',
    // walls: window grid — floors 3.4 m, windows 2.6 m along the face axis
    '      bool tkXFace = abs(tkN.x) > abs(tkN.z);',
    '      float tkAx = tkXFace ? tkP.z : tkP.x;',
    '      float tkFace = tkXFace ? (tkN.x > 0.0 ? 11.0 : 23.0) : (tkN.z > 0.0 ? 37.0 : 53.0);',
    '      vec2 tkCell = vec2(floor(tkP.y / 3.4), floor(tkAx / 2.6));',
    '      vec2 tkF = vec2(fract(tkP.y / 3.4), fract(tkAx / 2.6));',
    // window rectangle, ~0.55 m inset on the 2.6 m bay, sill/head on the 3.4 m floor
    '      float tkMx = smoothstep(0.19, 0.23, tkF.x) * (1.0 - smoothstep(0.77, 0.81, tkF.x));',
    '      float tkMy = smoothstep(0.24, 0.28, tkF.y) * (1.0 - smoothstep(0.78, 0.82, tkF.y));',
    '      float tkWin = tkMx * tkMy;',
    // day: glass darkening + subtle per-instance facade tint
    '      diffuseColor.rgb *= 1.0 - tkWin * 0.35;',
    '      diffuseColor.rgb *= 0.88 + 0.24 * tkHash21(vec2(floor(vSeed * 7.13 + 0.5), tkFace));',
    // night: lit windows
    '      vec2 tkId = floor(tkCell + 0.5) + floor(vec2(vSeed * 61.7 + tkFace) + 0.5);',
    '      float tkH = tkHash21(tkId);',
    '      float tkLit = step(tkH, uLit);',
    '      float tkH2 = tkHash21(tkId + 19.19);',
    '      vec3 tkCol = mix(uWarm, vec3(0.72, 0.84, 1.0), step(0.8, tkH2));', // ~20% cool-white
    '      float tkFl = step(0.94, tkHash21(tkId + 47.3));', // a few flicker slowly
    '      float tkFlick = 1.0 - tkFl * 0.35 * (0.5 + 0.5 * sin(uTime * (1.5 + 2.5 * tkH2) + tkH2 * 40.0));',
    '      totalEmissiveRadiance += tkCol * (tkWin * tkLit * uNight * 1.05 * tkFlick);',
    '    } else {',
    '      diffuseColor.rgb *= 0.4;', // underside
    '    }',
    '  }',
    '}'
  ].join('\n');

  function makeWindowMaterial(U, opts) {
    U = U || newUniforms();
    opts = opts || {};
    var warm = opts.warm || [1.0, 0.72, 0.38];
    var mat = new THREE.MeshStandardMaterial({
      color: opts.color !== undefined ? opts.color : 0x8a8f98,
      roughness: opts.roughness !== undefined ? opts.roughness : 0.85,
      metalness: opts.metalness !== undefined ? opts.metalness : 0.15
    });
    var uLit = { value: opts.litFraction !== undefined ? opts.litFraction : 0.42 };
    var uWarm = { value: new THREE.Color(warm[0], warm[1], warm[2]) };
    mat.onBeforeCompile = function (shader) {
      // shared uniform objects — orchestrator writes uNight, kit.tick writes uTime
      shader.uniforms.uNight = U.uNight;
      shader.uniforms.uTime = U.uTime;
      shader.uniforms.uLit = uLit;
      shader.uniforms.uWarm = uWarm;
      shader.uniforms.uDbg = DBG;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + WIN_VERT_PARS)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WIN_VERT_BODY);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + WIN_FRAG_PARS)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + WIN_FRAG_BODY);
    };
    mat.customProgramCacheKey = function () { return 'terra-windows'; };
    return mat;
  }

  /* ---------- instanced buildings ---------- */
  function makeBuildings(material, items) {
    var n = items.length;
    var geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0); // base at y=0
    var sizes = new Float32Array(n * 3);
    var seeds = new Float32Array(n);
    var mesh = new THREE.InstancedMesh(geo, material, n);
    var rand = util.rng(777);
    for (var i = 0; i < n; i++) {
      var it = items[i];
      var w = it.w, h = it.h, d = it.d;
      _p.set(it.x, 0, it.z);
      _q.setFromAxisAngle(_up, it.rot || 0);
      _s.set(w, h, d);
      _m4.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m4);
      sizes[i * 3] = w; sizes[i * 3 + 1] = h; sizes[i * 3 + 2] = d;
      seeds[i] = rand() * 100;
      _col.set(it.color !== undefined ? it.color : 0xffffff);
      mesh.setColorAt(i, _col);
    }
    _s.set(1, 1, 1);
    geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 3));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  /* ---------- painted ground plane with radial alpha fade ---------- */
  function makeGround(paintFn, sizeM, fadeStart) {
    sizeM = sizeM || 10000;
    fadeStart = fadeStart !== undefined ? fadeStart : 4200;
    var SZ = 2048, half = SZ / 2;
    var canvas = document.createElement('canvas');
    canvas.width = SZ; canvas.height = SZ;
    var ctx = canvas.getContext('2d');
    var pxPerM = SZ / sizeM;
    ctx.save();
    ctx.translate(half, half); // origin = city center, +x right, y-down = +z world
    paintFn(ctx, sizeM, pxPerM);
    ctx.restore();
    // radial alpha fade: opaque to fadeStart, 0 at sizeM/2
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(half, half);
    ctx.globalCompositeOperation = 'destination-in';
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, half);
    var f = Math.min(0.999, Math.max(0, fadeStart / (sizeM / 2)));
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(f, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-half, -half, SZ, SZ);
    ctx.globalCompositeOperation = 'source-over';
    var tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    var geo = new THREE.PlaneGeometry(sizeM, sizeM);
    geo.rotateX(-Math.PI / 2);
    var mat = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, roughness: 0.95, metalness: 0
    });
    return new THREE.Mesh(geo, mat);
  }

  /* ---------- flat water polygon ---------- */
  function makeWaterPoly(points, y) {
    y = y !== undefined ? y : 0.3;
    var shape = new THREE.Shape();
    // shape XY -> world XZ via rotateX(-PI/2): shape (x, -z) lands at world (x, z)
    shape.moveTo(points[0][0], -points[0][1]);
    for (var i = 1; i < points.length; i++) shape.lineTo(points[i][0], -points[i][1]);
    shape.closePath();
    var geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    var mat = new THREE.MeshStandardMaterial({
      color: 0x0a1e33, roughness: 0.12, metalness: 0.65
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = y;
    return mesh;
  }

  /* ---------- moving car lights ---------- */
  function makeCars(U, segments, count) {
    U = U || newUniforms();
    count = Math.max(0, count | 0);
    var segs = [];
    var i, s;
    for (i = 0; i < segments.length; i++) {
      s = segments[i];
      var dx = s.bx - s.ax, dz = s.bz - s.az;
      var len = Math.sqrt(dx * dx + dz * dz);
      if (len < 1) continue;
      segs.push({
        ax: s.ax, az: s.az,
        dx: dx / len, dz: dz / len, len: len,
        quat: new THREE.Quaternion().setFromAxisAngle(_up, Math.atan2(-dz, dx))
      });
    }
    var geo = new THREE.BoxGeometry(4, 1.4, 2);
    geo.translate(0, 0.7, 0); // base at road level
    var mat = new THREE.MeshStandardMaterial({
      color: 0x15161a, roughness: 0.5, metalness: 0.2,
      emissive: 0xffffff, emissiveIntensity: 0.6
    });
    // tint emissive by per-instance color (white headlights / red taillights)
    mat.onBeforeCompile = function (shader) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n\ttotalEmissiveRadiance *= vColor;\n#endif'
      );
    };
    mat.customProgramCacheKey = function () { return 'terra-cars'; };
    var mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.frustumCulled = false;

    var segIdx = new Uint32Array(count);
    var dist = new Float32Array(count);
    var speed = new Float32Array(count);
    var rand = util.rng(4242);
    for (i = 0; i < count; i++) {
      if (segs.length) {
        segIdx[i] = (rand() * segs.length) | 0;
        dist[i] = rand() * segs[segIdx[i]].len;
        speed[i] = 8 + rand() * 8; // 8–16 m/s
      }
      if (i % 2 === 0) _col.setRGB(1.0, 0.92, 0.75); // warm-white headlights
      else _col.setRGB(1.0, 0.1, 0.06);              // red taillights
      mesh.setColorAt(i, _col);
    }

    function writeMatrices() {
      for (var j = 0; j < count; j++) {
        var sg = segs[segIdx[j]];
        _p.set(sg.ax + sg.dx * dist[j], 0, sg.az + sg.dz * dist[j]);
        _m4.compose(_p, sg.quat, _s);
        mesh.setMatrixAt(j, _m4);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (segs.length && count) writeMatrices();
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    function update(dt) {
      mat.emissiveIntensity = 0.35 + 0.65 * U.uNight.value;
      if (!segs.length || !count) return;
      for (var j = 0; j < count; j++) {
        var sg = segs[segIdx[j]];
        var t = dist[j] + speed[j] * dt;
        if (t >= sg.len) t %= sg.len; // wrap
        dist[j] = t;
        _p.set(sg.ax + sg.dx * t, 0, sg.az + sg.dz * t);
        _m4.compose(_p, sg.quat, _s);
        mesh.setMatrixAt(j, _m4);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    return { mesh: mesh, update: update };
  }

  /* ---------- street lamps ---------- */
  function makeLamps(U, positions) {
    U = U || newUniforms();
    var n = positions.length;
    var group = new THREE.Group();

    var poleGeo = new THREE.CylinderGeometry(0.15, 0.15, 9, 6);
    poleGeo.translate(0, 4.5, 0);
    var poleMat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.7, metalness: 0.4 });
    var poles = new THREE.InstancedMesh(poleGeo, poleMat, n);

    var bulbGeo = new THREE.SphereGeometry(0.5, 8, 6);
    var bulbMat = new THREE.MeshStandardMaterial({
      color: 0x0c0a06, emissive: 0xffc16b, emissiveIntensity: 0, roughness: 0.5
    });
    var bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, n);

    for (var i = 0; i < n; i++) {
      _p.set(positions[i][0], 0, positions[i][1]);
      _q.identity();
      _m4.compose(_p, _q, _s);
      poles.setMatrixAt(i, _m4);
      _p.y = 9;
      _m4.compose(_p, _q, _s);
      bulbs.setMatrixAt(i, _m4);
    }
    poles.instanceMatrix.needsUpdate = true;
    bulbs.instanceMatrix.needsUpdate = true;
    poles.frustumCulled = false;
    bulbs.frustumCulled = false;
    group.add(poles);
    group.add(bulbs);

    bulbMat.emissiveIntensity = 3.0 * U.uNight.value;
    bind(U, function (u) { bulbMat.emissiveIntensity = 3.0 * u.uNight.value; });
    return group;
  }

  /* ---------- kit tick: advance uTime + all materials bound to U ---------- */
  function tick(U, dt) {
    U.uTime.value += dt;
    for (var i = 0; i < tickers.length; i++) {
      if (tickers[i].u === U) tickers[i].fn(U, dt);
    }
  }

  /* ---------- primitive helpers ---------- */
  function box(w, h, d, x, y, z, mat, ry) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); // y = CENTER height
    if (ry) m.rotation.y = ry;
    return m;
  }

  function cyl(rTop, rBot, h, x, y, z, mat, seg) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg || 10), mat);
    m.position.set(x, y, z); // y = CENTER height
    return m;
  }

  function stdMat(color, opts) {
    var p = { color: color, roughness: 0.9, metalness: 0, fog: true };
    if (opts) for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) p[k] = opts[k];
    return new THREE.MeshStandardMaterial(p);
  }

  function emissiveMat(U, color, intensity) {
    U = U || newUniforms();
    var mat = new THREE.MeshStandardMaterial({
      color: 0x050505, emissive: color,
      emissiveIntensity: intensity * (0.15 + 0.85 * U.uNight.value),
      roughness: 0.6, metalness: 0
    });
    bind(U, function (u) {
      mat.emissiveIntensity = intensity * (0.15 + 0.85 * u.uNight.value);
    });
    return mat;
  }

  /* ---------- public API ---------- */
  T.citykit = {
    dbg: DBG,
    newUniforms: newUniforms,
    makeWindowMaterial: makeWindowMaterial,
    makeBuildings: makeBuildings,
    makeGround: makeGround,
    makeWaterPoly: makeWaterPoly,
    makeCars: makeCars,
    makeLamps: makeLamps,
    tick: tick,
    box: box,
    cyl: cyl,
    stdMat: stdMat,
    emissiveMat: emissiveMat,
    rng: function (seed) { return util.rng(seed); }
  };
})();