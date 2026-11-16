/* ============================================================
   TERRA — textures.js  (SYSTEM A, part 1)
   Procedural Earth maps: day / night / clouds / spec / bump.
   Plain IIFE, no modules/fetch/external assets. Requires core.js
   (TERRA.util) and data/cities.js. THREE r128 global.
   Convention: x=(lon+180)/360*W, y=(90-lat)/180*H.
   ============================================================ */
(function () {
  'use strict';
  var T = window.TERRA;
  var U = T.util;

  /* ================= continent data =================
     Hand-authored simplified outlines [lon,lat]. Anchor points
     from CONTRACT.md, extra vertices for recognizability. */
  var POLYS = {
    northAmerica: [
      -168,65, -165,60, -150,59, -140,60, -130,54, -124,48, -124,40, -122,37,
      -117,32, -114,29, -110,24, -105,20, -97,16, -90,15, -83,9, -77,8,
      -82,10, -88,16, -90,21, -97,26, -94,29, -89,29, -84,30, -81,25,
      -80,32, -76,35, -70,42, -66,45, -60,46, -64,50, -58,54, -64,60,
      -78,62, -85,66, -95,68, -110,68, -125,70, -140,70, -156,71
    ],
    southAmerica: [
      -77,8, -72,12, -64,10, -60,10, -52,4, -44,-3, -35,-6, -38,-13,
      -48,-25, -53,-34, -62,-40, -65,-47, -68,-55, -72,-52, -73,-44,
      -71,-30, -70,-18, -76,-14, -81,-6, -80,0
    ],
    africa: [
      -5.9,35.8, 3,36.8, 10,37, 20,32, 25,32, 32.5,30, 34,27, 36,22,
      38,18, 40,15, 43,11.5, 51.4,11.8, 41,-2, 40,-15, 35,-24, 20,-34.8,
      18,-34.4, 12,-18, 13,-8.8, 9.3,0.5, 3,6.2, -7.5,4.6, -17.5,14.7, -13,27.7
    ],
    eurasia: [
      -9,43, -9,38, -6,36, -2,36.7, 0,38.8, 3,42, 6,43, 8,44, 10,44,
      12,44, 14,42, 16,40.5, 15.5,38, 16.5,38.5, 18,40, 20,39.5, 22,38,
      24,38, 26,39, 28,41, 30,36.5, 33,36, 36,36, 35.5,34, 34,31, 33,31,
      35,28, 39,21, 43,12, 48,13, 51,12, 54,17, 59,22, 56,27, 48,30,
      50,26, 56,24, 60,25, 66,25, 72,20, 77,8, 80,10, 80,15, 87,21,
      92,20, 94,16, 98,8, 100,5, 103,1, 104,4, 105,10, 103,11, 100,13,
      102,15, 105,16, 109,18, 108,21, 110,21, 113,22, 117,24, 120,27,
      121,31, 120,34, 122,37, 124,38, 126,34.5, 129,35, 129.5,38, 126,40,
      131,43, 135,48, 142,54, 156,51, 158,54, 162,60, 170,66, 179.9,68,
      179.9,71, 160,70, 140,72, 120,73, 105,77, 90,75, 70,73, 60,70,
      45,68, 33,69, 25,71, 15,68, 5,62, 5,58, 10,54, 4,52, -2,48,
      -5,48, -2,44
    ],
    australia: [
      113,-22, 114,-34, 118,-35, 124,-33, 130,-32, 138,-35, 141,-38,
      147,-38, 150,-37, 153,-30, 153,-25, 146,-19, 142,-11, 136,-12,
      131,-11, 125,-14, 122,-17
    ],
    greenland: [
      -73,78, -68,76, -60,75, -55,70, -53,66, -45,60, -42,62, -38,65,
      -30,68, -25,70, -20,73, -22,76, -30,79, -45,82, -58,82, -68,80
    ],
    uk: [-5,50, -3,53, -5,56, -3,58.5, -1,57, 0,53, 1,51.5, -2,50.5],
    ireland: [-10,52, -8,55, -6,54.5, -6,52.5, -9,51.5],
    iceland: [-24,64, -21,66, -16,66.5, -14,65, -18,63.5, -22,63.8],
    svalbard: [11,77, 17,78, 20,80, 15,80.5, 10,79],
    japanHonshu: [131,34, 133,35.5, 136,36.5, 138,37.5, 140,39.5, 140.5,41.5, 141,40, 140,36.5, 139.5,35, 136,34, 133,33.5, 131,33],
    japanHokkaido: [140,42, 143,43, 145.5,44, 144,42, 141,41.5],
    japanKyushu: [130,31, 132,32, 131.5,33.5, 129.5,32.5],
    madagascar: [44,-12, 50,-16, 48,-22, 45,-25, 43,-22, 44,-16],
    borneo: [109,1, 114,4, 117,7, 119,5, 117,0, 114,-3, 110,-2],
    sumatra: [95,5, 99,2, 103,-2, 106,-6, 103,-5, 98,1, 95,3],
    java: [105,-6.5, 110,-7, 114,-7.5, 114,-8.5, 108,-8, 105,-7],
    newGuinea: [131,-1, 137,-2, 142,-4, 147,-6, 150,-9, 146,-9, 141,-8, 136,-5, 132,-3],
    luzon: [120,18, 122,17, 122,14, 124,12, 122,10, 120,13, 119,16],
    mindanao: [122,8, 126,9, 126,6, 122,6],
    sriLanka: [80,6, 82,7, 81,9, 80,8],
    singapore: [103.5,0.9, 103.6,1.55, 104.25,1.5, 104.15,0.9],
    cuba: [-85,22, -80,23, -75,20, -78,20, -82,21.5, -85,21.5],
    hispaniola: [-74,19.5, -70,19.8, -69,18.5, -72,18],
    tasmania: [145,-41, 148,-41, 148,-43, 145,-42.5],
    nzNorth: [173,-35, 176,-37, 178,-38, 176,-40, 174,-39, 173,-36],
    nzSouth: [171,-40.8, 173,-40.5, 174.2,-41.5, 173,-43, 171,-44.5, 168,-46, 166,-46, 168.5,-44, 170,-42.5],
    baffin: [-75,68, -68,70, -62,67, -65,63, -72,64, -78,66],
    victoria: [-114,72, -108,73, -104,71, -108,69, -114,70],
    novayaZemlya: [53,71, 56,74, 58,77, 55,76, 52,73]
  };

  // Inland seas / lakes painted back to ocean (holes).
  var HOLES = {
    hudsonBay: [-94,57, -92,62, -88,64, -82,63, -79,60, -78,56, -82,53, -88,52, -92,54],
    baltic: [12,56, 15,56, 19,56.5, 21.5,58.5, 24,61, 25,64, 25,65.5, 22,65, 20,62.5, 19,60, 18,58.5, 14,56.8],
    blackSea: [28,41, 34,41.5, 41,41, 40,44, 33,45, 28,43],
    caspian: [47,44, 53,42, 54,38, 50,37, 48,41],
    gulfCalifornia: [-114,31, -111,27, -108,24, -109,23, -112,27, -114,30],
    lakeSuperior: [-92,46.5, -86,46.5, -84.5,47.5, -88,48.5, -92,47.5],
    lakeMichigan: [-88,46, -86,44, -86.5,42, -88,42.5],
    lakeHuron: [-84,44, -81,44, -80,45.5, -82,46, -84,45.5],
    lakeErie: [-83.5,41.5, -79,42.5, -79,43, -83,42.5],
    lakeVictoria: [31.5,-0.5, 34,-0.5, 34,-2.5, 32,-2.8]
  };

  // Mountain ranges: polylines [lon,lat,...], width (deg), strength.
  var RANGES = [
    { p: [-77,8, -75,0, -70,-15, -68,-25, -70,-35, -72,-45, -73,-52], w: 2.6, s: 1.0 },   // Andes
    { p: [-125,60, -118,52, -112,45, -108,38, -105,32], w: 3.2, s: 0.8 },                 // Rockies
    { p: [72,34, 80,31, 88,28.5, 95,27], w: 2.4, s: 1.25 },                               // Himalaya
    { p: [78,33, 98,32], w: 5.5, s: 0.5 },                                                // Tibet plateau
    { p: [6,45, 10,46.5, 14,46.5], w: 1.3, s: 0.75 },                                     // Alps
    { p: [60,55, 58,62, 62,68], w: 1.6, s: 0.4 },                                         // Urals
    { p: [-84,34, -78,38, -72,44], w: 2.2, s: 0.35 },                                     // Appalachians
    { p: [38,9, 40,12], w: 2.6, s: 0.55 },                                                // Ethiopia
    { p: [46,33, 52,30, 58,28], w: 2.6, s: 0.5 },                                         // Zagros
    { p: [8,61, 14,66], w: 1.6, s: 0.45 },                                                // Scandes
    { p: [98,38, 104,37], w: 2.0, s: 0.4 },                                               // Qinling
    { p: [140,-6, 145,-7], w: 1.6, s: 0.5 }                                               // New Guinea highlands
  ];

  // Desert regions [lonMin,lonMax,latMin,latMax,strength]
  var DESERTS = [
    [-15,35,16,33,1.0],     // Sahara
    [35,58,12,32,1.0],      // Arabia
    [118,147,-31,-18,0.95], // Australia interior
    [17,29,-29,-17,0.8],    // Kalahari
    [-72,-67,-29,-16,0.9],  // Atacama
    [-118,-103,27,41,0.85], // SW USA
    [90,112,38,46,0.6],     // Gobi
    [56,70,24,36,0.6]       // Iran / Pakistan
  ];

  /* ================= shared state ================= */
  var MW = 1024, MH = 512;           // land mask / field resolution
  var DW = 2048, DH = 1024;          // day & night resolution
  var mask = new Uint8Array(MW * MH);
  var distLand = new Float32Array(MW * MH); // ocean px: distance to land (px)
  var distSea = new Float32Array(MW * MH);  // land px: distance to ocean (px)
  var fElev, fMoist, fDepth, fMount, fDesert; // Float32 fields at MW×MH
  var maskCanvas = null;

  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function sstep(a, b, x) { var t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function tracePoly(ctx, flat, w, h) {
    ctx.beginPath();
    for (var i = 0; i < flat.length; i += 2) {
      var x = (flat[i] + 180) / 360 * w;
      var y = (90 - flat[i + 1]) / 180 * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /* ================= stage 1: land mask ================= */
  function buildMask() {
    var hi = makeCanvas(DW, DH);
    var hc = hi.getContext('2d');
    hc.fillStyle = '#000000'; hc.fillRect(0, 0, DW, DH);
    hc.fillStyle = '#ffffff';
    var k;
    for (k in POLYS) { tracePoly(hc, POLYS[k], DW, DH); hc.fill(); }

    // Antarctica: noisy edge band, peninsula reaches (-60,-63)
    hc.beginPath();
    hc.moveTo(0, DH);
    var i, lon, edge, x;
    for (i = 0; i <= 36; i++) {
      lon = -180 + i * 10;
      edge = -69.5 + U.noise2(lon * 0.13 + 5.2, 9.1) * 3.2;
      if (lon > -68 && lon < -52) edge = Math.max(edge, -63.5 + U.noise2(lon * 0.3, 3.3) * 1.2);
      x = (lon + 180) / 360 * DW;
      hc.lineTo(x, (90 - edge) / 180 * DH);
    }
    hc.lineTo(DW, DH);
    hc.closePath();
    hc.fill();

    // holes (inland seas)
    hc.fillStyle = '#000000';
    for (k in HOLES) { tracePoly(hc, HOLES[k], DW, DH); hc.fill(); }

    // downsample to 1024×512 mask
    maskCanvas = makeCanvas(MW, MH);
    var mc = maskCanvas.getContext('2d');
    mc.drawImage(hi, 0, 0, MW, MH);
    var d = mc.getImageData(0, 0, MW, MH).data;
    for (i = 0; i < MW * MH; i++) mask[i] = d[i * 4] > 127 ? 1 : 0;

    chamfer(distLand, 1); // distance from ocean to nearest land
    chamfer(distSea, 0);  // distance from land to nearest ocean
  }

  // two-pass chamfer distance transform; zero where mask===zeroVal
  function chamfer(out, zeroVal) {
    var INF = 1e6, i, x, y, v;
    for (i = 0; i < MW * MH; i++) out[i] = (mask[i] === zeroVal) ? 0 : INF;
    for (y = 0; y < MH; y++) {
      for (x = 0; x < MW; x++) {
        i = y * MW + x; v = out[i];
        if (x > 0) v = Math.min(v, out[i - 1] + 3);
        if (y > 0) {
          v = Math.min(v, out[i - MW] + 3);
          if (x > 0) v = Math.min(v, out[i - MW - 1] + 4);
          if (x < MW - 1) v = Math.min(v, out[i - MW + 1] + 4);
        }
        out[i] = v;
      }
    }
    for (y = MH - 1; y >= 0; y--) {
      for (x = MW - 1; x >= 0; x--) {
        i = y * MW + x; v = out[i];
        if (x < MW - 1) v = Math.min(v, out[i + 1] + 3);
        if (y < MH - 1) {
          v = Math.min(v, out[i + MW] + 3);
          if (x < MW - 1) v = Math.min(v, out[i + MW + 1] + 4);
          if (x > 0) v = Math.min(v, out[i + MW - 1] + 4);
        }
        out[i] = v;
      }
    }
    for (i = 0; i < MW * MH; i++) out[i] /= 3;
  }

  /* ================= stage 2: noise fields + mountains ================= */
  // bilinear sample of a MW×MH field, x wraps (seamless), y clamps
  function sample(f, fx, fy) {
    var x0 = Math.floor(fx), y0 = Math.floor(fy);
    var tx = fx - x0, ty = fy - y0;
    x0 = ((x0 % MW) + MW) % MW;
    var x1 = (x0 + 1) % MW;
    if (y0 < 0) { y0 = 0; ty = 0; }
    if (y0 > MH - 1) { y0 = MH - 1; ty = 0; }
    var y1 = Math.min(y0 + 1, MH - 1);
    var a = f[y0 * MW + x0], b = f[y0 * MW + x1];
    var c = f[y1 * MW + x0], d = f[y1 * MW + x1];
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
  }

  function mountainAt(lon, lat, cosLat) {
    var m = 0, r, j, ax, ay, bx, by, dx, dy, t, px, py, d, w, val;
    for (r = 0; r < RANGES.length; r++) {
      var rg = RANGES[r], p = rg.p;
      for (j = 0; j + 3 < p.length; j += 2) {
        ax = (p[j] - lon) * cosLat; ay = p[j + 1] - lat;
        bx = (p[j + 2] - lon) * cosLat; by = p[j + 3] - lat;
        dx = bx - ax; dy = by - ay;
        t = (dx * dx + dy * dy) > 1e-9 ? clamp01(-(ax * dx + ay * dy) / (dx * dx + dy * dy)) : 0;
        px = ax + dx * t; py = ay + dy * t;
        d = Math.sqrt(px * px + py * py);
        w = rg.w;
        if (d < w) {
          val = rg.s * Math.pow(1 - d / w, 1.4);
          if (val > m) m = val;
        }
      }
    }
    return m;
  }

  function desertWeight(lat, lon, n) {
    var w = 0, i, d, wx;
    var al = Math.abs(lat);
    for (i = 0; i < DESERTS.length; i++) {
      d = DESERTS[i];
      wx = sstep(d[0] - 3, d[0] + 3, lon) * (1 - sstep(d[1] - 3, d[1] + 3, lon)) *
           sstep(d[2] - 3, d[2] + 3, lat) * (1 - sstep(d[3] - 3, d[3] + 3, lat));
      if (wx * d[4] > w) w = wx * d[4];
    }
    // generic subtropical dryness outside named deserts
    var band = sstep(13, 19, al) * (1 - sstep(30, 36, al)) * 0.28;
    if (band > w) w = band;
    return clamp01(w * (0.78 + 0.3 * n));
  }

  async function buildFields(onProgress) {
    fElev = new Float32Array(MW * MH);
    fMoist = new Float32Array(MW * MH);
    fDepth = new Float32Array(MW * MH);
    fMount = new Float32Array(MW * MH);
    fDesert = new Float32Array(MW * MH);
    var sp = new Float32Array(MH), cp = new Float32Array(MH);
    var ct = new Float32Array(MW), st = new Float32Array(MW);
    var y, x, lat, phi, theta;
    for (y = 0; y < MH; y++) {
      lat = 90 - (y + 0.5) / MH * 180;
      phi = (90 - lat) * Math.PI / 180;
      sp[y] = Math.sin(phi); cp[y] = Math.cos(phi);
    }
    for (x = 0; x < MW; x++) {
      theta = ((x + 0.5) / MW * 360 - 180 + 180) * Math.PI / 180;
      ct[x] = Math.cos(theta); st[x] = Math.sin(theta);
    }
    for (y = 0; y < MH; y++) {
      lat = 90 - (y + 0.5) / MH * 180;
      var cosLat = Math.max(0.2, Math.cos(lat * Math.PI / 180));
      for (x = 0; x < MW; x++) {
        var i = y * MW + x;
        var lon = (x + 0.5) / MW * 360 - 180;
        var px = -sp[y] * ct[x], py = cp[y], pz = sp[y] * st[x];
        fElev[i] = U.fbm3(px * 2.2, py * 2.2, pz * 2.2, 5, 2, 0.5);
        fMoist[i] = U.fbm3(px * 3.1 + 13.7, py * 3.1 + 7.9, pz * 3.1 - 5.2, 3, 2, 0.5);
        fDepth[i] = U.fbm3(px * 4.3 - 31.4, py * 4.3 + 17.2, pz * 4.3 + 9.6, 3, 2, 0.5);
        var m = mountainAt(lon, lat, cosLat);
        if (m > 0) m *= 0.55 + 0.45 * Math.abs(fElev[i]); // ridge streaks
        fMount[i] = m;
        fDesert[i] = desertWeight(lat, lon, fElev[i]);
      }
      if ((y & 63) === 63) {
        onProgress(0.12 + 0.26 * (y / MH), 'Sculpting terrain');
        await tick();
      }
    }
  }

  /* ================= stage 3: day map ================= */
  function buildDay() {
    var cv = makeCanvas(DW, DH);
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(DW, DH);
    var d = img.data;
    var x, y, i, lat, lon, fx, fy;
    for (y = 0; y < DH; y++) {
      lat = 90 - (y + 0.5) / DH * 180;
      var al = Math.abs(lat);
      fy = (y + 0.5) * 0.5 - 0.5;
      // latitude-only biome blends (hoisted out of the pixel loop)
      var boreal = sstep(47, 58, al);
      var tundra = sstep(59, 67, al);
      var polar = sstep(68, 76, al);
      var snowLatBoost = sstep(40, 65, al) * 0.35;
      var iceAnt = lat < -62 ? sstep(-62, -66, lat) : 0;
      for (x = 0; x < DW; x++) {
        i = (y * DW + x) * 4;
        lon = (x + 0.5) / DW * 360 - 180;
        fx = (x + 0.5) * 0.5 - 0.5;
        var landF = clamp01(sample(mask, fx, fy));
        var elev = sample(fElev, fx, fy);
        var moist = sample(fMoist, fx, fy);
        var depth = sample(fDepth, fx, fy);
        var mount = sample(fMount, fx, fy);
        var dLand = sample(distLand, fx, fy);

        /* ---- ocean ---- */
        var dt = 0.5 + 0.5 * depth;
        var or = 8 + 14 * dt, og = 28 + 30 * dt, ob = 62 + 44 * dt;
        var shelf = sstep(7, 0.5, dLand);
        or += (40 - or) * shelf * 0.8;
        og += (104 - og) * shelf * 0.8;
        ob += (140 - ob) * shelf * 0.8;
        // arctic sea ice
        var iceEdge = 79 + depth * 3.5;
        var seaIce = sstep(iceEdge, iceEdge + 3, lat);
        if (lat < -64) seaIce = Math.max(seaIce, sstep(-64, -69, lat) * 0.85);
        if (seaIce > 0) {
          or += (232 - or) * seaIce; og += (238 - og) * seaIce; ob += (244 - ob) * seaIce;
        }

        /* ---- land ---- */
        // base temperate green
        var lr = 58, lg = 102, lb = 48;
        // boreal / tundra / ice by latitude (coeffs precomputed per row)
        lr += (40 - lr) * boreal; lg += (66 - lg) * boreal; lb += (48 - lb) * boreal;
        lr += (126 - lr) * tundra; lg += (118 - lg) * tundra; lb += (102 - lb) * tundra;
        lr += (235 - lr) * polar; lg += (240 - lg) * polar; lb += (245 - lb) * polar;
        // rainforest near equator (moist)
        var eq = (1 - sstep(6, 16, al)) * sstep(-0.25, 0.35, moist);
        lr += (20 - lr) * eq; lg += (74 - lg) * eq; lb += (30 - lb) * eq;
        // dry savanna / steppe
        var dry = sstep(0.1, -0.45, moist) * (1 - polar);
        var dw = sample(fDesert, fx, fy);
        dry *= (1 - dw);
        lr += (112 - lr) * dry * 0.8; lg += (116 - lg) * dry * 0.8; lb += (56 - lb) * dry * 0.8;
        // deserts
        lr += (198 - lr) * dw; lg += (170 - lg) * dw; lb += (112 - lb) * dw;
        // mountains: rock + snow
        if (mount > 0.08) {
          var rock = clamp01(mount * 1.1);
          lr += (138 - lr) * rock * 0.75; lg += (126 - lg) * rock * 0.75; lb += (108 - lb) * rock * 0.75;
          var snow = sstep(0.5, 0.95, mount + snowLatBoost);
          lr += (242 - lr) * snow; lg += (245 - lg) * snow; lb += (248 - lb) * snow;
        }
        // ice sheets: Greenland interior + Antarctica
        var ice = iceAnt;
        if (lon > -75 && lon < -10 && lat > 59) ice = Math.max(ice, sstep(61, 66, lat + elev * 2.5));
        if (ice > 0) {
          lr += (236 - lr) * ice; lg += (241 - lg) * ice; lb += (246 - lb) * ice;
        }
        // fine detail shading
        var det = 0.9 + 0.2 * (0.5 + 0.5 * elev);
        lr *= det; lg *= det; lb *= det;

        /* ---- blend coast ---- */
        d[i]     = or + (lr - or) * landF;
        d[i + 1] = og + (lg - og) * landF;
        d[i + 2] = ob + (lb - ob) * landF;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  }

  /* ================= stage 4: night map ================= */
  function buildNight() {
    var cv = makeCanvas(DW, DH);
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, DW, DH);
    ctx.globalCompositeOperation = 'lighter';

    function px(lon) { return (lon + 180) / 360 * DW; }
    function py(lat) { return (90 - lat) / 180 * DH; }

    // every city: warm gaussian blob sized by population
    var cities = (T.data && T.data.cities) || [];
    var i, c;
    for (i = 0; i < cities.length; i++) {
      c = cities[i];
      var cx = px(c.lon), cy = py(c.lat);
      var rad = 2.4 + Math.sqrt(c.pop) * 2.1;
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad * 3);
      g.addColorStop(0, 'rgba(255,205,130,0.95)');
      g.addColorStop(0.25, 'rgba(255,180,90,0.55)');
      g.addColorStop(0.6, 'rgba(255,150,60,0.16)');
      g.addColorStop(1, 'rgba(255,140,50,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - rad * 3, cy - rad * 3, rad * 6, rad * 6);
      if (c.pop > 6) { // cool-white core for megacities
        var g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad * 0.7);
        g2.addColorStop(0, 'rgba(235,240,255,0.9)');
        g2.addColorStop(1, 'rgba(235,240,255,0)');
        ctx.fillStyle = g2;
        ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
      }
    }

    // scattered town lights on land, denser in populated regions / near coasts
    var r = U.rng(4242);
    var attempts = 30000;
    for (i = 0; i < attempts; i++) {
      var lat = (r() * 2 - 1) * 72;
      var lon = r() * 360 - 180;
      var mx = Math.floor((lon + 180) / 360 * MW) % MW;
      var my = U.clamp(Math.floor((90 - lat) / 180 * MH), 0, MH - 1);
      var mi = my * MW + mx;
      if (!mask[mi]) continue;
      var al = Math.abs(lat);
      if (al > 66 || lat < -60) continue;                       // ice
      if (desertWeight(lat, lon, 0) > 0.55) continue;           // deserts
      var dens = 0.14;
      if (lon > -10 && lon < 42 && lat > 36 && lat < 60) dens = 0.85;       // Europe
      else if (lon > 66 && lon < 92 && lat > 6 && lat < 32) dens = 0.9;     // India
      else if (lon > 100 && lon < 126 && lat > 20 && lat < 43) dens = 0.85; // East Asia
      else if (lon > -92 && lon < -65 && lat > 29 && lat < 46) dens = 0.8;  // US east
      else if (lon > 126 && lon < 142 && lat > 30 && lat < 42) dens = 0.7;  // Japan
      else if (lon > 105 && lon < 122 && lat > 8 && lat < 24) dens = 0.55;  // SE Asia coast
      else if (lon > 95 && lon < 115 && lat > -9 && lat < 8) dens = 0.5;    // Indonesia
      else if (lon > -50 && lon < -32 && lat > -28 && lat < -5) dens = 0.5; // Brazil coast
      else if (lon > 25 && lon < 40 && lat > -5 && lat < 12) dens = 0.4;    // E Africa
      if (distSea[mi] < 6) dens *= 1.5;                          // coastal boost
      if (r() > dens) continue;
      var a = 0.2 + r() * 0.6;
      var warm = r();
      var cr = 255, cg = warm < 0.12 ? 230 : 170 + (warm * 50) | 0, cb = warm < 0.12 ? 250 : 80 + (warm * 40) | 0;
      ctx.fillStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',' + a.toFixed(2) + ')';
      var s = r() < 0.82 ? 1 : 2;
      ctx.fillRect(px(lon), py(lat), s, s);
    }
    ctx.globalCompositeOperation = 'source-over';
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  }

  /* ================= stage 5: clouds ================= */
  async function buildClouds(onProgress) {
    var cv = makeCanvas(MW, MH);
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(MW, MH);
    var d = img.data;
    var x, y;
    for (y = 0; y < MH; y++) {
      var lat = 90 - (y + 0.5) / MH * 180;
      var phi = (90 - lat) * Math.PI / 180;
      var sp = Math.sin(phi), cp = Math.cos(phi);
      var al = Math.abs(lat);
      // latitude bands: ITCZ ~6N, midlatitude storm tracks ±48, sparse subtropics
      var itcz = Math.exp(-Math.pow((lat - 6) / 9, 2)) * 0.42;
      var mid = Math.exp(-Math.pow((al - 48) / 15, 2)) * 0.4;
      var sub = -0.24 * Math.exp(-Math.pow((al - 22) / 10, 2));
      var polar = -0.2 * sstep(66, 80, al);
      var band = 0.3 + itcz + mid + sub + polar;
      for (x = 0; x < MW; x++) {
        var theta = ((x + 0.5) / MW * 360) * Math.PI / 180;
        var px = -sp * Math.cos(theta), py = cp, pz = sp * Math.sin(theta);
        // domain warp for swirls
        var w1 = U.fbm3(px * 2.3 + 7.3, py * 2.3 + 2.1, pz * 2.3 - 4.8, 3, 2, 0.5);
        var w2 = U.fbm3(px * 2.3 - 4.1, py * 2.3 + 9.4, pz * 2.3 + 6.2, 3, 2, 0.5);
        var qx = px * 3.4 + w1 * 0.95;
        var qy = py * 3.4 + w2 * 0.95;
        var qz = pz * 3.4 + w1 * 0.6;
        var n = U.fbm3(qx, qy, qz, 4, 2.1, 0.5) * 0.5 + 0.5;
        var v = n * 0.72 + band - 0.68;
        var a = sstep(0.06, 0.5, v);
        var idx = (y * MW + x) * 4;
        d[idx] = 255; d[idx + 1] = 255; d[idx + 2] = 255;
        d[idx + 3] = (a * 190) | 0;
      }
      if ((y & 63) === 63) {
        onProgress(0.78 + 0.12 * (y / MH), 'Weaving clouds');
        await tick();
      }
    }
    ctx.putImageData(img, 0, 0);
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  }

  /* ================= stage 6: spec + bump ================= */
  function buildSpecBump() {
    var sc = makeCanvas(MW, MH), bc = makeCanvas(MW, MH);
    var sctx = sc.getContext('2d'), bctx = bc.getContext('2d');
    var si = sctx.createImageData(MW, MH), bi = bctx.createImageData(MW, MH);
    var sd = si.data, bd = bi.data;
    var i, x, y;
    for (y = 0; y < MH; y++) {
      var lat = 90 - (y + 0.5) / MH * 180;
      for (x = 0; x < MW; x++) {
        i = y * MW + x;
        var land = mask[i];
        // spec: white ocean / black land, slight blur at coasts
        var signed = land ? -distSea[i] : distLand[i];
        var sv = (255 * sstep(-1.4, 1.4, signed)) | 0;
        var j = i * 4;
        sd[j] = sv; sd[j + 1] = sv; sd[j + 2] = sv; sd[j + 3] = 255;
        // bump: ocean mid-gray flat, land fbm + mountains
        var bv;
        if (!land) {
          bv = 118;
        } else {
          bv = 128 + fElev[i] * 36 + fMount[i] * 110;
          if (lat < -62) bv += 28;
          var lon = (x + 0.5) / MW * 360 - 180;
          if (lon > -75 && lon < -10 && lat > 62) bv += 26;
          bv = U.clamp(bv, 0, 255);
        }
        bd[j] = bv; bd[j + 1] = bv; bd[j + 2] = bv; bd[j + 3] = 255;
      }
    }
    sctx.putImageData(si, 0, 0);
    bctx.putImageData(bi, 0, 0);
    var st = new THREE.CanvasTexture(sc); st.wrapS = THREE.RepeatWrapping;
    var bt = new THREE.CanvasTexture(bc); bt.wrapS = THREE.RepeatWrapping;
    return { spec: st, bump: bt };
  }

  /* ================= public API ================= */
  function isLand(lat, lon) {
    var x = Math.floor((lon + 180) / 360 * MW);
    var y = Math.floor((90 - lat) / 180 * MH);
    x = ((x % MW) + MW) % MW;
    y = U.clamp(y, 0, MH - 1);
    return mask[y * MW + x] === 1;
  }

  async function generate(onProgress) {
    var P = typeof onProgress === 'function' ? onProgress : function () {};
    P(0.02, 'Building continents');
    await tick();
    buildMask();
    P(0.12, 'Sculpting terrain');
    await tick();
    await buildFields(P);
    P(0.4, 'Painting biomes');
    await tick();
    var day = buildDay();
    P(0.62, 'Igniting cities');
    await tick();
    var night = buildNight();
    P(0.78, 'Weaving clouds');
    await tick();
    var clouds = await buildClouds(P);
    P(0.92, 'Finishing maps');
    await tick();
    var sb = buildSpecBump();
    P(1, 'Ready');
    return { day: day, night: night, clouds: clouds, spec: sb.spec, bump: sb.bump };
  }

  T.textures = { generate: generate, isLand: isLand };
})();