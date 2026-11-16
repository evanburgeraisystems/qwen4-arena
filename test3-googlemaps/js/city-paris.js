/* ============================================================
   TERRA — city-paris.js  (agent B3)
   Haussmann cream blocks + mansard caps, 12 radial avenues from
   an Étoile hub, grand boulevards, the Seine with 12 bridges,
   a 324 m Eiffel-like iron lattice, Champ-de-Mars, Montparnasse
   slab and an Invalides-like golden dome.
   All geometry in METERS, +Y up, ground y=0, added to anchor.
   Codes against TERRA.citykit (CONTRACT-CITIES.md). THREE r128.
   ============================================================ */
(function () {
  'use strict';
  var T = window.TERRA;
  T.cityBuilders = T.cityBuilders || {};

  T.cityBuilders.paris = function (anchor, kit, hero, tex) {
    var U = kit.newUniforms();
    var rng = kit.rng((hero && hero.seed) || 1889);

    /* ---------------- layout constants ---------------- */
    var HUB = { x: -900, z: -600 };          // Étoile-like hub
    var TX = -1500, TZ = 700;                // Eiffel-like tower
    var CITY_R = 3750;                       // built-up radius
    var PITCH = 112, BLOCK = 94;             // block grid (18 m streets)
    var RIVER_HALF = 90;                     // Seine half width (~180 m)

    function riverZ(x) { return 300 * Math.sin(x * 0.001 + 2.0) + 250; }
    function riverSlope(x) { return 0.3 * Math.cos(x * 0.001 + 2.0); }

    // 12 radial avenues; avenue 0 aims at the city center (Champs-like)
    var AVE_LEN = 3250;
    var avenues = [];
    var a0 = Math.atan2(-HUB.z, -HUB.x);
    for (var ai = 0; ai < 12; ai++) {
      var ang = a0 + ai * Math.PI / 6;
      avenues.push({ dx: Math.cos(ang), dz: Math.sin(ang), halfW: ai === 0 ? 20 : 15 });
    }

    // grand boulevards (axis-aligned; B1/B3 never meet the Seine)
    var boulevards = [
      { ax: -3400, az: -250, bx: 3400, bz: -250, w: 32 },
      { ax: 350, az: -3400, bx: 350, bz: 3400, w: 30 },
      { ax: -3400, az: 1000, bx: 3400, bz: 1000, w: 28 }
    ];

    var parks = [
      { x0: -1610, z0: 760, x1: -1390, z1: 1460, champ: true },   // Champ-de-Mars
      { x0: -150, z0: 240, x1: 450, z1: 430 },                    // Tuileries-like
      { x0: 150, z0: 880, x1: 480, z1: 1120 },                    // Luxembourg-like
      { x0: 1600, z0: -1600, x1: 2050, z1: -1250 }                // Buttes-like
    ];
    var invalidesRect = { x0: -700, z0: 170, x1: -500, z1: 330 };
    var montparnRect = { x0: 740, z0: 1350, x1: 860, z1: 1450 };

    function inRect(x, z, r, pad) {
      return x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;
    }

    /* ---------------- building layout (data first) ---------------- */
    var creams = [], caps = [], bc = new THREE.Color();
    for (var ck = 0; ck < 12; ck++) {
      bc.setHex(0xd8cfc0);
      bc.offsetHSL((rng() - 0.5) * 0.015, (rng() - 0.5) * 0.04, (rng() - 0.5) * 0.06);
      creams.push(bc.getHex());
      bc.setHex(0x3a3f4a);
      bc.offsetHSL(0, (rng() - 0.5) * 0.03, (rng() - 0.5) * 0.05);
      caps.push(bc.getHex());
    }

    var items = [];       // main Haussmann bodies
    var capItems = [];    // mansard caps (second tier)

    function tryBuilding(x, z, w, d) {
      var m = (w + d) * 0.25 + 8;                       // footprint clearance
      if (Math.abs(z - riverZ(x)) < 104 + m) return;    // Seine + quays
      var vx = x - HUB.x, vz = z - HUB.z, i, a, proj, perp;
      if (vx * vx + vz * vz < (110 + m) * (110 + m)) return;  // Étoile plaza
      for (i = 0; i < 12; i++) {                        // radial wedges
        a = avenues[i];
        proj = vx * a.dx + vz * a.dz;
        if (proj > -60 && proj < AVE_LEN + 80) {
          perp = Math.abs(vx * a.dz - vz * a.dx);
          if (perp < a.halfW + m) return;
        }
      }
      if (Math.abs(z + 250) < 16 + m) return;           // boulevard 1
      if (Math.abs(x - 350) < 15 + m) return;           // boulevard 2
      if (Math.abs(z - 1000) < 14 + m) return;          // boulevard 3
      var dx = x - TX, dz = z - TZ;
      if (dx * dx + dz * dz < (160 + m) * (160 + m)) return; // tower plaza
      for (i = 0; i < parks.length; i++) if (inRect(x, z, parks[i], m)) return;
      if (inRect(x, z, invalidesRect, m)) return;
      if (inRect(x, z, montparnRect, m)) return;

      var h = 18 + rng() * 6;
      var col = creams[(rng() * creams.length) | 0];
      items.push({ x: x, z: z, w: w, d: d, h: h, rot: 0, color: col });
      capItems.push({
        x: x, y: h - 0.35, z: z, w: w - 2.5, h: 3.4, d: d - 2.5,
        ry: 0, color: caps[(rng() * caps.length) | 0]
      });
    }

    var lim = Math.ceil(CITY_R / PITCH);
    for (var gi = -lim; gi <= lim; gi++) {
      for (var gj = -lim; gj <= lim; gj++) {
        var cx = gi * PITCH, cz = gj * PITCH;
        if (cx * cx + cz * cz > CITY_R * CITY_R) continue;
        if (Math.abs(cz - riverZ(cx)) < 150) continue;
        var r = rng(), jx, jz;
        if (r < 0.06) {
          tryBuilding(cx + (rng() - 0.5) * 3, cz + (rng() - 0.5) * 3,
            84 + rng() * 4, 84 + rng() * 4);
        } else if (r < 0.53) {
          for (jx = -1; jx <= 1; jx += 2) {
            tryBuilding(cx + jx * 23.5 + (rng() - 0.5) * 2, cz + (rng() - 0.5) * 2,
              42 + rng() * 3, 86 + rng() * 3);
          }
        } else {
          for (jz = -1; jz <= 1; jz += 2) {
            tryBuilding(cx + (rng() - 0.5) * 2, cz + jz * 23.5 + (rng() - 0.5) * 2,
              86 + rng() * 3, 42 + rng() * 3);
          }
        }
      }
    }

    // landmark bodies riding in the same instanced mesh
    items.push({ x: 800, z: 1400, w: 58, d: 34, h: 210, rot: 0, color: 0x23262e }); // Montparnasse slab
    capItems.push({ x: 800, y: 209.6, z: 1400, w: 55, h: 3, d: 31, ry: 0, color: 0x1c1f26 });
    items.push({ x: -600, z: 250, w: 76, d: 48, h: 16, rot: 0, color: 0xd8cfc0 });  // Invalides base
    capItems.push({ x: -600, y: 15.6, z: 250, w: 73, h: 3, d: 45, ry: 0, color: 0x3a3f4a });

    /* ---------------- instancing helpers (build-time only) ---------------- */
    var _m = new THREE.Matrix4(), _p = new THREE.Vector3(),
        _q = new THREE.Quaternion(), _s = new THREE.Vector3(),
        _e = new THREE.Euler(), _c = new THREE.Color(),
        _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3(),
        _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3();

    function pushBox(list, x, y, z, w, h, d, rx, ry, rz, color) {
      _e.set(rx || 0, ry || 0, rz || 0);
      _q.setFromEuler(_e);
      _p.set(x, y, z); _s.set(w, h, d);
      _m.compose(_p, _q, _s);
      list.push({ m: _m.clone(), c: color === undefined ? -1 : color });
    }
    function bake(geo, mat, list) {
      var mesh = new THREE.InstancedMesh(geo, mat, list.length);
      var hasColor = list.length > 0 && list[0].c >= 0;
      for (var i = 0; i < list.length; i++) {
        mesh.setMatrixAt(i, list[i].m);
        if (hasColor) mesh.setColorAt(i, _c.setHex(list[i].c));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      return mesh;
    }
    var unitBox = new THREE.BoxGeometry(1, 1, 1);
    unitBox.translate(0, 0.5, 0);   // base at y=0, y in items = BASE height

    /* ---------------- ground (painted from the same layout) ---------------- */
    function paint(ctx, sizeM, ppm) {
      ctx.save();
      ctx.scale(ppm, ppm);                       // work in meters
      ctx.fillStyle = '#98928a';                 // warm-gray asphalt
      ctx.fillRect(-sizeM / 2, -sizeM / 2, sizeM, sizeM);

      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, 3800, 0, Math.PI * 2); ctx.clip();
      // street grid
      ctx.strokeStyle = '#a59f96'; ctx.lineWidth = 18;
      for (var i = -34; i <= 34; i++) {
        var c = i * PITCH + 56;
        ctx.beginPath(); ctx.moveTo(c, -3800); ctx.lineTo(c, 3800); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-3800, c); ctx.lineTo(3800, c); ctx.stroke();
      }
      // building footprints (darker than streets)
      ctx.fillStyle = '#8a847c';
      for (var b = 0; b < items.length; b++) {
        var it = items[b];
        ctx.fillRect(it.x - it.w / 2, it.z - it.d / 2, it.w, it.d);
      }
      // parks
      for (var p = 0; p < parks.length; p++) {
        var pk = parks[p];
        ctx.fillStyle = pk.champ ? '#6b8a52' : (p === 3 ? '#5f7f4a' : '#6b8a52');
        ctx.fillRect(pk.x0, pk.z0, pk.x1 - pk.x0, pk.z1 - pk.z0);
        if (pk.champ) {
          ctx.fillStyle = '#7fa05e';             // central lawn
          ctx.fillRect(-1560, pk.z0 + 10, 120, pk.z1 - pk.z0 - 20);
          ctx.fillStyle = '#b3ac9f';             // cross paths
          for (var zz = 900; zz <= 1320; zz += 140) ctx.fillRect(pk.x0, zz, pk.x1 - pk.x0, 8);
        }
      }
      ctx.restore();

      // plazas
      ctx.fillStyle = '#ada79c';
      ctx.beginPath(); ctx.arc(HUB.x, HUB.z, 95, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#bab4a8';
      ctx.beginPath(); ctx.arc(HUB.x, HUB.z, 28, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a8a29a';
      ctx.beginPath(); ctx.arc(TX, TZ, 150, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(invalidesRect.x0, invalidesRect.z0, 200, 160);
      ctx.fillStyle = '#746f68';
      ctx.fillRect(montparnRect.x0 - 20, montparnRect.z0 - 20, 160, 140);

      // radial avenues + boulevards (lighter stone lines)
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#b0aa9f';
      for (var a = 0; a < 12; a++) {
        var av = avenues[a];
        ctx.lineWidth = av.halfW * 2;
        ctx.beginPath();
        ctx.moveTo(HUB.x, HUB.z);
        ctx.lineTo(HUB.x + av.dx * AVE_LEN, HUB.z + av.dz * AVE_LEN);
        ctx.stroke();
      }
      for (var bb = 0; bb < boulevards.length; bb++) {
        var bl = boulevards[bb];
        ctx.lineWidth = bl.w;
        ctx.beginPath(); ctx.moveTo(bl.ax, bl.az); ctx.lineTo(bl.bx, bl.bz); ctx.stroke();
      }
      // dashed centerlines on the grand routes
      ctx.setLineDash([12, 16]);
      ctx.strokeStyle = '#d8d2c4'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(HUB.x, HUB.z);
      ctx.lineTo(HUB.x + avenues[0].dx * AVE_LEN, HUB.z + avenues[0].dz * AVE_LEN); ctx.stroke();
      for (var b2 = 0; b2 < boulevards.length; b2++) {
        var bl2 = boulevards[b2];
        ctx.beginPath(); ctx.moveTo(bl2.ax, bl2.az); ctx.lineTo(bl2.bx, bl2.bz); ctx.stroke();
      }
      ctx.setLineDash([]);

      // Seine: light stone quays, then dark riverbed (water mesh on top)
      ctx.beginPath();
      for (var x = -4300; x <= 4300; x += 86) {
        var rz = riverZ(x);
        if (x === -4300) ctx.moveTo(x, rz); else ctx.lineTo(x, rz);
      }
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#b3ac9f'; ctx.lineWidth = 214; ctx.stroke();
      ctx.strokeStyle = '#16242f'; ctx.lineWidth = 180; ctx.stroke();
      ctx.restore();
    }
    anchor.add(kit.makeGround(paint, 10000, 4200));

    /* ---------------- buildings + mansard caps ---------------- */
    var facadeMat = kit.makeWindowMaterial(U, {
      color: 0xffffff, roughness: 0.85, metalness: 0.08, litFraction: 0.4
    });
    anchor.add(kit.makeBuildings(facadeMat, items));

    var capMat = kit.stdMat(0xffffff, { roughness: 0.7, metalness: 0.25 });
    var capList = [];
    for (var ci = 0; ci < capItems.length; ci++) {
      var cp = capItems[ci];
      pushBox(capList, cp.x, cp.y || 0, cp.z, cp.w, cp.h, cp.d, 0, cp.ry || 0, 0, cp.color);
    }
    anchor.add(bake(unitBox, capMat, capList));

    /* ---------------- Seine water ---------------- */
    var waterPts = [];
    for (var wx = -4200; wx <= 4200; wx += 120) waterPts.push([wx, riverZ(wx) - RIVER_HALF]);
    for (var wx2 = 4200; wx2 >= -4200; wx2 -= 120) waterPts.push([wx2, riverZ(wx2) + RIVER_HALF]);
    anchor.add(kit.makeWaterPoly(waterPts, 0.3));

    /* ---------------- 12 bridges (deck + rails + piers + arches) ---------------- */
    var bridgeXs = [-3250, -2650, -2050, -1500, -950, -450, 50, 500, 1000, 1550, 2150, 2800];
    var bridgeList = [], archList = [];
    var stoneMat = kit.stdMat(0xffffff, { roughness: 0.85, metalness: 0.05 });
    var unitArch = new THREE.TorusGeometry(1, 0.09, 6, 20, Math.PI);
    for (var bi = 0; bi < bridgeXs.length; bi++) {
      var bx = bridgeXs[bi], bz = riverZ(bx);
      var s = riverSlope(bx), ry = Math.atan2(-s, 1);   // perpendicular to flow
      var axX = Math.sin(ry), axZ = Math.cos(ry);       // local +Z (span dir)
      var pxX = Math.cos(ry), pxZ = -Math.sin(ry);      // local +X (width dir)
      pushBox(bridgeList, bx, 4, bz, 15, 3, 240, 0, ry, 0, 0xa8a29a);        // deck
      pushBox(bridgeList, bx + pxX * 7, 7, bz + pxZ * 7, 1.5, 1.8, 240, 0, ry, 0, 0xb5afa4);
      pushBox(bridgeList, bx - pxX * 7, 7, bz - pxZ * 7, 1.5, 1.8, 240, 0, ry, 0, 0xb5afa4);
      for (var po = -1; po <= 1; po++)                                        // piers
        pushBox(bridgeList, bx + axX * po * 60, 0, bz + axZ * po * 60, 13, 4, 7, 0, ry, 0, 0x8f897f);
      pushBox(bridgeList, bx + axX * 115, 0, bz + axZ * 115, 17, 4, 14, 0, ry, 0, 0x9a948a); // abutments
      pushBox(bridgeList, bx - axX * 115, 0, bz - axZ * 115, 17, 4, 14, 0, ry, 0, 0x9a948a);
      for (var ao = -1; ao <= 1; ao += 2) {                                   // arch hints
        _e.set(0, Math.PI / 2 + ry, 0); _q.setFromEuler(_e);
        _p.set(bx + axX * ao * 30, 0.6, bz + axZ * ao * 30);
        _s.set(26, 26 * 0.16, 26);
        _m.compose(_p, _q, _s);
        archList.push({ m: _m.clone(), c: 0x9a948a });
      }
    }
    anchor.add(bake(unitBox, stoneMat, bridgeList));
    anchor.add(bake(unitArch, stoneMat, archList));

    /* ---------------- Eiffel-like tower (324 m) ---------------- */
    function hw(y) { return 62 * Math.exp(-y / 95) + 7; }
    var bronze = kit.stdMat(0x6b5a44, { roughness: 0.55, metalness: 0.6 });
    // subtle warm floodlight tint on the iron at night (shared uNight)
    bronze.onBeforeCompile = function (sh) {
      sh.uniforms.uNight = U.uNight;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight;')
        .replace('#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.69, 0.38) * uNight * 0.30;');
    };
    bronze.customProgramCacheKey = function () { return 'terra-paris-bronze'; };

    var towerList = [];
    // 4 corner legs: stacked tapered segments following the exponential curve
    for (var sx = -1; sx <= 1; sx += 2) {
      for (var sz = -1; sz <= 1; sz += 2) {
        for (var k = 0; k < 23; k++) {
          var y0 = k * 12, y1 = y0 + 12, ym = (y0 + y1) / 2;
          var h0 = hw(y0), h1 = hw(y1);
          _p0.set(sx * h0, y0, sz * h0);
          _p1.set(sx * h1, y1, sz * h1);
          _dir.subVectors(_p1, _p0);
          var L = _dir.length();
          _dir.normalize();
          _q.setFromUnitVectors(_up, _dir);
          _p.addVectors(_p0, _p1).multiplyScalar(0.5);
          var t = 9 * Math.exp(-ym / 180) + 2.8;
          _s.set(t, L * 1.08, t);
          _m.compose(_p, _q, _s);
          towerList.push({ m: _m.clone(), c: -1 });
        }
      }
    }
    // platforms at 57 / 115 / 276 m
    pushBox(towerList, TX, 55, TZ, 2 * hw(57) + 10, 4, 2 * hw(57) + 10, 0, 0, 0);
    pushBox(towerList, TX, 113.5, TZ, 2 * hw(115) + 8, 3.5, 2 * hw(115) + 8, 0, 0, 0);
    pushBox(towerList, TX, 274.5, TZ, 2 * hw(276) + 6, 3, 2 * hw(276) + 6, 0, 0, 0);
    // horizontal lattice belts
    var beltYs = [30, 150, 190, 230];
    for (var by = 0; by < beltYs.length; by++) {
      var yy = beltYs[by], hh = hw(yy), bw = 2 * hh + 3;
      pushBox(towerList, TX, yy - 1, TZ + hh, bw, 2.4, 2.4, 0, 0, 0);
      pushBox(towerList, TX, yy - 1, TZ - hh, bw, 2.4, 2.4, 0, 0, 0);
      pushBox(towerList, TX + hh, yy - 1, TZ, 2.4, 2.4, bw, 0, 0, 0);
      pushBox(towerList, TX - hh, yy - 1, TZ, 2.4, 2.4, bw, 0, 0, 0);
    }
    // X-brace hints on the four lower faces
    for (var f = 0; f < 4; f++) {
      var fx = f === 0 ? 0 : (f === 1 ? 46 : (f === 2 ? 0 : -46));
      var fz = f === 0 ? 46 : (f === 1 ? 0 : (f === 2 ? -46 : 0));
      var rx = f === 1 ? 0.62 : (f === 3 ? -0.62 : 0);
      var rz = f === 0 ? 0.62 : (f === 2 ? -0.62 : 0);
      pushBox(towerList, TX + fx, 30, TZ + fz, 2.4, 62, 2.4, rx, 0, rz);
      pushBox(towerList, TX + fx, 30, TZ + fz, 2.4, 62, 2.4, -rx, 0, -rz);
    }
    // upper shaft, cap and antenna (top at 324 m)
    pushBox(towerList, TX, 279, TZ, 9, 21, 9, 0, 0, 0);
    pushBox(towerList, TX, 300, TZ, 13, 2, 13, 0, 0, 0);
    pushBox(towerList, TX, 302, TZ, 2.4, 22, 2.4, 0, 0, 0);
    anchor.add(bake(unitBox, bronze, towerList));

    // half-torus arches between the lower legs (one per face)
    var towerArchGeo = new THREE.TorusGeometry(1, 0.05, 6, 24, Math.PI);
    var towerArchList = [];
    var faces = [[0, 46, 0], [46, 0, Math.PI / 2], [0, -46, 0], [-46, 0, Math.PI / 2]];
    for (var fa = 0; fa < 4; fa++) {
      _e.set(0, faces[fa][2], 0); _q.setFromEuler(_e);
      _p.set(TX + faces[fa][0], 6, TZ + faces[fa][1]);
      _s.set(50, 47, 50);
      _m.compose(_p, _q, _s);
      towerArchList.push({ m: _m.clone(), c: -1 });
    }
    anchor.add(bake(towerArchGeo, bronze, towerArchList));

    // night floodlights: warm uplight boxes around the base
    var upMat = kit.emissiveMat(U, 0xffb060, 1.2);
    var upList = [];
    var ups = [[80, 80], [80, -80], [-80, 80], [-80, -80], [0, 84], [0, -84], [84, 0], [-84, 0]];
    for (var ui = 0; ui < ups.length; ui++)
      pushBox(upList, TX + ups[ui][0], 0, TZ + ups[ui][1], 5, 2.5, 5, 0, 0, 0, -1);
    anchor.add(bake(unitBox, upMat, upList));

    /* ---------------- Invalides-like golden dome ---------------- */
    var goldMat = kit.stdMat(0xc9a84c, { roughness: 0.35, metalness: 0.7 });
    var drumMat = kit.stdMat(0xb8b2a6, { roughness: 0.8, metalness: 0.05 });
    anchor.add(kit.cyl(13, 15, 24, -600, 28, 250, drumMat, 16));        // drum
    var domeGeo = new THREE.SphereGeometry(14, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    var dome = new THREE.Mesh(domeGeo, goldMat);
    dome.position.set(-600, 40, 250);
    anchor.add(dome);
    anchor.add(kit.cyl(2.5, 3.2, 9, -600, 58.5, 250, goldMat, 8));      // lantern

    /* ---------------- trees (Champ-de-Mars rows + parks) ---------------- */
    var treeList = [];
    var treeGeo = new THREE.IcosahedronGeometry(1, 1);
    var treeMat = kit.stdMat(0xffffff, { roughness: 0.9, metalness: 0 });
    var greens = [0x4c6b3c, 0x557a42, 0x5f8a4a, 0x47633a];
    function tree(x, z) {
      var sc = 5 + rng() * 2.5;
      _e.set(0, rng() * Math.PI, 0); _q.setFromEuler(_e);
      _p.set(x, sc * 0.75, z); _s.set(sc, sc * (0.9 + rng() * 0.3), sc);
      _m.compose(_p, _q, _s);
      treeList.push({ m: _m.clone(), c: greens[(rng() * greens.length) | 0] });
    }
    for (var tz = 790; tz <= 1440; tz += 38) { tree(-1602, tz); tree(-1398, tz); }
    for (var tp = 1; tp < parks.length; tp++) {
      var pk2 = parks[tp], n = tp === 3 ? 20 : 16;
      for (var ti = 0; ti < n; ti++)
        tree(pk2.x0 + 12 + rng() * (pk2.x1 - pk2.x0 - 24), pk2.z0 + 12 + rng() * (pk2.z1 - pk2.z0 - 24));
    }
    for (var tr = 0; tr < 10; tr++) {
      var ta = tr / 10 * Math.PI * 2;
      tree(TX + Math.cos(ta) * 135, TZ + Math.sin(ta) * 135);
    }
    anchor.add(bake(treeGeo, treeMat, treeList));

    /* ---------------- street life: cars + lamps ---------------- */
    // road centerlines, split where they would run through the Seine
    var segments = [];
    function drySegs(ax, az, bx, bz) {
      var N = 80, st = -1, kk, tt, xx, zz, wet;
      function run(t0, t1) {
        var dx = (bx - ax) * (t1 - t0), dz = (bz - az) * (t1 - t0);
        if (Math.sqrt(dx * dx + dz * dz) > 140)
          segments.push({ ax: ax + (bx - ax) * t0, az: az + (bz - az) * t0,
                          bx: ax + (bx - ax) * t1, bz: az + (bz - az) * t1 });
      }
      for (kk = 0; kk <= N; kk++) {
        tt = kk / N; xx = ax + (bx - ax) * tt; zz = az + (bz - az) * tt;
        wet = Math.abs(zz - riverZ(xx)) < 112;
        if (!wet) { if (st < 0) st = tt; }
        else if (st >= 0) { run(st, (kk - 1) / N); st = -1; }
      }
      if (st >= 0) run(st, 1);
    }
    for (var ca = 0; ca < 12; ca++) {
      var av2 = avenues[ca];
      drySegs(HUB.x + av2.dx * 120, HUB.z + av2.dz * 120,
              HUB.x + av2.dx * AVE_LEN, HUB.z + av2.dz * AVE_LEN);
    }
    for (var cb = 0; cb < boulevards.length; cb++) {
      var bl3 = boulevards[cb];
      drySegs(bl3.ax, bl3.az, bl3.bx, bl3.bz);
    }
    var gridLines = [
      [-3300, -1400, 3300, -1400], [-3300, -392, 3300, -392], [-3300, 1176, 3300, 1176],
      [-1512, -3300, -1512, 3300], [504, -3300, 504, 3300], [1736, -3300, 1736, 3300]
    ];
    for (var gl = 0; gl < gridLines.length; gl++)
      drySegs(gridLines[gl][0], gridLines[gl][1], gridLines[gl][2], gridLines[gl][3]);

    var cars = kit.makeCars(U, segments, 220);
    anchor.add(cars.mesh);

    var lampPos = [];
    function lamp(x, z) {
      if (Math.abs(z - riverZ(x)) < 112) return;
      if (x * x + z * z > 3650 * 3650) return;
      lampPos.push([x, z]);
    }
    for (var la = 0; la < 12; la++) {
      var av3 = avenues[la], side = 1;
      for (var lt = 150; lt < AVE_LEN; lt += 85) {
        var px = -av3.dz * (av3.halfW + 4) * side, pz = av3.dx * (av3.halfW + 4) * side;
        lamp(HUB.x + av3.dx * lt + px, HUB.z + av3.dz * lt + pz);
        side = -side;
      }
    }
    for (var lb = 0; lb < boulevards.length; lb++) {
      var bl4 = boulevards[lb], horiz = bl4.az === bl4.bz, side2 = 1;
      var len = horiz ? bl4.bx - bl4.ax : bl4.bz - bl4.az;
      for (var lt2 = 60; lt2 < len; lt2 += 90) {
        var off = (bl4.w / 2 + 4) * side2;
        if (horiz) lamp(bl4.ax + lt2, bl4.az + off); else lamp(bl4.ax + off, bl4.az + lt2);
        side2 = -side2;
      }
    }
    for (var cl = 800; cl <= 1440; cl += 80) { lamp(-1615, cl); lamp(-1385, cl); }
    anchor.add(kit.makeLamps(U, lampPos));

    /* ---------------- per-frame ---------------- */
    return {
      uniforms: [U],
      update: function (dt, time) {
        kit.tick(U, dt);
        cars.update(dt);
      }
    };
  };
})();
