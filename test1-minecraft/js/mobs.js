/* mobs.js — pigs, sheep and zombies: box models, wander/chase/flee AI, spawning. AGENT mobs.
 * Mob origin = feet center (x,y,z); local forward = (0,0,-1), yaw matches the player
 * convention: world forward = (-sin yaw, 0, -cos yaw). getBoxes() returns FINAL
 * world-space boxes for Util.m4.boxModel(cx,cy,cz,sx,sy,sz,rx,ry) (T*Ry*Rx*S).
 * Box arrays are preallocated per mob and rewritten in place each frame. */
window.Mobs = (function () {
  'use strict';

  const GRAVITY = 32;
  const WALK_SPEED = 1.2, FLEE_SPEED = 2.6, CHASE_SPEED = 1.6;
  const JUMP_VY = 8;
  const ANIMAL_CAP = 10, ZOMBIE_CAP = 6, TOTAL_CAP = 16;
  const SPAWN_EVERY = 1.5, SPAWN_ATTEMPTS = 3;
  const DESPAWN_DIST = 68;
  const CHASE_RANGE = 14, ATTACK_RANGE = 1.15, ATTACK_COOLDOWN = 1.0;
  const FLEE_RANGE = 0.9, FLEE_TIME = 2.5;
  const SOUND_RANGE = 18;
  const TAU = Math.PI * 2;

  /* ---- shared palette (0..255) ---- */
  const C_PIG_BODY = [240, 160, 150], C_PIG_SNOUT = [250, 190, 180],
        C_PIG_LEG = [220, 140, 130], C_PIG_NOSTRIL = [150, 90, 85];
  const C_WOOL = [235, 235, 235], C_SHEEP_HEAD = [220, 210, 200],
        C_SHEEP_LEG = [200, 190, 180], C_EYE = [25, 25, 25];
  const C_Z_SKIN = [90, 140, 80], C_Z_SHIRT = [60, 110, 130],
        C_Z_PANTS = [60, 60, 130], C_Z_EYE = [20, 35, 20];

  const list = [];
  let rng = Math.random;
  let spawnTimer = 0;
  let elapsed = 0;

  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);

  /* ---- rotation helpers (match Util.m4.boxModel: Ry then Rx, about box center) ---- */
  /* rotY/rotX reproduce boxModel's columns exactly. NOTE: boxModel's Ry maps local
   * forward (0,0,-1) to (sin ry, 0, -cos ry) — opposite handedness to the player yaw
   * convention (forward = (-sin yaw, 0, -cos yaw)). So boxes are emitted with
   * ry = -mob.yaw (and centers rotated by the same angle) to make the model FACE
   * the direction the mob walks. */
  function rotYx(px, pz, yaw) { return Math.cos(yaw) * px - Math.sin(yaw) * pz; }
  function rotYz(px, pz, yaw) { return Math.sin(yaw) * px + Math.cos(yaw) * pz; }
  /* offset (0,oy,oz) rotated by rx about a pivot: y' = c*oy - s*oz, z' = s*oy + c*oz */
  function rotXy(oy, oz, rx) { return Math.cos(rx) * oy - Math.sin(rx) * oz; }
  function rotXz(oy, oz, rx) { return Math.sin(rx) * oy + Math.cos(rx) * oz; }

  function setBox(b, cx, cy, cz, sx, sy, sz, rx, ry, color) {
    b.cx = cx; b.cy = cy; b.cz = cz;
    b.sx = sx; b.sy = sy; b.sz = sz;
    b.rx = rx; b.ry = ry; b.color = color;
  }

  /* Limb rotated by rx about a local pivot (hip/shoulder), then yaw-rotated about
   * the mob origin. ox,oy,oz = pivot; offY,offZ = box-center offset from pivot. */
  function limbBox(b, m, ox, oy, oz, offY, offZ, sx, sy, sz, rx, color) {
    const yaw = -m.yaw; /* visual yaw — see rotY note above */
    const ly = oy + rotXy(offY, offZ, rx);
    const lz = oz + rotXz(offY, offZ, rx);
    setBox(b,
      m.x + rotYx(ox, lz, yaw), m.y + ly, m.z + rotYz(ox, lz, yaw),
      sx, sy, sz, rx, yaw, color);
  }

  /* ---- models (local forward = -Z; all boxes yaw-rotated about mob origin) ---- */
  function fillPig(m) {
    const B = m.boxes, yaw = -m.yaw, hy = -(m.yaw + m.headYaw);
    const s = Math.sin(m.walkPhase) * m.amp;
    setBox(B[0], m.x, m.y + 0.65, m.z, 0.55, 0.5, 0.9, 0, yaw, C_PIG_BODY);
    /* head (idle look wander baked into headYaw) */
    const hz = -0.55;
    const hx = m.x + rotYx(0, hz, hy), hcz = m.z + rotYz(0, hz, hy);
    setBox(B[1], hx, m.y + 0.7, hcz, 0.5, 0.5, 0.5, 0, hy, C_PIG_BODY);
    /* snout on head front */
    const sz = -0.31;
    setBox(B[2], hx + rotYx(0, sz, hy), m.y + 0.62, hcz + rotYz(0, sz, hy),
      0.25, 0.2, 0.15, 0, hy, C_PIG_SNOUT);
    /* two dark nostril pixels */
    const nz = -0.395;
    setBox(B[3], hx + rotYx(-0.06, nz, hy), m.y + 0.63, hcz + rotYz(-0.06, nz, hy),
      0.05, 0.06, 0.02, 0, hy, C_PIG_NOSTRIL);
    setBox(B[4], hx + rotYx(0.06, nz, hy), m.y + 0.63, hcz + rotYz(0.06, nz, hy),
      0.05, 0.06, 0.02, 0, hy, C_PIG_NOSTRIL);
    /* legs swing about hips (y 0.45), alternating diagonal pairs */
    limbBox(B[5], m, -0.17, 0.45, -0.28, -0.225, 0, 0.2, 0.45, 0.2, s, C_PIG_LEG);
    limbBox(B[6], m, 0.17, 0.45, -0.28, -0.225, 0, 0.2, 0.45, 0.2, -s, C_PIG_LEG);
    limbBox(B[7], m, -0.17, 0.45, 0.28, -0.225, 0, 0.2, 0.45, 0.2, -s, C_PIG_LEG);
    limbBox(B[8], m, 0.17, 0.45, 0.28, -0.225, 0, 0.2, 0.45, 0.2, s, C_PIG_LEG);
  }

  function fillSheep(m) {
    const B = m.boxes, yaw = -m.yaw, hy = -(m.yaw + m.headYaw);
    const s = Math.sin(m.walkPhase) * m.amp;
    /* fluffy wool body (slightly bigger than the frame) */
    setBox(B[0], m.x, m.y + 0.72, m.z, 0.6, 0.6, 0.95, 0, yaw, C_WOOL);
    const hz = -0.6;
    const hx = m.x + rotYx(0, hz, hy), hcz = m.z + rotYz(0, hz, hy);
    setBox(B[1], hx, m.y + 0.85, hcz, 0.4, 0.4, 0.4, 0, hy, C_SHEEP_HEAD);
    /* wool tuft on top of head */
    setBox(B[2], hx + rotYx(0, 0.05, hy), m.y + 1.08, hcz + rotYz(0, 0.05, hy),
      0.3, 0.14, 0.3, 0, hy, C_WOOL);
    /* eyes */
    const ez = -0.21;
    setBox(B[3], hx + rotYx(-0.1, ez, hy), m.y + 0.9, hcz + rotYz(-0.1, ez, hy),
      0.06, 0.06, 0.02, 0, hy, C_EYE);
    setBox(B[4], hx + rotYx(0.1, ez, hy), m.y + 0.9, hcz + rotYz(0.1, ez, hy),
      0.06, 0.06, 0.02, 0, hy, C_EYE);
    /* thin legs, hips y 0.45 */
    limbBox(B[5], m, -0.18, 0.45, -0.28, -0.225, 0, 0.18, 0.45, 0.18, s, C_SHEEP_LEG);
    limbBox(B[6], m, 0.18, 0.45, -0.28, -0.225, 0, 0.18, 0.45, 0.18, -s, C_SHEEP_LEG);
    limbBox(B[7], m, -0.18, 0.45, 0.28, -0.225, 0, 0.18, 0.45, 0.18, -s, C_SHEEP_LEG);
    limbBox(B[8], m, 0.18, 0.45, 0.28, -0.225, 0, 0.18, 0.45, 0.18, s, C_SHEEP_LEG);
  }

  function fillZombie(m) {
    const B = m.boxes, yaw = -m.yaw, hy = -(m.yaw + m.headYaw);
    const s = Math.sin(m.walkPhase) * m.amp;
    /* head 0.5 cube, top at 1.95 */
    setBox(B[0], m.x, m.y + 1.7, m.z, 0.5, 0.5, 0.5, 0, hy, C_Z_SKIN);
    /* dark eyes on face front */
    const ez = -0.26;
    setBox(B[1], m.x + rotYx(-0.11, ez, hy), m.y + 1.75, m.z + rotYz(-0.11, ez, hy),
      0.08, 0.06, 0.04, 0, hy, C_Z_EYE);
    setBox(B[2], m.x + rotYx(0.11, ez, hy), m.y + 1.75, m.z + rotYz(0.11, ez, hy),
      0.08, 0.06, 0.04, 0, hy, C_Z_EYE);
    /* teal shirt body */
    setBox(B[3], m.x, m.y + 1.1, m.z, 0.5, 0.7, 0.28, 0, yaw, C_Z_SHIRT);
    /* arms held FORWARD: rx ~ -PI/2 about shoulder, slight sway.
     * boxModel's Rx maps local down (0,-1,0) to +Z at rx=-PI/2, so the shoulder
     * pivot sits at the box's -Y end (offset +0.3): the rotated center lands
     * 0.3 ahead of the shoulder and the 0.6-long box extends forward from it. */
    const sway = Math.sin(elapsed * 1.8 + m.phase) * 0.07;
    const armRx = -Math.PI / 2 + sway;
    limbBox(B[4], m, -0.36, 1.38, 0, 0.3, 0, 0.22, 0.6, 0.22, armRx, C_Z_SKIN);
    limbBox(B[5], m, 0.36, 1.38, 0, 0.3, 0, 0.22, 0.6, 0.22, armRx, C_Z_SKIN);
    /* legs swing from hips y 0.75 */
    limbBox(B[6], m, -0.13, 0.75, 0, -0.375, 0, 0.24, 0.75, 0.24, s, C_Z_PANTS);
    limbBox(B[7], m, 0.13, 0.75, 0, -0.375, 0, 0.24, 0.75, 0.24, -s, C_Z_PANTS);
  }

  const FILL = { pig: fillPig, sheep: fillSheep, zombie: fillZombie };

  function getBoxes() {
    FILL[this.type](this);
    return this.boxes;
  }

  /* ---- creation ---- */
  function createMob(type, x, y, z) {
    const animal = type !== 'zombie';
    const m = {
      type: type,
      /* physics body (Util.Physics.step mutates these) */
      x: x, y: y, z: z,
      w: animal ? 0.9 : 0.6, h: animal ? 0.95 : 1.95,
      vx: 0, vy: 0, vz: 0, onGround: false,
      /* AI */
      yaw: rng() * TAU,
      mode: 'idle',
      stateTimer: 1 + rng() * 3,
      turnCooldown: 0,
      fleeTimer: 0,
      attackCooldown: 0,
      soundTimer: 6 + rng() * 10,
      /* animation */
      walkPhase: rng() * TAU,
      amp: 0,
      headYaw: 0,
      phase: rng() * TAU,
      boxes: null,
      getBoxes: getBoxes
    };
    const n = type === 'zombie' ? 8 : 9; /* pig 9, sheep 9, zombie 8 */
    m.boxes = new Array(n);
    for (let i = 0; i < n; i++) {
      m.boxes[i] = { cx: 0, cy: 0, cz: 0, sx: 0, sy: 0, sz: 0, rx: 0, ry: 0, color: C_EYE };
    }
    return m;
  }

  /* ---- spawning ---- */
  function countType(type) {
    let n = 0;
    for (let i = 0; i < list.length; i++) if (list[i].type === type) n++;
    return n;
  }

  function trySpawn(df, px, pz) {
    const animals = df > 0.5;
    const zombies = df < 0.25;
    if (!animals && !zombies) return;
    if (animals && countType('pig') + countType('sheep') >= ANIMAL_CAP) return;
    if (zombies && countType('zombie') >= ZOMBIE_CAP) return;

    const ang = rng() * TAU;
    const dist = 20 + rng() * 24;
    const x = Math.floor(px + Math.cos(ang) * dist);
    const z = Math.floor(pz + Math.sin(ang) * dist);
    if (!World.hasChunk(Math.floor(x / 16), Math.floor(z / 16))) return;
    const sy = World.surfaceY(x, z);
    if (sy < 1 || sy > 120) return;
    const ground = World.get(x, sy, z);
    if (ground === 0 || ground === 11) return; /* reject air/water surface */
    if (animals) {
      if (ground !== 1 && ground !== 15) return; /* grass or snow only */
    } else if (!Blocks.BY_ID[ground] || !Blocks.BY_ID[ground].solid) {
      return; /* zombies: any solid non-water */
    }
    /* clearance above surface (2 air for animals, full zombie height) */
    const need = animals ? 2 : 3;
    for (let i = 1; i <= need; i++) {
      const id = World.get(x, sy + i, z);
      if (id !== 0) return;
    }
    const y = sy + 1;
    if (World.isSolid(x, y, z) || World.isSolid(x, y + 1, z)) return;
    const type = animals ? (rng() < 0.5 ? 'pig' : 'sheep') : 'zombie';
    if (intersectsBlock(x, y, z)) return; /* never spawn inside another mob */
    list.push(createMob(type, x + 0.5, y, z + 0.5));
  }

  function intersectsMobAABB(m, bx, by, bz) {
    const hw = m.w / 2;
    return m.x + hw > bx && m.x - hw < bx + 1 &&
           m.y + m.h > by && m.y < by + 1 &&
           m.z + hw > bz && m.z - hw < bz + 1;
  }

  /* ---- AI helpers ---- */
  function pickWander(m) {
    if (rng() < 0.3) {
      m.mode = 'idle';
    } else {
      m.mode = 'walk';
      m.yaw += (rng() * 2 - 1) * 2.5;
    }
    m.stateTimer = 2 + rng() * 4;
  }

  /* water / cliff avoidance; returns true if the mob turned around */
  function avoidHazards(m, fx, fz) {
    if (m.turnCooldown > 0) return false;
    const ax = m.x + fx * 1.2, az = m.z + fz * 1.2;
    const bx = Math.floor(ax), bz = Math.floor(az);
    const fy = Math.floor(m.y);
    /* water ahead at feet (or the surface just below) -> turn around */
    if (World.get(bx, fy, bz) === 11 || World.get(bx, fy - 1, bz) === 11) {
      m.yaw += Math.PI + (rng() - 0.5) * 0.6;
      m.turnCooldown = 0.8;
      return true;
    }
    /* cliff: ground 2 blocks ahead drops more than 3 -> turn around */
    const cx2 = Math.floor(m.x + fx * 2), cz2 = Math.floor(m.z + fz * 2);
    let ground = -1;
    for (let y = fy; y >= fy - 5; y--) {
      if (World.isSolid(cx2, y, cz2)) { ground = y; break; }
    }
    if (ground < 0 || fy - ground > 3) {
      m.yaw += Math.PI + (rng() - 0.5) * 0.6;
      m.turnCooldown = 0.8;
      return true;
    }
    return false;
  }

  function playSound(name, vol) {
    if (window.Audio && Audio.play) Audio.play(name, { vol: vol });
  }

  /* ---- per-mob update ---- */
  function updateMob(m, dt, df, px, pz, player) {
    const dx = px - m.x, dz = pz - m.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const animal = m.type !== 'zombie';

    /* zombies burn away in daylight */
    if (!animal && df > 0.6) return false;

    m.attackCooldown -= dt;
    m.turnCooldown -= dt;
    m.soundTimer -= dt;
    if (m.soundTimer <= 0) {
      m.soundTimer = 6 + rng() * 10;
      if (dist < SOUND_RANGE) {
        const name = m.type === 'pig' ? 'oink' : m.type === 'sheep' ? 'baa' : 'groan';
        playSound(name, clamp(1 - dist / 20, 0.15, 0.7));
      }
    }

    let speed = 0;
    if (animal) {
      /* sprint-bump -> flee away from the player */
      if (dist < FLEE_RANGE && player && player.sprinting) {
        m.mode = 'flee';
        m.fleeTimer = FLEE_TIME;
      }
      if (m.mode === 'flee') {
        m.fleeTimer -= dt;
        if (m.fleeTimer <= 0) {
          m.mode = 'idle';
          m.stateTimer = 1 + rng() * 2;
        } else {
          if (dist > 0.001) m.yaw = Math.atan2(dx, dz); /* face AWAY from player */
          speed = FLEE_SPEED;
        }
      } else {
        m.stateTimer -= dt;
        if (m.stateTimer <= 0) pickWander(m);
        if (m.mode === 'walk') speed = WALK_SPEED;
      }
    } else {
      /* zombie: chase the player at night, otherwise wander */
      if (dist < CHASE_RANGE) {
        m.mode = 'chase';
        if (dist > 0.001) m.yaw = Math.atan2(-dx, -dz);
        speed = CHASE_SPEED;
        if (dist < ATTACK_RANGE && m.attackCooldown <= 0) {
          m.attackCooldown = ATTACK_COOLDOWN;
          if (player && player.damage) player.damage(2, m.x, m.z);
          playSound('groan', 0.8);
        }
      } else {
        if (m.mode === 'chase') { m.mode = 'idle'; m.stateTimer = 0.5; }
        m.stateTimer -= dt;
        if (m.stateTimer <= 0) pickWander(m);
        if (m.mode === 'walk') speed = WALK_SPEED;
      }
    }

    const fx = -Math.sin(m.yaw), fz = -Math.cos(m.yaw);
    if (speed > 0 && avoidHazards(m, fx, fz)) speed = 0;

    m.vx = fx * speed;
    m.vz = fz * speed;
    m.vy -= GRAVITY * dt;
    const hit = Util.Physics.step(World, m, dt);
    if ((hit.hitX || hit.hitZ) && m.onGround) m.vy = JUMP_VY;

    /* animation: leg swing from actual speed (amplitude eases to 0 when idle),
     * smooth head turn */
    m.walkPhase += speed * dt * 4;
    m.amp += ((speed > 0 ? 0.6 : 0) - m.amp) * Math.min(1, dt * 10);
    const targetHead = m.mode === 'idle' ? Math.sin(elapsed * 0.3 + m.phase) * 0.3 : 0;
    m.headYaw += (targetHead - m.headYaw) * Math.min(1, dt * 8);
    return true;
  }

  /* ---- public update ---- */
  function update(dt) {
    if (!window.Game || Game.state !== 'playing') return;
    if (!(dt > 0) || !isFinite(dt)) return;
    elapsed += dt;
    const df = (typeof Game.dayFactor === 'number') ? Game.dayFactor : 1;
    const player = window.Player;
    const px = player ? player.x : 0;
    const pz = player ? player.z : 0;

    /* despawn far mobs (and daylight zombies) */
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      const dx = m.x - px, dz = m.z - pz;
      if (dx * dx + dz * dz > DESPAWN_DIST * DESPAWN_DIST ||
          (m.type === 'zombie' && df > 0.6)) {
        list.splice(i, 1);
      }
    }

    /* spawning */
    spawnTimer += dt;
    if (spawnTimer >= SPAWN_EVERY) {
      spawnTimer = 0;
      if (list.length < TOTAL_CAP) {
        for (let a = 0; a < SPAWN_ATTEMPTS && list.length < TOTAL_CAP; a++) {
          trySpawn(df, px, pz);
        }
      }
    }

    for (let i = list.length - 1; i >= 0; i--) {
      if (!updateMob(list[i], dt, df, px, pz, player)) list.splice(i, 1);
    }
  }

  function init() {
    list.length = 0;
    spawnTimer = 0;
    elapsed = 0;
    const seed = (window.World && typeof World.seed === 'number') ? World.seed : 1;
    rng = Util.mulberry32((seed ^ 0x51ab3d) >>> 0);
  }

  function clear() { list.length = 0; }

  function intersectsBlock(x, y, z) {
    for (let i = 0; i < list.length; i++) {
      if (intersectsMobAABB(list[i], x, y, z)) return true;
    }
    return false;
  }

  return {
    init: init,
    update: update,
    list: list,
    clear: clear,
    intersectsBlock: intersectsBlock
  };
})();
