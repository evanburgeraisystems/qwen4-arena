/* ============================================================
   BODYCAM: OUTBREAK — LEVEL (procedural derelict hospital)
   6 zones: lobby -> ward corridor -> stairwell ramp -> ICU (y4)
            -> roof access ramp -> rooftop helipad (y7)
   Classic script. Depends on engine.js + state.js only.
   ============================================================ */
'use strict';

(function () {

  /* ---------------- canvas texture helpers ---------------- */
  function cnv(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function speckle(g, w, h, n, colors, aMin, aMax, sMin, sMax) {
    for (let i = 0; i < n; i++) {
      g.globalAlpha = rnd(aMin, aMax);
      g.fillStyle = pick(colors);
      const s = rnd(sMin, sMax);
      g.fillRect(rnd(w), rnd(h), s, s);
    }
    g.globalAlpha = 1;
  }
  function blotch(g, x, y, r, col, a) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, col);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = a;
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    g.globalAlpha = 1;
  }
  function crack(g, x, y, len, col, w) {
    g.strokeStyle = col; g.lineWidth = w; g.beginPath();
    g.moveTo(x, y);
    let a = rnd(Math.PI * 2);
    for (let i = 0; i < len; i++) {
      a += rnd(-0.7, 0.7);
      x += Math.cos(a) * rnd(4, 12); y += Math.sin(a) * rnd(4, 12);
      g.lineTo(x, y);
    }
    g.stroke();
  }

  function paintFloor() {
    const c = cnv(512, 512), g = c.getContext('2d');
    g.fillStyle = '#525a4e'; g.fillRect(0, 0, 512, 512);
    // 4x4 vinyl tiles, per-tile tint
    for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
      const v = rnd(-10, 8) | 0;
      g.fillStyle = 'rgb(' + (82 + v) + ',' + (90 + v) + ',' + (78 + v) + ')';
      g.fillRect(tx * 128 + 2, ty * 128 + 2, 124, 124);
    }
    speckle(g, 512, 512, 2600, ['#3d4238', '#6a7263', '#2e3229', '#767d6d'], 0.05, 0.16, 1, 3);
    // grout
    g.fillStyle = '#26291f';
    for (let i = 0; i <= 4; i++) { g.fillRect(i * 128 - 2, 0, 4, 512); g.fillRect(0, i * 128 - 2, 512, 4); }
    // scuffs (dark arcs)
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = 'rgba(22,24,18,' + rnd(0.1, 0.3) + ')';
      g.lineWidth = rnd(1, 4);
      g.beginPath();
      g.arc(rnd(512), rnd(512), rnd(6, 30), rnd(Math.PI * 2), rnd(Math.PI * 2) + rnd(0.5, 2));
      g.stroke();
    }
    // grime blotches
    for (let i = 0; i < 14; i++) blotch(g, rnd(512), rnd(512), rnd(20, 70), 'rgba(20,18,12,1)', rnd(0.08, 0.22));
    for (let i = 0; i < 5; i++) blotch(g, rnd(512), rnd(512), rnd(14, 40), 'rgba(58,20,14,1)', rnd(0.05, 0.14));
    crack(g, rnd(512), rnd(512), 8, 'rgba(20,22,16,0.5)', 1.5);
    crack(g, rnd(512), rnd(512), 6, 'rgba(20,22,16,0.4)', 1);
    return c;
  }

  function paintWall() {
    const c = cnv(512, 512), g = c.getContext('2d');
    // two-tone: pale green upper, darker lower (v=0 is canvas bottom)
    g.fillStyle = '#87917d'; g.fillRect(0, 0, 512, 512);
    g.fillStyle = '#525c4c'; g.fillRect(0, 318, 512, 194);
    g.fillStyle = '#39413a'; g.fillRect(0, 314, 512, 7);
    g.fillStyle = '#2c322b'; g.fillRect(0, 498, 512, 14); // baseboard
    speckle(g, 512, 512, 1800, ['#6e7a66', '#9aa48e', '#48523f', '#333c30'], 0.04, 0.12, 1, 3);
    // vertical grime streaks running down
    for (let i = 0; i < 34; i++) {
      const x = rnd(512), w = rnd(2, 9), h = rnd(40, 240);
      g.fillStyle = 'rgba(28,30,22,' + rnd(0.04, 0.14) + ')';
      g.fillRect(x, rnd(0, 200), w, h);
    }
    // stains
    for (let i = 0; i < 12; i++) blotch(g, rnd(512), rnd(512), rnd(24, 90), 'rgba(30,26,16,1)', rnd(0.08, 0.24));
    for (let i = 0; i < 4; i++) blotch(g, rnd(512), rnd(300, 512), rnd(16, 46), 'rgba(64,22,16,1)', rnd(0.06, 0.16));
    // scuff marks near lower band
    for (let i = 0; i < 22; i++) {
      g.strokeStyle = 'rgba(18,20,14,' + rnd(0.12, 0.32) + ')';
      g.lineWidth = rnd(1, 3.5);
      g.beginPath();
      const x = rnd(512), y = rnd(350, 500);
      g.moveTo(x, y); g.lineTo(x + rnd(-34, 34), y + rnd(-8, 8));
      g.stroke();
    }
    crack(g, rnd(512), rnd(200), 7, 'rgba(24,26,20,0.45)', 1.2);
    return c;
  }

  function paintCeil() {
    const c = cnv(256, 256), g = c.getContext('2d');
    g.fillStyle = '#787a72'; g.fillRect(0, 0, 256, 256);
    for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
      const v = rnd(-8, 6) | 0;
      g.fillStyle = 'rgb(' + (120 + v) + ',' + (122 + v) + ',' + (114 + v) + ')';
      g.fillRect(tx * 128 + 2, ty * 128 + 2, 124, 124);
    }
    speckle(g, 256, 256, 900, ['#5c5e56', '#8f9188', '#4a4c44'], 0.05, 0.14, 1, 2);
    g.fillStyle = '#45473f';
    g.fillRect(126, 0, 4, 256); g.fillRect(0, 126, 256, 4);
    // water stains
    for (let i = 0; i < 7; i++) blotch(g, rnd(256), rnd(256), rnd(18, 60), 'rgba(66,48,26,1)', rnd(0.12, 0.3));
    blotch(g, rnd(256), rnd(256), rnd(30, 55), 'rgba(40,30,16,1)', 0.25);
    // one missing tile (dark void)
    g.fillStyle = '#14161a';
    g.beginPath();
    g.moveTo(132, 132); g.lineTo(250, 136); g.lineTo(246, 250); g.lineTo(136, 246);
    g.closePath(); g.fill();
    g.strokeStyle = '#2c2e28'; g.lineWidth = 3; g.stroke();
    return c;
  }

  function paintBlood() {
    const c = cnv(256, 256), g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    // central pool-ish cluster
    for (let i = 0; i < 9; i++) {
      const x = 128 + rnd(-34, 34), y = 128 + rnd(-30, 30), r = rnd(12, 42);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(96,10,8,0.9)');
      gr.addColorStop(0.7, 'rgba(70,8,6,0.75)');
      gr.addColorStop(1, 'rgba(50,6,4,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // satellite droplets
    for (let i = 0; i < 70; i++) {
      const a = rnd(Math.PI * 2), d = rnd(20, 120);
      const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d;
      g.fillStyle = 'rgba(' + (60 + rnd(50) | 0) + ',8,6,' + rnd(0.35, 0.85) + ')';
      g.beginPath(); g.arc(x, y, rnd(1, 5), 0, Math.PI * 2); g.fill();
    }
    // smears / drag streaks
    for (let i = 0; i < 6; i++) {
      const x = rnd(40, 216), y = rnd(40, 216), a = rnd(Math.PI * 2), l = rnd(30, 90);
      g.strokeStyle = 'rgba(78,10,8,' + rnd(0.25, 0.55) + ')';
      g.lineWidth = rnd(4, 12); g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    // drips
    for (let i = 0; i < 8; i++) {
      const x = rnd(30, 226), y = rnd(60, 180);
      g.strokeStyle = 'rgba(66,8,6,0.6)'; g.lineWidth = rnd(1.5, 3);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + rnd(-3, 3), y + rnd(14, 40)); g.stroke();
    }
    return c;
  }

  function paintExit() {
    const c = cnv(256, 128), g = c.getContext('2d');
    g.fillStyle = '#03140a'; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#1d5c34'; g.lineWidth = 6; g.strokeRect(4, 4, 248, 120);
    g.fillStyle = '#54ff96';
    g.font = 'bold 64px monospace'; g.textBaseline = 'middle';
    g.fillText('EXIT', 18, 68);
    // running man
    g.strokeStyle = '#54ff96'; g.lineWidth = 7; g.lineCap = 'round';
    g.beginPath(); g.arc(196, 34, 10, 0, Math.PI * 2); g.stroke(); // head
    g.beginPath();
    g.moveTo(196, 46); g.lineTo(188, 74);            // torso
    g.moveTo(188, 74); g.lineTo(170, 96);            // back leg
    g.moveTo(188, 74); g.lineTo(208, 88); g.lineTo(206, 108); // front leg
    g.moveTo(194, 56); g.lineTo(214, 62);            // arm fwd
    g.moveTo(194, 58); g.lineTo(176, 66);            // arm back
    g.stroke();
    return c;
  }

  function paintHeli() {
    const c = cnv(512, 512), g = c.getContext('2d');
    g.fillStyle = '#585a56'; g.fillRect(0, 0, 512, 512);
    speckle(g, 512, 512, 4200, ['#484a46', '#6a6c66', '#3a3c38', '#767871'], 0.08, 0.25, 1, 3);
    for (let i = 0; i < 8; i++) blotch(g, rnd(512), rnd(512), rnd(30, 90), 'rgba(24,24,22,1)', rnd(0.08, 0.2));
    crack(g, rnd(512), rnd(512), 9, 'rgba(26,26,24,0.55)', 1.5);
    // painted circle + H, worn yellow
    g.strokeStyle = '#c9a83a'; g.lineWidth = 20;
    g.beginPath(); g.arc(256, 256, 196, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#c9a83a';
    g.font = 'bold 230px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('H', 256, 268);
    // wear: knock out paint patches
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 40; i++) {
      g.globalAlpha = rnd(0.1, 0.5);
      g.beginPath(); g.arc(rnd(512), rnd(512), rnd(3, 16), 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    return c;
  }

  function paintRoof() {
    const c = cnv(256, 256), g = c.getContext('2d');
    g.fillStyle = '#53555a'; g.fillRect(0, 0, 256, 256);
    speckle(g, 256, 256, 3600, ['#43454a', '#65676c', '#35373c', '#71737a', '#5e6066'], 0.1, 0.35, 1, 2.5);
    // tar seams
    g.fillStyle = 'rgba(26,26,28,0.6)';
    g.fillRect(0, 84, 256, 5); g.fillRect(170, 0, 5, 256);
    // patches
    g.fillStyle = 'rgba(70,72,76,0.5)'; g.fillRect(20, 120, 70, 60);
    g.fillStyle = 'rgba(44,46,50,0.5)'; g.fillRect(190, 180, 56, 66);
    for (let i = 0; i < 6; i++) blotch(g, rnd(256), rnd(256), rnd(16, 50), 'rgba(20,20,22,1)', rnd(0.1, 0.24));
    crack(g, rnd(256), rnd(256), 8, 'rgba(24,24,26,0.6)', 1.4);
    crack(g, rnd(256), rnd(256), 6, 'rgba(24,24,26,0.5)', 1);
    return c;
  }

  function paintGlass() {
    const c = cnv(256, 256), g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(170,195,210,0.16)'; g.fillRect(0, 0, 256, 256);
    // impact cracks from two points
    const impacts = [[70, 90], [190, 170]];
    for (const [ix, iy] of impacts) {
      for (let i = 0; i < 11; i++) {
        const a = rnd(Math.PI * 2), l = rnd(30, 120);
        g.strokeStyle = 'rgba(225,238,248,' + rnd(0.25, 0.6) + ')';
        g.lineWidth = rnd(0.6, 1.8);
        g.beginPath(); g.moveTo(ix, iy);
        let x = ix, y = iy, aa = a;
        for (let s = 0; s < 5; s++) {
          aa += rnd(-0.35, 0.35);
          x += Math.cos(aa) * l / 5; y += Math.sin(aa) * l / 5;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      // concentric ring cracks
      for (let r = 14; r < 46; r += 15) {
        g.strokeStyle = 'rgba(220,232,242,0.3)'; g.lineWidth = 0.8;
        g.beginPath(); g.arc(ix, iy, r, rnd(Math.PI * 2), rnd(Math.PI * 2) + rnd(2, 5)); g.stroke();
      }
    }
    // missing shards (holes)
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 5; i++) {
      const x = rnd(256), y = rnd(256);
      g.globalAlpha = rnd(0.5, 1);
      g.beginPath();
      g.moveTo(x, y); g.lineTo(x + rnd(-30, 30), y + rnd(-30, 30)); g.lineTo(x + rnd(-30, 30), y + rnd(-30, 30));
      g.closePath(); g.fill();
    }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    return c;
  }

  function paintPoster() {
    const c = cnv(256, 256), g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#c9c3b0'; g.fillRect(8, 6, 240, 236);
    speckle(g, 256, 256, 400, ['#b0aa96', '#d8d2c0', '#9a947f'], 0.06, 0.18, 1, 3);
    // red cross + header
    g.fillStyle = '#8d2c22';
    g.fillRect(28, 22, 34, 10); g.fillRect(40, 10, 10, 34);
    g.fillStyle = '#3a3a34';
    g.font = 'bold 19px monospace';
    g.fillText('MERCY GENERAL', 74, 36);
    g.font = '12px monospace';
    g.fillText('NOTICE — NIGHT SHIFT', 28, 66);
    // body text lines
    g.fillStyle = 'rgba(58,58,52,0.75)';
    for (let i = 0; i < 9; i++) g.fillRect(28, 84 + i * 13, rnd(120, 200), 4);
    // anatomy torso sketch
    g.strokeStyle = 'rgba(120,50,40,0.7)'; g.lineWidth = 2;
    g.beginPath(); g.ellipse(186, 176, 26, 38, 0, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(186, 140); g.lineTo(186, 212); g.stroke();
    g.beginPath(); g.arc(186, 168, 8, 0, Math.PI * 2); g.stroke();
    // water stain
    blotch(g, rnd(60, 200), rnd(100, 220), rnd(30, 60), 'rgba(90,74,44,1)', 0.2);
    // torn bottom edge + corner
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.moveTo(0, 256);
    let x = 0;
    while (x < 256) { x += rnd(10, 26); g.lineTo(x, 236 + rnd(-14, 18)); }
    g.lineTo(256, 256); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(248, 6); g.lineTo(248, 40); g.lineTo(216, 6); g.closePath(); g.fill();
    g.globalCompositeOperation = 'source-over';
    // tape
    g.fillStyle = 'rgba(222,220,200,0.55)';
    g.fillRect(20, 0, 40, 14); g.fillRect(196, 0, 40, 14);
    return c;
  }

  function paintMetal() {
    const c = cnv(256, 256), g = c.getContext('2d');
    g.fillStyle = '#3e4248'; g.fillRect(0, 0, 256, 256);
    // brushed horizontal streaks
    for (let i = 0; i < 700; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,' + rnd(0.015, 0.06) + ')' : 'rgba(0,0,0,' + rnd(0.02, 0.09) + ')';
      g.fillRect(0, rnd(256), 256, rnd(0.5, 1.6));
    }
    // scratches
    for (let i = 0; i < 16; i++) {
      g.strokeStyle = 'rgba(180,186,196,' + rnd(0.06, 0.2) + ')';
      g.lineWidth = rnd(0.5, 1.2);
      const x = rnd(256), y = rnd(256);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + rnd(-50, 50), y + rnd(-10, 10)); g.stroke();
    }
    // grime + rust hints
    for (let i = 0; i < 8; i++) blotch(g, rnd(256), rnd(256), rnd(14, 50), 'rgba(16,16,18,1)', rnd(0.1, 0.26));
    for (let i = 0; i < 4; i++) blotch(g, rnd(256), rnd(200, 256), rnd(8, 26), 'rgba(94,52,26,1)', rnd(0.08, 0.2));
    // rivets
    g.fillStyle = 'rgba(150,156,164,0.5)';
    for (const [rx, ry] of [[14, 14], [242, 14], [14, 242], [242, 242]]) {
      g.beginPath(); g.arc(rx, ry, 4, 0, Math.PI * 2); g.fill();
    }
    return c;
  }

  /* ---------------- module state ---------------- */
  const walls = [];          // AABB colliders {minX,maxX,minZ,maxZ,minY,maxY,active}
  const lights = [];         // flicker light records (also pushed into Eng.lights)
  const doors = [];
  const pickups = [];
  const waypoints = [];
  const spawnPoints = [];
  const cables = [];         // ICU hanging cable sway props
  const glassPatches = [     // floor regions that crunch as 'glass'
    { x0: 4.3, x1: 6.05, z0: 1.6, z1: 3.6 },   // lobby, below east window 1
    { x0: 4.3, x1: 6.05, z0: 4.4, z1: 6.4 },   // lobby, below east window 2
    { x0: 2.0, x1: 4.4, z0: -6.6, z1: -4.6 }   // ward east room (zc -5)
  ];
  const _res = [0, 0];       // reusable moveCircle result
  let beacon = null;         // rooftop antenna blink quad
  let scare = { entered: false, delay: 0, timer: 25 };
  let dustT = 0.4, tinkleT = rnd(18, 40);
  let built = false;

  const Level = {
    tex: {},
    data: null,
    walls: walls
  };

  /* ---------------- collider / geometry helpers ---------------- */
  function col(cx, cy, cz, sx, sy, sz) {
    walls.push({
      minX: cx - sx / 2, maxX: cx + sx / 2,
      minZ: cz - sz / 2, maxZ: cz + sz / 2,
      minY: cy - sy / 2, maxY: cy + sy / 2,
      active: true
    });
    return walls[walls.length - 1];
  }

  /* ---------------- floor / zone queries ---------------- */
  // ramps: z -32 -> -37 rises 0 -> 4 ; z -62 -> -67 rises 4 -> 7
  function floorHeight(x, z) {
    if (z > -32) return 0;
    if (z > -37) return 4 * (-32 - z) / 5;
    if (z > -62) return 4;
    if (z > -67) return 4 + 3 * (-62 - z) / 5;
    return 7;
  }
  function zoneAt(pos) {
    const z = pos[2];
    if (z > -1) return 0;
    if (z > -32) return 1;
    if (z > -37) return 2;
    if (z > -62) return 3;
    if (z > -67) return 4;
    return 5;
  }
  // footstep surface: glass shard patches, concrete stair ramps, roof gravel, else tile
  function surfaceAt(x, z) {
    if (z <= -67) return 'roof';
    if (z <= -62) return 'concrete';   // roof-access ramp
    if (z <= -37) return 'tile';       // ICU
    if (z <= -32) return 'concrete';   // stairwell A ramp
    for (let i = 0; i < glassPatches.length; i++) {
      const p = glassPatches[i];
      if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return 'glass';
    }
    return 'tile';
  }

  /* ---------------- movement: two-pass axis-separated slide ---------------- */
  function moveCircle(x, z, r, dx, dz) {
    const fy = floorHeight(x, z);
    let nx = x + dx, nz = z + dz;
    // pass 1: X axis
    if (dx !== 0) {
      for (let i = 0; i < walls.length; i++) {
        const w = walls[i];
        if (w.active === false) continue;
        if (fy >= w.maxY || fy + 1.7 <= w.minY) continue;
        if (nz + r <= w.minZ || nz - r >= w.maxZ) continue;
        if (nx + r > w.minX && nx - r < w.maxX) {
          nx = dx > 0 ? w.minX - r : w.maxX + r;
        }
      }
    }
    // pass 2: Z axis
    if (dz !== 0) {
      for (let i = 0; i < walls.length; i++) {
        const w = walls[i];
        if (w.active === false) continue;
        if (fy >= w.maxY || fy + 1.7 <= w.minY) continue;
        if (nx + r <= w.minX || nx - r >= w.maxX) continue;
        if (nz + r > w.minZ && nz - r < w.maxZ) {
          nz = dz > 0 ? w.minZ - r : w.maxZ + r;
        }
      }
    }
    _res[0] = nx; _res[1] = nz;
    return _res;
  }

  /* ---------------- raycast: slab test vs wall AABBs (doors included) ---------------- */
  function raycast(from, to) {
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    let best = 1;
    const BIG = 1e30;
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      if (w.active === false) continue;
      let t1, t2, tn = 0, tf = 1;
      // X slab
      if (Math.abs(dx) < 1e-8) {
        if (from[0] < w.minX || from[0] > w.maxX) continue;
      } else {
        t1 = (w.minX - from[0]) / dx; t2 = (w.maxX - from[0]) / dx;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        if (t1 > tn) tn = t1;
        if (t2 < tf) tf = t2;
        if (tn > tf) continue;
      }
      // Y slab
      if (Math.abs(dy) < 1e-8) {
        if (from[1] < w.minY || from[1] > w.maxY) continue;
      } else {
        t1 = (w.minY - from[1]) / dy; t2 = (w.maxY - from[1]) / dy;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        if (t1 > tn) tn = t1;
        if (t2 < tf) tf = t2;
        if (tn > tf) continue;
      }
      // Z slab
      if (Math.abs(dz) < 1e-8) {
        if (from[2] < w.minZ || from[2] > w.maxZ) continue;
      } else {
        t1 = (w.minZ - from[2]) / dz; t2 = (w.maxZ - from[2]) / dz;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        if (t1 > tn) tn = t1;
        if (t2 < tf) tf = t2;
        if (tn > tf) continue;
      }
      if (tf < 0 || tn > best) continue;
      const hit = tn > 0 ? tn : 0;
      if (hit < best) best = hit;
    }
    return best;
  }

  /* -------- raycastHit: same slab test, returns {t, normal} (face normal) -------- */
  function raycastHit(from, to) {
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    let best = 1, bnx = 0, bny = 1, bnz = 0;
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      if (w.active === false) continue;
      let t1, t2, tn = 0, tf = 1, ax = -1, sg = 1;
      // X slab
      if (Math.abs(dx) < 1e-8) {
        if (from[0] < w.minX || from[0] > w.maxX) continue;
      } else {
        t1 = (w.minX - from[0]) / dx; t2 = (w.maxX - from[0]) / dx;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        if (t1 > tn) { tn = t1; ax = 0; sg = dx > 0 ? -1 : 1; }
        if (t2 < tf) tf = t2;
        if (tn > tf) continue;
      }
      // Y slab
      if (Math.abs(dy) < 1e-8) {
        if (from[1] < w.minY || from[1] > w.maxY) continue;
      } else {
        t1 = (w.minY - from[1]) / dy; t2 = (w.maxY - from[1]) / dy;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        if (t1 > tn) { tn = t1; ax = 1; sg = dy > 0 ? -1 : 1; }
        if (t2 < tf) tf = t2;
        if (tn > tf) continue;
      }
      // Z slab
      if (Math.abs(dz) < 1e-8) {
        if (from[2] < w.minZ || from[2] > w.maxZ) continue;
      } else {
        t1 = (w.minZ - from[2]) / dz; t2 = (w.maxZ - from[2]) / dz;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        if (t1 > tn) { tn = t1; ax = 2; sg = dz > 0 ? -1 : 1; }
        if (t2 < tf) tf = t2;
        if (tn > tf) continue;
      }
      if (tf < 0 || tn > best) continue;
      const hit = tn > 0 ? tn : 0;
      if (hit < best) {
        best = hit;
        if (tn > 0 && ax >= 0) {
          bnx = ax === 0 ? sg : 0; bny = ax === 1 ? sg : 0; bnz = ax === 2 ? sg : 0;
        } else { bnx = 0; bny = 1; bnz = 0; } // origin inside: default up
      }
    }
    return { t: best, normal: [bnx, bny, bnz] };
  }

  /* ---------------- decals ---------------- */
  function addDecal(pos, size, tex, color, alpha, rotY) {
    return Eng.add(Eng.meshQuad,
      M4.trs([pos[0], pos[1] + 0.012, pos[2]], [-Math.PI / 2, rotY || 0, 0], [size, size, 1]),
      color || [1, 1, 1],
      { tex: tex || Level.tex.blood, alpha: alpha === undefined ? 0.8 : alpha, blend: 'alpha', depthWrite: false, doubleSided: true });
  }
  // wall blood = thin blood-textured box
  function wallBlood(x, y, z, w, h, rotY, alpha) {
    return Eng.add(Eng.meshCube,
      M4.trs([x, y, z], [0, rotY || 0, 0], [w, h, 0.02]),
      [0.42, 0.035, 0.03],
      { tex: Level.tex.blood, alpha: alpha === undefined ? 0.85 : alpha, blend: 'alpha', depthWrite: false, doubleSided: true });
  }
  function bloodPool(x, y, z, s) {
    addDecal([x, y, z], s || rnd(1.2, 1.8), Level.tex.blood, [0.3, 0.02, 0.02], rnd(0.7, 0.9), rnd(Math.PI * 2));
  }
  function dragTrail(x0, z0, x1, z1, y, n, s0, s1) {
    const px = -(z1 - z0), pz = (x1 - x0);
    const pl = Math.hypot(px, pz) || 1;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const wob = rnd(-0.18, 0.18);
      addDecal(
        [lerp(x0, x1, t) + px / pl * wob, y, lerp(z0, z1, t) + pz / pl * wob],
        lerp(s0, s1, t) * rnd(0.8, 1.2), Level.tex.blood,
        [0.3, 0.02, 0.02], rnd(0.45, 0.75), rnd(Math.PI * 2));
    }
  }

  /* ---------------- doors ---------------- */
  function doorModels(d) {
    let yaw = d.closedYaw + d.swing;
    if (d.banging > 0) yaw += Math.sin(Eng.time * 55) * 0.06 * d.banging;
    const root = M4.trs(d.pos, [0, yaw, 0], null);
    d.r.model = M4.mul(root, M4.trs([d.w / 2, d.h / 2, 0], null, [d.w, d.h, 0.07]));
    d.rw.model = M4.mul(root, M4.trs([d.w * 0.5, d.h * 0.72, 0.045], null, [0.36, 0.5, 1]));
  }
  function makeDoor(hx, hy, hz, closedYaw, zone, colBox, heavy) {
    const d = {
      pos: [hx, hy, hz], yaw: closedYaw, closedYaw: closedYaw,
      w: 1.0, h: 2.1, open: 0, target: 0, spd: 2.9,
      closed: true, zone: zone, r: null, rw: null, col: null,
      swing: 0, banging: 0, _dir: 1, _last: -1
    };
    d.col = col(colBox[0], colBox[1], colBox[2], colBox[3], colBox[4], colBox[5]);
    d.r = Eng.add(Eng.meshCube, M4.ident(), heavy ? [0.34, 0.36, 0.4] : [0.45, 0.42, 0.38], { tex: Level.tex.metal });
    d.rw = Eng.add(Eng.meshQuad, M4.ident(), [0.62, 0.7, 0.72],
      { tex: Level.tex.glass, alpha: 0.55, blend: 'alpha', depthWrite: false, doubleSided: true });
    doorModels(d);
    d._last = 0;
    doors.push(d);
    return d;
  }
  function openDoor(d, violent) {
    if (!d || !d.closed) return;
    d.closed = false;
    d.target = 1;
    d.spd = violent ? 5.5 : 2.9;
    if (d.col) d.col.active = false;
    if (violent) {
      d.banging = 0.6;
    } else if (window.AudioSys && AudioSys.doorCreak) {
      AudioSys.doorCreak(d.pos);
    }
  }
  Level.openDoor = openDoor;

  /* ---------------- lights ---------------- */
  function addLight(x, y, z, base, radius, state, hard) {
    const L = {
      pos: [x, y, z], color: [base[0], base[1], base[2]], radius: radius,
      base: base, state: state, hard: !!hard,
      seed: rnd(100), timer: rnd(0.1, 1), dur: 0.5, level: 1
    };
    lights.push(L);
    Eng.lights.push(L);
    return L;
  }
  function updateLights(dt) {
    const pp = G.player.pos, t = Eng.time;
    for (let i = 0; i < lights.length; i++) {
      const L = lights[i];
      const dx = L.pos[0] - pp[0], dy = L.pos[1] - pp[1], dz = L.pos[2] - pp[2];
      if (dx * dx + dy * dy + dz * dz > 900) { // cull > 30 m
        L.color[0] = 0; L.color[1] = 0; L.color[2] = 0;
        continue;
      }
      let lv = 1;
      switch (L.state) {
        case 'dead': lv = 0; break;
        case 'on': lv = 0.92 + 0.04 * Math.sin(t * 6.3 + L.seed); break;
        case 'buzz': lv = 0.82 + 0.07 * Math.sin(t * 37 + L.seed) + 0.04 * Math.sin(t * 11.7 + L.seed * 2); break;
        case 'pulse': lv = 0.55 + 0.2 * Math.sin(t * 2 + L.seed); break;
        case 'steady': lv = 1; break;
        case 'flicker': {
          L.timer -= dt;
          if (L.timer <= 0) {
            const prev = L.level;
            const roll = Math.random();
            const dipP = L.hard ? 0.45 : 0.2, blackP = L.hard ? 0.15 : 0.06;
            if (roll < blackP) { L.level = 0; L.dur = rnd(0.2, 1.0); }
            else if (roll < blackP + dipP) { L.level = rnd(0.08, 0.45); L.dur = rnd(0.03, 0.12); }
            else { L.level = 1; L.dur = L.hard ? rnd(0.06, 0.5) : rnd(0.15, 1.2); }
            L.timer = L.dur;
            // ballast buzz on flicker state change (near player only, guarded)
            if (L.level !== prev && window.AudioSys && AudioSys.flickerBuzz) {
              const bx = L.pos[0] - pp[0], bz = L.pos[2] - pp[2];
              if (bx * bx + bz * bz < 324) AudioSys.flickerBuzz(L.pos, L.level < 0.5);
            }
          }
          lv = L.level * (0.9 + 0.1 * Math.sin(t * 43 + L.seed));
          break;
        }
      }
      L.color[0] = L.base[0] * lv;
      L.color[1] = L.base[1] * lv;
      L.color[2] = L.base[2] * lv;
    }
  }

  /* ---------------- waypoints / spawn points ---------------- */
  function wp(x, z, zone) {
    const id = waypoints.length;
    waypoints.push({ id: id, pos: [x, floorHeight(x, z), z], links: [], zone: zone });
    return id;
  }
  function link(a, b) {
    if (waypoints[a].links.indexOf(b) < 0) waypoints[a].links.push(b);
    if (waypoints[b].links.indexOf(a) < 0) waypoints[b].links.push(a);
  }
  function chain(ids) {
    for (let i = 0; i < ids.length - 1; i++) link(ids[i], ids[i + 1]);
  }
  function sp(x, z, zone) {
    spawnPoints.push({ pos: [x, floorHeight(x, z), z], zone: zone });
  }

  /* ============================================================
     BUILD
     ============================================================ */
  function build() {
    if (built) return;
    built = true;

    /* ----- textures ----- */
    Level.tex = {
      floor: Eng.texFromCanvas(paintFloor()),
      wall: Eng.texFromCanvas(paintWall()),
      ceil: Eng.texFromCanvas(paintCeil()),
      blood: Eng.texFromCanvas(paintBlood()),
      exit: Eng.texFromCanvas(paintExit(), false),
      heli: Eng.texFromCanvas(paintHeli(), false),
      roof: Eng.texFromCanvas(paintRoof()),
      glass: Eng.texFromCanvas(paintGlass()),
      poster: Eng.texFromCanvas(paintPoster(), false),
      metal: Eng.texFromCanvas(paintMetal())
    };
    const T = Level.tex;

    /* ----- merged builders ----- */
    const FB = Eng.builder(0.5);   // floor: texture repeats every 2 m
    const WB = Eng.builder(0.33);  // wall: ~3 m vertical span
    const CB = Eng.builder(0.5);   // ceiling
    const PB = Eng.builder(1);     // plain vertex-color clutter
    const RB = Eng.builder(0.4);   // roof gravel
    const MB = Eng.builder(1);     // brushed metal

    const wallCol = [1, 1, 1];
    function wall(cx, cy, cz, sx, sy, sz) { WB.box(cx, cy, cz, sx, sy, sz, wallCol); col(cx, cy, cz, sx, sy, sz); }
    function floorB(cx, cy, cz, sx, sy, sz) { FB.box(cx, cy, cz, sx, sy, sz, [1, 1, 1]); }
    function ceilB(cx, cy, cz, sx, sy, sz) { CB.box(cx, cy, cz, sx, sy, sz, [0.9, 0.9, 0.88]); }
    function plain(cx, cy, cz, sx, sy, sz, c, rotY, solid) {
      PB.box(cx, cy, cz, sx, sy, sz, c, rotY ? { rotY: rotY } : {});
      if (solid) col(cx, cy, cz, sx, sy, sz);
    }
    function metal(cx, cy, cz, sx, sy, sz, c, rotY, solid) {
      MB.box(cx, cy, cz, sx, sy, sz, c || [0.8, 0.8, 0.82], rotY ? { rotY: rotY } : {});
      if (solid) col(cx, cy, cz, sx, sy, sz);
    }
    function fixture(x, y, z, dead) {
      plain(x, y, z, 1.3, 0.06, 0.35, dead ? [0.3, 0.32, 0.3] : [0.88, 0.92, 0.86]);
    }
    function exitSign(x, y, z, withLight) {
      Eng.add(Eng.meshQuad, M4.trs([x, y, z], null, [0.72, 0.36, 1]), [1, 1, 1], { tex: T.exit, emissive: 0.95 });
      if (withLight !== false) addLight(x, y - 0.2, z + 0.25, [0.09, 0.42, 0.18], 3, 'steady');
    }
    function poster(x, y, z, rotY, s) {
      Eng.add(Eng.meshQuad, M4.trs([x, y, z], [0, rotY, 0], [s || 0.62, (s || 0.62) * 1.35, 1]),
        [0.9, 0.9, 0.86], { tex: T.poster, alpha: 0.96, blend: 'alpha', depthWrite: false });
    }
    function ivPole(x, y, z) {
      plain(x, y + 0.85, z, 0.035, 1.7, 0.035, [0.6, 0.62, 0.64]);
      plain(x, y + 0.02, z, 0.3, 0.04, 0.3, [0.4, 0.42, 0.44]);
      plain(x + 0.09, y + 1.62, z, 0.2, 0.03, 0.03, [0.6, 0.62, 0.64]);
      plain(x + 0.16, y + 1.45, z, 0.08, 0.22, 0.05, [0.7, 0.72, 0.7]); // bag
    }
    function bed(x, y, z, rotY, bloodied, tipped) {
      const c = bloodied ? [0.5, 0.44, 0.4] : [0.6, 0.6, 0.55];
      if (tipped) {
        metal(x, y + 0.22, z, 1.9, 0.3, 0.9, [0.55, 0.56, 0.58], rotY, true);
        plain(x + 0.3, y + 0.08, z + 0.6, 1.7, 0.12, 0.8, c, rotY + 0.3);
      } else {
        metal(x, y + 0.38, z, 1.9, 0.22, 0.9, [0.55, 0.56, 0.58], rotY, true);
        plain(x, y + 0.56, z, 1.82, 0.14, 0.84, c, rotY);
        plain(x - 0.92, y + 0.72, z, 0.06, 0.5, 0.9, [0.5, 0.52, 0.54], rotY);
        plain(x + 0.92, y + 0.62, z, 0.06, 0.3, 0.9, [0.5, 0.52, 0.54], rotY);
      }
    }
    function chair(x, y, z, rotY, tipped, solid) {
      const c = [0.22, 0.3, 0.32];
      if (tipped) {
        plain(x, y + 0.2, z, 0.45, 0.42, 0.45, c, rotY, solid);
      } else {
        plain(x, y + 0.44, z, 0.45, 0.07, 0.45, c, rotY, solid);
        plain(x, y + 0.22, z, 0.09, 0.44, 0.09, [0.3, 0.32, 0.34], rotY);
        plain(x, y + 0.72, z + 0.2, 0.45, 0.5, 0.06, c, rotY);
      }
    }
    function ramp(z0, y0, z1, y1, width) {
      // tilted slab whose TOP face matches floorHeight exactly along z0..z1
      const run = z0 - z1, rise = y1 - y0;
      const ang = Math.atan2(rise, run);
      const L = Math.hypot(run, rise), thick = 0.3;
      const c = Math.cos(ang), s = Math.sin(ang);
      const cz = (z0 + z1) / 2 - s * thick / 2;
      const cy = (y0 + y1) / 2 - c * thick / 2;
      Eng.add(Eng.meshCube, M4.trs([0, cy, cz], [ang, 0, 0], [width, thick, L]),
        [0.78, 0.78, 0.8], { tex: T.roof, texScale: [1.6, 3] });
      // side walls (colliders keep player on the ramp)
      const wh = y1 + 1.2;
      wall(-(width / 2 + 0.1), wh / 2, (z0 + z1) / 2, 0.2, wh, run + 0.4);
      wall(width / 2 + 0.1, wh / 2, (z0 + z1) / 2, 0.2, wh, run + 0.4);
      // handrails
      for (const sx of [-1, 1]) {
        Eng.add(Eng.meshCube,
          M4.trs([sx * (width / 2 - 0.08), (y0 + y1) / 2 + 0.95, (z0 + z1) / 2], [ang, 0, 0], [0.05, 0.05, L]),
          [0.5, 0.5, 0.52], { tex: T.metal });
      }
    }

    /* ================= ZONE 0 — LOBBY (x -6..6, z -1..9) ================= */
    floorB(0, -0.1, 4, 12.4, 0.2, 10);
    ceilB(0, 3.3, 4, 12.4, 0.2, 10.4);
    wall(0, 1.6, 9.1, 12.4, 3.2, 0.2);            // south
    wall(-6.1, 1.6, 4, 0.2, 3.2, 10.4);           // west
    // north wall with double-door gap x -1.1..1.1
    wall(-3.55, 1.6, -1, 4.9, 3.2, 0.2);
    wall(3.55, 1.6, -1, 4.9, 3.2, 0.2);
    wall(0, 2.7, -1, 2.2, 1.0, 0.2);              // header
    metal(-1.15, 1.1, -1, 0.12, 2.2, 0.26, [0.5, 0.5, 0.52]);
    metal(1.15, 1.1, -1, 0.12, 2.2, 0.26, [0.5, 0.5, 0.52]);
    // east wall with two broken window openings z 1.5..3.5 / 4.5..6.5, y 0.9..2.5
    wall(6.1, 1.6, 0.25, 0.2, 3.2, 2.5);
    wall(6.1, 1.6, 4, 0.2, 3.2, 1.0);
    wall(6.1, 1.6, 7.75, 0.2, 3.2, 2.5);
    wall(6.1, 0.45, 2.5, 0.2, 0.9, 2.0);          // sills
    wall(6.1, 0.45, 5.5, 0.2, 0.9, 2.0);
    wall(6.1, 2.85, 2.5, 0.2, 0.7, 2.0);          // headers
    wall(6.1, 2.85, 5.5, 0.2, 0.7, 2.0);
    // cracked glass panes
    Eng.add(Eng.meshQuad, M4.trs([5.99, 1.7, 2.5], [0, -Math.PI / 2, 0], [2.0, 1.6, 1]),
      [0.75, 0.82, 0.88], { tex: T.glass, alpha: 0.8, blend: 'alpha', depthWrite: false, doubleSided: true });
    Eng.add(Eng.meshQuad, M4.trs([5.99, 1.7, 5.5], [0, -Math.PI / 2, 0], [2.0, 1.6, 1]),
      [0.75, 0.82, 0.88], { tex: T.glass, alpha: 0.55, blend: 'alpha', depthWrite: false, doubleSided: true });
    // moonlight through windows
    addLight(5.3, 2.3, 2.5, [0.05, 0.065, 0.11], 14, 'steady');
    addLight(5.3, 2.3, 5.5, [0.045, 0.06, 0.1], 14, 'steady');
    // reception desk (west side)
    metal(-3.8, 0.55, 3.5, 2.6, 1.1, 0.7, [0.72, 0.7, 0.66], 0, true);
    plain(-3.8, 1.13, 3.5, 2.7, 0.06, 0.8, [0.5, 0.48, 0.44]);
    plain(-4.3, 1.32, 3.5, 0.4, 0.32, 0.06, [0.1, 0.11, 0.12]); // monitor
    plain(-3.2, 1.18, 3.4, 0.24, 0.02, 0.32, [0.75, 0.74, 0.68], 0.4); // papers
    // overturned gurney + struggle blood
    metal(2.8, 0.3, 5.5, 1.9, 0.55, 0.16, [0.55, 0.56, 0.58], 0.6);
    col(2.8, 0.3, 5.5, 1.9, 0.6, 1.4); // AABB covering the rotated frame
    plain(3.1, 0.07, 6.1, 1.7, 0.12, 0.75, [0.52, 0.46, 0.42], 0.6);
    plain(2.2, 0.12, 4.9, 0.16, 0.24, 0.16, [0.3, 0.3, 0.32], 0.6);
    bloodPool(2.6, 0, 5.2, 1.7);
    dragTrail(2.4, 5.0, 0.4, -0.4, 0, 9, 0.9, 0.5); // dragged north toward doors
    wallBlood(1.6, 1.3, -0.88, 0.7, 0.9, 0, 0.8);   // splatter beside double doors
    // scattered chairs
    chair(-1.8, 0, 6.8, 0.3, false, true);
    chair(1.2, 0, 7.4, -0.5, false, true);
    chair(3.9, 0, 2.2, 1.2, true, false);
    chair(-4.9, 0, 1.1, 2.1, true, false);
    // broken glass on floor below windows
    addDecal([5.2, 0, 2.6], 1.4, T.glass, [0.8, 0.88, 0.95], 0.5, rnd(6));
    addDecal([5.4, 0, 5.3], 1.2, T.glass, [0.8, 0.88, 0.95], 0.45, rnd(6));
    plain(5.3, 0.02, 3.4, 0.14, 0.02, 0.1, [0.7, 0.78, 0.82], 0.7);
    plain(5.5, 0.02, 4.6, 0.1, 0.02, 0.14, [0.7, 0.78, 0.82], 1.4);
    // papers + posters
    plain(0.8, 0.006, 3.2, 0.22, 0.006, 0.3, [0.72, 0.7, 0.64], 0.8);
    plain(-1.4, 0.006, 5.8, 0.22, 0.006, 0.3, [0.7, 0.68, 0.62], 2.2);
    poster(-5.97, 1.7, 5.8, Math.PI / 2, 0.66);
    poster(-5.97, 1.65, 1.6, Math.PI / 2, 0.58);
    // exit sign above double doors (lobby already lit — no extra light)
    exitSign(0, 2.55, -0.9, false);
    fixture(0, 3.18, 4, false);
    addLight(0, 2.7, 4, [0.56, 0.64, 0.6], 8, 'buzz');

    /* ================= ZONE 1 — WARD CORRIDOR (x ±1.6, z -1..-31) ================= */
    floorB(0, -0.1, -16, 3.6, 0.2, 30);
    ceilB(0, 3.1, -16, 3.6, 0.2, 30.4);
    const wardZ = [-5, -13, -21, -29];
    const segs = [[-1, -4.2], [-5.8, -12.2], [-13.8, -20.2], [-21.8, -28.2], [-29.8, -31]];
    for (const s of segs) {
      const cz = (s[0] + s[1]) / 2, sz = s[1] - s[0];
      wall(-1.7, 1.5, cz, 0.2, 3.0, sz);
      wall(1.7, 1.5, cz, 0.2, 3.0, sz);
    }
    for (const zc of wardZ) {
      wall(-1.7, 2.6, zc, 0.2, 0.8, 1.6); // doorway headers
      wall(1.7, 2.6, zc, 0.2, 0.8, 1.6);
      // rooms both sides: x 1.8..7.7, z zc±2.6
      for (const sgn of [-1, 1]) {
        const rx = sgn * 4.75;
        floorB(rx, -0.1, zc, 5.9, 0.2, 5.2);
        ceilB(rx, 3.1, zc, 5.9, 0.2, 5.2);
        wall(rx, 1.5, zc - 2.6, 6.2, 3.0, 0.2);
        wall(rx, 1.5, zc + 2.6, 6.2, 3.0, 0.2);
        wall(sgn * 7.8, 1.5, zc, 0.2, 3.0, 5.4);
      }
    }
    // room contents
    bed(-4.6, 0, -6.2, 0, false, false);
    ivPole(-6.6, 0, -6.8);
    plain(-6.9, 0.3, -3.6, 0.5, 0.6, 0.5, [0.42, 0.44, 0.42], 0, true); // cabinet
    bed(4.6, 0, -4.2, 0, true, false);
    ivPole(6.6, 0, -6.6);
    dragTrail(1.7, -5, 4.2, -4.4, 0, 6, 0.7, 0.5); // trail dragged into room
    bloodPool(4.4, 0, -4.6, 1.3);
    // glass shard patch in this room (matches surfaceAt 'glass' region)
    addDecal([3.1, 0, -5.5], 1.7, T.glass, [0.8, 0.88, 0.95], 0.5, rnd(6));
    plain(2.6, 0.02, -5.9, 0.12, 0.02, 0.09, [0.7, 0.78, 0.82], 0.9);
    plain(3.7, 0.02, -5.0, 0.1, 0.02, 0.13, [0.7, 0.78, 0.82], 2.1);
    wallBlood(2.0, 1.2, -5.9, 0.8, 0.9, Math.PI / 2, 0.8);
    bed(-4.6, 0, -13.8, 0.35, true, true); // overturned bed
    ivPole(-6.8, 0, -11.6);
    bloodPool(-4.2, 0, -13.2, 1.6);
    dragTrail(-1.7, -13, -4.0, -13.4, 0, 6, 0.7, 0.9);
    wallBlood(-2.0, 1.3, -12.1, 0.9, 1.0, -Math.PI / 2, 0.85);
    bed(4.6, 0, -12.2, 0, false, false);
    plain(6.9, 0.3, -14.4, 0.5, 0.6, 0.5, [0.42, 0.44, 0.42], 0, true);
    bed(-4.6, 0, -21.6, 0, true, false);
    ivPole(-6.7, 0, -22.6);
    bloodPool(-4.5, 0, -21.2, 1.4);
    wallBlood(-2.0, 1.1, -20.0, 0.7, 0.8, -Math.PI / 2, 0.75);
    bed(4.6, 0, -21.4, -0.3, true, true);
    bloodPool(4.3, 0, -21.0, 1.5);
    dragTrail(1.7, -21, 4.0, -21.2, 0, 6, 0.6, 0.9);
    bed(-4.6, 0, -28.4, 0, false, false);
    bed(4.6, 0, -29.6, 0, true, false);
    ivPole(6.6, 0, -27.6);
    bloodPool(4.5, 0, -29.2, 1.2);
    // corridor: overturned gurney mid-way forcing a sidestep (right side)
    metal(1.0, 0.38, -16, 0.14, 0.75, 1.9, [0.55, 0.56, 0.58], 0.1);
    col(1.0, 0.4, -16, 0.9, 0.8, 2.0); // forces a sidestep, leaves x<0.55 clear
    plain(0.95, 0.06, -16, 0.7, 0.1, 1.8, [0.5, 0.45, 0.42], 0.1);
    plain(1.25, 0.1, -15.2, 0.14, 0.2, 0.14, [0.3, 0.3, 0.32]);
    bloodPool(0.7, 0, -16.2, 1.5);
    dragTrail(0.5, -16.5, -1.6, -20.8, 0, 8, 0.8, 0.5); // dragged toward left room door
    // fallen ceiling tile + papers
    plain(-0.9, 0.03, -9, 0.6, 0.04, 0.6, [0.6, 0.6, 0.56], 0.7);
    plain(0.6, 0.006, -24, 0.22, 0.006, 0.3, [0.72, 0.7, 0.64], 1.9);
    plain(-0.5, 0.006, -18.6, 0.22, 0.006, 0.3, [0.7, 0.68, 0.62], 0.5);
    poster(-1.58, 1.6, -8, Math.PI / 2, 0.55);
    poster(1.58, 1.65, -17.5, -Math.PI / 2, 0.6);
    poster(-1.58, 1.6, -25, Math.PI / 2, 0.55);
    // fluorescents every 6 m — 2 dead
    const wardFix = [[-4, 'on'], [-10, 'flicker'], [-16, 'dead'], [-22, 'on'], [-28, 'dead']];
    for (const [z, st] of wardFix) {
      fixture(0, 2.98, z, st === 'dead');
      addLight(0, 2.7, z, [0.68, 0.77, 0.72], 7, st, false);
    }

    /* ================= ZONE 2 — STAIRWELL A (ramp 0 -> 4, z -32..-37) ================= */
    floorB(0, -0.1, -31.5, 4.6, 0.2, 1.0);
    ceilB(0, 6.9, -34.2, 4.6, 0.2, 6.4);
    wall(-2.3, 3.4, -34.2, 0.2, 6.8, 6.4);
    wall(2.3, 3.4, -34.2, 0.2, 6.8, 6.4);
    wall(-1.95, 3.4, -31, 0.7, 6.8, 0.2);
    wall(1.95, 3.4, -31, 0.7, 6.8, 0.2);
    wall(0, 4.5, -31, 3.2, 4.6, 0.2);             // header over corridor entry
    floorB(0, 3.9, -37.2, 4.6, 0.2, 0.4);         // top landing
    wall(-1.95, 3.4, -37.4, 0.7, 6.8, 0.2);
    wall(1.95, 3.4, -37.4, 0.7, 6.8, 0.2);
    wall(0, 6.45, -37.4, 3.2, 0.7, 0.2);
    ramp(-32, 0, -37, 4, 2.8);
    // red emergency light + EXIT
    plain(0, 6.7, -34, 0.3, 0.12, 0.3, [0.5, 0.12, 0.1]);
    addLight(0, 5.8, -34, [0.4, 0.05, 0.03], 6.5, 'pulse');
    exitSign(0, 2.5, -31.05);
    // dragged handprints up the ramp wall
    wallBlood(-1.38, 1.2, -33, 0.28, 0.4, Math.PI / 2, 0.8);
    wallBlood(-1.38, 2.2, -34, 0.26, 0.38, Math.PI / 2, 0.75);
    wallBlood(-1.38, 3.2, -35, 0.3, 0.42, Math.PI / 2, 0.7);
    bloodPool(0.4, 0, -31.6, 1.1);
    addDecal([0.2, 2, -34.5], 0.8, T.blood, [0.3, 0.02, 0.02], 0.6, rnd(6)); // on ramp surface

    /* ================= ZONE 3 — ICU CORRIDOR (y=4, z -37..-62) ================= */
    floorB(0, 3.9, -49.5, 3.6, 0.2, 25);
    ceilB(0, 7.1, -49.5, 3.6, 0.2, 25.4);
    // left wall doorways at z -42, -56 (1.0 wide); right at -49
    const lsegs = [[-37, -42.5], [-41.5, -56.5], [-55.5, -62]];
    for (const s of lsegs) wall(-1.7, 5.5, (s[0] + s[1]) / 2, 0.2, 3.0, s[1] - s[0]);
    const rsegs = [[-37, -49.5], [-48.5, -62]];
    for (const s of rsegs) wall(1.7, 5.5, (s[0] + s[1]) / 2, 0.2, 3.0, s[1] - s[0]);
    wall(-1.7, 6.55, -42, 0.2, 0.9, 1.0);
    wall(-1.7, 6.55, -56, 0.2, 0.9, 1.0);
    wall(1.7, 6.55, -49, 0.2, 0.9, 1.0);
    // ICU rooms (5 deep) with beds, monitors, heavy blood
    const icuRooms = [[-1, -42], [1, -49], [-1, -56]];
    for (const [sgn, zc] of icuRooms) {
      const rx = sgn * 4.65;
      floorB(rx, 3.9, zc, 5.8, 0.2, 5.0);
      ceilB(rx, 7.1, zc, 5.8, 0.2, 5.0);
      wall(rx, 5.5, zc - 2.5, 6.1, 3.0, 0.2);
      wall(rx, 5.5, zc + 2.5, 6.1, 3.0, 0.2);
      wall(sgn * 7.7, 5.5, zc, 0.2, 3.0, 5.2);
      bed(sgn * 4.3, 4, zc + 0.6, 0, true, zc === -49);
      plain(sgn * 6.6, 4.9, zc - 1.6, 0.5, 0.9, 0.4, [0.3, 0.34, 0.36], 0, true); // monitor cart
      plain(sgn * 6.6, 5.5, zc - 1.6, 0.42, 0.3, 0.06, [0.08, 0.1, 0.1]);
      ivPole(sgn * 6.8, 4, zc + 1.8);
      bloodPool(sgn * 4.1, 4, zc + 0.4, 1.7);
      dragTrail(sgn * 1.7, zc, sgn * 3.9, zc + 0.4, 4, 6, 0.7, 0.9);
      wallBlood(sgn * 1.58, 5.3, zc + 0.85, 0.8, 1.0, sgn > 0 ? -Math.PI / 2 : Math.PI / 2, 0.85);
    }
    // corridor gurney (left side) + wheelchair debris (right side)
    metal(-0.95, 4.4, -52, 0.7, 0.12, 1.9, [0.55, 0.56, 0.58], 0, true);
    plain(-0.95, 4.52, -52, 0.66, 0.12, 1.8, [0.5, 0.44, 0.4]);
    plain(-0.95, 4.15, -52.7, 0.08, 0.5, 0.08, [0.35, 0.36, 0.38]);
    plain(-0.95, 4.15, -51.3, 0.08, 0.5, 0.08, [0.35, 0.36, 0.38]);
    bloodPool(-0.6, 4, -52.4, 1.4);
    plain(1.0, 4.55, -47, 0.45, 0.06, 0.45, [0.25, 0.28, 0.3], 0.7, true);
    plain(1.15, 4.85, -47.2, 0.45, 0.5, 0.06, [0.25, 0.28, 0.3], 0.7);
    Eng.add(Eng.meshCyl, M4.trs([0.82, 4.35, -46.85], [0, 0, Math.PI / 2], [0.6, 0.05, 0.6]), [0.2, 0.2, 0.22], { tex: T.metal });
    Eng.add(Eng.meshCyl, M4.trs([1.22, 4.35, -47.3], [0, 0, Math.PI / 2], [0.6, 0.05, 0.6]), [0.2, 0.2, 0.22], { tex: T.metal });
    // fallen ceiling tiles
    plain(0.7, 4.03, -44, 0.6, 0.04, 0.6, [0.6, 0.6, 0.56], 0.4);
    plain(-0.8, 4.03, -50.2, 0.6, 0.04, 0.6, [0.58, 0.58, 0.54], 1.3);
    plain(0.4, 4.03, -58.6, 0.6, 0.04, 0.6, [0.6, 0.6, 0.56], 2.4);
    plain(-1.1, 4.3, -60.6, 0.6, 0.6, 0.05, [0.58, 0.58, 0.54], 0.2); // leaning on wall
    // big struggle pool mid-corridor + drag toward room
    bloodPool(0.3, 4, -50, 1.9);
    dragTrail(0.4, -49.6, 1.6, -49, 4, 5, 0.8, 0.5);
    wallBlood(1.58, 5.4, -51, 0.9, 1.1, -Math.PI / 2, 0.8);
    poster(-1.58, 5.6, -45.5, Math.PI / 2, 0.55);
    poster(1.58, 5.55, -54, -Math.PI / 2, 0.6);
    // ICU fluorescents — fewer working, one hard flicker
    const icuFix = [[-40, 'dead'], [-46, 'flicker'], [-52, 'on'], [-58, 'dead']];
    for (const [z, st] of icuFix) {
      fixture(0, 6.98, z, st === 'dead');
      const dim = st === 'on' ? [0.4, 0.45, 0.42] : [0.68, 0.77, 0.72];
      addLight(0, 6.7, z, dim, 7, st, z === -46);
    }
    // severed cables hanging from the ceiling, swaying (animated in update)
    const cableSpots = [[-0.7, -44.2], [0.8, -50.6], [-0.4, -57.4], [0.5, -41.2]];
    for (const [cx, cz] of cableSpots) {
      const len = rnd(0.7, 1.5);
      const r = Eng.add(Eng.meshCube, M4.ident(), [0.07, 0.07, 0.08]);
      cables.push({ r: r, x: cx, y: 7.0, z: cz, len: len, phase: rnd(6.28), freq: rnd(0.6, 1.2), amp: rnd(0.1, 0.22) });
    }
    exitSign(0, 6.4, -62.05);
    // the 3 hinged door leafs (closed initially)
    makeDoor(-1.6, 4, -41.5, Math.PI / 2, 3, [-1.65, 5.05, -42, 0.24, 2.1, 1.14], false);
    makeDoor(1.6, 4, -49.5, -Math.PI / 2, 3, [1.65, 5.05, -49, 0.24, 2.1, 1.14], false);
    makeDoor(-1.6, 4, -55.5, Math.PI / 2, 3, [-1.65, 5.05, -56, 0.24, 2.1, 1.14], false);

    /* ================= ZONE 4 — ROOF ACCESS (ramp 4 -> 7, z -62..-67) ================= */
    ceilB(0, 10.1, -64.7, 4.6, 0.2, 5.4);
    wall(-2.3, 7, -64.7, 0.2, 6.0, 5.4);
    wall(2.3, 7, -64.7, 0.2, 6.0, 5.4);
    wall(-1.95, 7, -62, 0.7, 6.0, 0.2);
    wall(1.95, 7, -62, 0.7, 6.0, 0.2);
    wall(0, 8.05, -62, 3.2, 3.9, 0.2);            // header over ICU entry
    wall(-1.425, 8.5, -67, 1.75, 3.0, 0.2);       // heavy-door wall
    wall(1.425, 8.5, -67, 1.75, 3.0, 0.2);
    wall(0, 9.55, -67, 1.1, 0.9, 0.2);            // header
    ramp(-62, 4, -67, 7, 2.8);
    // pipes along wall
    plain(2.05, 7.5, -64.5, 0.14, 5.0, 0.14, [0.4, 0.42, 0.44]);
    plain(-2.05, 6.5, -63.5, 0.1, 3.0, 0.1, [0.4, 0.42, 0.44]);
    fixture(0, 9.98, -64.5, false);
    addLight(0, 9.6, -64.5, [0.45, 0.5, 0.47], 7, 'buzz');
    exitSign(0, 9.3, -66.88);
    bloodPool(0.5, 4, -62.4, 1.2);
    wallBlood(1.38, 6.2, -64.5, 0.5, 0.7, -Math.PI / 2, 0.7);
    // heavy door at top (hinge left, swings out onto roof)
    makeDoor(-0.5, 7, -67, 0, 4, [0, 8.05, -67, 1.14, 2.1, 0.2], true);

    /* ================= ZONE 5 — ROOFTOP (y=7, z -66..-84) ================= */
    RB.box(0, 6.85, -75, 18.6, 0.3, 18.6, [1, 1, 1]);
    // parapets 1.1 m
    const parapet = [1, 1, 1];
    RB.box(0, 7.55, -84.15, 18.6, 1.1, 0.3, parapet); col(0, 7.55, -84.15, 18.6, 1.1, 0.3);
    RB.box(-5.8, 7.55, -65.85, 7.0, 1.1, 0.3, parapet); col(-5.8, 7.55, -65.85, 7.0, 1.1, 0.3);
    RB.box(5.8, 7.55, -65.85, 7.0, 1.1, 0.3, parapet); col(5.8, 7.55, -65.85, 7.0, 1.1, 0.3);
    RB.box(9.15, 7.55, -75, 0.3, 1.1, 18.6, parapet); col(9.15, 7.55, -75, 0.3, 1.1, 18.6);
    RB.box(-9.15, 7.55, -75, 0.3, 1.1, 18.6, parapet); col(-9.15, 7.55, -75, 0.3, 1.1, 18.6);
    // helipad painted quad
    Eng.add(Eng.meshQuad, M4.trs([0, 7.012, -78], [-Math.PI / 2, 0, 0], [6.2, 6.2, 1]),
      [1, 1, 1], { tex: T.heli, emissive: 0.04 });
    // AC units / vents
    metal(-4.5, 7.6, -74, 1.6, 1.2, 1.2, [0.6, 0.62, 0.64], 0, true);
    plain(-4.5, 8.22, -74, 1.4, 0.06, 1.0, [0.25, 0.26, 0.28]);
    metal(5, 7.7, -75.5, 2.0, 1.4, 1.4, [0.58, 0.6, 0.62], 0, true);
    plain(5, 8.42, -75.5, 1.7, 0.06, 1.1, [0.25, 0.26, 0.28]);
    metal(-5, 7.5, -79.5, 1.4, 1.0, 1.4, [0.6, 0.62, 0.64], 0, true);
    plain(2.5, 7.4, -82, 0.4, 0.8, 0.4, [0.5, 0.52, 0.54], 0, true);
    plain(-2.8, 7.35, -82.5, 0.36, 0.7, 0.36, [0.5, 0.52, 0.54], 0, true);
    // antenna + blinking beacon
    plain(7.8, 8.6, -83, 0.07, 3.2, 0.07, [0.4, 0.42, 0.44]);
    beacon = Eng.add(Eng.meshQuad, M4.trs([7.8, 10.25, -83], null, [0.14, 0.14, 1]),
      [1, 0.1, 0.06], { emissive: 1, doubleSided: true });
    // distant city glow — dim emissive quads on the horizon
    const city = [
      [-38, 5, 26, 11, [0.3, 0.16, 0.07]],
      [-14, 6, 18, 14, [0.24, 0.13, 0.06]],
      [8, 4.5, 22, 9, [0.28, 0.15, 0.08]],
      [30, 6, 16, 12, [0.1, 0.12, 0.18]],
      [46, 4, 14, 8, [0.2, 0.11, 0.05]]
    ];
    for (const [x, y, w, h, c] of city) {
      Eng.add(Eng.meshQuad, M4.trs([x, y, -120], null, [w, h, 1]), c, { emissive: 1 });
    }
    addLight(0, 5, -116, [0.3, 0.15, 0.06], 70, 'steady');

    /* ----- commit merged meshes ----- */
    Eng.add(FB.build(), M4.ident(), [1, 1, 1], { tex: T.floor });
    Eng.add(WB.build(), M4.ident(), [1, 1, 1], { tex: T.wall });
    Eng.add(CB.build(), M4.ident(), [1, 1, 1], { tex: T.ceil });
    Eng.add(PB.build(), M4.ident(), [1, 1, 1]);
    Eng.add(RB.build(), M4.ident(), [1, 1, 1], { tex: T.roof });
    Eng.add(MB.build(), M4.ident(), [1, 1, 1], { tex: T.metal });

    /* ----- pickups: 2 medkits + 3 ammo ----- */
    function pickup(x, z, type) {
      const y = floorHeight(x, z);
      const p = { pos: [x, y + 0.12, z], type: type, taken: false, r: null, baseY: y + 0.12, phase: rnd(6), extra: [] };
      if (type === 'medkit') {
        p.r = Eng.add(Eng.meshCube, M4.trs(p.pos, null, [0.32, 0.2, 0.22]), [0.88, 0.88, 0.85], { emissive: 0.12 });
        p.extra.push(Eng.add(Eng.meshCube, M4.ident(), [0.78, 0.08, 0.08], { emissive: 0.3 }));
        p.extra.push(Eng.add(Eng.meshCube, M4.ident(), [0.78, 0.08, 0.08], { emissive: 0.3 }));
      } else {
        p.r = Eng.add(Eng.meshCube, M4.trs(p.pos, null, [0.34, 0.18, 0.22]), [0.34, 0.36, 0.22], { emissive: 0.08 });
        p.extra.push(Eng.add(Eng.meshCube, M4.ident(), [0.5, 0.52, 0.34], { emissive: 0.1 }));
      }
      pickups.push(p);
      return p;
    }
    pickup(3.9, 1.2, 'medkit');       // lobby, by the windows
    pickup(-4.5, -56, 'medkit');      // ICU left room
    pickup(4.6, -13, 'ammo');         // ward right room
    pickup(1.7, -31.4, 'ammo');       // stairwell landing
    pickup(2.6, -69.5, 'ammo');       // rooftop, near exit

    /* ----- waypoint graph (bidirectional, zone-tagged) ----- */
    // lobby
    const L0 = wp(0, 7.6, 0), L1 = wp(0, 4, 0), L2 = wp(0, 0.2, 0);
    const L3 = wp(-4.6, 7, 0), L4 = wp(4.6, 7, 0), L5 = wp(-4.6, 0.8, 0), L6 = wp(4.6, 0.8, 0);
    link(L0, L1); link(L1, L2); link(L0, L3); link(L0, L4);
    link(L1, L5); link(L1, L6); link(L3, L5); link(L4, L6); link(L2, L5); link(L2, L6);
    // ward corridor centerline, ~3 m spacing
    const Cz = [-2, -5, -8, -11, -14, -17, -20, -23, -26, -29, -30.8];
    const C = Cz.map(z => wp(0, z, 1));
    chain(C); link(L2, C[0]);
    // ward room centers -> corridor nodes whose straight line passes through the doorway
    for (const zc of wardZ) {
      const near = [];
      for (let i = 0; i < C.length; i++) {
        if (Math.abs(Cz[i] - zc) > 2.2) continue;
        const crossZ = zc + 0.5 * (Cz[i] - zc); // where the line from x=±3.2 crosses x=±1.6
        if (Math.abs(crossZ - zc) <= 0.8) near.push(i);
      }
      for (const sgn of [-1, 1]) {
        const r = wp(sgn * 3.2, zc, 1);
        for (const i of near) link(r, C[i]);
      }
    }
    // stairwell ramp nodes
    const S1 = wp(0, -31.6, 2), S2 = wp(0, -34.5, 2);
    link(C[C.length - 1], S1); link(S1, S2);
    // ICU corridor (doorway nodes at -42, -49, -56)
    const Iz = [-37.6, -40.5, -42, -45, -49, -52.5, -56, -59, -61.5];
    const I = Iz.map(z => wp(0, z, 3));
    chain(I); link(S2, I[0]);
    link(wp(-3.0, -42, 3), I[2]);
    link(wp(3.0, -49, 3), I[4]);
    link(wp(-3.0, -56, 3), I[6]);
    // roof access ramp nodes
    const R1 = wp(0, -62.6, 4), R2 = wp(0, -64.5, 4), R3 = wp(0, -67.6, 5);
    link(I[I.length - 1], R1); link(R1, R2); link(R2, R3);
    // rooftop
    const T1 = wp(0, -69.5, 5), T2 = wp(0, -72.5, 5), T3 = wp(0, -78, 5);
    const T4 = wp(-6, -70, 5), T5 = wp(6, -70, 5), T6 = wp(-7, -76, 5), T7 = wp(7, -76, 5);
    const T8 = wp(-6, -81.5, 5), T9 = wp(6, -81.5, 5);
    link(R3, T1); link(T1, T2); link(T2, T3);
    link(T1, T4); link(T1, T5); link(T4, T6); link(T5, T7);
    link(T6, T8); link(T7, T9); link(T8, T3); link(T9, T3);
    link(T6, T3); link(T7, T3); link(T4, T8);

    /* ----- spawn points (feet Y, min zone) ----- */
    sp(-5, 7.5, 0); sp(5, 7.5, 0); sp(-5, 0.5, 0); sp(5, 0.5, 0);
    sp(-3, 8.6, 0); sp(3, 8.6, 0);                       // behind player start
    sp(-6.8, -3, 1); sp(6.8, -7, 1); sp(-6.8, -19, 1); sp(6.8, -23, 1); sp(-6.8, -27, 1);
    sp(1.1, -20, 1); sp(0, -30.5, 1);
    sp(1, -31.5, 2); sp(-1, -31.5, 2);
    sp(-6.5, -40.5, 3); sp(6.3, -47.3, 3); sp(-6.3, -54.3, 3); sp(1.1, -45, 3); sp(0, -61, 3);
    sp(0.9, -63, 4); sp(-0.9, -63.5, 4);
    sp(-7.5, -68, 5); sp(7.5, -68, 5); sp(-7.5, -82.5, 5); sp(7.5, -82.5, 5); sp(0, -83, 5);

    /* ----- ambient / fog baseline ----- */
    Eng.ambient[0] = 0.035; Eng.ambient[1] = 0.04; Eng.ambient[2] = 0.055;
    Eng.fog.color[0] = 0.012; Eng.fog.color[1] = 0.014; Eng.fog.color[2] = 0.02;
    Eng.fog.density = 0.05;

    /* ----- public data ----- */
    Level.data = {
      spawn: { pos: [0, 1.62, 8.2], yaw: 0 },
      waypoints: waypoints,
      spawnPoints: spawnPoints,
      zones: [
        { id: 0, name: 'LOBBY', floorY: 0 },
        { id: 1, name: 'WEST WARD', floorY: 0 },
        { id: 2, name: 'STAIRWELL A', floorY: 0 },
        { id: 3, name: 'ICU', floorY: 4 },
        { id: 4, name: 'ROOF ACCESS', floorY: 4 },
        { id: 5, name: 'ROOFTOP', floorY: 7 }
      ],
      doors: doors,
      pickups: pickups,
      helipad: { pos: [0, 7, -78], r: 2.8 }
    };
  }

  /* ---------------- scripted scares ---------------- */
  function doScare() {
    const pp = G.player.pos;
    let best = null, bd = 30;
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      if (!d.closed) continue;
      const dist = V3.dist(d.pos, pp);
      if (dist < bd) { bd = dist; best = d; }
    }
    if (!best) return false;
    openDoor(best, true);
    if (window.AudioSys && AudioSys.doorBang) AudioSys.doorBang(best.pos);
    G.emitNoise(best.pos, 26, 'door');
    if (bd < 12 && window.CameraRig && CameraRig.addShake) CameraRig.addShake(0.3);
    return true;
  }

  /* ---------------- rooftop wind gust (called by Director) ---------------- */
  function gust() {
    if (!built || !Eng.fx) return;
    const ang = rnd(Math.PI * 2);
    const wx = Math.cos(ang), wz = Math.sin(ang);
    const spd = rnd(3.5, 6.5);
    const n = 16 + (Math.random() * 8 | 0);
    for (let i = 0; i < n; i++) {
      const paper = Math.random() < 0.6;
      Eng.fx.spawn({
        p: [rnd(-8.5, 8.5), rnd(7.05, 8.6), rnd(-83.5, -67)],
        v: [wx * spd * rnd(0.6, 1.2), rnd(0.4, 1.6), wz * spd * rnd(0.6, 1.2)],
        col: paper ? [0.72, 0.7, 0.64, 0.85] : [0.3, 0.3, 0.28, 0.8],
        size: paper ? rnd(0.05, 0.11) : rnd(0.02, 0.05),
        life: rnd(1.6, 3.2), grav: paper ? 0.5 : 2.2, drag: 0.6
      });
    }
  }

  /* ============================================================
     UPDATE
     ============================================================ */
  function update(dt) {
    if (!built) return;
    const t = Eng.time;
    const zone = G.player.zone;

    updateLights(dt);

    // ambient / fog: cold blue rooftop vs warm-dark interior
    const k = Math.min(1, dt * 1.5);
    const roof = zone === 5;
    const ta = roof ? [0.05, 0.065, 0.1] : [0.035, 0.04, 0.055];
    const tf = roof ? [0.02, 0.025, 0.045] : [0.012, 0.014, 0.02];
    const td = roof ? 0.03 : 0.05;
    for (let i = 0; i < 3; i++) {
      Eng.ambient[i] += (ta[i] - Eng.ambient[i]) * k;
      Eng.fog.color[i] += (tf[i] - Eng.fog.color[i]) * k;
    }
    Eng.fog.density += (td - Eng.fog.density) * k;

    // doors: hinge animation + bang shake
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      if (d.banging > 0) d.banging = Math.max(0, d.banging - dt);
      if (d.open !== d.target) {
        const dir = d.target > d.open ? 1 : -1;
        d.open += dir * d.spd * dt;
        if ((dir > 0 && d.open >= d.target) || (dir < 0 && d.open <= d.target)) d.open = d.target;
        d.swing = d.open * 1.85 * d._dir;
      }
      if (d.open !== d._last || d.banging > 0) {
        doorModels(d);
        d._last = d.open;
      }
    }

    // heavy roof door creaks open as the player approaches (guarantees the path on foot)
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      if (d.zone === 4 && d.closed && V3.distXZ(G.player.pos, d.pos) < 2.2) openDoor(d, false);
    }

    // scripted scares: first ICU entry, then every ~25 s
    if (G.state === 'play') {
      if (zone >= 3 && !scare.entered) { scare.entered = true; scare.delay = 0.5; }
      if (scare.entered) {
        if (scare.delay > 0) {
          scare.delay -= dt;
          if (scare.delay <= 0) { doScare(); scare.timer = rnd(22, 28); }
        } else if (zone >= 3) {
          scare.timer -= dt;
          if (scare.timer <= 0) { doScare(); scare.timer = rnd(22, 28); }
        }
      }
      // rare quiet glass tinkle in ward / ICU
      tinkleT -= dt;
      if (tinkleT <= 0) {
        tinkleT = rnd(20, 45);
        if ((zone === 1 || zone === 3) && window.AudioSys && AudioSys.glassBreak) {
          const pp = G.player.pos;
          AudioSys.glassBreak([pp[0] + rnd(-6, 6), pp[1] - 1, pp[2] + rnd(-6, 6)]);
        }
      }
    }

    // pickups: bob + spin, hide when taken
    for (let i = 0; i < pickups.length; i++) {
      const p = pickups[i];
      if (p.taken) {
        if (p.r) p.r.visible = false;
        for (let j = 0; j < p.extra.length; j++) p.extra[j].visible = false;
        continue;
      }
      const y = p.baseY + Math.sin(t * 2.2 + p.phase) * 0.045;
      const ry = t * 0.9 + p.phase;
      const pos = [p.pos[0], y, p.pos[2]];
      p.r.model = M4.trs(pos, [0, ry, 0], p.type === 'medkit' ? [0.32, 0.2, 0.22] : [0.34, 0.18, 0.22]);
      if (p.type === 'medkit') {
        p.extra[0].model = M4.trs([pos[0], y + 0.105, pos[2]], [0, ry, 0], [0.2, 0.02, 0.06]);
        p.extra[1].model = M4.trs([pos[0], y + 0.105, pos[2]], [0, ry, 0], [0.06, 0.02, 0.2]);
      } else {
        p.extra[0].model = M4.trs([pos[0], y + 0.095, pos[2]], [0, ry, 0], [0.35, 0.03, 0.23]);
      }
    }

    // hanging cable sway in ICU (pendulum from ceiling anchor)
    for (let i = 0; i < cables.length; i++) {
      const c = cables[i];
      const ax = Math.sin(t * c.freq + c.phase) * c.amp;
      const az = Math.cos(t * c.freq * 0.83 + c.phase * 1.7) * c.amp * 0.7;
      c.r.model = M4.mul(
        M4.trs([c.x, c.y, c.z], [ax, 0, az], null),
        M4.trs([0, -c.len / 2, 0], null, [0.025, c.len, 0.025]));
    }

    // sparse ambient dust motes near the player (interior)
    dustT -= dt;
    if (dustT <= 0) {
      dustT = rnd(0.25, 0.6);
      if (zone < 5 && Eng.fx) {
        const pp = G.player.pos;
        const fy = floorHeight(pp[0], pp[2]);
        Eng.fx.spawn({
          p: [pp[0] + rnd(-5, 5), fy + rnd(0.3, 2.4), pp[2] + rnd(-5, 5)],
          v: [rnd(-0.05, 0.05), rnd(-0.02, 0.01), rnd(-0.05, 0.05)],
          col: [0.55, 0.55, 0.5, 0.1], size: rnd(0.012, 0.03),
          life: rnd(3, 6), grav: 0.015, drag: 0.2
        });
      }
    }

    // rooftop antenna beacon blink
    if (beacon) beacon.emissive = Math.sin(t * 2.6) > 0.55 ? 1 : 0.12;
  }

  /* ---------------- public API ---------------- */
  Level.build = build;
  Level.update = update;
  Level.moveCircle = moveCircle;
  Level.floorHeight = floorHeight;
  Level.zoneAt = zoneAt;
  Level.raycast = raycast;
  Level.raycastHit = raycastHit;
  Level.surfaceAt = surfaceAt;
  Level.gust = gust;
  Level.addDecal = addDecal;

  window.Level = Level;
})();