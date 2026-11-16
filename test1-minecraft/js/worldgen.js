/* worldgen.js — terrain, biomes, caves, ores, trees. AGENT worldgen.
   generate(cx,cz,seed) -> Uint8Array(16*128*16), idx = (y*16+z)*16+x (local x,z).
   Classic script IIFE; only depends on Util. */
window.WorldGen = (function () {
  'use strict';

  const CHUNK = 16, HEIGHT = 128, SEA = 46;
  const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, LOG = 6, LEAVES = 7, SAND = 8,
        WATER = 11, BEDROCK = 12, COAL = 13, IRON = 14, SNOW = 15, GRAVEL = 16;

  /* biome codes (numeric internally, names for the public API) */
  const B_PLAINS = 0, B_FOREST = 1, B_MOUNT = 2, B_OCEAN = 3, B_BEACH = 4;
  const BIOME_NAMES = ['plains', 'forest', 'mountains', 'ocean', 'beach'];

  /* ---- per-seed noise cache (reused across chunks; never allocated per chunk) ---- */
  const noiseCache = new Map();
  let curSeed = 1; // seed of the last generate() call; used by getHeight/biomeAt
  function noises(seed) {
    let n = noiseCache.get(seed);
    if (n) return n;
    n = {
      h:  new Util.Noise(seed),               // continental shape + ridged mountains
      m:  new Util.Noise(seed ^ 0x51ab3c7d),  // mountain mask
      b:  new Util.Noise(seed ^ 0x9e3779b9),  // moisture (forest biome)
      d:  new Util.Noise(seed ^ 0x85ebca6b),  // detail hills + cave entrances
      c1: new Util.Noise(seed ^ 0xc2b2ae35),  // spaghetti cave field 1 + cheese pockets
      c2: new Util.Noise(seed ^ 0x27d4eb2d)   // spaghetti cave field 2
    };
    if (noiseCache.size >= 4) noiseCache.delete(noiseCache.keys().next().value);
    noiseCache.set(seed, n);
    return n;
  }

  /* ---- column sampling (shared by generate / getHeight / biomeAt) ----
     Writes module temps instead of allocating objects. */
  let tH = 0, tMask = 0;
  function sampleTerrain(x, z) {
    const n = noises(curSeed);
    let cont = n.h.fbm2(x * 0.0022, z * 0.0022, 4, 2, 0.5);
    // stretch the negative side so ocean basins actually dip below sea level
    cont = cont > 0 ? cont * 0.55 : cont * 1.8;
    const hill = n.d.fbm2(x * 0.021, z * 0.021, 3, 2, 0.5);
    const mr = n.m.fbm2(x * 0.005, z * 0.005, 3, 2, 0.5);
    let mask = (mr - 0.08) / 0.5;
    mask = mask < 0 ? 0 : (mask > 1 ? 1 : mask);
    mask = mask * mask * (3 - 2 * mask); // smooth transition in/out of mountain regions
    const rr = n.h.fbm2(x * 0.011 + 37.7, z * 0.011 - 91.3, 4, 2, 0.5);
    let ridge = 1 - (rr < 0 ? -rr : rr); // ridged fbm
    ridge *= ridge;
    let h = 52 + cont * 13 + hill * 3.2 + mask * (10 + ridge * 42);
    if (h < SEA) h = SEA - (SEA - h) * 1.5; // deepen ocean basins a little
    h = Math.floor(h);
    tH = h < 5 ? 5 : (h > 108 ? 108 : h);
    tMask = mask;
  }
  function moistAt(x, z) {
    return noises(curSeed).b.fbm2(x * 0.008, z * 0.008, 3, 2, 0.5);
  }
  function biomeCode(h, mask, moist) {
    if (h < 44) return B_OCEAN;
    if (h <= 48) return B_BEACH; // within 2 of sea level
    if (mask > 0.55) return B_MOUNT;
    if (moist > 0.18) return B_FOREST;
    return B_PLAINS;
  }

  function getHeight(x, z) { sampleTerrain(x, z); return tH; }
  function biomeAt(x, z) {
    sampleTerrain(x, z);
    return BIOME_NAMES[biomeCode(tH, tMask, moistAt(x, z))];
  }

  /* ---- reusable scratch arrays for the chunk + tree margin (22x22 columns) ---- */
  const MARGIN = 3, SPAN = CHUNK + MARGIN * 2;
  const sH = new Int16Array(SPAN * SPAN);
  const sMask = new Float32Array(SPAN * SPAN);
  const sMoist = new Float32Array(SPAN * SPAN);

  /* ---- ore pass: deterministic vein seeds on a world-aligned 3-block grid ---- */
  function orePass(blocks, baseX, baseZ, seed, id, salt, chance, maxY) {
    const s = seed ^ salt;
    const x0 = Math.floor((baseX - 4) / 3) * 3, x1 = baseX + CHUNK + 4;
    const z0 = Math.floor((baseZ - 4) / 3) * 3, z1 = baseZ + CHUNK + 4;
    for (let gy = 3; gy < maxY; gy += 3) {
      for (let gz = z0; gz <= z1; gz += 3) {
        for (let gx = x0; gx <= x1; gx += 3) {
          if (Util.hash01(gx, gy, gz, s) >= chance) continue;
          const count = 3 + ((Util.hash01(gx, gy + 7, gz, s ^ 0x55aa) * 3) | 0); // 3..5 blocks
          let px = gx, py = gy, pz = gz;
          for (let k = 0; k < count; k++) {
            if (py >= 3 && py < maxY) {
              const lx = px - baseX, lz = pz - baseZ;
              if (lx >= 0 && lx < CHUNK && lz >= 0 && lz < CHUNK) {
                const idx = py * 256 + lz * CHUNK + lx;
                if (blocks[idx] === STONE) blocks[idx] = id; // ores only replace stone
              }
            }
            const r = Util.hash01(px + k, py, pz - k, s ^ 0x9e37);
            const axis = (r * 3) | 0, dir = (r * 6) % 1 < 0.5 ? 1 : -1;
            if (axis === 0) px += dir; else if (axis === 1) py += dir; else pz += dir;
            if (py < 3) py = 3; else if (py >= maxY) py = maxY - 1;
          }
        }
      }
    }
  }

  /* ---- oak tree: pure function of world column + seed ---- */
  function plantTree(blocks, baseX, baseZ, wx, wz, h, trunkSalt, leafSalt) {
    const th = 4 + ((Util.hash01(wx, 1, wz, trunkSalt) * 3) | 0); // trunk 4..6
    const topY = h + th;
    const lx0 = wx - baseX, lz0 = wz - baseZ;
    // canopy: radius-2 layers at topY-1 / topY, radius-1 + cross at topY+1
    for (let dy = -1; dy <= 1; dy++) {
      const y = topY + dy;
      if (y >= HEIGHT) continue;
      const rad = dy === 1 ? 1 : 2;
      const rowBase = y * 256;
      for (let dz = -rad; dz <= rad; dz++) {
        const lz = lz0 + dz;
        if (lz < 0 || lz >= CHUNK) continue;
        for (let dx = -rad; dx <= rad; dx++) {
          const lx = lx0 + dx;
          if (lx < 0 || lx >= CHUNK) continue;
          const corner = (dx === -rad || dx === rad) && (dz === -rad || dz === rad);
          if (corner && Util.hash01(wx + dx, y, wz + dz, leafSalt) < 0.5) continue;
          const idx = rowBase + lz * CHUNK + lx;
          if (blocks[idx] === AIR) blocks[idx] = LEAVES; // leaves never overwrite logs/solids
        }
      }
    }
    // trunk: logs overwrite leaves
    if (lx0 >= 0 && lx0 < CHUNK && lz0 >= 0 && lz0 < CHUNK) {
      const col = lz0 * CHUNK + lx0;
      for (let y = h + 1; y <= topY; y++) {
        const idx = y * 256 + col;
        const cur = blocks[idx];
        if (cur === AIR || cur === LEAVES) blocks[idx] = LOG;
      }
    }
  }

  /* ---- main chunk generation ---- */
  function generate(cx, cz, seed) {
    curSeed = seed | 0;
    const n = noises(curSeed);
    const blocks = new Uint8Array(CHUNK * HEIGHT * CHUNK);
    const baseX = cx * CHUNK, baseZ = cz * CHUNK;
    const bedSalt = curSeed ^ 0xdeadbeef;
    const dirtSalt = curSeed ^ 0x1b873593;
    const gravelSalt = curSeed ^ 0xcc9e2d51;

    // 1) precompute heights/mask/moisture once per column, incl. the tree margin
    for (let lz = -MARGIN; lz < CHUNK + MARGIN; lz++) {
      const wz = baseZ + lz;
      for (let lx = -MARGIN; lx < CHUNK + MARGIN; lx++) {
        const wx = baseX + lx;
        const i = (lz + MARGIN) * SPAN + (lx + MARGIN);
        sampleTerrain(wx, wz);
        sH[i] = tH; sMask[i] = tMask;
        sMoist[i] = moistAt(wx, wz);
      }
    }

    // 2) column fill + caves + water
    for (let lz = 0; lz < CHUNK; lz++) {
      const wz = baseZ + lz;
      for (let lx = 0; lx < CHUNK; lx++) {
        const wx = baseX + lx;
        const i = (lz + MARGIN) * SPAN + (lx + MARGIN);
        const h = sH[i];
        const col = lz * CHUNK + lx;
        const bio = biomeCode(h, sMask[i], sMoist[i]);

        let top, sub;
        if (h >= 90) { top = SNOW; sub = DIRT; }
        else if (h <= 48) { top = SAND; sub = SAND; }
        else { top = GRASS; sub = DIRT; }
        if (bio === B_OCEAN && Util.hash01(wx, 5, wz, gravelSalt) < 0.12) {
          top = GRAVEL; sub = GRAVEL; // gravel patches on the ocean floor
        }
        const dd = 3 + (Util.hash01(wx, 7, wz, dirtSalt) < 0.45 ? 1 : 0); // 3..4 deep

        blocks[col] = BEDROCK; // y=0 always
        blocks[256 + col] = Util.hash01(wx, 1, wz, bedSalt) < 0.5 ? BEDROCK : STONE;
        blocks[512 + col] = Util.hash01(wx, 2, wz, bedSalt) < 0.25 ? BEDROCK : STONE;
        const dirtStart = h - dd + 1;
        for (let y = 3; y <= h; y++) {
          blocks[y * 256 + col] = y === h ? top : (y >= dirtStart ? sub : STONE);
        }

        // spaghetti caves: carve where both 3D fbm fields are near zero.
        // Entrance noise occasionally lets caves break through to surface-1.
        const ent = n.d.noise2(wx * 0.033 + 311.7, wz * 0.033 - 147.2);
        const caveTop = ent > 0.6 ? h - 1 : h - 3;
        const c1x = wx * 0.045, c1z = wz * 0.045;
        const c2x = wx * 0.05 + 113.7, c2z = wz * 0.05 + 29.1;
        const chx = wx * 0.021 + 53.1, chz = wz * 0.021 - 17.4;
        for (let y = 6; y <= caveTop; y++) {
          const a = n.c1.fbm3(c1x, y * 0.07, c1z, 2, 2, 0.5);
          if (a < 0.09 && a > -0.09) {
            const b = n.c2.fbm3(c2x, y * 0.06 - 71.3, c2z, 2, 2, 0.5);
            if (b < 0.09 && b > -0.09) { blocks[y * 256 + col] = AIR; continue; }
          }
          // rare cheese pockets at lower frequency
          if (n.c1.fbm3(chx, y * 0.031 + 9.7, chz, 2, 2, 0.5) > 0.62) {
            blocks[y * 256 + col] = AIR;
          }
        }

        // water: only air cells above terrain, at/below sea level
        if (h < SEA) {
          for (let y = h + 1; y <= SEA; y++) blocks[y * 256 + col] = WATER;
        }
      }
    }

    // 3) ores (stone only, deterministic world-aligned vein grid)
    orePass(blocks, baseX, baseZ, curSeed, COAL, 0x243f6a88, 0.011, 110);
    orePass(blocks, baseX, baseZ, curSeed, IRON, 0x13198a2e, 0.0045, 64);

    // 4) trees: loop the margin so neighbor-rooted canopies overlap seamlessly
    const treeSalt = curSeed ^ 0x9e3779b9;
    const trunkSalt = curSeed ^ 0x6a09e667;
    const leafSalt = curSeed ^ 0xbb67ae85;
    for (let lz = -MARGIN; lz < CHUNK + MARGIN; lz++) {
      const wz = baseZ + lz;
      for (let lx = -MARGIN; lx < CHUNK + MARGIN; lx++) {
        const i = (lz + MARGIN) * SPAN + (lx + MARGIN);
        const h = sH[i];
        if (h < 49 || h > 89) continue; // no sand/snow/underwater/high peaks
        const bio = biomeCode(h, sMask[i], sMoist[i]);
        if (bio !== B_FOREST && bio !== B_PLAINS) continue;
        const r = Util.hash01(baseX + lx, 0, wz, treeSalt);
        if (r >= (bio === B_FOREST ? 1 / 28 : 1 / 90)) continue;
        plantTree(blocks, baseX, baseZ, baseX + lx, wz, h, trunkSalt, leafSalt);
      }
    }

    return blocks;
  }

  return { generate, getHeight, biomeAt };
})();
