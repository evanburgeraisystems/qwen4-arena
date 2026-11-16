/* util.js — math, RNG, simplex noise, mat4, frustum, AABB physics. FOUNDATION. */
window.Util = (function () {
  'use strict';

  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (t) => t * t * (3 - 2 * t);

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash01(x, y, z, seed) {
    let h = seed | 0;
    h = Math.imul(h ^ (x | 0), 0x27d4eb2d);
    h ^= h >>> 15;
    h = Math.imul(h ^ (y | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h ^ (z | 0), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  /* ---- Simplex noise (2D/3D), seeded ---- */
  const GRAD3 = new Float32Array([
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
    1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
    0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
  ]);
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  const F3 = 1 / 3, G3 = 1 / 6;

  class Noise {
    constructor(seed) {
      const rnd = mulberry32(seed);
      const p = new Uint8Array(256);
      for (let i = 0; i < 256; i++) p[i] = i;
      for (let i = 255; i > 0; i--) {
        const j = (rnd() * (i + 1)) | 0;
        const t = p[i]; p[i] = p[j]; p[j] = t;
      }
      this.perm = new Uint8Array(512);
      this.permMod12 = new Uint8Array(512);
      for (let i = 0; i < 512; i++) {
        this.perm[i] = p[i & 255];
        this.permMod12[i] = this.perm[i] % 12;
      }
    }
    noise2(xin, yin) {
      const perm = this.perm, pm12 = this.permMod12;
      let n0 = 0, n1 = 0, n2 = 0;
      const s = (xin + yin) * F2;
      const i = Math.floor(xin + s), j = Math.floor(yin + s);
      const t = (i + j) * G2;
      const x0 = xin - (i - t), y0 = yin - (j - t);
      let i1, j1;
      if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
      const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
      const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
      const ii = i & 255, jj = j & 255;
      let t0 = 0.5 - x0 * x0 - y0 * y0;
      if (t0 >= 0) {
        const gi = pm12[ii + perm[jj]] * 3;
        t0 *= t0; n0 = t0 * t0 * (GRAD3[gi] * x0 + GRAD3[gi + 1] * y0);
      }
      let t1 = 0.5 - x1 * x1 - y1 * y1;
      if (t1 >= 0) {
        const gi = pm12[ii + i1 + perm[jj + j1]] * 3;
        t1 *= t1; n1 = t1 * t1 * (GRAD3[gi] * x1 + GRAD3[gi + 1] * y1);
      }
      let t2 = 0.5 - x2 * x2 - y2 * y2;
      if (t2 >= 0) {
        const gi = pm12[ii + 1 + perm[jj + 1]] * 3;
        t2 *= t2; n2 = t2 * t2 * (GRAD3[gi] * x2 + GRAD3[gi + 1] * y2);
      }
      return 70 * (n0 + n1 + n2);
    }
    noise3(xin, yin, zin) {
      const perm = this.perm, pm12 = this.permMod12;
      let n0 = 0, n1 = 0, n2 = 0, n3 = 0;
      const s = (xin + yin + zin) * F3;
      const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
      const t = (i + j + k) * G3;
      const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
      let i1, j1, k1, i2, j2, k2;
      if (x0 >= y0) {
        if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
        else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
        else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
      } else {
        if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
        else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
        else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      }
      const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
      const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
      const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
      const ii = i & 255, jj = j & 255, kk = k & 255;
      let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
      if (t0 >= 0) {
        const gi = pm12[ii + perm[jj + perm[kk]]] * 3;
        t0 *= t0; n0 = t0 * t0 * (GRAD3[gi] * x0 + GRAD3[gi + 1] * y0 + GRAD3[gi + 2] * z0);
      }
      let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
      if (t1 >= 0) {
        const gi = pm12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3;
        t1 *= t1; n1 = t1 * t1 * (GRAD3[gi] * x1 + GRAD3[gi + 1] * y1 + GRAD3[gi + 2] * z1);
      }
      let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
      if (t2 >= 0) {
        const gi = pm12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3;
        t2 *= t2; n2 = t2 * t2 * (GRAD3[gi] * x2 + GRAD3[gi + 1] * y2 + GRAD3[gi + 2] * z2);
      }
      let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
      if (t3 >= 0) {
        const gi = pm12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3;
        t3 *= t3; n3 = t3 * t3 * (GRAD3[gi] * x3 + GRAD3[gi + 1] * y3 + GRAD3[gi + 2] * z3);
      }
      return 32 * (n0 + n1 + n2 + n3);
    }
    fbm2(x, y, oct, lac, gain) {
      lac = lac || 2; gain = gain || 0.5;
      let a = 1, f = 1, sum = 0, norm = 0;
      for (let o = 0; o < oct; o++) {
        sum += a * this.noise2(x * f, y * f);
        norm += a; a *= gain; f *= lac;
      }
      return sum / norm;
    }
    fbm3(x, y, z, oct, lac, gain) {
      lac = lac || 2; gain = gain || 0.5;
      let a = 1, f = 1, sum = 0, norm = 0;
      for (let o = 0; o < oct; o++) {
        sum += a * this.noise3(x * f, y * f, z * f);
        norm += a; a *= gain; f *= lac;
      }
      return sum / norm;
    }
  }

  /* ---- camera vectors ---- */
  function forward(yaw, pitch) {
    const cp = Math.cos(pitch);
    return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
  }
  function right(yaw) { return [Math.cos(yaw), 0, -Math.sin(yaw)]; }

  /* ---- mat4, column-major Float32Array ---- */
  const m4 = {
    identity() {
      const m = new Float32Array(16);
      m[0] = m[5] = m[10] = m[15] = 1;
      return m;
    },
    perspective(fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
      m[0] = f / aspect; m[5] = f;
      m[10] = (far + near) / (near - far); m[11] = -1;
      m[14] = (2 * far * near) / (near - far);
      return m;
    },
    lookAt(eye, center, up) {
      let fx = center[0] - eye[0], fy = center[1] - eye[1], fz = center[2] - eye[2];
      let l = Math.hypot(fx, fy, fz) || 1;
      fx /= l; fy /= l; fz /= l;
      let sx = fy * up[2] - fz * up[1], sy = fz * up[0] - fx * up[2], sz = fx * up[1] - fy * up[0];
      l = Math.hypot(sx, sy, sz) || 1;
      sx /= l; sy /= l; sz /= l;
      const ux = sy * fz - sz * fy, uy = sz * fx - sx * fz, uz = sx * fy - sy * fx;
      const m = new Float32Array(16);
      m[0] = sx; m[1] = ux; m[2] = -fx; m[3] = 0;
      m[4] = sy; m[5] = uy; m[6] = -fy; m[7] = 0;
      m[8] = sz; m[9] = uz; m[10] = -fz; m[11] = 0;
      m[12] = -(sx * eye[0] + sy * eye[1] + sz * eye[2]);
      m[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
      m[14] = fx * eye[0] + fy * eye[1] + fz * eye[2];
      m[15] = 1;
      return m;
    },
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
          o[c * 4 + r] =
            a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
            a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
        }
      }
      return o;
    },
    /* T(center) * Ry(ry) * Rx(rx) * S(size) — for mob boxes */
    boxModel(cx, cy, cz, sx, sy, sz, rx, ry) {
      const cyr = Math.cos(ry), syr = Math.sin(ry);
      const cxr = Math.cos(rx), sxr = Math.sin(rx);
      const m = new Float32Array(16);
      m[0] = cyr * sx; m[1] = 0; m[2] = syr * sx; m[3] = 0;
      m[4] = -syr * sxr * sy; m[5] = cxr * sy; m[6] = cyr * sxr * sy; m[7] = 0;
      m[8] = -syr * cxr * sz; m[9] = -sxr * sz; m[10] = cyr * cxr * sz; m[11] = 0;
      m[12] = cx; m[13] = cy; m[14] = cz; m[15] = 1;
      return m;
    }
  };

  /* ---- frustum culling ---- */
  function frustumPlanes(vp) {
    const row = (i) => [vp[i], vp[4 + i], vp[8 + i], vp[12 + i]];
    const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
    const mk = (a, b, sign) => {
      const p = [a[0] + sign * b[0], a[1] + sign * b[1], a[2] + sign * b[2], a[3] + sign * b[3]];
      const l = Math.hypot(p[0], p[1], p[2]) || 1;
      return [p[0] / l, p[1] / l, p[2] / l, p[3] / l];
    };
    return [
      mk(r3, r0, 1), mk(r3, r0, -1),
      mk(r3, r1, 1), mk(r3, r1, -1),
      mk(r3, r2, 1), mk(r3, r2, -1)
    ];
  }
  function aabbInFrustum(planes, minx, miny, minz, maxx, maxy, maxz) {
    for (let i = 0; i < 6; i++) {
      const p = planes[i];
      const px = p[0] >= 0 ? maxx : minx;
      const py = p[1] >= 0 ? maxy : miny;
      const pz = p[2] >= 0 ? maxz : minz;
      if (p[0] * px + p[1] * py + p[2] * pz + p[3] < 0) return false;
    }
    return true;
  }

  /* ---- AABB voxel physics (shared by player & mobs) ---- */
  const EPS = 1e-4;
  const Physics = {
    /* body: {x,y,z (feet center/bottom), w,h, vx,vy,vz, onGround} */
    step(world, body, dt) {
      const res = { hitX: false, hitY: false, hitZ: false };
      body.onGround = false;
      const maxV = Math.max(Math.abs(body.vx), Math.abs(body.vy), Math.abs(body.vz));
      const steps = clamp(Math.ceil((maxV * dt) / 0.4), 1, 10);
      const sdt = dt / steps;
      const hw = body.w / 2;
      for (let s = 0; s < steps; s++) {
        // X axis
        let dx = body.vx * sdt;
        if (dx !== 0) {
          body.x += dx;
          const miny = Math.floor(body.y + EPS), maxy = Math.floor(body.y + body.h - EPS);
          const minz = Math.floor(body.z - hw + EPS), maxz = Math.floor(body.z + hw - EPS);
          if (dx > 0) {
            const bx = Math.floor(body.x + hw - EPS);
            if (solidRange(world, bx, bx, miny, maxy, minz, maxz)) {
              body.x = bx - hw - EPS; body.vx = 0; res.hitX = true;
            }
          } else {
            const bx = Math.floor(body.x - hw + EPS);
            if (solidRange(world, bx, bx, miny, maxy, minz, maxz)) {
              body.x = bx + 1 + hw + EPS; body.vx = 0; res.hitX = true;
            }
          }
        }
        // Z axis
        let dz = body.vz * sdt;
        if (dz !== 0) {
          body.z += dz;
          const miny = Math.floor(body.y + EPS), maxy = Math.floor(body.y + body.h - EPS);
          const minx = Math.floor(body.x - hw + EPS), maxx = Math.floor(body.x + hw - EPS);
          if (dz > 0) {
            const bz = Math.floor(body.z + hw - EPS);
            if (solidRange(world, minx, maxx, miny, maxy, bz, bz)) {
              body.z = bz - hw - EPS; body.vz = 0; res.hitZ = true;
            }
          } else {
            const bz = Math.floor(body.z - hw + EPS);
            if (solidRange(world, minx, maxx, miny, maxy, bz, bz)) {
              body.z = bz + 1 + hw + EPS; body.vz = 0; res.hitZ = true;
            }
          }
        }
        // Y axis
        let dy = body.vy * sdt;
        if (dy !== 0) {
          body.y += dy;
          const minx = Math.floor(body.x - hw + EPS), maxx = Math.floor(body.x + hw - EPS);
          const minz = Math.floor(body.z - hw + EPS), maxz = Math.floor(body.z + hw - EPS);
          if (dy > 0) {
            const by = Math.floor(body.y + body.h - EPS);
            if (solidRange(world, minx, maxx, by, by, minz, maxz)) {
              body.y = by - body.h - EPS; body.vy = 0; res.hitY = true;
            }
          } else {
            const by = Math.floor(body.y + EPS);
            if (solidRange(world, minx, maxx, by, by, minz, maxz)) {
              body.y = by + 1; body.vy = 0; body.onGround = true; res.hitY = true;
            }
          }
        }
      }
      return res;
    },
    groundId(world, body) {
      return world.get(Math.floor(body.x), Math.floor(body.y - 0.05), Math.floor(body.z));
    }
  };
  function solidRange(world, x0, x1, y0, y1, z0, z1) {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++)
          if (world.isSolid(x, y, z)) return true;
    return false;
  }

  return {
    clamp, lerp, smoothstep, mulberry32, hash01, Noise,
    forward, right, m4, frustumPlanes, aabbInFrustum, Physics
  };
})();
