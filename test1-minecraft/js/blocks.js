/* blocks.js — block registry + ALL procedural textures (16x16 pixel art), atlas, icons. FOUNDATION. */
window.Blocks = (function () {
  'use strict';

  const TILE = 16, ATLAS_TILES = 16, ATLAS_SIZE = TILE * ATLAS_TILES;

  /* ---------- pixel helpers ---------- */
  function px(d, x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x > 15 || y > 15) return;
    const i = (y * 16 + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a === undefined ? 255 : a;
  }
  function jit(rnd, v, amt) { return Math.max(0, Math.min(255, v + (rnd() * 2 - 1) * amt)); }
  function fillNoise(d, rnd, r, g, b, amt, a) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const j = (rnd() * 2 - 1) * amt;
      px(d, x, y, r + j, g + j, b + j, a);
    }
  }
  function blob(d, rnd, cx, cy, rad, dr, dg, db) {
    for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
      if (x * x + y * y <= rad * rad + rnd() * 1.5) {
        const i = ((cy + y) * 16 + (cx + x)) * 4;
        if (cx + x < 0 || cx + x > 15 || cy + y < 0 || cy + y > 15) continue;
        d[i] = Math.max(0, d[i] + dr); d[i + 1] = Math.max(0, d[i + 1] + dg); d[i + 2] = Math.max(0, d[i + 2] + db);
      }
    }
  }

  let tileSeed = 1337;
  function makeTile(fn) {
    const c = document.createElement('canvas');
    c.width = c.height = TILE;
    const g = c.getContext('2d');
    const img = g.createImageData(TILE, TILE);
    fn(img.data, Util.mulberry32(tileSeed++));
    g.putImageData(img, 0, 0);
    return c;
  }

  /* ---------- tile generators ---------- */
  const T = {};
  T.grassTop = makeTile((d, rnd) => {
    fillNoise(d, rnd, 124, 189, 91, 14);
    for (let k = 0; k < 10; k++) blob(d, rnd, (rnd() * 16) | 0, (rnd() * 16) | 0, 1, -18, -14, -18);
    for (let k = 0; k < 8; k++) px(d, (rnd() * 16) | 0, (rnd() * 16) | 0, 150, 214, 112);
  });
  T.dirt = makeTile((d, rnd) => {
    fillNoise(d, rnd, 134, 96, 67, 13);
    for (let k = 0; k < 7; k++) blob(d, rnd, (rnd() * 16) | 0, (rnd() * 16) | 0, 1, -22, -18, -14);
    for (let k = 0; k < 5; k++) px(d, (rnd() * 16) | 0, (rnd() * 16) | 0, 160, 122, 90);
  });
  T.grassSide = makeTile((d, rnd) => {
    fillNoise(d, rnd, 134, 96, 67, 13);
    for (let k = 0; k < 6; k++) blob(d, rnd, (rnd() * 16) | 0, 5 + (rnd() * 11) | 0, 1, -22, -18, -14);
    for (let x = 0; x < 16; x++) {
      const depth = 3 + ((rnd() * 3) | 0);
      for (let y = 0; y < depth; y++) {
        const j = (rnd() * 2 - 1) * 14;
        px(d, x, y, 124 + j, 189 + j, 91 + j);
      }
      if (rnd() < 0.4) px(d, x, depth, 110, 168, 80);
    }
  });
  T.stone = makeTile((d, rnd) => {
    fillNoise(d, rnd, 127, 127, 127, 9);
    for (let k = 0; k < 7; k++) blob(d, rnd, (rnd() * 16) | 0, (rnd() * 16) | 0, 1 + ((rnd() * 2) | 0), -17, -17, -17);
    for (let k = 0; k < 4; k++) blob(d, rnd, (rnd() * 16) | 0, (rnd() * 16) | 0, 1, 12, 12, 12);
  });
  T.cobble = makeTile((d, rnd) => {
    fillNoise(d, rnd, 56, 56, 56, 6);
    const stones = [];
    for (let gy = 0; gy < 2; gy++) for (let gx = 0; gx < 2; gx++)
      stones.push([gx * 8 + ((rnd() * 2) | 0), gy * 8 + ((rnd() * 2) | 0), 5 + ((rnd() * 3) | 0), 5 + ((rnd() * 3) | 0)]);
    stones.push([6 + ((rnd() * 3) | 0), 6 + ((rnd() * 3) | 0), 3, 3]);
    for (const [sx, sy, w, h] of stones) {
      const base = 105 + ((rnd() * 45) | 0);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if ((x === 0 || x === w - 1) && (y === 0 || y === h - 1)) continue;
        let v = base + (rnd() * 2 - 1) * 10;
        if (y === 0) v += 18; if (y === h - 1) v -= 20;
        px(d, sx + x, sy + y, v, v, v);
      }
    }
  });
  T.planks = makeTile((d, rnd) => {
    fillNoise(d, rnd, 178, 143, 90, 8);
    for (let b = 0; b < 4; b++) {
      const y0 = b * 4;
      for (let k = 0; k < 3; k++) {
        const gy = y0 + ((rnd() * 3) | 0), gx = (rnd() * 10) | 0, len = 3 + ((rnd() * 5) | 0);
        for (let x = gx; x < Math.min(16, gx + len); x++) px(d, x, gy, 150, 118, 70);
      }
      for (let x = 0; x < 16; x++) { px(d, x, y0 + 3, 110, 86, 50); }
      if (rnd() < 0.6) { const kx = (rnd() * 14) | 0, ky = y0 + 1; px(d, kx, ky, 128, 99, 58); px(d, kx + 1, ky, 140, 110, 66); }
    }
  });
  T.logSide = makeTile((d, rnd) => {
    fillNoise(d, rnd, 104, 82, 54, 8);
    for (let x = 0; x < 16; x++) {
      if (rnd() < 0.38) {
        const v = 78 + ((rnd() * 14) | 0);
        for (let y = 0; y < 16; y++) if (rnd() < 0.85) px(d, x, y, v, v * 0.8, v * 0.54);
      }
    }
    for (let k = 0; k < 3; k++) { const x = (rnd() * 16) | 0; for (let y = 0; y < 16; y++) px(d, x, y, 122, 98, 66); }
  });
  T.logTop = makeTile((d, rnd) => {
    fillNoise(d, rnd, 178, 143, 90, 7);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (r > 6.5) px(d, x, y, 104 + (rnd() * 12), 82 + (rnd() * 10), 54);
      else if ((r | 0) % 2 === 0) px(d, x, y, 150 + (rnd() * 10), 118 + (rnd() * 8), 72);
    }
    px(d, 7, 7, 128, 99, 58); px(d, 8, 8, 128, 99, 58);
  });
  T.leaves = makeTile((d, rnd) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (rnd() < 0.16) { px(d, x, y, 0, 0, 0, 0); continue; }
      const t = rnd();
      let r = 52, g = 118, b = 34;
      if (t < 0.3) { r = 40; g = 96; b = 26; } else if (t > 0.8) { r = 70; g = 140; b = 44; }
      const j = (rnd() * 2 - 1) * 10;
      px(d, x, y, r + j, g + j, b + j, 255);
    }
  });
  T.sand = makeTile((d, rnd) => {
    fillNoise(d, rnd, 219, 211, 160, 9);
    for (let k = 0; k < 6; k++) px(d, (rnd() * 16) | 0, (rnd() * 16) | 0, 196, 186, 134);
    for (let k = 0; k < 4; k++) px(d, (rnd() * 16) | 0, (rnd() * 16) | 0, 236, 230, 186);
  });
  T.glass = makeTile((d, rnd) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(d, x, y, 200, 228, 240, 16);
    for (let i = 0; i < 16; i++) {
      px(d, i, 0, 220, 240, 248, 210); px(d, i, 15, 220, 240, 248, 210);
      px(d, 0, i, 220, 240, 248, 210); px(d, 15, i, 220, 240, 248, 210);
    }
    for (let k = 0; k < 6; k++) px(d, 2 + k, 3 + k, 255, 255, 255, 110);
    for (let k = 0; k < 4; k++) px(d, 9 + k, 2 + k, 255, 255, 255, 80);
  });
  T.brick = makeTile((d, rnd) => {
    fillNoise(d, rnd, 150, 86, 72, 9);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const row = (y / 4) | 0;
      const off = (row % 2) * 4;
      if (y % 4 === 3 || ((x + off) % 8 === 7)) px(d, x, y, 178 + (rnd() * 10), 172 + (rnd() * 10), 166 + (rnd() * 10));
    }
  });
  T.water = makeTile((d, rnd) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const j = (rnd() * 2 - 1) * 10;
      const wave = Math.sin((x + y * 0.6) * 0.9) * 6;
      px(d, x, y, 34 + j + wave, 86 + j + wave, 192 + j, 205);
    }
  });
  T.bedrock = makeTile((d, rnd) => {
    const pal = [[26, 26, 26], [52, 52, 52], [74, 74, 74], [38, 38, 38], [60, 60, 60]];
    for (let y = 0; y < 16; y += 2) for (let x = 0; x < 16; x += 2) {
      const c = pal[(rnd() * pal.length) | 0];
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++)
        px(d, x + dx, y + dy, c[0] + (rnd() * 8), c[1] + (rnd() * 8), c[2] + (rnd() * 8));
    }
  });
  function oreTile(fleckR, fleckG, fleckB) {
    return makeTile((d, rnd) => {
      fillNoise(d, rnd, 127, 127, 127, 9);
      for (let k = 0; k < 5; k++) blob(d, rnd, (rnd() * 16) | 0, (rnd() * 16) | 0, 1, -15, -15, -15);
      const spots = 3 + ((rnd() * 2) | 0);
      for (let s = 0; s < spots; s++) {
        const cx = 2 + ((rnd() * 12) | 0), cy = 2 + ((rnd() * 12) | 0);
        const n = 3 + ((rnd() * 3) | 0);
        for (let k = 0; k < n; k++) {
          const ox = cx + ((rnd() * 3) | 0) - 1, oy = cy + ((rnd() * 3) | 0) - 1;
          const j = (rnd() * 2 - 1) * 14;
          px(d, ox, oy, fleckR + j, fleckG + j, fleckB + j);
        }
      }
    });
  }
  T.coalOre = oreTile(28, 28, 28);
  T.ironOre = oreTile(216, 175, 147);
  T.snow = makeTile((d, rnd) => {
    fillNoise(d, rnd, 244, 250, 252, 5);
    for (let k = 0; k < 5; k++) px(d, (rnd() * 16) | 0, (rnd() * 16) | 0, 228, 236, 244);
  });
  T.snowSide = makeTile((d, rnd) => {
    fillNoise(d, rnd, 134, 96, 67, 13);
    for (let x = 0; x < 16; x++) {
      const depth = 3 + ((rnd() * 3) | 0);
      for (let y = 0; y < depth; y++) {
        const j = (rnd() * 2 - 1) * 5;
        px(d, x, y, 244 + j, 250 + j, 252 + j);
      }
    }
  });
  T.gravel = makeTile((d, rnd) => {
    const pal = [[126, 122, 118], [98, 94, 90], [148, 142, 136], [86, 80, 76], [112, 100, 92], [160, 154, 148]];
    for (let y = 0; y < 16; y += 2) for (let x = 0; x < 16; x += 2) {
      const c = pal[(rnd() * pal.length) | 0];
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const j = (rnd() * 2 - 1) * 8;
        px(d, x + dx, y + dy, c[0] + j, c[1] + j, c[2] + j);
      }
    }
  });
  function crackTile(stage) {
    return makeTile((d, rnd) => {
      for (let i = 0; i < d.length; i += 4) { d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 0; }
      const lines = 2 + stage * 2;
      for (let l = 0; l < lines; l++) {
        let x = 6 + ((rnd() * 5) | 0), y = 6 + ((rnd() * 5) | 0);
        let dx = rnd() < 0.5 ? -1 : 1, dy = rnd() < 0.5 ? -1 : 1;
        const len = 4 + stage * 2 + ((rnd() * 3) | 0);
        for (let s = 0; s < len; s++) {
          px(d, x, y, 15, 15, 15, 190);
          if (rnd() < 0.35) { const t = dx; dx = dy; dy = -t; }
          if (rnd() < 0.5) x += dx; else y += dy;
          if (rnd() < 0.2 && stage > 1) px(d, x + 1, y, 15, 15, 15, 130);
        }
      }
    });
  }
  T.crack0 = crackTile(0); T.crack1 = crackTile(1); T.crack2 = crackTile(2); T.crack3 = crackTile(3);

  /* ---------- atlas ---------- */
  const tileList = [
    T.grassTop, T.grassSide, T.dirt, T.stone, T.cobble, T.planks, T.logSide, T.logTop,
    T.leaves, T.sand, T.glass, T.brick, T.water, T.bedrock, T.coalOre, T.ironOre,
    T.snow, T.snowSide, T.gravel, T.crack0, T.crack1, T.crack2, T.crack3
  ];
  const TILE_IDX = {};
  tileList.forEach((c, i) => { TILE_IDX[c === T.grassTop ? 'grassTop' : i] = i; });
  const atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = atlasCanvas.height = ATLAS_SIZE;
  const ag = atlasCanvas.getContext('2d');
  tileList.forEach((c, i) => ag.drawImage(c, (i % ATLAS_TILES) * TILE, ((i / ATLAS_TILES) | 0) * TILE));

  function tileUV(t) {
    const u0 = (t % ATLAS_TILES) / ATLAS_TILES, v0 = ((t / ATLAS_TILES) | 0) / ATLAS_TILES;
    return [u0, v0, u0 + 1 / ATLAS_TILES, v0 + 1 / ATLAS_TILES];
  }
  const CRACK_TILES = [19, 20, 21, 22];

  /* ---------- block registry ---------- */
  /* tiles: [top, side, bottom] atlas indices */
  const BY_ID = [];
  function def(id, name, o) {
    BY_ID[id] = Object.assign({
      id, name, solid: true, opaque: true, pass: 'solid',
      hardness: 1, sound: 'stone', tiles: { top: 0, side: 0, bottom: 0 }, color: [128, 128, 128]
    }, o);
  }
  def(0, 'Air', { solid: false, opaque: false, hardness: 0 });
  def(1, 'Grass Block', { tiles: { top: 0, side: 1, bottom: 2 }, hardness: 0.7, sound: 'grass', color: [124, 189, 91] });
  def(2, 'Dirt', { tiles: { top: 2, side: 2, bottom: 2 }, hardness: 0.55, sound: 'grass', color: [134, 96, 67] });
  def(3, 'Stone', { tiles: { top: 3, side: 3, bottom: 3 }, hardness: 1.6, color: [127, 127, 127] });
  def(4, 'Cobblestone', { tiles: { top: 4, side: 4, bottom: 4 }, hardness: 1.8, color: [110, 110, 110] });
  def(5, 'Oak Planks', { tiles: { top: 5, side: 5, bottom: 5 }, hardness: 1.2, sound: 'wood', color: [178, 143, 90] });
  def(6, 'Oak Log', { tiles: { top: 7, side: 6, bottom: 7 }, hardness: 1.4, sound: 'wood', color: [104, 82, 54] });
  def(7, 'Oak Leaves', { tiles: { top: 8, side: 8, bottom: 8 }, opaque: false, pass: 'cutout', hardness: 0.35, sound: 'grass', color: [52, 118, 34] });
  def(8, 'Sand', { tiles: { top: 9, side: 9, bottom: 9 }, hardness: 0.5, sound: 'sand', color: [219, 211, 160] });
  def(9, 'Glass', { tiles: { top: 10, side: 10, bottom: 10 }, opaque: false, pass: 'trans', hardness: 0.4, sound: 'glass', color: [200, 228, 240] });
  def(10, 'Bricks', { tiles: { top: 11, side: 11, bottom: 11 }, hardness: 2.0, color: [150, 86, 72] });
  def(11, 'Water', { tiles: { top: 12, side: 12, bottom: 12 }, solid: false, opaque: false, pass: 'trans', hardness: Infinity, sound: 'glass', color: [46, 100, 205] });
  def(12, 'Bedrock', { tiles: { top: 13, side: 13, bottom: 13 }, hardness: Infinity, color: [40, 40, 40] });
  def(13, 'Coal Ore', { tiles: { top: 14, side: 14, bottom: 14 }, hardness: 2.2, color: [90, 90, 90] });
  def(14, 'Iron Ore', { tiles: { top: 15, side: 15, bottom: 15 }, hardness: 2.6, color: [150, 130, 115] });
  def(15, 'Snowy Grass', { tiles: { top: 16, side: 17, bottom: 2 }, hardness: 0.6, sound: 'grass', color: [244, 250, 252] });
  def(16, 'Gravel', { tiles: { top: 18, side: 18, bottom: 18 }, hardness: 0.7, sound: 'gravel', color: [126, 122, 118] });

  /* ---------- sun / moon ---------- */
  const sunCanvas = document.createElement('canvas');
  sunCanvas.width = sunCanvas.height = 64;
  {
    const g = sunCanvas.getContext('2d');
    const img = g.createImageData(64, 64); const d = img.data;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const dx = Math.abs(x - 31.5), dy = Math.abs(y - 31.5);
      const m = Math.max(dx, dy);
      const i = (y * 64 + x) * 4;
      if (m < 15) { d[i] = 255; d[i + 1] = 246; d[i + 2] = 205; d[i + 3] = 255; }
      else {
        const a = Math.max(0, 1 - (m - 15) / 16);
        d[i] = 255; d[i + 1] = 208; d[i + 2] = 110; d[i + 3] = (a * a * 150) | 0;
      }
    }
    g.putImageData(img, 0, 0);
  }
  const moonCanvas = document.createElement('canvas');
  moonCanvas.width = moonCanvas.height = 64;
  {
    const g = moonCanvas.getContext('2d');
    const img = g.createImageData(64, 64); const d = img.data;
    const rnd = Util.mulberry32(777);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const dx = Math.abs(x - 31.5), dy = Math.abs(y - 31.5);
      const m = Math.max(dx, dy);
      const i = (y * 64 + x) * 4;
      if (m < 12) {
        const j = (rnd() * 2 - 1) * 7;
        d[i] = 216 + j; d[i + 1] = 222 + j; d[i + 2] = 235 + j; d[i + 3] = 255;
      } else {
        const a = Math.max(0, 1 - (m - 12) / 16);
        d[i] = 180; d[i + 1] = 195; d[i + 2] = 225; d[i + 3] = (a * a * 90) | 0;
      }
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = 'rgba(160,170,190,0.8)';
    g.fillRect(24, 26, 4, 4); g.fillRect(34, 34, 5, 4); g.fillRect(30, 22, 3, 3); g.fillRect(38, 27, 3, 3);
  }

  /* ---------- clouds (tileable, blocky) ---------- */
  const cloudCanvas = document.createElement('canvas');
  cloudCanvas.width = cloudCanvas.height = 256;
  {
    const g = cloudCanvas.getContext('2d');
    const img = g.createImageData(256, 256); const d = img.data;
    const N = 16;
    const grid = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) grid[j * N + i] = Util.hash01(i, j, 0, 4242);
    const grid2 = new Float32Array(8 * 8);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) grid2[j * 8 + i] = Util.hash01(i, j, 7, 9191);
    function sampleWrap(gr, n, u, v) {
      const x = u * n, y = v * n;
      const x0 = Math.floor(x) % n, y0 = Math.floor(y) % n;
      const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
      const fx = Util.smoothstep(x - Math.floor(x)), fy = Util.smoothstep(y - Math.floor(y));
      const a = gr[y0 * n + x0], b = gr[y0 * n + x1], c = gr[y1 * n + x0], e = gr[y1 * n + x1];
      return Util.lerp(Util.lerp(a, b, fx), Util.lerp(c, e, fx), fy);
    }
    const vals = new Float32Array(N * N);
    for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
      const u = cx / N, v = cy / N;
      vals[cy * N + cx] = sampleWrap(grid, N, u, v) * 0.68 + sampleWrap(grid2, 8, u, v) * 0.32;
    }
    const at = (x, y) => vals[((y + N) % N) * N + ((x + N) % N)];
    for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
      const val = vals[cy * N + cx];
      /* dilate: cells touching a cloud core join it -> cohesive blocky slabs */
      const nearCore = at(cx + 1, cy) > 0.58 || at(cx - 1, cy) > 0.58 || at(cx, cy + 1) > 0.58 || at(cx, cy - 1) > 0.58;
      let a = 0;
      if (val > 0.58 || (val > 0.50 && nearCore)) a = 235;
      else if (val > 0.53 || (val > 0.46 && nearCore)) a = 120;
      for (let dy = 0; dy < 16; dy++) for (let dx = 0; dx < 16; dx++) {
        const i = ((cy * 16 + dy) * 256 + (cx * 16 + dx)) * 4;
        d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = a;
      }
    }
    g.putImageData(img, 0, 0);
  }

  /* ---------- isometric hotbar icon ---------- */
  function drawIcon(canvas, id) {
    const b = BY_ID[id]; if (!b || id === 0) return;
    const s = canvas.width;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, s, s);
    g.imageSmoothingEnabled = false;
    const P = {
      T: [0.5 * s, 0.06 * s], R: [0.95 * s, 0.28 * s], B: [0.5 * s, 0.5 * s], L: [0.05 * s, 0.28 * s],
      LB: [0.05 * s, 0.72 * s], RB: [0.95 * s, 0.72 * s], BB: [0.5 * s, 0.94 * s]
    };
    function face(tile, o, u, v, dark) {
      const sx = (tile % ATLAS_TILES) * TILE, sy = ((tile / ATLAS_TILES) | 0) * TILE;
      g.save();
      g.setTransform(u[0] - o[0], u[1] - o[1], v[0] - o[0], v[1] - o[1], o[0], o[1]);
      g.drawImage(atlasCanvas, sx, sy, TILE, TILE, 0, 0, 1, 1);
      if (dark > 0) { g.fillStyle = 'rgba(0,0,20,' + dark + ')'; g.fillRect(0, 0, 1, 1); }
      g.restore();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    face(b.tiles.top, P.L, P.T, P.B, 0);          // top: origin L, u→T, v→B
    face(b.tiles.side, P.L, P.B, P.LB, 0.22);     // left: origin L, u→B, v→LB
    face(b.tiles.side, P.B, P.R, P.BB, 0.42);     // right: origin B, u→R, v→BB
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  return {
    BY_ID, atlasCanvas, tileUV, CRACK_TILES,
    sunCanvas, moonCanvas, cloudCanvas, drawIcon,
    TILE, ATLAS_SIZE
  };
})();
