/* ============================================================
   TERRA — city-nyc.js (agent B1)
   Manhattan-like district: rotated grid island, Central Park,
   Hudson & East rivers, 2 bridges, Midtown/Downtown height
   clusters, Empire / WTC / Chrysler landmarks, cars + lamps.
   Meters, +Y up, ground y=0. Plain IIFE, THREE r128.
   Layout is generated as DATA first; ground is painted from
   that same data. All layout coords are rotated ~29° into
   world space (the anchor itself is never rotated).
   ============================================================ */
(function () {
  'use strict';

  var T = (window.TERRA = window.TERRA || {});
  T.cityBuilders = T.cityBuilders || {};

  T.cityBuilders.nyc = function (anchor, kit, hero, tex) {
    hero = hero || { seed: 1901 };
    var rng = kit.rng(hero.seed || 1901);
    var rngPaint = kit.rng((hero.seed || 1901) + 101);
    var U = kit.newUniforms();

    /* ---------- layout constants (meters, layout space) ---------- */
    var THETA = 29 * Math.PI / 180;
    var COS = Math.cos(THETA), SIN = Math.sin(THETA);
    var ISL_W = 1200;            // island half-width
    var ISL_L = 3250;            // island half-length (along Z)
    var AVE_SP = 220, ST_SP = 80;
    var AVE_HW = 13, ST_HW = 8;  // half widths of avenue / street
    var PARK = { x0: -427, x1: 427, z0: 400, z1: 2900 };
    var MID = { x: 100, z: 900, r: 850 };     // Midtown cluster
    var DOW = { x: -100, z: -2300, r: 650 };  // Downtown cluster
    var LM = {
      empire:   { x: 110,  z: 880 },
      wtc:      { x: -120, z: -2350 },
      chrysler: { x: -170, z: 1060 }
    };

    // layout -> world (rotate about Y, matching THREE rotation.y = THETA)
    function rx(x, z) { return x * COS + z * SIN; }
    function rz(x, z) { return -x * SIN + z * COS; }

    // island half-width as a function of z (tapered tips)
    function halfWidth(z) {
      var w = ISL_W;
      if (z < -2400) w -= (-2400 - z) / 850 * 700;   // downtown tip
      if (z > 2700) w -= (z - 2700) / 550 * 450;     // upper tip
      return Math.max(380, w);
    }

    // z-range where an avenue at x is still on the island
    function avenueRange(ax) {
      var zLo = 3150, zHi = -3150, z;
      for (z = -3150; z <= 3150; z += 50) {
        if (halfWidth(z) > Math.abs(ax) + 15) {
          if (z < zLo) zLo = z;
          if (z > zHi) zHi = z;
        }
      }
      return [zLo, zHi];
    }

    /* ---------- 1. generate block + building layout DATA ---------- */
    var avenues = [], streets = [], i, j;
    for (i = -1100; i <= 1100; i += AVE_SP) avenues.push(i);
    for (j = -3200; j <= 3200; j += ST_SP) streets.push(j);

    var blocks = [];   // {x0,z0,x1,z1} — painted as asphalt later
    var items = [];    // building instances
    var palette = [0x9aa0a8, 0x8d9298, 0x9c6b52, 0x8a5f4b, 0x7fa6c4, 0x6f9cbd, 0xcfc8b8, 0xb8bcc2];
    var tmpC = new THREE.Color();

    function heightFor(x, z) {
      var h = 20 + rng() * 50;
      var dm = Math.sqrt((x - MID.x) * (x - MID.x) + (z - MID.z) * (z - MID.z));
      var fm = Math.max(0, 1 - dm / MID.r); fm = fm * fm * (3 - 2 * fm);
      fm = Math.min(1, fm * 1.35); // fatter core plateau
      if (fm > 0) h = Math.max(h, h + (120 + rng() * 260 - h) * fm);
      var dd = Math.sqrt((x - DOW.x) * (x - DOW.x) + (z - DOW.z) * (z - DOW.z));
      var fd = Math.max(0, 1 - dd / DOW.r); fd = fd * fd * (3 - 2 * fd);
      fd = Math.min(1, fd * 1.35);
      if (fd > 0) h = Math.max(h, h + (90 + rng() * 210 - h) * fd);
      return h;
    }

    function nearLandmark(x, z) {
      var k;
      for (k in LM) {
        var dx = x - LM[k].x, dz = z - LM[k].z;
        if (dx * dx + dz * dz < 85 * 85) return true;
      }
      return false;
    }

    for (i = 0; i < avenues.length - 1; i++) {
      var bx0 = avenues[i] + AVE_HW, bx1 = avenues[i + 1] - AVE_HW;
      var bcx = (bx0 + bx1) / 2;
      var inParkCol = bcx > PARK.x0 && bcx < PARK.x1;
      for (j = 0; j < streets.length - 1; j++) {
        var bz0 = streets[j] + ST_HW, bz1 = streets[j + 1] - ST_HW;
        var bcz = (bz0 + bz1) / 2;
        if (Math.abs(bcx) > halfWidth(bcz) - 25) continue;      // off-island
        if (inParkCol && bcz > PARK.z0 && bcz < PARK.z1) continue; // the park
        blocks.push({ x0: bx0, z0: bz0, x1: bx1, z1: bz1 });

        // subdivide block into lots: ~5 across, 2 deep
        var nx = 5, nz = 2;
        var lotW = (bx1 - bx0) / nx, lotD = (bz1 - bz0) / nz;
        for (var a = 0; a < nx; a++) {
          for (var b = 0; b < nz; b++) {
            if (rng() < 0.08) continue; // small plaza / vacant lot
            var lx = bx0 + (a + 0.5) * lotW + (rng() - 0.5) * 4;
            var lz = bz0 + (b + 0.5) * lotD + (rng() - 0.5) * 3;
            if (Math.abs(lx) > halfWidth(lz) - 14) continue;
            if (nearLandmark(lx, lz)) continue;
            var h = heightFor(lx, lz);
            var w = lotW * (0.62 + rng() * 0.26);
            var d = lotD * (0.60 + rng() * 0.28);
            // facade palette: taller -> more glass/steel
            var ci;
            var roll = rng();
            if (h > 110) ci = roll < 0.5 ? 4 + ((rng() * 2) | 0) : (roll < 0.75 ? 7 : 0);
            else ci = roll < 0.34 ? (rng() * 2) | 0 : (roll < 0.62 ? 2 + ((rng() * 2) | 0) : (roll < 0.84 ? 4 + ((rng() * 2) | 0) : 6 + ((rng() * 2) | 0)));
            tmpC.set(palette[ci]).multiplyScalar(0.82 + rng() * 0.34);
            items.push({
              x: rx(lx, lz), z: rz(lx, lz),
              w: w, d: d, h: h,
              rot: THETA,
              color: tmpC.getHex()
            });
          }
        }
      }
    }
    // keep instance count inside the 5000–6500 budget
    if (items.length > 6500) {
      var keep = [], stride = items.length / 6500;
      for (i = 0; i < 6500; i++) keep.push(items[Math.floor(i * stride)]);
      items = keep;
    }

    // guarantee spec-height supertalls at the cluster cores
    // (separate rng stream so the layout stream stays untouched)
    var rngH = kit.rng((hero.seed || 1901) + 7);
    function boostCluster(cx, cz, radius, n, hMin, hSpan) {
      var cand = [], i2;
      for (i2 = 0; i2 < items.length; i2++) {
        var it = items[i2];
        var lx = it.x * COS - it.z * SIN, lz = it.x * SIN + it.z * COS; // un-rotate
        var d2 = (lx - cx) * (lx - cx) + (lz - cz) * (lz - cz);
        if (d2 < radius * radius) cand.push({ i: i2, d: d2 });
      }
      cand.sort(function (a, b) { return a.d - b.d; });
      for (i2 = 0; i2 < Math.min(n, cand.length); i2++) {
        items[cand[i2].i].h = hMin + rngH() * hSpan;
      }
    }
    boostCluster(MID.x, MID.z, 320, 10, 260, 120); // Midtown 260–380 m
    boostCluster(DOW.x, DOW.z, 300, 8, 210, 90);   // Downtown 210–300 m

    /* ---------- 2. ground painted FROM the layout data ---------- */
    var ground = kit.makeGround(function (ctx, sizeM, pxPerM) {
      ctx.scale(pxPerM, pxPerM);
      ctx.rotate(-THETA); // canvas y-down = +z; rotate layout into world
      var k;

      // surrounding boroughs base
      ctx.fillStyle = '#383b3f';
      ctx.fillRect(-sizeM / 2, -sizeM / 2, sizeM, sizeM);
      for (k = 0; k < 420; k++) { // faint block texture outside the island
        ctx.fillStyle = rngPaint() < 0.5 ? '#34373b' : '#3d4044';
        var bxx = (rngPaint() - 0.5) * 9600, bzz = (rngPaint() - 0.5) * 9600;
        if (Math.abs(bxx) < 2000 && Math.abs(bzz) < 3500) continue;
        ctx.fillRect(bxx, bzz, 60 + rngPaint() * 140, 60 + rngPaint() * 140);
      }

      // riverbeds (under the water polys)
      ctx.fillStyle = '#101c28';
      ctx.fillRect(-1950, -4700, 770, 9400);  // Hudson
      ctx.fillRect(1180, -4700, 610, 9400);   // East river

      // island silhouette (same halfWidth() used for buildings)
      ctx.beginPath();
      var z;
      for (z = -ISL_L; z <= ISL_L; z += 100) {
        var hw = halfWidth(z);
        if (z === -ISL_L) ctx.moveTo(hw, z); else ctx.lineTo(hw, z);
      }
      for (z = ISL_L; z >= -ISL_L; z -= 100) ctx.lineTo(-halfWidth(z), z);
      ctx.closePath();
      ctx.fillStyle = '#4a4e53'; // street asphalt base
      ctx.fill();
      ctx.lineWidth = 6; ctx.strokeStyle = '#5a5e63'; ctx.stroke(); // seawall

      // blocks (same data as the buildings)
      ctx.fillStyle = '#2c2f33';
      for (k = 0; k < blocks.length; k++) {
        var bl = blocks[k];
        ctx.fillRect(bl.x0, bl.z0, bl.x1 - bl.x0, bl.z1 - bl.z0);
      }

      // Central Park
      ctx.fillStyle = '#2f5c33';
      ctx.fillRect(PARK.x0, PARK.z0, PARK.x1 - PARK.x0, PARK.z1 - PARK.z0);
      for (k = 0; k < 34; k++) { // darker groves
        ctx.fillStyle = '#27502c';
        ctx.beginPath();
        ctx.ellipse(
          PARK.x0 + 40 + rngPaint() * (PARK.x1 - PARK.x0 - 80),
          PARK.z0 + 60 + rngPaint() * (PARK.z1 - PARK.z0 - 120),
          30 + rngPaint() * 70, 24 + rngPaint() * 55, rngPaint() * 3, 0, 6.283);
        ctx.fill();
      }
      // the reservoir
      ctx.fillStyle = '#1d3a52';
      ctx.beginPath(); ctx.ellipse(0, 1700, 165, 110, 0, 0, 6.283); ctx.fill();
      // park paths
      ctx.strokeStyle = '#8a7f5e'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(PARK.x0 + 30, PARK.z0 + 60); ctx.lineTo(PARK.x1 - 40, PARK.z1 - 80); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PARK.x1 - 30, PARK.z0 + 100); ctx.lineTo(PARK.x0 + 50, PARK.z1 - 120); ctx.stroke();

      // avenue centerlines (dashed where scale allows)
      ctx.strokeStyle = '#9a925a'; ctx.lineWidth = 2.5;
      ctx.setLineDash([20, 26]);
      for (k = 0; k < avenues.length; k++) {
        var ax = avenues[k];
        var ar = avenueRange(ax);
        if (ar[1] <= ar[0]) continue;
        var inPark = ax > PARK.x0 && ax < PARK.x1;
        ctx.beginPath();
        ctx.moveTo(ax, ar[0]); ctx.lineTo(ax, inPark ? PARK.z0 : ar[1]);
        ctx.stroke();
        if (inPark) {
          ctx.beginPath(); ctx.moveTo(ax, PARK.z1); ctx.lineTo(ax, ar[1]); ctx.stroke();
        }
      }
      ctx.setLineDash([]);

      // landmark plazas
      ctx.fillStyle = '#55585c';
      for (k in LM) ctx.fillRect(LM[k].x - 60, LM[k].z - 60, 120, 120);
    }, 10000, 4200);
    anchor.add(ground);

    /* ---------- 3. rivers ---------- */
    function rotPts(pts) {
      var out = [];
      for (var p = 0; p < pts.length; p++) out.push([rx(pts[p][0], pts[p][1]), rz(pts[p][0], pts[p][1])]);
      return out;
    }
    anchor.add(kit.makeWaterPoly(rotPts([[-1900, -4600], [-1210, -4600], [-1210, 4600], [-1900, 4600]]), 0.3));
    anchor.add(kit.makeWaterPoly(rotPts([[1210, -4600], [1760, -4600], [1760, 4600], [1210, 4600]]), 0.3));

    /* ---------- 4. buildings (one instanced draw) ---------- */
    var winMat = kit.makeWindowMaterial(U, { color: 0xffffff, roughness: 0.85, metalness: 0.15, litFraction: 0.42 });
    anchor.add(kit.makeBuildings(winMat, items));

    /* ---------- 5. park trees (instanced blobs) ---------- */
    (function () {
      var n = 150;
      var geo = new THREE.SphereGeometry(1, 6, 5);
      var mat = kit.stdMat(0x2f5d33, { roughness: 1, metalness: 0 });
      var mesh = new THREE.InstancedMesh(geo, mat, n);
      var m4 = new THREE.Matrix4(), p = new THREE.Vector3(),
          q = new THREE.Quaternion(), s = new THREE.Vector3(), c = new THREE.Color();
      var placed = 0, guard = 0;
      while (placed < n && guard++ < 2000) {
        var tx = PARK.x0 + 30 + rng() * (PARK.x1 - PARK.x0 - 60);
        var tz = PARK.z0 + 30 + rng() * (PARK.z1 - PARK.z0 - 60);
        var ex = tx / 185, ez = (tz - 1700) / 130;
        if (ex * ex + ez * ez < 1) continue; // keep the reservoir clear
        var r = 5 + rng() * 6;
        p.set(rx(tx, tz), r * 0.65, rz(tx, tz));
        s.set(r, r * (0.75 + rng() * 0.4), r);
        m4.compose(p, q, s);
        mesh.setMatrixAt(placed, m4);
        c.setHex(0x2f5d33).multiplyScalar(0.7 + rng() * 0.55);
        mesh.setColorAt(placed, c);
        placed++;
      }
      mesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      anchor.add(mesh);
    })();

    /* ---------- geometry baking helpers (build-time only) ---------- */
    var _up = new THREE.Vector3(0, 1, 0);
    function bake(parts, mat) {
      var gs = [], total = 0, p;
      for (p = 0; p < parts.length; p++) {
        var g = parts[p].g.index ? parts[p].g.toNonIndexed() : parts[p].g;
        g.applyMatrix4(parts[p].m);
        gs.push(g);
        total += g.attributes.position.count;
      }
      var pos = new Float32Array(total * 3),
          nor = new Float32Array(total * 3),
          uv = new Float32Array(total * 2);
      var o3 = 0, o2 = 0;
      for (p = 0; p < gs.length; p++) {
        pos.set(gs[p].attributes.position.array, o3);
        nor.set(gs[p].attributes.normal.array, o3);
        if (gs[p].attributes.uv) uv.set(gs[p].attributes.uv.array, o2);
        o3 += gs[p].attributes.position.array.length;
        o2 += gs[p].attributes.position.count * 2;
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      return new THREE.Mesh(geo, mat);
    }
    function boxPart(w, h, d, x, y, z, ry) {
      var m = new THREE.Matrix4();
      var q = new THREE.Quaternion().setFromAxisAngle(_up, ry || 0);
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
      return { g: new THREE.BoxGeometry(w, h, d), m: m };
    }
    function strutPart(ax, ay, az, bx, by, bz, r) {
      var dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
      var len = dir.length();
      var q = new THREE.Quaternion().setFromUnitVectors(_up, dir.normalize());
      var m = new THREE.Matrix4().compose(
        new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2),
        q, new THREE.Vector3(1, 1, 1));
      return { g: new THREE.CylinderGeometry(r, r, len, 5), m: m };
    }
    function cylPart(rt, rb, h, x, y, z) {
      var m = new THREE.Matrix4().makeTranslation(x, y, z);
      return { g: new THREE.CylinderGeometry(rt, rb, h, 8), m: m };
    }

    /* ---------- 6. landmarks (layout-space group, rotated once) ---------- */
    var lmGroup = new THREE.Group();
    lmGroup.rotation.y = THETA;
    anchor.add(lmGroup);

    // Empire-State-like: 3 setback tiers + spire, 380 m
    var empMat = kit.stdMat(0xb8b0a0, { roughness: 0.8, metalness: 0.1 });
    var ex = LM.empire.x, ez = LM.empire.z;
    lmGroup.add(bake([
      boxPart(90, 90, 90, ex, 45, ez),
      boxPart(64, 110, 64, ex, 145, ez),
      boxPart(42, 100, 42, ex, 250, ez),
      boxPart(26, 30, 26, ex, 315, ez),
      cylPart(2.2, 4.5, 50, ex, 355, ez)
    ], empMat));

    // WTC-like: tapered glass tower, stacked shrinking boxes, 420 m
    var wtcMat = kit.stdMat(0x8fb6d8, { roughness: 0.18, metalness: 0.85 });
    var wx = LM.wtc.x, wz = LM.wtc.z;
    var wtcParts = [], seg;
    for (seg = 0; seg < 10; seg++) {
      var t0 = seg / 10, t1 = (seg + 1) / 10;
      var w0 = 68 - 26 * t0, w1 = 68 - 26 * t1;
      var y0 = t0 * 400, y1 = t1 * 400;
      wtcParts.push(boxPart((w0 + w1) / 2, y1 - y0 + 0.5, (w0 + w1) / 2,
        wx, (y0 + y1) / 2, wz, seg * 0.022)); // subtle twist
    }
    wtcParts.push(cylPart(0.8, 1.6, 22, wx, 409, wz)); // antenna -> 420 m
    lmGroup.add(bake(wtcParts, wtcMat));

    // Chrysler-like: brick body + layered glowing crown, 320 m
    var chMat = kit.stdMat(0xc9c0ae, { roughness: 0.75, metalness: 0.15 });
    var cx = LM.chrysler.x, cz = LM.chrysler.z;
    lmGroup.add(bake([
      boxPart(56, 150, 56, cx, 75, cz),
      boxPart(44, 60, 44, cx, 180, cz),
      boxPart(34, 30, 34, cx, 225, cz)
    ], chMat));
    var crownMat = kit.emissiveMat(U, 0xffe9b0, 1.1);
    var crownParts = [], layer;
    for (layer = 0; layer < 6; layer++) {
      var cw = 30 - layer * 4.4;
      crownParts.push(boxPart(cw, 10, cw, cx, 245 + layer * 10, cz, layer * 0.13));
    }
    crownParts.push(cylPart(0.7, 2.4, 22, cx, 309, cz)); // needle -> 320 m
    lmGroup.add(bake(crownParts, crownMat));

    // red aviation beacons on Empire + WTC tips (one merged draw)
    var beaconMat = kit.emissiveMat(U, 0xff4433, 2.5);
    lmGroup.add(bake([
      boxPart(3, 5, 3, ex, 379, ez),
      boxPart(2.4, 4, 2.4, wx, 419, wz)
    ], beaconMat));

    /* ---------- 7. two suspension bridges over the East river ---------- */
    var bridgeConc = [], bridgeCables = [], bz;
    var concMat = kit.stdMat(0x8a8d92, { roughness: 0.85 });
    var cableMat = kit.stdMat(0x3c4046, { roughness: 0.5, metalness: 0.6 });
    var bridgeZs = [-1750, -2550];
    for (i = 0; i < bridgeZs.length; i++) {
      bz = bridgeZs[i];
      bridgeConc.push(boxPart(660, 3, 22, 1480, 24, bz));       // deck
      bridgeConc.push(boxPart(10, 95, 10, 1330, 47.5, bz));     // tower W
      bridgeConc.push(boxPart(10, 95, 10, 1630, 47.5, bz));     // tower E
      bridgeConc.push(boxPart(12, 6, 24, 1330, 88, bz));        // crossbeam
      bridgeConc.push(boxPart(12, 6, 24, 1630, 88, bz));
      var side;
      for (side = -1; side <= 1; side += 2) {
        var zo = bz + side * 9;
        // main span cables (sag approximated by two struts)
        bridgeCables.push(strutPart(1330, 92, zo, 1480, 28, zo, 0.8));
        bridgeCables.push(strutPart(1480, 28, zo, 1630, 92, zo, 0.8));
        // side spans
        bridgeCables.push(strutPart(1150, 26, zo, 1330, 92, zo, 0.8));
        bridgeCables.push(strutPart(1630, 92, zo, 1810, 26, zo, 0.8));
      }
    }
    lmGroup.add(bake(bridgeConc, concMat));
    lmGroup.add(bake(bridgeCables, cableMat));

    /* ---------- 8. street life: cars + lamps ---------- */
    var segments = [], k2;
    // avenues run along Z (clamped to the island, split around the park)
    for (k2 = 0; k2 < avenues.length; k2++) {
      var avx = avenues[k2];
      var ar2 = avenueRange(avx);
      if (ar2[1] - ar2[0] < 100) continue;
      var inPark = avx > PARK.x0 && avx < PARK.x1;
      if (inPark) {
        segments.push({ ax: rx(avx, ar2[0]), az: rz(avx, ar2[0]), bx: rx(avx, PARK.z0 - 20), bz: rz(avx, PARK.z0 - 20) });
        segments.push({ ax: rx(avx, PARK.z1 + 20), az: rz(avx, PARK.z1 + 20), bx: rx(avx, ar2[1]), bz: rz(avx, ar2[1]) });
      } else {
        segments.push({ ax: rx(avx, ar2[0]), az: rz(avx, ar2[0]), bx: rx(avx, ar2[1]), bz: rz(avx, ar2[1]) });
      }
    }
    // streets run along X (split around the park rows)
    for (k2 = 0; k2 < streets.length; k2++) {
      var stz = streets[k2];
      var hwS = halfWidth(stz) - 20;
      if (stz > PARK.z0 && stz < PARK.z1) {
        segments.push({ ax: rx(-hwS, stz), az: rz(-hwS, stz), bx: rx(PARK.x0 - 15, stz), bz: rz(PARK.x0 - 15, stz) });
        segments.push({ ax: rx(PARK.x1 + 15, stz), az: rz(PARK.x1 + 15, stz), bx: rx(hwS, stz), bz: rz(hwS, stz) });
      } else {
        segments.push({ ax: rx(-hwS, stz), az: rz(-hwS, stz), bx: rx(hwS, stz), bz: rz(hwS, stz) });
      }
    }
    var cars = kit.makeCars(U, segments, 250);
    anchor.add(cars.mesh);

    // lamps along avenues every ~60 m (one side), skipping the park
    var lampPos = [];
    for (k2 = 0; k2 < avenues.length; k2++) {
      var lx2 = avenues[k2] + AVE_HW + 1.5;
      var inPark2 = avenues[k2] > PARK.x0 && avenues[k2] < PARK.x1;
      for (var lz2 = -3120; lz2 <= 3120; lz2 += 60) {
        if (inPark2 && lz2 > PARK.z0 - 30 && lz2 < PARK.z1 + 30) continue;
        if (Math.abs(lx2) > halfWidth(lz2) - 8) continue;
        lampPos.push([rx(lx2, lz2), rz(lx2, lz2)]);
      }
    }
    anchor.add(kit.makeLamps(U, lampPos));

    /* ---------- 9. frame update (no allocations) ---------- */
    return {
      uniforms: [U],
      update: function (dt, time) {
        kit.tick(U, dt);
        cars.update(dt);
      }
    };
  };
})();
