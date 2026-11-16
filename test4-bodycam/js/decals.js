/* Decals — bullet holes, blood splats, growing pools, glass shards.
   Loads after postfx, before main. Shared meshes + canvas textures, one
   renderable per decal, cap 120 (oldest evicted). Self-registers update by
   wrapping Eng.start once at load. */
'use strict';
(function () {
  const CAP = 120;
  const OFFSET = 0.012;
  const PI = Math.PI;

  const list = [];      // all decal entries {r, dead}
  const growing = [];   // pool entries still animating {r, base, t, size, dead}
  let tex = null;       // {hole, splat:[t0,t1,t2], pool}

  /* ---------- canvas textures (lazy: Eng.gl exists only after Eng.init) ---------- */
  function makeCanvas(px) {
    const c = document.createElement('canvas');
    c.width = c.height = px;
    return c;
  }

  function drawHole() {
    const c = makeCanvas(64), g = c.getContext('2d');
    // faint dust ring
    g.fillStyle = 'rgba(70,64,58,0.22)';
    g.beginPath(); g.arc(32, 32, 11, 0, PI * 2); g.fill();
    // radial cracks
    const n = 7 + (Math.random() * 3 | 0);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * PI * 2 + rnd(-0.3, 0.3);
      const len = rnd(13, 29);
      const mx = 32 + Math.cos(a) * len * 0.5 + rnd(-2, 2);
      const my = 32 + Math.sin(a) * len * 0.5 + rnd(-2, 2);
      g.strokeStyle = 'rgba(16,13,11,' + rnd(0.45, 0.75).toFixed(2) + ')';
      g.lineWidth = rnd(0.7, 1.5);
      g.beginPath();
      g.moveTo(32 + Math.cos(a) * 4, 32 + Math.sin(a) * 4);
      g.lineTo(mx, my);
      g.lineTo(32 + Math.cos(a + rnd(-0.15, 0.15)) * len, 32 + Math.sin(a + rnd(-0.15, 0.15)) * len);
      g.stroke();
    }
    // dark hole core
    const rg = g.createRadialGradient(32, 32, 1, 32, 32, 8);
    rg.addColorStop(0, 'rgba(6,5,4,0.98)');
    rg.addColorStop(0.7, 'rgba(12,10,8,0.92)');
    rg.addColorStop(1, 'rgba(18,15,12,0)');
    g.fillStyle = rg;
    g.beginPath(); g.arc(32, 32, 8, 0, PI * 2); g.fill();
    return c;
  }

  function drawSplat(seedBias) {
    const c = makeCanvas(128), g = c.getContext('2d');
    const cx = 64 + rnd(-6, 6), cy = 64 + rnd(-6, 6);
    // main blob: overlapping soft circles
    const blobs = 5 + (Math.random() * 4 | 0);
    for (let i = 0; i < blobs; i++) {
      const a = rnd(PI * 2), d = rnd(0, 14);
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      const r = rnd(10, 24);
      const rg = g.createRadialGradient(x, y, r * 0.15, x, y, r);
      rg.addColorStop(0, 'rgba(88,9,11,0.92)');
      rg.addColorStop(0.65, 'rgba(66,7,9,0.85)');
      rg.addColorStop(1, 'rgba(52,5,7,0)');
      g.fillStyle = rg;
      g.beginPath(); g.arc(x, y, r, 0, PI * 2); g.fill();
    }
    // darker core
    g.fillStyle = 'rgba(46,4,6,0.85)';
    g.beginPath(); g.arc(cx, cy, rnd(7, 12), 0, PI * 2); g.fill();
    // flung droplets, biased along seedBias direction (impact dir)
    const drops = 13 + (Math.random() * 8 | 0);
    for (let i = 0; i < drops; i++) {
      const a = seedBias + rnd(-1.5, 1.5) + (Math.random() < 0.3 ? rnd(PI * 2) : 0);
      const d = rnd(20, 58);
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      const r = rnd(1.2, 4.5) * (1 - d / 90);
      g.fillStyle = 'rgba(' + (60 + rnd(30) | 0) + ',7,9,' + rnd(0.5, 0.9).toFixed(2) + ')';
      g.save();
      g.translate(x, y); g.rotate(a);
      g.beginPath(); g.ellipse(0, 0, r * rnd(1, 2.2), r, 0, 0, PI * 2); g.fill();
      g.restore();
    }
    return c;
  }

  function drawPool() {
    const c = makeCanvas(128), g = c.getContext('2d');
    const blob = (x, y, r, a) => {
      const rg = g.createRadialGradient(x, y, r * 0.1, x, y, r);
      rg.addColorStop(0, 'rgba(64,6,8,' + a + ')');
      rg.addColorStop(0.7, 'rgba(50,5,7,' + (a * 0.9).toFixed(2) + ')');
      rg.addColorStop(1, 'rgba(40,4,6,0)');
      g.fillStyle = rg;
      g.beginPath(); g.arc(x, y, r, 0, PI * 2); g.fill();
    };
    blob(64, 64, 46, 0.95);
    const bumps = 8 + (Math.random() * 4 | 0);
    for (let i = 0; i < bumps; i++) {
      const a = (i / bumps) * PI * 2 + rnd(-0.25, 0.25);
      const d = rnd(34, 46);
      blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, rnd(9, 17), 0.8);
    }
    return c;
  }

  function ensure() {
    if (tex) return true;
    if (!window.Eng || !Eng.gl) return false;
    tex = {
      hole: Eng.texFromCanvas(drawHole(), false),
      splat: [
        Eng.texFromCanvas(drawSplat(0), false),
        Eng.texFromCanvas(drawSplat(PI * 0.5), false),
        Eng.texFromCanvas(drawSplat(PI), false)
      ],
      pool: Eng.texFromCanvas(drawPool(), false)
    };
    return true;
  }

  /* ---------- placement helpers ---------- */
  function evict() {
    while (list.length > CAP) {
      const e = list.shift();
      e.dead = true;
      Eng.scene.remove(e.r);
    }
  }

  function track(r) {
    const e = { r, dead: false };
    list.push(e);
    evict();
    return e;
  }

  // model matrix with quad +Z aligned to surface normal n, random spin, scale s
  function normalModel(p, n, spin, s) {
    const m = new Float32Array(16);
    const ref = Math.abs(n[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
    let x = V3.norm(V3.cross(ref, n));
    let y = V3.cross(n, x);
    const c = Math.cos(spin), sn = Math.sin(spin);
    const rx = x[0] * c + y[0] * sn, ry = x[1] * c + y[1] * sn, rz = x[2] * c + y[2] * sn;
    y = [y[0] * c - x[0] * sn, y[1] * c - x[1] * sn, y[2] * c - x[2] * sn];
    m[0] = rx * s; m[1] = ry * s; m[2] = rz * s;
    m[4] = y[0] * s; m[5] = y[1] * s; m[6] = y[2] * s;
    m[8] = n[0]; m[9] = n[1]; m[10] = n[2];
    m[12] = p[0] + n[0] * OFFSET; m[13] = p[1] + n[1] * OFFSET; m[14] = p[2] + n[2] * OFFSET;
    m[15] = 1;
    return m;
  }

  function floorModel(p, spin, sx, sy) {
    return M4.trs([p[0], p[1] + OFFSET, p[2]], [-PI / 2, spin, 0], [sx, sy, 1]);
  }

  const decalOpts = { blend: 'alpha', depthWrite: false, doubleSided: true };

  /* ---------- public API ---------- */
  const Decals = {
    // small dark hole + radial cracks, one quad oriented to surface normal
    bullet(point, normal) {
      if (!ensure()) return;
      const n = V3.norm(normal || [0, 1, 0]);
      const s = rnd(0.07, 0.12);
      const r = Eng.add(Eng.meshQuad, normalModel(point, n, rnd(PI * 2), s), [1, 1, 1],
        Object.assign({ tex: tex.hole, alpha: rnd(0.8, 0.95) }, decalOpts));
      track(r);
    },

    // splat oriented to the surface the hit came from (dir = travel direction)
    blood(point, dir, size) {
      if (!ensure()) return;
      const n = dir ? V3.norm(V3.scl(dir, -1)) : [0, 1, 0];
      const s = (size || 0.35) * rnd(0.8, 1.3);
      // droplet bias in texture space follows impact dir projected on surface
      const t = tex.splat[Math.random() * 3 | 0];
      const r = Eng.add(Eng.meshQuad, normalModel(point, n, rnd(PI * 2), s), [1, 1, 1],
        Object.assign({ tex: t, alpha: rnd(0.72, 0.92) }, decalOpts));
      track(r);
    },

    // floor pool that grows to full size over 1.2 s
    pool(point, size) {
      if (!ensure()) return;
      const s = size || 0.9;
      const spin = rnd(PI * 2);
      const base = M4.trs([point[0], point[1] + OFFSET, point[2]], [-PI / 2, spin, 0], [1, 1, 1]);
      const model = new Float32Array(base);
      const k0 = 0.15 * s;
      model[0] *= k0; model[1] *= k0; model[2] *= k0;
      model[4] *= k0; model[5] *= k0; model[6] *= k0;
      const r = Eng.add(Eng.meshQuad, model, [1, 1, 1],
        Object.assign({ tex: tex.pool, alpha: 0.9 }, decalOpts));
      const e = track(r);
      e.base = base; e.t = 0; e.size = s;
      growing.push(e);
    },

    // a few persistent glass quads scattered on the floor
    shards(point) {
      if (!ensure()) return;
      const n = 4 + (Math.random() * 3 | 0);
      for (let i = 0; i < n; i++) {
        const s = rnd(0.04, 0.15);
        const p = [point[0] + rnd(-0.55, 0.55), point[1] + rnd(0, 0.008), point[2] + rnd(-0.55, 0.55)];
        const r = Eng.add(Eng.meshQuad, floorModel(p, rnd(PI * 2), s, s * rnd(0.4, 1)),
          [0.72, 0.82, 0.88],
          Object.assign({ alpha: rnd(0.18, 0.36), emissive: 0.06 }, decalOpts));
        track(r);
      }
    },

    update(dt) {
      for (let i = growing.length - 1; i >= 0; i--) {
        const e = growing[i];
        if (e.dead) { growing.splice(i, 1); continue; }
        e.t += dt;
        const u = Math.min(1, e.t / 1.2);
        const k = (1 - Math.pow(1 - u, 3)) * 0.85 + 0.15; // ease-out cubic
        const s = e.size * k;
        const m = e.r.model, b = e.base;
        m.set(b);
        m[0] *= s; m[1] *= s; m[2] *= s;
        m[4] *= s; m[5] *= s; m[6] *= s;
        if (u >= 1) growing.splice(i, 1);
      }
    }
  };

  window.Decals = Decals;

  // self-register: wrap Eng.start once so update runs every frame (and in Eng.step)
  if (window.Eng && !Eng._decalsWrapped) {
    Eng._decalsWrapped = true;
    const os = Eng.start.bind(Eng);
    Eng.start = function (fn) {
      os(function (dt, t) { Decals.update(dt); fn(dt, t); });
    };
  }
})();
