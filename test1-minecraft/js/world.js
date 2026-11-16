/* world.js — chunk store, block access, raycast, streaming. FOUNDATION. */
window.World = (function () {
  'use strict';

  const CHUNK = 16, HEIGHT = 128, SEA_LEVEL = 46;
  const GEN_RADIUS = 7, UNLOAD_RADIUS = 10, GEN_BUDGET = 2;

  let seed = 1;
  const chunks = new Map();
  const key = (cx, cz) => cx + ',' + cz;

  /* precomputed generation order, nearest first */
  const genOrder = [];
  for (let dz = -GEN_RADIUS; dz <= GEN_RADIUS; dz++)
    for (let dx = -GEN_RADIUS; dx <= GEN_RADIUS; dx++)
      genOrder.push([dx, dz, dx * dx + dz * dz]);
  genOrder.sort((a, b) => a[2] - b[2]);

  function init(s) {
    for (const c of chunks.values()) {
      if (window.Renderer && Renderer.onChunkUnload) Renderer.onChunkUnload(c);
    }
    chunks.clear();
    seed = s | 0;
  }

  function get(x, y, z) {
    if (y < 0) return 12;
    if (y >= HEIGHT) return 0;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = chunks.get(key(cx, cz));
    if (!c) return 0;
    return c.blocks[(y * CHUNK + (z - cz * CHUNK)) * CHUNK + (x - cx * CHUNK)];
  }

  function isSolid(x, y, z) {
    if (y < 0) return true;
    if (y >= HEIGHT) return false;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = chunks.get(key(cx, cz));
    if (!c) return true; // unloaded = solid (physics safety)
    return Blocks.BY_ID[c.blocks[(y * CHUNK + (z - cz * CHUNK)) * CHUNK + (x - cx * CHUNK)]].solid;
  }

  function hasChunk(cx, cz) { return chunks.has(key(cx, cz)); }

  function markDirty(cx, cz) {
    const c = chunks.get(key(cx, cz));
    if (c) c.dirty = true;
  }

  function set(x, y, z, id) {
    if (y < 0 || y >= HEIGHT) return false;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = chunks.get(key(cx, cz));
    if (!c) return false;
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    c.blocks[(y * CHUNK + lz) * CHUNK + lx] = id;
    c.dirty = true;
    if (lx === 0) markDirty(cx - 1, cz);
    if (lx === CHUNK - 1) markDirty(cx + 1, cz);
    if (lz === 0) markDirty(cx, cz - 1);
    if (lz === CHUNK - 1) markDirty(cx, cz + 1);
    return true;
  }

  function generateChunk(cx, cz) {
    const k = key(cx, cz);
    if (chunks.has(k)) return chunks.get(k);
    const blocks = WorldGen.generate(cx, cz, seed);
    const c = { cx, cz, blocks, dirty: true, mesh: null, meshTrans: null };
    chunks.set(k, c);
    markDirty(cx - 1, cz); markDirty(cx + 1, cz);
    markDirty(cx, cz - 1); markDirty(cx, cz + 1);
    return c;
  }

  function stream(px, pz) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    let budget = GEN_BUDGET;
    for (let i = 0; i < genOrder.length && budget > 0; i++) {
      const cx = pcx + genOrder[i][0], cz = pcz + genOrder[i][1];
      if (!chunks.has(key(cx, cz))) { generateChunk(cx, cz); budget--; }
    }
    for (const [k, c] of chunks) {
      if (Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) > UNLOAD_RADIUS) {
        if (window.Renderer && Renderer.onChunkUnload) Renderer.onChunkUnload(c);
        chunks.delete(k);
      }
    }
  }

  /* Amanatides & Woo DDA. Skips air + water. */
  function raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx !== 0 ? ((dx > 0 ? (x + 1 - ox) : (ox - x)) * tDeltaX) : Infinity;
    let tMaxY = dy !== 0 ? ((dy > 0 ? (y + 1 - oy) : (oy - y)) * tDeltaY) : Infinity;
    let tMaxZ = dz !== 0 ? ((dz > 0 ? (z + 1 - oz) : (oz - z)) * tDeltaZ) : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let i = 0; i < 256; i++) {
      const id = get(x, y, z);
      if (id !== 0 && id !== 11 && t <= maxDist) {
        return { x, y, z, nx, ny, nz, px: x + nx, py: y + ny, pz: z + nz, id, dist: t };
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        if (tMaxX > maxDist) return null;
        x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
      } else if (tMaxY < tMaxZ) {
        if (tMaxY > maxDist) return null;
        y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
      } else {
        if (tMaxZ > maxDist) return null;
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
      }
    }
    return null;
  }

  function surfaceY(x, z) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = chunks.get(key(cx, cz));
    if (!c) return WorldGen.getHeight(x, z);
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    for (let y = HEIGHT - 1; y >= 0; y--) {
      const id = c.blocks[(y * CHUNK + lz) * CHUNK + lx];
      if (id !== 0 && id !== 11 && id !== 7 && id !== 6) return y;
    }
    return WorldGen.getHeight(x, z);
  }

  return {
    CHUNK, HEIGHT, SEA_LEVEL,
    init, get, set, isSolid, hasChunk, generateChunk, stream, raycast, surfaceY,
    chunks, get seed() { return seed; }
  };
})();
