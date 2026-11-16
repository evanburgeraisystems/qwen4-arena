/* ============================================================
   TERRA — core.js
   Shared foundation: namespace, constants, seeded RNG, simplex
   noise (2D/3D), geodesy helpers, easing, event bus, state.
   Plain script (no modules) — works from file://. Requires THREE
   to be loaded first (three.min.js r128 UMD).
   ============================================================ */
(function () {
  'use strict';

  var T = (window.TERRA = window.TERRA || {});

  /* ---------- constants ---------- */
  var C = (T.C = {
    R: 100,            // globe radius in world units
    EARTH_KM: 6371,    // real earth radius, km
    MPU: 63710,        // meters per world unit  (100 units = 6371 km)
    DEG: Math.PI / 180,
    RAD: 180 / Math.PI,
    CITY_VISIBLE_DIST: 0.6,   // world units (~38 km) — city LOD switch
    ORIGIN_SWITCH_DIST: 5     // world units — floating-origin threshold
  });
  C.m2u = function (m) { return m / C.MPU; };
  C.u2m = function (u) { return u * C.MPU; };

  /* ---------- seeded RNG (mulberry32) ---------- */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- simplex noise (Gustavson-style, seeded perm) ---------- */
  var grad3 = new Float32Array([
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
    1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
    0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
  ]);
  var perm = new Uint8Array(512), permMod12 = new Uint8Array(512);
  (function () {
    var p = new Uint8Array(256), i, j, tmp, r = rng(1337);
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) { j = (r() * (i + 1)) | 0; tmp = p[i]; p[i] = p[j]; p[j] = tmp; }
    for (i = 0; i < 512; i++) { perm[i] = p[i & 255]; permMod12[i] = perm[i] % 12; }
  })();

  var F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  var F3 = 1 / 3, G3 = 1 / 6;

  function noise2(xin, yin) {
    var n0 = 0, n1 = 0, n2 = 0;
    var s = (xin + yin) * F2;
    var i = Math.floor(xin + s), j = Math.floor(yin + s);
    var t = (i + j) * G2;
    var x0 = xin - (i - t), y0 = yin - (j - t);
    var i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    var x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    var x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    var ii = i & 255, jj = j & 255;
    var t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) { var gi0 = permMod12[ii + perm[jj]] * 3; t0 *= t0; n0 = t0 * t0 * (grad3[gi0] * x0 + grad3[gi0 + 1] * y0); }
    var t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) { var gi1 = permMod12[ii + i1 + perm[jj + j1]] * 3; t1 *= t1; n1 = t1 * t1 * (grad3[gi1] * x1 + grad3[gi1 + 1] * y1); }
    var t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) { var gi2 = permMod12[ii + 1 + perm[jj + 1]] * 3; t2 *= t2; n2 = t2 * t2 * (grad3[gi2] * x2 + grad3[gi2 + 1] * y2); }
    return 70 * (n0 + n1 + n2); // ~[-1,1]
  }

  function noise3(xin, yin, zin) {
    var n0 = 0, n1 = 0, n2 = 0, n3 = 0;
    var s = (xin + yin + zin) * F3;
    var i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    var t = (i + j + k) * G3;
    var x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
    var i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    var x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    var x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    var x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    var ii = i & 255, jj = j & 255, kk = k & 255;
    var t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 >= 0) { var gi0 = permMod12[ii + perm[jj + perm[kk]]] * 3; t0 *= t0; n0 = t0 * t0 * (grad3[gi0] * x0 + grad3[gi0 + 1] * y0 + grad3[gi0 + 2] * z0); }
    var t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 >= 0) { var gi1 = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; t1 *= t1; n1 = t1 * t1 * (grad3[gi1] * x1 + grad3[gi1 + 1] * y1 + grad3[gi1 + 2] * z1); }
    var t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 >= 0) { var gi2 = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; t2 *= t2; n2 = t2 * t2 * (grad3[gi2] * x2 + grad3[gi2 + 1] * y2 + grad3[gi2 + 2] * z2); }
    var t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 >= 0) { var gi3 = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; t3 *= t3; n3 = t3 * t3 * (grad3[gi3] * x3 + grad3[gi3 + 1] * y3 + grad3[gi3 + 2] * z3); }
    return 32 * (n0 + n1 + n2 + n3); // ~[-1,1]
  }

  function fbm2(x, y, oct, lac, gain) {
    oct = oct || 5; lac = lac || 2; gain = gain || 0.5;
    var a = 1, f = 1, sum = 0, norm = 0;
    for (var o = 0; o < oct; o++) { sum += a * noise2(x * f, y * f); norm += a; a *= gain; f *= lac; }
    return sum / norm;
  }
  function fbm3(x, y, z, oct, lac, gain) {
    oct = oct || 5; lac = lac || 2; gain = gain || 0.5;
    var a = 1, f = 1, sum = 0, norm = 0;
    for (var o = 0; o < oct; o++) { sum += a * noise3(x * f, y * f, z * f); norm += a; a *= gain; f *= lac; }
    return sum / norm;
  }

  /* ---------- scalar math / easing ---------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  // frame-rate independent exponential damping
  function damp(a, b, lambda, dt) { return lerp(a, b, 1 - Math.exp(-lambda * dt)); }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeInOutQuart(t) { return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInCubic(t) { return t * t * t; }
  function easeOutQuint(t) { return 1 - Math.pow(1 - t, 5); }
  function easeOutExpo(t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); }

  /* ---------- geodesy ----------
     Convention (matches THREE.SphereGeometry UVs exactly):
       u = (lon + 180) / 360   (canvas x, left = -180)
       v = (90 - lat) / 180    (canvas y, top = +90)
       latLonToVec3(0, 0, R) === (R, 0, 0)                     */
  function latLonToVec3(lat, lon, r, out) {
    var phi = (90 - lat) * C.DEG;
    var theta = (lon + 180) * C.DEG;
    var sp = Math.sin(phi);
    var v = out || new THREE.Vector3();
    return v.set(-r * sp * Math.cos(theta), r * Math.cos(phi), r * sp * Math.sin(theta));
  }
  function vec3ToLatLon(v) {
    var n = v.clone().normalize();
    var lat = 90 - Math.acos(clamp(n.y, -1, 1)) * C.RAD;
    var lon = Math.atan2(n.z, -n.x) * C.RAD - 180;
    lon = ((lon + 540) % 360) - 180;
    return { lat: lat, lon: lon };
  }
  // great-circle interpolation between two surface points (any radius,
  // radius interpolated linearly). Handles near-antipodal gracefully.
  function slerpSurface(a, b, t, out) {
    var ra = a.length(), rb = b.length();
    var na = a.clone().normalize(), nb = b.clone().normalize();
    var d = clamp(na.dot(nb), -1, 1);
    var ang = Math.acos(d);
    var r = lerp(ra, rb, t);
    var v = out || new THREE.Vector3();
    if (ang < 1e-5) { return v.copy(na).multiplyScalar(r); }
    if (Math.PI - ang < 1e-4) {
      // antipodal: pick a stable perpendicular axis
      var axis = Math.abs(na.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      var perp = new THREE.Vector3().crossVectors(na, axis).normalize();
      return v.copy(na).multiplyScalar(Math.cos(Math.PI * t))
        .addScaledVector(perp, Math.sin(Math.PI * t)).multiplyScalar(r);
    }
    var s = Math.sin(ang);
    return v.copy(na).multiplyScalar(Math.sin((1 - t) * ang) / s)
      .addScaledVector(nb, Math.sin(t * ang) / s).multiplyScalar(r);
  }
  function surfaceAngle(a, b) {
    return Math.acos(clamp(a.clone().normalize().dot(b.clone().normalize()), -1, 1));
  }

  /* ---------- formatting ---------- */
  function formatAlt(m) {
    if (m >= 1e6) return (m / 1000).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' km';
    if (m >= 10000) return (m / 1000).toFixed(0) + ' km';
    if (m >= 1000) return (m / 1000).toFixed(1) + ' km';
    return Math.round(m) + ' m';
  }
  function formatLatLon(lat, lon) {
    return Math.abs(lat).toFixed(2) + '°' + (lat >= 0 ? 'N' : 'S') + '  ' +
           Math.abs(lon).toFixed(2) + '°' + (lon >= 0 ? 'E' : 'W');
  }
  function formatPop(p) {
    if (p >= 1) return p.toFixed(1) + 'M';
    return Math.round(p * 1000) + 'K';
  }

  /* ---------- event bus ---------- */
  var listeners = {};
  var bus = (T.bus = {
    on: function (evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); return fn; },
    off: function (evt, fn) { var l = listeners[evt]; if (l) { var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } },
    emit: function (evt, data) { var l = listeners[evt]; if (l) for (var i = 0; i < l.length; i++) { try { l[i](data); } catch (e) { console.error('[bus:' + evt + ']', e); } } }
  });

  /* ---------- shared state ---------- */
  T.state = {
    phase: 'loading',       // loading | space | flying | orbit | street | tour
    focusCity: null,        // city object from TERRA.data.cities or null
    altitudeM: Infinity,    // camera height above surface
    sunDir: new THREE.Vector3(1, 0.25, 0.3).normalize(),
    spinEnabled: true,
    tourActive: false,
    time: 0
  };

  /* ---------- public util ---------- */
  T.util = {
    rng: rng, noise2: noise2, noise3: noise3, fbm2: fbm2, fbm3: fbm3,
    clamp: clamp, lerp: lerp, smoothstep: smoothstep, damp: damp,
    easeInOutCubic: easeInOutCubic, easeInOutQuart: easeInOutQuart,
    easeOutCubic: easeOutCubic, easeInCubic: easeInCubic,
    easeOutQuint: easeOutQuint, easeOutExpo: easeOutExpo,
    latLonToVec3: latLonToVec3, vec3ToLatLon: vec3ToLatLon,
    slerpSurface: slerpSurface, surfaceAngle: surfaceAngle,
    formatAlt: formatAlt, formatLatLon: formatLatLon, formatPop: formatPop
  };
})();