/* ============================================================
   BODYCAM: OUTBREAK — zombies.js
   Box-built humanoids, procedural animation, hearing-based swarm
   AI, BFS waypoint pathing, wave director. window.Zombies
   ============================================================ */
'use strict';

(function () {

  /* ---------- scratch math (zero-alloc matrix writes) ---------- */
  // Same convention as M4.trs: T * Ry * Rx * Rz * S, written in place.
  function compose(m, x, y, z, rx, ry, rz, sx, sy, sz) {
    const cx = Math.cos(rx), sxr = Math.sin(rx);
    const cy = Math.cos(ry), syr = Math.sin(ry);
    const cz = Math.cos(rz), szr = Math.sin(rz);
    // columns of Ry*Rx*Rz
    m[0] = (cy * cz + syr * sxr * szr) * sx;
    m[1] = (cx * szr) * sx;
    m[2] = (-syr * cz + cy * sxr * szr) * sx;
    m[3] = 0;
    m[4] = (-cy * szr + syr * sxr * cz) * sy;
    m[5] = (cx * cz) * sy;
    m[6] = (syr * szr + cy * sxr * cz) * sy;
    m[7] = 0;
    m[8] = (syr * cx) * sz;
    m[9] = (-sxr) * sz;
    m[10] = (cy * cx) * sz;
    m[11] = 0;
    m[12] = x; m[13] = y; m[14] = z; m[15] = 1;
    return m;
  }
  // out = a * b (b applied first), in place, out must not alias a/b
  function mulInto(out, a, b) {
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
      out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
      out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return out;
  }
  const _local = new Float32Array(16);   // shared scratch for part-local transforms
  const _upper = new Float32Array(16);   // per-zombie upper-body root (reused via z._upper)

  function angLerp(a, b, t) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  /* ---------- module state ---------- */
  const Z = {
    list: [],
    budget: [2, 5, 6, 9, 10, 12],
    runnerRatio: [0, 0.10, 0.20, 0.35, 0.45, 0.55],
    aliveCap: 26,
    corpseCap: 18,
    spawnTimer: 3,
    lastZone: 0,
    // waypoint graph
    nodes: null, nodeById: null, adj: null,
    _bfsPrev: [], _bfsQueue: []
  };

  /* ---------- waypoint graph + BFS ---------- */
  function buildGraph() {
    if (!window.Level || !Level.data || !Level.data.waypoints) return false;
    const wps = Level.data.waypoints;
    Z.nodes = wps;
    Z.nodeById = new Map();
    for (let i = 0; i < wps.length; i++) Z.nodeById.set(wps[i].id, i);
    Z.adj = new Array(wps.length);
    for (let i = 0; i < wps.length; i++) {
      const links = wps[i].links || [];
      const a = [];
      for (let j = 0; j < links.length; j++) {
        const idx = Z.nodeById.get(links[j]);
        if (idx !== undefined) a.push(idx);
      }
      Z.adj[i] = a;
    }
    Z._bfsPrev = new Array(wps.length);
    return true;
  }

  function nearestNode(x, y, zz) {
    const nodes = Z.nodes;
    let best = -1, bd = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const p = nodes[i].pos;
      const dx = p[0] - x, dz = p[2] - zz, dy = (p[1] - y) * 2.5; // penalize other floors
      const d = dx * dx + dz * dz + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // BFS over waypoint links; fills z.path with node pos refs. Returns true on path found.
  function bfsPath(z, tx, ty, tz) {
    if (!Z.nodes && !buildGraph()) return false;
    const n = Z.nodes.length;
    const start = nearestNode(z.pos[0], z.pos[1], z.pos[2]);
    const goal = nearestNode(tx, ty, tz);
    if (start < 0 || goal < 0) return false;
    const prev = Z._bfsPrev, queue = Z._bfsQueue;
    for (let i = 0; i < n; i++) prev[i] = -1;
    let qh = 0, qt = 0;
    queue[qt++] = start; prev[start] = start;
    let found = start === goal;
    while (qh < qt && !found) {
      const cur = queue[qh++];
      const a = Z.adj[cur];
      for (let i = 0; i < a.length; i++) {
        const nx = a[i];
        if (prev[nx] !== -1) continue;
        prev[nx] = cur;
        if (nx === goal) { found = true; break; }
        queue[qt++] = nx;
      }
    }
    z.path.length = 0;
    if (!found) return false;
    // reconstruct goal -> start, then reverse into path
    let cur = goal;
    while (cur !== start) { z.path.push(Z.nodes[cur].pos); cur = prev[cur]; }
    z.path.push(Z.nodes[start].pos);
    z.path.reverse();
    z.pathIdx = 0;
    // skip nodes we're already past
    while (z.pathIdx < z.path.length - 1 &&
      V3.distXZ(z.pos, z.path[z.pathIdx]) < 0.9) z.pathIdx++;
    return true;
  }

  /* ---------- palettes ---------- */
  function makePalette(type) {
    const runner = type === 'run';
    const skin = [
      0.55 + rnd(-0.07, 0.05),
      0.50 + rnd(-0.07, 0.04),
      0.42 + rnd(-0.06, 0.04)
    ];
    // sickly green-grey drift
    skin[1] += rnd(0, 0.03); skin[0] -= rnd(0, 0.03);
    const clothRoll = Math.random();
    let cloth;
    if (clothRoll < 0.30) cloth = [0.10 + rnd(0.03), 0.16 + rnd(0.03), 0.16 + rnd(0.03)]; // dark teal scrubs
    else if (clothRoll < 0.55) cloth = [0.13 + rnd(0.03), 0.13 + rnd(0.03), 0.15 + rnd(0.03)]; // grey
    else if (clothRoll < 0.78) cloth = [0.10 + rnd(0.02), 0.12 + rnd(0.02), 0.19 + rnd(0.03)]; // blue scrubs
    else cloth = [0.44 + rnd(0.06), 0.43 + rnd(0.05), 0.39 + rnd(0.05)]; // pale hospital gown
    const pants = [cloth[0] * 0.7, cloth[1] * 0.7, cloth[2] * 0.75];
    // blood staining (runners much bloodier)
    const stainAmt = runner ? rnd(0.35, 0.65) : rnd(0.05, 0.35);
    const blood = [0.24, 0.035, 0.035];
    const stain = (c, amt) => [
      c[0] + (blood[0] - c[0]) * amt,
      c[1] + (blood[1] - c[1]) * amt,
      c[2] + (blood[2] - c[2]) * amt
    ];
    return {
      skin,
      head: stain(skin, stainAmt * rnd(0.4, 1)),
      torso: stain(cloth, stainAmt),
      pelvis: stain(pants, stainAmt * 0.5),
      arm: stain(cloth, stainAmt * rnd(0.3, 0.8)),
      hand: stain(skin, stainAmt * rnd(0.3, 0.9)),
      leg: stain(pants, stainAmt * rnd(0.2, 0.7)),
      lean: runner ? 0.85 : 1
    };
  }

  /* ---------- spawn ---------- */
  function mkPart(color, sx, sy, sz) {
    const r = Eng.add(Eng.meshCube, M4.ident(), color);
    return { r, sx, sy, sz };
  }

  function spawn(type, pos) {
    type = type === 'run' ? 'run' : 'shamble';
    const runner = type === 'run';
    let x = pos[0], zz = pos[2];
    let y = pos[1];
    if (window.Level && Level.floorHeight) y = Level.floorHeight(x, zz);
    const pal = makePalette(type);
    const L = pal.lean;

    const z = {
      pos: [x, y, zz],
      yaw: rnd(Math.PI * 2),
      type,
      hp: runner ? 60 : 100,
      speed: runner ? rnd(4.0, 4.6) : rnd(0.9, 1.3),
      state: 'idle',
      phase: rnd(Math.PI * 2),
      freq: (runner ? rnd(6.8, 8.2) : rnd(4.6, 5.8)),
      radius: 0.34,
      height: 1.8,
      alive: true,
      stagger: 0,
      attackCd: rnd(0.4, 1.2),
      path: [],
      pathIdx: 0,
      pathTimer: 0,
      lastPathTarget: [x, y, zz],
      targetPos: [x, y, zz],
      losTimer: rnd(0, 0.2),
      losClear: false,
      groanCd: rnd(1.5, 7),
      deathT: 0,
      sinkT: 0,
      // per-zombie animation personality
      asymSide: Math.random() < 0.5 ? 0 : 1,   // stiff leg / dangling arm side
      limpAmp: rnd(0.45, 0.62),
      leanBase: runner ? 0.35 : rnd(0.08, 0.16),
      headTilt: rnd(-0.16, 0.16),
      headTurn: rnd(-0.2, 0.2),
      swaySeed: rnd(Math.PI * 2),
      twitchT: rnd(1, 5),
      twitchAmt: 0,
      armDangle: rnd(0.05, 0.2),
      limpT: rnd(0.6, 2.2),      // countdown to next micro-hesitation
      limpPause: 0,              // remaining limp-pause time
      jukeT: rnd(Math.PI * 2),   // runner sine-strafe phase
      jukeFreq: rnd(3.2, 5.2),
      jukeAmp: rnd(0.3, 0.55),
      flinchT: 0, flinchF: 0, flinchR: 0, // directional flinch (local fwd/right)
      // ai scratch
      aware: false,
      screamed: false,
      wanderT: rnd(2, 7),
      wanderTarget: [x, y, zz],
      attackT: 0,
      attackHit: false,
      bashT: 0,
      bashDoor: null,
      stuckT: 0,
      sideT: 0,
      sideDir: 1,
      kx: 0, kz: 0,          // knockback velocity
      sepX: 0, sepZ: 0,
      moveAmt: 0,
      fallSign: Math.random() < 0.5 ? 1 : -1,
      fallYaw: rnd(-0.4, 0.4),
      decalT: -1,
      removed: false,
      parts: null,
      shadow: null,
      _root: new Float32Array(16),
      _upper: new Float32Array(16)
    };

    const p = {};
    p.pelvis = mkPart(pal.pelvis, 0.30 * L, 0.22, 0.18 * L);
    p.torso = mkPart(pal.torso, 0.34 * L, 0.44, 0.20 * L);
    p.head = mkPart(pal.head, 0.22, 0.24, 0.22);
    p.uaL = mkPart(pal.arm, 0.10 * L, 0.30, 0.10 * L);
    p.uaR = mkPart(pal.arm, 0.10 * L, 0.30, 0.10 * L);
    p.faL = mkPart(pal.hand, 0.09 * L, 0.28, 0.09 * L);
    p.faR = mkPart(pal.hand, 0.09 * L, 0.28, 0.09 * L);
    p.thL = mkPart(pal.leg, 0.13 * L, 0.42, 0.13 * L);
    p.thR = mkPart(pal.leg, 0.13 * L, 0.42, 0.13 * L);
    p.shL = mkPart(pal.leg, 0.11 * L, 0.42, 0.11 * L);
    p.shR = mkPart(pal.leg, 0.11 * L, 0.42, 0.11 * L);
    z.parts = p;

    const shOpts = { alpha: 0.35, blend: 'alpha', depthWrite: false, doubleSided: true };
    if (Eng.texShadow) { shOpts.tex = Eng.texShadow; shOpts.alpha = 0.45; } // soft radial blob
    z.shadow = Eng.add(Eng.meshQuad, M4.ident(), [0.01, 0.01, 0.015], shOpts);

    Z.list.push(z);
    return z;
  }

  /* ---------- init ---------- */
  function init() {
    Z.list.length = 0;
    Z.spawnTimer = rnd(2.5, 4);
    Z.lastZone = G.player.zone;
    Z.nodes = null;
    buildGraph();
    // initial population: 2 shamblers in lobby far corners (>8m from spawn [0,1.62,8.2])
    spawn('shamble', [-4.6, 0, 0.2]);
    spawn('shamble', [4.8, 0, 1.0]);
    // 3 shamblers in ward corridor rooms
    spawn('shamble', [-3.6, 0, -9]);
    spawn('shamble', [3.6, 0, -16]);
    spawn('shamble', [-3.6, 0, -24]);
    for (const z of Z.list) { z.state = 'idle'; z.wanderT = rnd(3, 9); }
  }

  /* ---------- senses helpers ---------- */
  function playerFeet(out) {
    out[0] = G.player.pos[0];
    out[1] = G.player.pos[1] - 1.62;
    out[2] = G.player.pos[2];
    return out;
  }
  const _pf = [0, 0, 0];
  const _rayFrom = [0, 0, 0], _rayTo = [0, 0, 0];

  function losToPlayer(z) {
    if (!window.Level || !Level.raycast) return false;
    _rayFrom[0] = z.pos[0]; _rayFrom[1] = z.pos[1] + 1.55; _rayFrom[2] = z.pos[2];
    _rayTo[0] = G.player.pos[0]; _rayTo[1] = G.player.pos[1]; _rayTo[2] = G.player.pos[2];
    return Level.raycast(_rayFrom, _rayTo) > 0.97;
  }

  function pointBlockedFromPlayer(px, py, pz) {
    if (!window.Level || !Level.raycast) return false;
    _rayFrom[0] = G.player.pos[0]; _rayFrom[1] = G.player.pos[1]; _rayFrom[2] = G.player.pos[2];
    _rayTo[0] = px; _rayTo[1] = py + 1.5; _rayTo[2] = pz;
    return Level.raycast(_rayFrom, _rayTo) < 0.95;
  }

  function setAggro(z) {
    if (!z.aware) {
      z.aware = true;
      if (z.type === 'run' && !z.screamed) {
        z.screamed = true;
        if (window.AudioSys) AudioSys.scream(z.pos);
      }
    }
    if (z.state !== 'attack' && z.state !== 'bash' && z.state !== 'stagger') z.state = 'chase';
  }

  /* ---------- noise ---------- */
  function consumeNoise() {
    const ev = G.noiseEvents;
    for (let e = 0; e < ev.length; e++) {
      const n = ev[e];
      const gunshot = n.kind === 'gunshot';
      for (let i = 0; i < Z.list.length; i++) {
        const z = Z.list[i];
        if (!z.alive) continue;
        const dx = z.pos[0] - n.pos[0], dz = z.pos[2] - n.pos[2];
        const dy = Math.abs(z.pos[1] - n.pos[1]);
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > n.radius || (!gunshot && dy > 4.5)) continue;
        if (z.state === 'stagger' || z.state === 'attack' || z.state === 'bash') continue;
        if (gunshot && (z.aware || d < 10)) {
          setAggro(z);
        } else if (z.state !== 'chase') {
          z.state = 'investigate';
          z.targetPos[0] = n.pos[0]; z.targetPos[1] = n.pos[1]; z.targetPos[2] = n.pos[2];
          z.pathTimer = 0;
          z.wanderT = rnd(4, 8);
        }
      }
    }
    ev.length = 0; // we own consumption
  }

  /* ---------- doors ---------- */
  function findBashDoor(z, dirX, dirZ) {
    if (!window.Level || !Level.data || !Level.data.doors) return null;
    const doors = Level.data.doors;
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      if (!d.closed) continue;
      const dx = d.pos[0] - z.pos[0], dz = d.pos[2] - z.pos[2];
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 1.25 || dist < 0.001) continue;
      if ((dx * dirX + dz * dirZ) / dist < 0.15) continue; // must be ahead
      if (Math.abs(d.pos[1] - z.pos[1]) > 2.2) continue;
      return d;
    }
    return null;
  }

  /* ---------- director ---------- */
  function aliveCount() {
    let n = 0;
    for (let i = 0; i < Z.list.length; i++) if (Z.list[i].alive) n++;
    return n;
  }

  function tryDirectorSpawn(pz, minDist, aheadOnly) {
    if (!window.Level || !Level.data || !Level.data.spawnPoints) return null;
    const pts = Level.data.spawnPoints;
    const ratio = Z.runnerRatio[clamp(pz, 0, 5)];
    for (let attempt = 0; attempt < 10; attempt++) {
      const p = pick(pts);
      if (p.zone > pz + 1) continue;
      if (aheadOnly && p.zone < pz) continue;
      const dx = p.pos[0] - G.player.pos[0], dz = p.pos[2] - G.player.pos[2];
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < minDist) continue;
      if (!pointBlockedFromPlayer(p.pos[0], p.pos[1], p.pos[2])) continue; // must NOT be in LOS
      const type = Math.random() < ratio ? 'run' : 'shamble';
      return spawn(type, p.pos);
    }
    return null;
  }

  function director(dt) {
    const pz = clamp(G.player.zone, 0, 5);
    // zone change: burst-spawn ahead + distant scream
    if (pz !== Z.lastZone) {
      const burst = 2 + ((Math.random() * 2) | 0);
      let screamPos = null;
      for (let i = 0; i < burst; i++) {
        if (aliveCount() >= Z.aliveCap) break;
        const z = tryDirectorSpawn(pz, 10, pz > Z.lastZone);
        if (z) screamPos = z.pos;
      }
      if (screamPos && window.AudioSys) AudioSys.scream(screamPos);
      Z.lastZone = pz;
      Z.spawnTimer = rnd(2.5, 5);
    }
    // gradual spawning under budget
    Z.spawnTimer -= dt;
    if (Z.spawnTimer <= 0) {
      Z.spawnTimer = rnd(2.5, 5);
      const budget = Z.budget[pz];
      if (aliveCount() < Math.min(budget, Z.aliveCap)) {
        let z = tryDirectorSpawn(pz, 12, false);
        if (!z) tryDirectorSpawn(pz, 8, false);
      }
    }
  }

  /* ---------- pose / animation ---------- */
  // limb: pivot at joint, rotate, hang half-length down. Writes part.model = parent * local.
  function limb(part, parent, px, py, pz, rx, rz, lenScale) {
    const len = part.sy * (lenScale || 1);
    const h = len * 0.5;
    const cr = Math.cos(rz), sr = Math.sin(rz);
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const ox = h * sr, oy = -h * cr * cx, oz = -h * cr * sx;
    compose(_local, px + ox, py + oy, pz + oz, rx, 0, rz, part.sx, len, part.sz);
    mulInto(part.r.model, parent, _local);
    // return joint-end point (for chaining forearm/shin) via scratch object
    limb.ex = px + ox * 2; limb.ey = py + oy * 2; limb.ez = pz + oz * 2;
  }

  function pose(z, t, dt) {
    const p = z.parts;
    const runner = z.type === 'run';
    const moving = z.moveAmt;
    const ph = z.phase;
    const s = Math.sin(ph), c = Math.sin(ph + Math.PI);

    // --- default joint angles ---
    let lean = z.leanBase * (0.3 + moving * 0.7);
    let twist = 0, rootRx = 0, rootRy = z.yaw, rootY = z.pos[1];
    let thL = 0, thR = 0, knL = 0.08, knR = 0.08;
    let uaL = z.armDangle, uaR = z.armDangle, elL = -0.12, elR = -0.12;
    let headRx = 0, headRy = z.headTurn, headRz = z.headTilt;
    let lunge = 0;
    const stiff = z.asymSide; // 0 = left stiff, 1 = right stiff

    if (z.state === 'dead') {
      // fall over 0.55s, then lie; limbs relax splayed
      const ft = clamp(z.deathT / 0.55, 0, 1);
      const ease = ft * ft * (3 - 2 * ft);
      rootRx = ease * z.fallSign * (Math.PI / 2) * 0.96;
      rootRy = z.yaw + ease * z.fallYaw;
      rootY = z.pos[1] + ease * 0.12 - Math.min(z.sinkT / 1.6, 1) * 0.4;
      lean = 0.05; twist = ease * 0.2 * z.fallSign;
      thL = 0.12 * ease; thR = -0.18 * ease; knL = 0.15; knR = 0.3 * ease;
      uaL = 0.5 * ease + 0.1; uaR = -0.3 * ease + 0.1; elL = -0.2; elR = -0.1;
      headRz = z.headTilt + ease * 0.4 * z.fallSign;
      headRx = ease * 0.25;
    } else if (z.state === 'stagger') {
      // directional flinch: fold away from incoming hit dir
      const fk = clamp(z.flinchT / 0.3, 0, 1);
      lean = -0.28 + z.flinchF * 0.24 * fk;
      twist = Math.sin(t * 17 + z.swaySeed) * 0.1 + z.flinchR * 0.35 * fk;
      uaL = 0.6 + Math.sin(t * 21) * 0.45;
      uaR = 0.6 + Math.sin(t * 19 + 2) * 0.45;
      elL = -0.5; elR = -0.5;
      thL = 0.2; thR = -0.15; knL = 0.3; knR = 0.2;
      headRx = -0.2 - z.flinchF * 0.18 * fk;
    } else if (z.state === 'attack' || (G.player.grabber === z && G.player.grabbed > 0)) {
      // 0.25s arms-coil telegraph, then lunge; hit lands at attackT 0.35 (contract)
      const at = z.state === 'attack' ? z.attackT : 0.5;
      if (at < 0.25) {
        const w = at / 0.25;
        lean = lerp(z.leanBase * 0.5, -0.14, w);
        uaL = lerp(z.armDangle, -0.62, w);
        uaR = lerp(z.armDangle, -0.55, w);
        elL = lerp(-0.12, -1.4, w); elR = lerp(-0.12, -1.35, w);
        thL = 0.3 * w; thR = -0.24 * w;
        knL = 0.12 + 0.5 * w; knR = 0.12 + 0.42 * w;
        headRx = -0.12 * w; headRy = 0;
      } else {
        // arms forward horizontal, lunge
        lunge = Math.sin(clamp((at - 0.25) / 0.2, 0, 1) * Math.PI) * 0.25;
        lean = 0.3;
        uaL = 1.35 + Math.sin(t * 13) * 0.06;
        uaR = 1.35 + Math.sin(t * 11 + 1) * 0.06;
        elL = 0.22; elR = 0.22;
        thL = 0.25; thR = -0.2; knL = 0.25; knR = 0.15;
        headRx = 0.12; headRy = 0;
      }
    } else if (z.state === 'bash') {
      // windup: raise arm, then slam
      const bt = z.bashT;
      const wind = clamp(bt / 0.7, 0, 1);
      const slam = bt > 0.85 ? clamp((bt - 0.85) / 0.2, 0, 1) : 0;
      uaR = lerp(0.2, 1.9, wind) - slam * 1.1;
      elR = -0.4 + slam * 0.5;
      uaL = 0.35; elL = -0.25;
      lean = 0.1 + wind * 0.12 - slam * 0.15;
      thL = 0.12; thR = -0.1;
    } else if (moving > 0.05) {
      // walk / run cycle — asymmetric shamble vs lean-forward sprint
      const amp = runner ? 0.9 : z.limpAmp;
      const stiffAmp = runner ? 0.75 : 0.15;
      const aL = stiff === 0 ? stiffAmp : amp;
      const aR = stiff === 1 ? stiffAmp : amp;
      thL = s * aL;
      thR = c * aR;
      knL = 0.12 + Math.max(0, Math.sin(ph - 1.0)) * (runner ? 1.0 : 0.55);
      knR = 0.12 + Math.max(0, Math.sin(ph + Math.PI - 1.0)) * (runner ? 1.0 : 0.4);
      if (runner) {
        lean = 0.35 + Math.sin(ph * 2) * 0.03;
        twist = s * 0.07;
        uaL = c * 0.75; uaR = s * 0.75;
        elL = -0.85; elR = -0.85;
        headRx = 0.1;
      } else {
        lean = z.leanBase + Math.sin(ph * 0.5 + z.swaySeed) * 0.035;
        twist = Math.sin(ph * 0.5 + z.swaySeed) * 0.05;
        // one arm dangles, other counter-swings weakly
        if (stiff === 0) { uaL = z.armDangle; uaR = s * 0.3; }
        else { uaR = z.armDangle; uaL = s * 0.3; }
        elL = -0.1 - Math.max(0, s) * 0.15;
        elR = -0.1 - Math.max(0, c) * 0.15;
        headRz = z.headTilt + Math.sin(ph * 0.5) * 0.04;
        // micro-hesitation: weight sags onto stiff leg mid-stride
        if (z.limpPause > 0) { lean += 0.07; knL += 0.12; knR += 0.1; }
        // uneven limp: vertical hitch baked into root below
      }
    } else {
      // idle: slow sway + random head twitch
      lean = z.leanBase * 0.4 + Math.sin(t * 0.5 + z.swaySeed) * 0.03;
      twist = Math.sin(t * 0.33 + z.swaySeed) * 0.04;
      uaL = z.armDangle + Math.sin(t * 0.7 + z.swaySeed) * 0.04;
      uaR = z.armDangle + Math.sin(t * 0.6 + z.swaySeed + 2) * 0.04;
      headRy = z.headTurn + z.twitchAmt * Math.sin(t * 43) * 0.3;
      headRz = z.headTilt + z.twitchAmt * Math.sin(t * 37) * 0.15;
    }

    // --- root matrix ---
    const fx = -Math.sin(z.yaw), fz = -Math.cos(z.yaw);
    let hitch = 0;
    if (!runner && moving > 0.05 && z.state !== 'dead') {
      hitch = Math.abs(Math.sin(ph)) * 0.035 * (stiff === 0 ? 1 : 0.6); // limp bob
    }
    compose(z._root,
      z.pos[0] + fx * lunge, rootY + hitch, z.pos[2] + fz * lunge,
      rootRx, rootRy, 0, 1, 1, 1);

    // --- upper body (lean/twist pivot at waist y~1.0) ---
    compose(_local, 0, 1.0, 0, lean, 0, twist, 1, 1, 1);
    mulInto(z._upper, z._root, _local);

    // pelvis (root space)
    compose(_local, 0, 0.95, 0, lean * 0.3, 0, twist * 0.4, p.pelvis.sx, p.pelvis.sy, p.pelvis.sz);
    mulInto(p.pelvis.r.model, z._root, _local);
    // torso
    compose(_local, 0, 0.25, 0, 0, 0, 0, p.torso.sx, p.torso.sy, p.torso.sz);
    mulInto(p.torso.r.model, z._upper, _local);
    // head
    compose(_local, 0, 0.62, 0, headRx, headRy, headRz, p.head.sx, p.head.sy, p.head.sz);
    mulInto(p.head.r.model, z._upper, _local);

    // arms: shoulders ±0.24, y1.42 (0.42 above waist pivot)
    limb(p.uaL, z._upper, -0.24, 0.42, 0, uaL, 0.06, 1);
    limb(p.faL, z._upper, limb.ex, limb.ey, limb.ez, uaL + elL, 0.03, 1);
    limb(p.uaR, z._upper, 0.24, 0.42, 0, uaR, -0.06, 1);
    limb(p.faR, z._upper, limb.ex, limb.ey, limb.ez, uaR + elR, -0.03, 1);

    // legs: hips ±0.11, y0.9 (root space)
    limb(p.thL, z._root, -0.11, 0.9, 0, thL, 0.02, 1);
    limb(p.shL, z._root, limb.ex, limb.ey, limb.ez, thL - knL, 0, 1);
    limb(p.thR, z._root, 0.11, 0.9, 0, thR, -0.02, 1);
    limb(p.shR, z._root, limb.ex, limb.ey, limb.ez, thR - knR, 0, 1);

    // shadow quad flat on floor
    const shScale = 0.8 + (z.state === 'dead' ? clamp(z.deathT / 0.55, 0, 1) * 0.7 : 0);
    compose(z.shadow.model, z.pos[0], z.pos[1] + 0.02, z.pos[2], -Math.PI / 2, 0, 0, shScale, shScale, 1);
  }

  function setVisible(z, v) {
    const p = z.parts;
    p.pelvis.r.visible = v; p.torso.r.visible = v; p.head.r.visible = v;
    p.uaL.r.visible = v; p.uaR.r.visible = v; p.faL.r.visible = v; p.faR.r.visible = v;
    p.thL.r.visible = v; p.thR.r.visible = v; p.shL.r.visible = v; p.shR.r.visible = v;
    z.shadow.visible = v;
  }

  function removeZombie(z) {
    if (z.removed) return;
    z.removed = true;
    const p = z.parts;
    Eng.scene.remove(p.pelvis.r); Eng.scene.remove(p.torso.r); Eng.scene.remove(p.head.r);
    Eng.scene.remove(p.uaL.r); Eng.scene.remove(p.uaR.r);
    Eng.scene.remove(p.faL.r); Eng.scene.remove(p.faR.r);
    Eng.scene.remove(p.thL.r); Eng.scene.remove(p.thR.r);
    Eng.scene.remove(p.shL.r); Eng.scene.remove(p.shR.r);
    Eng.scene.remove(z.shadow);
    const i = Z.list.indexOf(z);
    if (i >= 0) Z.list.splice(i, 1);
    if (G.player.grabber === z) { G.player.grabber = null; G.player.grabbed = 0; }
  }

  /* ---------- death ---------- */
  function die(z) {
    z.alive = false;
    z.state = 'dead';
    z.deathT = 0;
    z.sinkT = 0;
    z.hp = 0;
    z.kx = 0; z.kz = 0;
    if (G.player.grabber === z) { G.player.grabber = null; G.player.grabbed = 0; }
    G.player.kills++;
    if (window.AudioSys) AudioSys.deathRattle(z.pos);
    if (window.Feel && Feel.hitstop) Feel.hitstop(0.05, 0.3);
    if (window.AudioSys && AudioSys.bodyFall) AudioSys.bodyFall(z.pos);
    if (window.Decals && Decals.pool) Decals.pool(z.pos, rnd(0.9, 1.3));
    if (window.Level && Level.addDecal && Level.tex && Level.tex.blood) {
      Level.addDecal(z.pos, rnd(0.7, 1.0), Level.tex.blood, [0.32, 0.02, 0.02], 0.8, rnd(Math.PI * 2));
      z.decalT = 1.2; // second, larger pool decal grows in shortly
    }
    // corpse cap: remove oldest early
    let corpses = 0, oldest = null;
    for (let i = 0; i < Z.list.length; i++) {
      const c = Z.list[i];
      if (!c.alive && !c.removed) {
        corpses++;
        if (!oldest || c.deathT > oldest.deathT) oldest = c;
      }
    }
    if (corpses > Z.corpseCap && oldest) removeZombie(oldest);
  }

  /* ---------- public: damage / shove ---------- */
  function damage(z, dmg, dir, head) {
    if (!z || !z.alive) return;
    z.hp -= dmg;
    const hitY = z.pos[1] + (head ? 1.62 : 1.05);
    const hit = [z.pos[0], hitY, z.pos[2]];
    if (Eng.fx) {
      Eng.fx.burst(hit, head ? 16 : 9, {
        speed: 2.6, col: [0.35, 0.02, 0.02, 1], size: 0.045, life: 0.5, grav: 6, drag: 1.6, up: 0.6
      });
      if (head) {
        Eng.fx.burst(hit, 8, {
          speed: 3.6, col: [0.3, 0.015, 0.015, 1], size: 0.035, life: 0.4, grav: 7, drag: 1.2, up: 1.2
        });
      }
    }
    if (z.hp <= 0) { die(z); return; }
    // flinch
    z.stagger = Math.max(z.stagger, 0.25);
    z.state = 'stagger';
    if (dir) {
      const l = Math.sqrt(dir[0] * dir[0] + dir[2] * dir[2]) || 1;
      const nx = dir[0] / l, nz = dir[2] / l;
      z.kx += nx * 1.1;
      z.kz += nz * 1.1;
      // flinch folds away from the incoming direction (local fwd/right)
      z.flinchF = nx * -Math.sin(z.yaw) + nz * -Math.cos(z.yaw);
      z.flinchR = nx * Math.cos(z.yaw) + nz * -Math.sin(z.yaw);
      z.flinchT = 0.3;
    }
    setAggro(z); // shot survivors know where you are
    z.state = 'stagger'; // setAggro may have switched to chase; keep flinch
  }

  function shove(z, dir) {
    if (!z || !z.alive) return;
    z.stagger = 1.4;
    z.state = 'stagger';
    let dx = dir ? dir[0] : 0, dz = dir ? dir[2] : 0;
    const l = Math.sqrt(dx * dx + dz * dz);
    if (l > 0.001) { dx /= l; dz /= l; }
    else { dx = -Math.sin(z.yaw); dz = -Math.cos(z.yaw); }
    z.kx = dx * 3; z.kz = dz * 3;
    z.flinchF = dx * -Math.sin(z.yaw) + dz * -Math.cos(z.yaw);
    z.flinchR = dx * Math.cos(z.yaw) + dz * -Math.sin(z.yaw);
    z.flinchT = 0.4;
    if (G.player.grabber === z) { G.player.grabber = null; G.player.grabbed = 0; }
    if (Eng.fx) {
      Eng.fx.burst([z.pos[0], z.pos[1] + 1.1, z.pos[2]], 5, {
        speed: 1.8, col: [0.35, 0.02, 0.02, 1], size: 0.04, life: 0.4, grav: 6, drag: 1.5
      });
    }
    setAggro(z);
    z.state = 'stagger';
  }

  /* ---------- per-zombie update ---------- */
  function updateZombie(z, dt, t) {
    // ----- dead: fall, corpse sink, removal -----
    if (!z.alive) {
      z.deathT += dt;
      if (z.decalT > 0) {
        z.decalT -= dt;
        if (z.decalT <= 0 && window.Level && Level.addDecal && Level.tex && Level.tex.blood) {
          Level.addDecal([z.pos[0] + rnd(-0.2, 0.2), z.pos[1], z.pos[2] + rnd(-0.2, 0.2)],
            rnd(1.1, 1.5), Level.tex.blood, [0.25, 0.015, 0.015], 0.7, rnd(Math.PI * 2));
        }
      }
      if (z.deathT > 14) {
        z.sinkT += dt;
        if (z.sinkT > 1.7) { removeZombie(z); return; }
      }
      z.moveAmt = 0;
      pose(z, t, dt);
      return;
    }

    const playing = G.state === 'play';
    playerFeet(_pf);
    const dxp = _pf[0] - z.pos[0], dzp = _pf[2] - z.pos[2];
    const distP = Math.sqrt(dxp * dxp + dzp * dzp);

    // ----- timers -----
    z.attackCd -= dt;
    z.groanCd -= dt;
    z.losTimer -= dt;
    z.pathTimer -= dt;
    if (z.twitchAmt > 0) z.twitchAmt = Math.max(0, z.twitchAmt - dt * 3);
    z.twitchT -= dt;
    if (z.twitchT <= 0) { z.twitchT = rnd(1.5, 5.5); z.twitchAmt = 1; }
    if (z.flinchT > 0) z.flinchT = Math.max(0, z.flinchT - dt);
    // shamble micro-hesitations: brief limp pauses, never synced between zombies
    if (z.limpPause > 0) {
      z.limpPause -= dt;
    } else if (z.type !== 'run' &&
      (z.state === 'chase' || z.state === 'investigate' || z.state === 'wander')) {
      z.limpT -= dt;
      if (z.limpT <= 0) { z.limpPause = rnd(0.1, 0.3); z.limpT = rnd(1.1, 3.0); }
    }

    // ----- senses (throttled LOS) -----
    if (z.losTimer <= 0) {
      z.losTimer = 0.2 + rnd(0.05);
      const sight = G.player.flashlight ? 18 : 14;
      z.losClear = playing && distP < sight && losToPlayer(z);
    }
    if (playing && z.losClear && distP < (G.player.flashlight ? 18 : 14) &&
      z.state !== 'stagger' && z.state !== 'attack' && z.state !== 'bash') {
      setAggro(z);
    }

    // ----- state machine -----
    let dirX = 0, dirZ = 0, wantMove = 0, speedMul = 1;
    const spd = z.speed;

    switch (z.state) {
      case 'idle': {
        z.wanderT -= dt;
        if (z.wanderT <= 0) {
          z.wanderT = rnd(4, 10);
          const a = rnd(Math.PI * 2), r = rnd(1.5, 3.5);
          z.wanderTarget[0] = z.pos[0] + Math.cos(a) * r;
          z.wanderTarget[2] = z.pos[2] + Math.sin(a) * r;
          z.state = 'wander';
        }
        break;
      }
      case 'wander': {
        const dx = z.wanderTarget[0] - z.pos[0], dz = z.wanderTarget[2] - z.pos[2];
        const d = Math.sqrt(dx * dx + dz * dz);
        z.wanderT -= dt;
        if (d < 0.5 || z.wanderT <= 0) { z.state = 'idle'; z.wanderT = rnd(3, 8); break; }
        dirX = dx / d; dirZ = dz / d; wantMove = 1; speedMul = 0.35;
        break;
      }
      case 'investigate': {
        const dx = z.targetPos[0] - z.pos[0], dz = z.targetPos[2] - z.pos[2];
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < 0.8) { z.state = 'idle'; z.wanderT = rnd(2, 5); break; }
        steerToward(z, z.targetPos, dt);
        dirX = z._steerX; dirZ = z._steerZ; wantMove = 1; speedMul = z.type === 'run' ? 0.6 : 0.75;
        break;
      }
      case 'chase': {
        if (!playing) { z.state = z.aware ? 'investigate' : 'idle'; z.targetPos = _pf.slice(); break; }
        z.targetPos[0] = _pf[0]; z.targetPos[1] = _pf[1]; z.targetPos[2] = _pf[2];
        // grabbed: shamble with player, arms forward (pose handles it)
        const grabbing = G.player.grabber === z && G.player.grabbed > 0;
        if (distP < 1.05 && z.attackCd <= 0 && !grabbing) {
          z.state = 'attack'; z.attackT = 0; z.attackHit = false; z.limpPause = 0;
          break;
        }
        // door bash check
        const tx = distP > 0.001 ? dxp / distP : -Math.sin(z.yaw);
        const tz = distP > 0.001 ? dzp / distP : -Math.cos(z.yaw);
        const door = findBashDoor(z, tx, tz);
        if (door) { z.state = 'bash'; z.bashT = 0; z.bashDoor = door; break; }
        if (grabbing) {
          if (distP > 0.72) { dirX = tx; dirZ = tz; wantMove = 1; speedMul = 0.8; }
        } else {
          steerToward(z, z.targetPos, dt);
          dirX = z._steerX; dirZ = z._steerZ; wantMove = 1; speedMul = 1;
          // runner juke: small sine strafe perpendicular to the chase line
          if (z.type === 'run') {
            z.jukeT += dt * z.jukeFreq;
            const j = Math.sin(z.jukeT) * z.jukeAmp;
            const jx = dirX, jz = dirZ;
            dirX += -jz * j; dirZ += jx * j;
          }
        }
        break;
      }
      case 'attack': {
        z.attackT += dt;
        if (z.attackT >= 0.35 && !z.attackHit) {
          z.attackHit = true;
          if (playing && distP < 1.5 && G.player.hp > 0) {
            if (window.Combat) Combat.damage(7 + rnd(4), z.pos);
            G.player.grabbed = 1.1;
            G.player.grabber = z;
            if (window.AudioSys) AudioSys.grabAttack(z.pos);
            if (window.CameraRig) CameraRig.addShake(0.5);
          }
          z.attackCd = 1.6;
        }
        if (z.attackT > 0.6) z.state = 'chase';
        // coil 0..0.25s planted, then short lunge step (hit still lands at 0.35s)
        if (z.attackT >= 0.25 && z.attackT < 0.45) { dirX = -Math.sin(z.yaw); dirZ = -Math.cos(z.yaw); wantMove = 1; speedMul = 0.9; }
        break;
      }
      case 'bash': {
        z.bashT += dt;
        const d = z.bashDoor;
        if (!d || !d.closed) { z.state = z.aware ? 'chase' : 'investigate'; z.bashDoor = null; break; }
        // face the door
        const dx = d.pos[0] - z.pos[0], dz = d.pos[2] - z.pos[2];
        z.yaw = angLerp(z.yaw, Math.atan2(-dx, -dz), Math.min(1, dt * 8));
        if (z.bashT >= 1.1) {
          if (window.Level && Level.openDoor) Level.openDoor(d, true);
          if (window.AudioSys) AudioSys.doorBang(d.pos);
          G.emitNoise(d.pos, 26, 'door');
          z.bashDoor = null;
          z.state = z.aware ? 'chase' : 'investigate';
          z.pathTimer = 0;
        }
        break;
      }
      case 'stagger': {
        z.stagger -= dt;
        if (z.stagger <= 0) {
          z.state = z.aware ? 'chase' : 'idle';
          z.wanderT = rnd(2, 5);
        }
        break;
      }
    }

    // ----- separation (cheap O(n²), accumulated symmetrically in pairs below) -----
    dirX += z.sepX; dirZ += z.sepZ;

    // limp micro-hesitation: near-stop hitch (not while grabbing the player)
    if (z.limpPause > 0 && !(G.player.grabber === z && G.player.grabbed > 0)) speedMul *= 0.06;

    // ----- sidestep when stuck -----
    if (z.sideT > 0) {
      z.sideT -= dt;
      // perpendicular to desired dir (or facing)
      const bx = wantMove ? dirX : -Math.sin(z.yaw);
      const bz = wantMove ? dirZ : -Math.cos(z.yaw);
      dirX += -bz * z.sideDir * 0.9;
      dirZ += bx * z.sideDir * 0.9;
      wantMove = 1;
      if (speedMul < 0.6) speedMul = 0.6;
    }

    // ----- movement -----
    let moved = 0;
    const dl = Math.sqrt(dirX * dirX + dirZ * dirZ);
    if (wantMove && dl > 0.001) {
      dirX /= dl; dirZ /= dl;
      const v = spd * speedMul;
      let mx = dirX * v * dt + z.kx * dt;
      let mz = dirZ * v * dt + z.kz * dt;
      const oldX = z.pos[0], oldZ = z.pos[2];
      if (window.Level && Level.moveCircle) {
        const np = Level.moveCircle(z.pos[0], z.pos[2], z.radius, mx, mz);
        z.pos[0] = np[0]; z.pos[2] = np[1];
      } else { z.pos[0] += mx; z.pos[2] += mz; }
      moved = Math.sqrt((z.pos[0] - oldX) ** 2 + (z.pos[2] - oldZ) ** 2);
      // face movement dir
      const targetYaw = Math.atan2(-dirX, -dirZ);
      z.yaw = angLerp(z.yaw, targetYaw, Math.min(1, dt * (z.type === 'run' ? 10 : 6)));
      z.moveAmt = lerp(z.moveAmt, clamp(speedMul, 0, 1), Math.min(1, dt * 8));
    } else {
      // knockback only (stagger)
      if (Math.abs(z.kx) > 0.01 || Math.abs(z.kz) > 0.01) {
        const oldX = z.pos[0], oldZ = z.pos[2];
        if (window.Level && Level.moveCircle) {
          const np = Level.moveCircle(z.pos[0], z.pos[2], z.radius, z.kx * dt, z.kz * dt);
          z.pos[0] = np[0]; z.pos[2] = np[1];
        } else { z.pos[0] += z.kx * dt; z.pos[2] += z.kz * dt; }
        moved = Math.sqrt((z.pos[0] - oldX) ** 2 + (z.pos[2] - oldZ) ** 2);
      }
      z.moveAmt = lerp(z.moveAmt, 0, Math.min(1, dt * 6));
    }
    // knockback decay
    const kd = Math.max(0, 1 - 5 * dt);
    z.kx *= kd; z.kz *= kd;

    // feet on floor
    if (window.Level && Level.floorHeight) z.pos[1] = Level.floorHeight(z.pos[0], z.pos[2]);

    // ----- stuck detection: repath / sidestep -----
    const trying = (z.state === 'chase' || z.state === 'investigate' || z.state === 'wander') && wantMove;
    if (trying && moved < 0.1 * dt && z.limpPause <= 0) {
      z.stuckT += dt;
      if (z.stuckT > 1) {
        z.stuckT = 0;
        z.sideT = rnd(0.5, 0.9);
        z.sideDir = Math.random() < 0.5 ? 1 : -1;
        z.pathTimer = 0; // force repath
      }
    } else z.stuckT = 0;

    // ----- animation phase (per-zombie freq, never synced; hitch during limp pause) -----
    z.phase += dt * z.freq * (0.25 + z.moveAmt * 0.9) * (z.limpPause > 0 ? 0.25 : 1);

    // ----- groans -----
    if (z.groanCd <= 0) {
      let kind = 'idle';
      if (z.state === 'chase' || z.state === 'attack') kind = z.type === 'run' ? 'run' : 'aggro';
      else if (z.state === 'investigate' || z.state === 'wander' || z.state === 'bash') kind = 'shamble';
      if (window.AudioSys) AudioSys.groan(z.pos, kind);
      z.groanCd = (z.state === 'chase' || z.state === 'attack') ? rnd(2, 5) : rnd(3, 9);
    }

    // ----- distance cull + pose -----
    const camD = V3.dist(z.pos, Eng.camera.pos);
    const vis = camD < 48;
    if (z.shadow.visible !== vis || z.parts.head.r.visible !== vis) setVisible(z, vis);
    if (vis) pose(z, t, dt);
  }

  // steering: direct when LOS, else BFS waypoint chain
  function steerToward(z, target, dt) {
    const dx = target[0] - z.pos[0], dz = target[2] - z.pos[2];
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.001) { z._steerX = 0; z._steerZ = 0; return; }
    // direct steer when LOS to the target (player chase uses cached losClear)
    const isPlayer = target === z.targetPos && z.state === 'chase';
    if (isPlayer && z.losClear) {
      z._steerX = dx / d; z._steerZ = dz / d;
      z.path.length = 0;
      return;
    }
    // repath every 0.7s or target moved >3m
    const lpt = z.lastPathTarget;
    const tmove = Math.sqrt((target[0] - lpt[0]) ** 2 + (target[2] - lpt[2]) ** 2);
    if (z.pathTimer <= 0 || tmove > 3 || z.path.length === 0) {
      z.pathTimer = 0.7;
      lpt[0] = target[0]; lpt[1] = target[1]; lpt[2] = target[2];
      bfsPath(z, target[0], target[1], target[2]);
    }
    // follow node chain
    if (z.path.length > 0 && z.pathIdx < z.path.length) {
      let node = z.path[z.pathIdx];
      let nd = V3.distXZ(z.pos, node);
      while (nd < 0.6 && z.pathIdx < z.path.length - 1) {
        z.pathIdx++;
        node = z.path[z.pathIdx];
        nd = V3.distXZ(z.pos, node);
      }
      if (z.pathIdx >= z.path.length - 1 && nd < 0.9) {
        // last node reached → head straight for target
        z._steerX = dx / d; z._steerZ = dz / d;
        return;
      }
      const nx = node[0] - z.pos[0], nz = node[2] - z.pos[2];
      const nl = Math.sqrt(nx * nx + nz * nz) || 1;
      z._steerX = nx / nl; z._steerZ = nz / nl;
      return;
    }
    // no path found → direct (moveCircle will slide; stuck logic handles walls)
    z._steerX = dx / d; z._steerZ = dz / d;
  }

  /* ---------- main update ---------- */
  function update(dt) {
    const t = Eng.time;
    consumeNoise();

    // separation accumulation (reset, then symmetric pairs)
    const L = Z.list;
    for (let i = 0; i < L.length; i++) { L[i].sepX = 0; L[i].sepZ = 0; }
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (!b.alive) continue;
        const dx = a.pos[0] - b.pos[0], dz = a.pos[2] - b.pos[2];
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.49 || d2 < 0.0001) continue; // 0.7m
        const d = Math.sqrt(d2);
        const push = (0.7 - d) * 1.4 / d;
        a.sepX += dx * push; a.sepZ += dz * push;
        b.sepX -= dx * push; b.sepZ -= dz * push;
      }
    }

    for (let i = L.length - 1; i >= 0; i--) {
      updateZombie(L[i], dt, t); // may splice via removeZombie (reverse loop safe)
    }

    // grab struggle: oscillating yaw wobble the camera rig can read
    if (G.player.grabbed > 0 && G.player.grabber && G.player.grabber.alive) {
      const gs = G.player.grabber.swaySeed;
      G.player.grabWobble = Math.sin(t * 12.7 + gs) * 0.03 + Math.sin(t * 6.1 + gs * 2) * 0.018;
    } else if (G.player.grabWobble) {
      G.player.grabWobble *= Math.max(0, 1 - dt * 10);
    }

    // director + threat only while playing
    if (G.state === 'play') {
      director(dt);
      let threat = 0;
      playerFeet(_pf);
      for (let i = 0; i < L.length; i++) {
        const z = L[i];
        if (!z.alive) continue;
        if (z.state === 'chase' || z.state === 'attack' || z.state === 'bash') {
          const th = 1 - V3.distXZ(z.pos, _pf) / 12;
          if (th > threat) threat = th;
        }
      }
      if (G.player.grabbed > 0) threat = 1;
      G.threat = clamp(threat, 0, 1);
    }
  }

  /* ---------- export ---------- */
  window.Zombies = {
    list: Z.list,
    init,
    spawn,
    update,
    damage,
    shove
  };

})();