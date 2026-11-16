/* ============================================================
   TERRA — city-tokyo.js  (agent B2)
   Tokyo-like district: dense jittered street grid (~6000 low
   buildings), Shinjuku-like tower cluster west (x≈-1400),
   ~250 neon sign panels (5 hues, flicker), 333 m red/white
   lattice tower, curved elevated highway, scramble-crossing
   plaza, shrine/park patches, cars + street lamps.
   Plain IIFE, THREE r128, meters (+Y up, ground y=0).
   Codes against the citykit API in CONTRACT-CITIES.md.
   ============================================================ */
(function () {
  'use strict';

  var T = window.TERRA;
  T.cityBuilders = T.cityBuilders || {};

  /* ---------- build-time scratch (never touched in update) ---------- */
  var _v1 = new THREE.Vector3();
  var _v2 = new THREE.Vector3();
  var _dir = new THREE.Vector3();
  var _mid = new THREE.Vector3();
  var _q = new THREE.Quaternion();
  var _qYaw = new THREE.Quaternion();
  var _s = new THREE.Vector3();
  var _m4 = new THREE.Matrix4();
  var _Y = new THREE.Vector3(0, 1, 0);
  var _Z = new THREE.Vector3(0, 0, 1);
  var _col = new THREE.Color();

  var NEON_HUES = [0xff2d78, 0x2de2ff, 0xff9a2d, 0x39ff88, 0xb44dff];

  /* ---------- small helpers ---------- */

  // InstancedMesh from {x,y,z,q,sx,sy,sz} items; unit box base at y=0.
  function instancedBoxes(items, mat) {
    var geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    var mesh = new THREE.InstancedMesh(geo, mat, items.length);
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      _s.set(it.sx, it.sy, it.sz);
      _m4.compose(_v1.set(it.x, it.y, it.z), it.q, _s);
      mesh.setMatrixAt(i, _m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  function pushBox(list, x, y, z, sx, sy, sz, ry) {
    list.push({
      x: x, y: y, z: z, sx: sx, sy: sy, sz: sz,
      q: new THREE.Quaternion().setFromAxisAngle(_Y, ry || 0)
    });
  }

  // Unit cylinder (r=1, h=1, centered) instance stretched between a→b.
  function pushStrut(list, ax, ay, az, bx, by, bz, r) {
    _dir.set(bx - ax, by - ay, bz - az);
    var len = _dir.length();
    _dir.normalize();
    _q.setFromUnitVectors(_Y, _dir);
    _mid.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    list.push({
      x: _mid.x, y: _mid.y, z: _mid.z, sx: r, sy: len, sz: r,
      q: _q.clone()
    });
  }

  /* ============================================================
     Builder
     ============================================================ */
  T.cityBuilders.tokyo = function (anchor, kit, hero, tex) {
    var U = kit.newUniforms();
    var rng = kit.rng((hero && hero.seed) || 1603);
    var util = T.util;

    var EXT = 2100;              // district half-extent (m)
    var GROT = 0.05;             // slight district-wide rotation (rad)
    var CG = Math.cos(GROT), SG = Math.sin(GROT);

    // grid-frame → world (matches canvas paint: +y canvas = +z world)
    function gx(x, z) { return x * CG - z * SG; }
    function gz(x, z) { return x * SG + z * CG; }

    /* ---------- special zones (grid frame) ---------- */
    var plaza = { x: 140, z: -60, hw: 58, hd: 46 };
    var parks = [
      { x: 1050, z: -1150, hw: 230, hd: 170, kind: 'park' },
      { x: -880, z: 1240, hw: 160, hd: 130, kind: 'shrine' },
      { x: 1560, z: 860, hw: 100, hd: 90, kind: 'park' }
    ];
    var towerPos = { x: 480, z: 780 };   // world frame, 333 m lattice tower
    var towerParkR = 120;

    function inRect(x, z, r, pad) {
      return Math.abs(x - r.x) < r.hw + pad && Math.abs(z - r.z) < r.hd + pad;
    }
    function inZone(x, z, pad) {
      if (inRect(x, z, plaza, pad)) return true;
      for (var i = 0; i < parks.length; i++) if (inRect(x, z, parks[i], pad)) return true;
      var dx = x - towerPos.x, dz = z - towerPos.z;
      if (dx * dx + dz * dz < (towerParkR + pad) * (towerParkR + pad)) return true;
      return false;
    }

    /* ---------- 1. jittered street grid ---------- */
    function makeAxis() {
      var lines = [], p = -EXT;
      while (p < EXT) {
        var sw = rng() < 0.14 ? 15 + rng() * 4 : 7 + rng() * 6;
        lines.push({ c: p + (rng() - 0.5) * 10, w: sw });
        p += sw + 60 + rng() * 50;     // blocks 60–110 m
      }
      return lines;
    }
    var vSt = makeAxis();   // streets running along z (varying x)
    var hSt = makeAxis();   // streets running along x (varying z)

    /* ---------- 2. building layout (data first) ---------- */
    var items = [];
    var neonItems = [];
    var PALETTE = [
      0x9aa0a8, 0x8a8f98, 0xb8bcc2, 0xcfd2d6, 0xaab2ba,
      0x7f8892, 0xd8d5cc, 0x9fb4c4, 0x88a0b4, 0xb0aaa0
    ];

    function addBuilding(x, z, w, d, h, rot, glassy) {
      var color;
      if (glassy && rng() < 0.65) color = rng() < 0.5 ? 0x88a0b4 : 0x9fb4c4;
      else color = PALETTE[(rng() * PALETTE.length) | 0];
      items.push({ x: x, z: z, w: w, d: d, h: h, rot: rot, color: color });
    }

    // normal low-rise fabric between streets
    for (var bi = 0; bi < vSt.length - 1; bi++) {
      for (var bj = 0; bj < hSt.length - 1; bj++) {
        var x0 = vSt[bi].c + vSt[bi].w / 2, x1 = vSt[bi + 1].c - vSt[bi + 1].w / 2;
        var z0 = hSt[bj].c + hSt[bj].w / 2, z1 = hSt[bj + 1].c - hSt[bj + 1].w / 2;
        var bw = x1 - x0, bd = z1 - z0;
        if (bw < 20 || bd < 20) continue;
        var cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        if (inZone(cx, cz, -8)) continue;
        var nx = bw > 80 ? 2 : (bw > 46 && rng() < 0.5 ? 2 : 1);
        var nz = bd > 80 ? 2 : (bd > 46 && rng() < 0.5 ? 2 : 1);
        if (bw > 104 && rng() < 0.4) nx = 3;
        if (bd > 104 && rng() < 0.4) nz = 3;
        var cw = bw / nx, cd = bd / nz;
        for (var ix = 0; ix < nx; ix++) {
          for (var iz = 0; iz < nz; iz++) {
            if (rng() > 0.78) continue;   // courtyards / gaps
            var w = cw * (0.60 + rng() * 0.26);
            var d = cd * (0.60 + rng() * 0.26);
            var px = x0 + cw * (ix + 0.5) + (rng() - 0.5) * cw * 0.12;
            var pz = z0 + cd * (iz + 0.5) + (rng() - 0.5) * cd * 0.12;
            var wx = gx(px, pz), wz = gz(px, pz);
            // height field: mostly 10–45 m, taller toward the core
            var dc = Math.sqrt(wx * wx + wz * wz);
            var h = 10 + rng() * 35;
            if (dc < 850 && rng() < 0.30) h = 45 + rng() * 40;
            if (rng() < 0.015) h = 60 + rng() * 35;
            addBuilding(wx, wz, w, d, h, GROT + (rng() - 0.5) * 0.06, h > 55);
          }
        }
      }
    }

    // Shinjuku-like tower cluster, west (world x ≈ -1400)
    var cluster = [];
    var tries = 0;
    while (cluster.length < 25 && tries++ < 900) {
      var tx = -1720 + rng() * 640;
      var tz = -380 + rng() * 760;
      var ok = true;
      for (var ci = 0; ci < cluster.length; ci++) {
        var ddx = cluster[ci].x - tx, ddz = cluster[ci].z - tz;
        if (ddx * ddx + ddz * ddz < 58 * 58) { ok = false; break; }
      }
      if (!ok) continue;
      var th = 120 + rng() * 120;
      if (cluster.length < 2) th = 228 + rng() * 12;   // twin government-like towers
      var tw = 26 + rng() * 20;
      cluster.push({ x: tx, z: tz });
      addBuilding(tx, tz, tw, tw * (0.75 + rng() * 0.5), th, (rng() - 0.5) * 0.1, true);
    }

    // a few 180 m+ supertalls scattered elsewhere
    var superTalls = [];
    tries = 0;
    while (superTalls.length < 5 && tries++ < 500) {
      var sx = (rng() * 2 - 1) * 1700, sz = (rng() * 2 - 1) * 1700;
      if (sx < -900 && Math.abs(sz) < 600) continue;          // keep cluster distinct
      if (inZone(sx, sz, 70)) continue;
      var far = true;
      for (var si = 0; si < superTalls.length; si++) {
        var sdx = superTalls[si].x - sx, sdz = superTalls[si].z - sz;
        if (sdx * sdx + sdz * sdz < 420 * 420) { far = false; break; }
      }
      if (!far) continue;
      superTalls.push({ x: sx, z: sz });
      addBuilding(sx, sz, 30 + rng() * 14, 30 + rng() * 14, 180 + rng() * 40, (rng() - 0.5) * 0.1, true);
    }

    /* ---------- 3. neon signs (~250, on street-facing sides) ---------- */
    function addSign(x, y, z, ry, sw, sh, flick) {
      var r = rng();
      var hue = r < 0.28 ? 0 : r < 0.54 ? 1 : r < 0.72 ? 2 : r < 0.87 ? 3 : 4;
      neonItems.push({
        x: x, y: y, z: z, sx: sw, sy: sh, sz: 0.35,
        q: new THREE.Quaternion().setFromAxisAngle(_Y, ry),
        hue: hue, flick: flick
      });
    }

    var nSigns = 0;
    for (var ni = 0; ni < items.length && nSigns < 240; ni++) {
      var b = items[ni];
      if (b.h < 13 || b.h > 58) continue;
      if (Math.abs(b.x) > 1600 || Math.abs(b.z) > 1600) continue;
      var pSign = 0.055 + 0.05 * (1 - Math.min(1, Math.sqrt(b.x * b.x + b.z * b.z) / 1600));
      if (rng() > pSign) continue;
      var face = (rng() * 4) | 0;
      var vertical = b.h > 22 && rng() < 0.45;
      var sw2 = vertical ? 1.7 + rng() * 1.1 : 4 + rng() * 6;
      var sh2 = vertical ? Math.min(b.h - 5, 8 + rng() * 11) : 2.2 + rng() * 3;
      var yc = vertical ? 3 + sh2 / 2 + rng() * 3 : Math.min(b.h - 2, 4 + rng() * (b.h * 0.7));
      var off = 0.45;
      var nx2 = b.x, nz2 = b.z, ry2 = b.rot;
      if (face === 0) { nz2 += b.d / 2 + off; }
      else if (face === 1) { nz2 -= b.d / 2 + off; ry2 += Math.PI; }
      else if (face === 2) { nx2 += b.w / 2 + off; ry2 += Math.PI / 2; }
      else { nx2 -= b.w / 2 + off; ry2 -= Math.PI / 2; }
      addSign(nx2, yc, nz2, ry2, sw2, sh2, rng() < 0.12);
      nSigns++;
    }
    // extra neon ringing the scramble plaza
    for (var pi = 0; pi < 26; pi++) {
      var side = pi % 4;
      var tt = rng();
      var px2, pz2, ry3;
      if (side === 0) { px2 = plaza.x - plaza.hw + tt * plaza.hw * 2; pz2 = plaza.z - plaza.hd - 5; ry3 = 0; }
      else if (side === 1) { px2 = plaza.x - plaza.hw + tt * plaza.hw * 2; pz2 = plaza.z + plaza.hd + 5; ry3 = Math.PI; }
      else if (side === 2) { px2 = plaza.x + plaza.hw + 5; pz2 = plaza.z - plaza.hd + tt * plaza.hd * 2; ry3 = Math.PI / 2; }
      else { px2 = plaza.x - plaza.hw - 5; pz2 = plaza.z - plaza.hd + tt * plaza.hd * 2; ry3 = -Math.PI / 2; }
      var vSign = rng() < 0.5;
      addSign(gx(px2, pz2), 4 + rng() * 13, gz(px2, pz2), GROT + ry3,
        vSign ? 1.8 + rng() : 5 + rng() * 5,
        vSign ? 8 + rng() * 8 : 2.5 + rng() * 2.5,
        rng() < 0.2);
    }

    /* ---------- 4. ground painted from the SAME layout ---------- */
    var hwPts = [];   // highway centerline samples (also used for paint)

    function paintGround(ctx, sizeM, pxPerM) {
      ctx.scale(pxPerM, pxPerM);
      var L = EXT + 40;
      var i, j, k;

      // dense asphalt base
      ctx.fillStyle = '#232529';
      ctx.fillRect(-L, -L, L * 2, L * 2);

      // blocks: subtle tonal variation (before streets)
      ctx.fillStyle = 'rgba(255,255,255,0.022)';
      for (i = 0; i < vSt.length - 1; i++) {
        for (j = 0; j < hSt.length - 1; j++) {
          if ((i * 7 + j * 13) % 5 !== 0) continue;
          var bx0 = vSt[i].c + vSt[i].w / 2, bx1 = vSt[i + 1].c - vSt[i + 1].w / 2;
          var bz0 = hSt[j].c + hSt[j].w / 2, bz1 = hSt[j + 1].c - hSt[j + 1].w / 2;
          if (inZone((bx0 + bx1) / 2, (bz0 + bz1) / 2, -8)) continue;
          ctx.save();
          ctx.translate(gx((bx0 + bx1) / 2, (bz0 + bz1) / 2), gz((bx0 + bx1) / 2, (bz0 + bz1) / 2));
          ctx.rotate(GROT);
          ctx.fillRect(-(bx1 - bx0) / 2, -(bz1 - bz0) / 2, bx1 - bx0, bz1 - bz0);
          ctx.restore();
        }
      }

      // streets: lighter gray ribbons
      ctx.fillStyle = '#3c4046';
      for (i = 0; i < vSt.length; i++) {
        ctx.save();
        ctx.translate(gx(vSt[i].c, 0), gz(vSt[i].c, 0));
        ctx.rotate(GROT);
        ctx.fillRect(-vSt[i].w / 2, -L, vSt[i].w, L * 2);
        ctx.restore();
      }
      for (i = 0; i < hSt.length; i++) {
        ctx.save();
        ctx.translate(gx(0, hSt[i].c), gz(0, hSt[i].c));
        ctx.rotate(GROT);
        ctx.fillRect(-L, -hSt[i].w / 2, L * 2, hSt[i].w);
        ctx.restore();
      }

      // dashed centerlines on the wider avenues
      ctx.strokeStyle = 'rgba(214,196,120,0.45)';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([6, 8]);
      for (i = 0; i < vSt.length; i++) {
        if (vSt[i].w < 13) continue;
        ctx.save();
        ctx.translate(gx(vSt[i].c, 0), gz(vSt[i].c, 0));
        ctx.rotate(GROT);
        ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(0, L); ctx.stroke();
        ctx.restore();
      }
      for (i = 0; i < hSt.length; i++) {
        if (hSt[i].w < 13) continue;
        ctx.save();
        ctx.translate(gx(0, hSt[i].c), gz(0, hSt[i].c));
        ctx.rotate(GROT);
        ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(L, 0); ctx.stroke();
        ctx.restore();
      }
      ctx.setLineDash([]);

      // highway shadow on the ground
      if (hwPts.length > 1) {
        ctx.strokeStyle = 'rgba(10,11,13,0.5)';
        ctx.lineWidth = 15;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(hwPts[0].x, hwPts[0].z);
        for (i = 1; i < hwPts.length; i++) ctx.lineTo(hwPts[i].x, hwPts[i].z);
        ctx.stroke();
      }

      // parks + shrine
      var treeRng = kit.rng(((hero && hero.seed) || 1603) + 77);
      for (i = 0; i < parks.length; i++) {
        var pk = parks[i];
        ctx.save();
        ctx.translate(gx(pk.x, pk.z), gz(pk.x, pk.z));
        ctx.rotate(GROT);
        ctx.fillStyle = pk.kind === 'shrine' ? '#2c4a33' : '#2f5238';
        ctx.fillRect(-pk.hw, -pk.hd, pk.hw * 2, pk.hd * 2);
        if (pk.kind === 'shrine') {
          ctx.fillStyle = '#57534a';
          ctx.fillRect(-pk.hw * 0.55, -pk.hd * 0.55, pk.hw * 1.1, pk.hd * 1.1);
          // little torii mark
          ctx.fillStyle = '#c8452c';
          ctx.fillRect(-9, -3, 2.6, 12);
          ctx.fillRect(6.4, -3, 2.6, 12);
          ctx.fillRect(-12, -4, 24, 2.6);
        }
        ctx.fillStyle = 'rgba(18,44,26,0.85)';
        var nTrees = ((pk.hw * pk.hd) / 900) | 0;
        for (k = 0; k < nTrees; k++) {
          var trx = (treeRng() * 2 - 1) * (pk.hw - 8);
          var trz = (treeRng() * 2 - 1) * (pk.hd - 8);
          ctx.beginPath();
          ctx.arc(trx, trz, 3 + treeRng() * 5, 0, 6.2832);
          ctx.fill();
        }
        ctx.restore();
      }

      // tower park: green disc + gravel ring
      ctx.save();
      ctx.translate(towerPos.x, towerPos.z);
      ctx.fillStyle = '#2f5238';
      ctx.beginPath(); ctx.arc(0, 0, towerParkR, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgba(18,44,26,0.85)';
      for (k = 0; k < 40; k++) {
        var ta = treeRng() * 6.2832, tr = 48 + treeRng() * (towerParkR - 56);
        ctx.beginPath();
        ctx.arc(Math.cos(ta) * tr, Math.sin(ta) * tr, 3 + treeRng() * 5, 0, 6.2832);
        ctx.fill();
      }
      ctx.strokeStyle = '#5a564c';
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(0, 0, 40, 0, 6.2832); ctx.stroke();
      ctx.fillStyle = '#5a564c';
      ctx.beginPath(); ctx.arc(0, 0, 18, 0, 6.2832); ctx.fill();
      ctx.restore();

      // scramble-crossing plaza: paved square + diagonal crosswalk stripes
      ctx.save();
      ctx.translate(gx(plaza.x, plaza.z), gz(plaza.x, plaza.z));
      ctx.rotate(GROT);
      ctx.fillStyle = '#33363c';
      ctx.fillRect(-plaza.hw, -plaza.hd, plaza.hw * 2, plaza.hd * 2);
      ctx.beginPath();
      ctx.rect(-plaza.hw + 3, -plaza.hd + 3, plaza.hw * 2 - 6, plaza.hd * 2 - 6);
      ctx.clip();
      ctx.fillStyle = 'rgba(228,230,234,0.75)';
      var diag = plaza.hw + plaza.hd;
      for (k = -diag; k < diag; k += 6.4) {
        ctx.save(); ctx.rotate(Math.PI / 4);
        ctx.fillRect(k, -diag, 1.6, diag * 2);
        ctx.restore();
        ctx.save(); ctx.rotate(-Math.PI / 4);
        ctx.fillRect(k, -diag, 1.6, diag * 2);
        ctx.restore();
      }
      ctx.restore();
    }

    /* ---------- 5. Tokyo-Tower-like 333 m lattice ---------- */
    var towerRed = [], towerWhite = [], towerSteel = [];
    var TX = towerPos.x, TZ = towerPos.z;
    var legSigns = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

    function halfW(y) { return 55 * Math.exp(-y / 110) + 6; }

    // 4 tapering legs, stacked box segments, alternating red/white bands
    var segH = 12, y0, y1, hm, li;
    for (y0 = 0; y0 < 252; y0 += segH) {
      y1 = Math.min(y0 + segH, 252);
      hm = halfW((y0 + y1) / 2);
      var lw = Math.max(2.4, hm * 0.17);
      var redBand = (((y0 / segH) | 0) % 2) === 0;
      for (li = 0; li < 4; li++) {
        pushBox(redBand ? towerRed : towerWhite,
          TX + legSigns[li][0] * (hm - lw / 2), (y0 + y1) / 2, TZ + legSigns[li][1] * (hm - lw / 2),
          lw, y1 - y0 + 0.6, lw, 0);
      }
    }

    // horizontal ring beams every 30 m
    for (y0 = 30; y0 <= 240; y0 += 30) {
      hm = halfW(y0);
      var e = hm - 1.5;
      pushStrut(towerSteel, TX - e, y0, TZ - e, TX + e, y0, TZ - e, 0.8);
      pushStrut(towerSteel, TX - e, y0, TZ + e, TX + e, y0, TZ + e, 0.8);
      pushStrut(towerSteel, TX - e, y0, TZ - e, TX - e, y0, TZ + e, 0.8);
      pushStrut(towerSteel, TX + e, y0, TZ - e, TX + e, y0, TZ + e, 0.8);
    }

    // X-braces between legs on all 4 faces, every ~30 m
    for (y0 = 0; y0 < 240; y0 += 30) {
      y1 = y0 + 30;
      var ha = halfW(y0) - 1.5, hb = halfW(y1) - 1.5;
      // faces at z = ±e
      pushStrut(towerSteel, TX - ha, y0, TZ - ha, TX + hb, y1, TZ - hb, 0.65);
      pushStrut(towerSteel, TX + ha, y0, TZ - ha, TX - hb, y1, TZ - hb, 0.65);
      pushStrut(towerSteel, TX - ha, y0, TZ + ha, TX + hb, y1, TZ + hb, 0.65);
      pushStrut(towerSteel, TX + ha, y0, TZ + ha, TX - hb, y1, TZ + hb, 0.65);
      // faces at x = ±e
      pushStrut(towerSteel, TX - ha, y0, TZ - ha, TX - hb, y1, TZ + hb, 0.65);
      pushStrut(towerSteel, TX - ha, y0, TZ + ha, TX - hb, y1, TZ - hb, 0.65);
      pushStrut(towerSteel, TX + ha, y0, TZ - ha, TX + hb, y1, TZ + hb, 0.65);
      pushStrut(towerSteel, TX + ha, y0, TZ + ha, TX + hb, y1, TZ - hb, 0.65);
    }

    // observation decks at 120 m & 250 m (wider boxes)
    var deckMat = kit.stdMat(0xd9d5cc, { roughness: 0.7, metalness: 0.2 });
    var deckMain = kit.box(48, 7, 48, TX, 120, TZ, deckMat);
    var deckMainCap = kit.box(38, 2.6, 38, TX, 124.8, TZ, deckMat);
    var deckTop = kit.box(22, 6, 22, TX, 250, TZ, deckMat);
    anchor.add(deckMain); anchor.add(deckMainCap); anchor.add(deckTop);

    // warm emissive window bands wrapping the decks (night glow)
    var bandMat = kit.emissiveMat(U, 0xffc37a, 2.0);
    var bands = [];
    pushBox(bands, TX, 120, TZ - 24.2, 49, 2.4, 0.6, 0);
    pushBox(bands, TX, 120, TZ + 24.2, 49, 2.4, 0.6, 0);
    pushBox(bands, TX - 24.2, 120, TZ, 0.6, 2.4, 40, 0);
    pushBox(bands, TX + 24.2, 120, TZ, 0.6, 2.4, 40, 0);
    pushBox(bands, TX, 250, TZ - 11.2, 23, 2.0, 0.5, 0);
    pushBox(bands, TX, 250, TZ + 11.2, 23, 2.0, 0.5, 0);
    pushBox(bands, TX - 11.2, 250, TZ, 0.5, 2.0, 18, 0);
    pushBox(bands, TX + 11.2, 250, TZ, 0.5, 2.0, 18, 0);
    anchor.add(instancedBoxes(bands, bandMat));

    // antenna spire 252 → 333 m, alternating red/white
    var spireSegs = 7, spH = (330 - 252) / spireSegs;
    for (var si2 = 0; si2 < spireSegs; si2++) {
      var sy0 = 252 + si2 * spH, sy1 = sy0 + spH;
      var sr = util.lerp(2.4, 0.55, si2 / spireSegs);
      pushStrut(si2 % 2 === 0 ? towerRed : towerWhite, TX, sy0, TZ, TX, sy1, TZ, sr);
    }
    pushStrut(towerWhite, TX, 330, TZ, TX, 333, TZ, 0.3);

    // blinking aviation beacon at the tip (manual, not kit-ticked)
    var beaconMat = new THREE.MeshStandardMaterial({
      color: 0x1a0505, emissive: 0xff2222, emissiveIntensity: 0, roughness: 0.5
    });
    var beacon = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), beaconMat);
    beacon.position.set(TX, 333.6, TZ);
    anchor.add(beacon);

    // warm floodlight uplights at the base (night)
    var upMat = kit.emissiveMat(U, 0xffb060, 1.6);
    for (li = 0; li < 4; li++) {
      anchor.add(kit.box(3.2, 1.4, 3.2,
        TX + legSigns[li][0] * (halfW(0) + 5), 0.7, TZ + legSigns[li][1] * (halfW(0) + 5), upMat));
    }

    // tower materials: subtle warm floodlight tint at night via kit tick
    var towerRedMat = kit.emissiveMat(U, 0xd43a2f, 0.5);
    towerRedMat.color.set(0xd43a2f);
    var towerWhiteMat = kit.emissiveMat(U, 0xe8e4dc, 0.4);
    towerWhiteMat.color.set(0xe8e4dc);
    var steelMat = kit.stdMat(0xb9b4ac, { roughness: 0.6, metalness: 0.35 });

    anchor.add(instancedBoxes(towerRed, towerRedMat));
    anchor.add(instancedBoxes(towerWhite, towerWhiteMat));

    // steel braces/rings: unit cylinder instances
    var cylGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
    var steelMesh = new THREE.InstancedMesh(cylGeo, steelMat, towerSteel.length);
    for (var ti = 0; ti < towerSteel.length; ti++) {
      var st = towerSteel[ti];
      _s.set(st.sx, st.sy, st.sz);
      _m4.compose(_v1.set(st.x, st.y, st.z), st.q, _s);
      steelMesh.setMatrixAt(ti, _m4);
    }
    steelMesh.instanceMatrix.needsUpdate = true;
    steelMesh.frustumCulled = false;
    anchor.add(steelMesh);

    /* ---------- 6. elevated highway (curved ribbon on pylons) ---------- */
    var hwCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-2150, 14, 1500),
      new THREE.Vector3(-1350, 14, 950),
      new THREE.Vector3(-550, 14, 1150),
      new THREE.Vector3(350, 14, 1350),
      new THREE.Vector3(1150, 14, 950),
      new THREE.Vector3(1650, 14, 250),
      new THREE.Vector3(1950, 14, -650)
    ]);
    var HW_N = 72;
    var hwDeck = [], hwBar = [], hwPyl = [];
    var hwDeckMat = kit.stdMat(0x585c63, { roughness: 0.9 });
    var hwBarMat = kit.stdMat(0x9a9ea6, { roughness: 0.8 });
    var hwPylMat = kit.stdMat(0x4c5058, { roughness: 0.9 });
    for (var hi = 0; hi <= HW_N; hi++) {
      var ht = hi / HW_N;
      var hp = hwCurve.getPoint(ht);
      var htan = hwCurve.getTangent(ht);
      hwPts.push({ x: hp.x, z: hp.z });
      var yaw = Math.atan2(-htan.z, htan.x);
      _qYaw.setFromAxisAngle(_Y, yaw);
      var qCopy = _qYaw.clone();
      if (hi < HW_N) {
        hwDeck.push({ x: hp.x, y: 13.2, z: hp.z, sx: 30, sy: 1.6, sz: 12, q: qCopy });
        var rx = -htan.z, rz = htan.x;   // right of travel direction
        hwBar.push({ x: hp.x + rx * 5.9, y: 14.0, z: hp.z + rz * 5.9, sx: 30, sy: 1.1, sz: 0.5, q: qCopy });
        hwBar.push({ x: hp.x - rx * 5.9, y: 14.0, z: hp.z - rz * 5.9, sx: 30, sy: 1.1, sz: 0.5, q: qCopy });
      }
      if (hi % 3 === 0) {
        hwPyl.push({ x: hp.x, y: 0, z: hp.z, sx: 2.2, sy: 13.4, sz: 2.2, q: qCopy });
      }
    }
    anchor.add(instancedBoxes(hwDeck, hwDeckMat));
    anchor.add(instancedBoxes(hwBar, hwBarMat));
    anchor.add(instancedBoxes(hwPyl, hwPylMat));

    /* ---------- 7. neon meshes: merged by hue (5 + 2 flicker) ---------- */
    var neonStatic = [[], [], [], [], []];
    var neonFlick = [[], []];   // pink flicker, cyan flicker
    for (var qi = 0; qi < neonItems.length; qi++) {
      var nn = neonItems[qi];
      if (nn.flick) neonFlick[nn.hue === 1 ? 1 : 0].push(nn);
      else neonStatic[nn.hue].push(nn);
    }
    for (var hueI = 0; hueI < 5; hueI++) {
      if (!neonStatic[hueI].length) continue;
      anchor.add(instancedBoxes(neonStatic[hueI], kit.emissiveMat(U, NEON_HUES[hueI], 2.5)));
    }
    // flicker groups: manual materials (intensity driven in update, after kit.tick)
    var flickMats = [];
    var flickHues = [0xff2d78, 0x2de2ff];
    for (var fi = 0; fi < 2; fi++) {
      if (!neonFlick[fi].length) continue;
      var fm = new THREE.MeshStandardMaterial({
        color: 0x0a0a0c, emissive: flickHues[fi], emissiveIntensity: 0,
        roughness: 0.6, metalness: 0.1
      });
      flickMats.push(fm);
      anchor.add(instancedBoxes(neonFlick[fi], fm));
    }

    /* ---------- 8. street life: cars + lamps ---------- */
    var segments = [];
    var lane = 2.2;
    for (var vi = 0; vi < vSt.length; vi++) {
      var vx = vSt[vi].c + lane;
      segments.push({ ax: gx(vx, -EXT), az: gz(vx, -EXT), bx: gx(vx, EXT), bz: gz(vx, EXT) });
    }
    for (var hj = 0; hj < hSt.length; hj++) {
      var hz = hSt[hj].c - lane;
      segments.push({ ax: gx(-EXT, hz), az: gz(-EXT, hz), bx: gx(EXT, hz), bz: gz(EXT, hz) });
    }
    var cars = kit.makeCars(U, segments, 280);
    anchor.add(cars.mesh);

    var lampPos = [];
    for (var vi2 = 0; vi2 < vSt.length; vi2++) {
      for (var lz = -EXT + 45; lz < EXT; lz += 95) {
        var side = (((lz / 95) | 0) % 2) === 0 ? 1 : -1;
        var lx = vSt[vi2].c + side * (vSt[vi2].w / 2 + 1.2);
        lampPos.push([gx(lx, lz), gz(lx, lz)]);
      }
    }
    for (var hj2 = 0; hj2 < hSt.length; hj2++) {
      for (var lx2 = -EXT + 45; lx2 < EXT; lx2 += 95) {
        var side2 = (((lx2 / 95) | 0) % 2) === 0 ? 1 : -1;
        var hz2 = hSt[hj2].c + side2 * (hSt[hj2].w / 2 + 1.2);
        lampPos.push([gx(lx2, hz2), gz(lx2, hz2)]);
      }
    }
    anchor.add(kit.makeLamps(U, lampPos));

    /* ---------- 9. ground + buildings meshes ---------- */
    anchor.add(kit.makeGround(paintGround, 10000, 4200));
    var winMat = kit.makeWindowMaterial(U, { litFraction: 0.5 });
    anchor.add(kit.makeBuildings(winMat, items));

    /* ---------- update: no per-frame allocations ---------- */
    function update(dt, time) {
      kit.tick(U, dt);
      cars.update(dt);
      var night = U.uNight.value;
      var t = U.uTime.value;
      // neon flicker (overrides kit tick for these two materials only)
      if (flickMats.length > 0) {
        var f0 = 0.5 + 0.5 * Math.sin(t * 23.7 + Math.sin(t * 7.3) * 4.0);
        flickMats[0].emissiveIntensity = 2.5 * (0.15 + 0.85 * night) * (f0 > 0.22 ? 1.0 : 0.12);
      }
      if (flickMats.length > 1) {
        var f1 = 0.5 + 0.5 * Math.sin(t * 17.9 + 2.1 + Math.sin(t * 5.1) * 3.0);
        flickMats[1].emissiveIntensity = 2.5 * (0.15 + 0.85 * night) * (f1 > 0.30 ? 1.0 : 0.18);
      }
      // tower beacon blink
      var pulse = Math.sin(t * 2.4);
      beaconMat.emissiveIntensity = night * (pulse > 0.55 ? 3.2 : 0.06);
    }

    return { uniforms: [U], update: update };
  };
})();