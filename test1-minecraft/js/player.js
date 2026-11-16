/* player.js — input, physics, break/place, health, swimming, flying. AGENT player. */
window.Player = (function () {
  'use strict';

  /* ---- constants (SPEC) ---- */
  const W = 0.6, H = 1.8, HW = W / 2, EYE = 1.62;
  const GRAVITY = 32, JUMP_VEL = 8.8;
  const WALK_SPEED = 4.3, SPRINT_SPEED = 5.6;
  const ACCEL_GROUND = 40, ACCEL_AIR = 8;
  const WATER_SPEED = 2.2, WATER_GRAVITY = 6, SWIM_UP = 3.5;
  const FLY_SPEED = 8, FLY_SPRINT = 16;
  const SENS = 0.0022, PITCH_LIMIT = Math.PI / 2 - 0.01;
  const REACH = 5.5;
  const MAX_HEALTH = 20, INVULN_TIME = 0.5, REGEN_INTERVAL = 4;
  const PLACE_COOLDOWN = 0.22, PLACE_REPEAT = 0.25;
  const DIG_TICK = 0.25, STEP_DIST = 2.0;
  const DOUBLE_TAP = 0.35;

  /* ---- exposed state; this object IS the physics body (Util.Physics.step mutates it) ---- */
  const P = {
    x: 0, y: 64, z: 0,
    vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0,
    w: W, h: H,
    onGround: false, inWater: false, headUnderwater: false,
    flying: false, sprinting: false,
    health: MAX_HEALTH, selected: 0,
    hotbar: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    breakProgress: 0, fallDistance: 0,
    swing: 0, walkPhase: 0
  };

  /* ---- internal state ---- */
  let canvas = null, initialized = false;
  const keys = new Set();
  let mouseL = false, mouseR = false, placeRequest = false;
  let invulnTimer = 0, placeCooldown = 0, regenTimer = 0;
  let digTimer = 0, breakTarget = null, stepDist = 0;
  let lastSpaceTime = -1e9;

  /* keys we swallow while playing (scroll / browser shortcuts) */
  const PREVENT_CODES = new Set([
    'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'F3',
    'Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4',
    'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'
  ]);

  /* ---- guarded helpers (load-order safe) ---- */
  function playing() { return !!(window.Game && Game.state === 'playing'); }
  function locked() { return !!canvas && document.pointerLockElement === canvas; }
  /* fallback for environments where pointer lock is unavailable (embedded panes):
     plain mouse movement drives look once a lock attempt has failed */
  function lookActive() { return locked() || !!(P.fallbackLook && playing()); }
  function play(name, opts) { if (window.Audio && Audio.play) Audio.play(name, opts); }
  function flash() { if (window.UI && UI.damageFlash) UI.damageFlash(); }
  function setSelection(hit) { if (window.Renderer && Renderer.setSelection) Renderer.setSelection(hit || null); }
  function setCrack(hit, p) { if (window.Renderer && Renderer.setCrack) Renderer.setCrack(hit || null, p); }
  function particles(x, y, z, id, n) { if (window.Renderer && Renderer.spawnBlockParticles) Renderer.spawnBlockParticles(x, y, z, id, n); }
  function splash(x, y, z) { if (window.Renderer && Renderer.spawnSplash) Renderer.spawnSplash(x, y, z); }
  function isTyping(el) {
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  }

  /* ---- input handlers ---- */
  function onKeyDown(e) {
    if (isTyping(e.target)) return;
    const code = e.code;
    if (PREVENT_CODES.has(code) && playing()) e.preventDefault();
    keys.add(code);
    if (code === 'Space' && !e.repeat && playing()) {
      const now = performance.now() * 0.001;
      if (now - lastSpaceTime <= DOUBLE_TAP) {
        P.flying = !P.flying;
        if (P.flying) P.vy = 0;
        lastSpaceTime = -1e9; // consume: a 3rd tap starts a fresh pair
      } else {
        lastSpaceTime = now;
      }
    }
    if (playing() && code.length === 6 && code.indexOf('Digit') === 0) {
      const d = code.charCodeAt(5) - 48;
      if (d >= 0 && d <= 9) P.selected = d === 0 ? 9 : d - 1;
    }
  }
  function onKeyUp(e) { keys.delete(e.code); }

  function onMouseMove(e) {
    if (!lookActive() || !playing()) return;
    P.yaw -= e.movementX * SENS;
    P.pitch = Util.clamp(P.pitch - e.movementY * SENS, -PITCH_LIMIT, PITCH_LIMIT);
  }
  function onMouseDown(e) {
    if (!lookActive() || !playing()) return;
    if (e.button === 0) mouseL = true;
    else if (e.button === 2) { mouseR = true; placeRequest = true; }
    e.preventDefault();
  }
  function onMouseUp(e) {
    if (e.button === 0) mouseL = false;
    else if (e.button === 2) { mouseR = false; placeRequest = false; }
  }
  function onWheel(e) {
    if (!lookActive() || !playing()) return;
    e.preventDefault();
    const s = Math.sign(e.deltaY);
    if (s !== 0) P.selected = (P.selected + s + 10) % 10;
  }
  function onContextMenu(e) { e.preventDefault(); }
  function onLockChange() {
    if (document.pointerLockElement !== canvas) {
      // lost lock: avoid stuck keys / lingering break visuals
      keys.clear();
      mouseL = mouseR = false; placeRequest = false;
      P.breakProgress = 0; breakTarget = null; digTimer = 0;
      P.sprinting = false;
      lastSpaceTime = -1e9;
      setSelection(null); setCrack(null, 0);
    } else {
      keys.clear();
      P.fallbackLook = false;
    }
  }

  /* ---- init (all DOM work happens here, never at parse time) ---- */
  function init(c) {
    if (initialized) return;
    initialized = true;
    canvas = c;
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('pointerlockerror', function () { P.fallbackLook = true; });
    P.fallbackLook = false;
  }

  /* ---- break / place ---- */
  function updateBreak(hit, dt) {
    const b = hit ? Blocks.BY_ID[hit.id] : null;
    const breakable = !!(b && isFinite(b.hardness) && b.hardness > 0);
    if (mouseL && lookActive() && breakable) {
      const key = hit.x + ',' + hit.y + ',' + hit.z;
      if (key !== breakTarget) { breakTarget = key; P.breakProgress = 0; digTimer = 0; }
      const sound = b.sound || 'stone';
      P.breakProgress += dt / b.hardness;
      digTimer += dt;
      while (digTimer >= DIG_TICK) {
        digTimer -= DIG_TICK;
        play('dig_' + sound, { vol: 0.5 });
        particles(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, hit.id, 4);
      }
      if (P.breakProgress >= 1) {
        World.set(hit.x, hit.y, hit.z, 0);
        play('break_' + sound);
        P.swing = 1;
        particles(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, hit.id, 22);
        P.breakProgress = 0; breakTarget = null; digTimer = 0;
        setCrack(null, 0);
      } else {
        setCrack(hit, P.breakProgress);
      }
    } else {
      P.breakProgress = 0; breakTarget = null; digTimer = 0;
      setCrack(null, 0);
    }
  }

  function tryPlace(hit) {
    if (!hit) return;
    const px = hit.px, py = hit.py, pz = hit.pz;
    const cell = World.get(px, py, pz);
    if (cell !== 0 && cell !== 11) return; // only air / water replaceable
    // strict AABB overlap vs player (shrunk by epsilon so flush faces are allowed)
    const E = 1e-3;
    if (px + 1 > P.x - HW + E && px < P.x + HW - E &&
        py + 1 > P.y + E && py < P.y + H - E &&
        pz + 1 > P.z - HW + E && pz < P.z + HW - E) return;
    if (window.Mobs && Mobs.intersectsBlock && Mobs.intersectsBlock(px, py, pz)) return;
    if (World.set(px, py, pz, P.hotbar[P.selected])) { play('place'); P.swing = 1; }
  }

  function updatePlace(hit) {
    if (!mouseR || !lookActive()) { placeRequest = false; return; }
    if (placeRequest && placeCooldown > 0) placeRequest = false; // pressed during cooldown: ignore
    if (placeRequest || placeCooldown <= 0) {
      tryPlace(hit);
      placeCooldown = placeRequest ? PLACE_COOLDOWN : PLACE_REPEAT;
      placeRequest = false;
    }
  }

  /* ---- health ---- */
  function damage(n, srcX, srcZ) {
    if (!(n > 0) || P.health <= 0 || invulnTimer > 0) return;
    P.health -= n;
    invulnTimer = INVULN_TIME;
    // knockback only when a source is given (fall damage passes none)
    if (typeof srcX === 'number' && typeof srcZ === 'number') {
      const dx = P.x - srcX, dz = P.z - srcZ;
      const len = Math.hypot(dx, dz);
      if (len > 1e-4) { P.vx += (dx / len) * 6; P.vz += (dz / len) * 6; }
      if (P.onGround) P.vy = 4;
    }
    flash();
    play('hurt');
    if (P.health <= 0) {
      P.health = 0;
      play('death');
      if (window.Game && Game.onPlayerDeath) Game.onPlayerDeath();
    }
  }
  function heal(n) {
    if (n > 0 && P.health > 0) P.health = Math.min(MAX_HEALTH, P.health + n);
  }

  function resetMotion() {
    P.vx = P.vy = P.vz = 0;
    P.onGround = false;
    P.fallDistance = 0; P.flying = false; P.sprinting = false;
    P.breakProgress = 0; breakTarget = null; digTimer = 0;
    invulnTimer = 0; regenTimer = 0; stepDist = 0;
    placeCooldown = 0; placeRequest = false;
    mouseL = mouseR = false;
  }
  function spawn(x, y, z) {
    P.x = x; P.y = y; P.z = z;
    P.health = MAX_HEALTH;
    resetMotion();
  }
  function respawn() {
    P.health = MAX_HEALTH;
    resetMotion();
    if (window.Game && Game.spawnPoint) {
      P.x = Game.spawnPoint.x; P.y = Game.spawnPoint.y; P.z = Game.spawnPoint.z;
    }
  }

  /* ---- main update ---- */
  function update(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.05);

    if (!playing()) {
      // paused / menu / dead: no physics, no input effects; clear interaction visuals
      mouseL = mouseR = false; placeRequest = false;
      P.sprinting = false;
      P.breakProgress = 0; breakTarget = null; digTimer = 0;
      setSelection(null); setCrack(null, 0);
      return;
    }

    /* timers */
    if (invulnTimer > 0) invulnTimer = Math.max(0, invulnTimer - dt);
    if (placeCooldown > 0) placeCooldown = Math.max(0, placeCooldown - dt);

    /* water detection + entry splash */
    const wasInWater = P.inWater;
    P.inWater = World.get(Math.floor(P.x), Math.floor(P.y + 0.4), Math.floor(P.z)) === 11;
    P.headUnderwater = World.get(Math.floor(P.x), Math.floor(P.y + EYE), Math.floor(P.z)) === 11;
    if (P.inWater && !wasInWater && P.vy < -5) {
      play('splash');
      splash(P.x, P.y + 0.3, P.z);
    }
    if (P.inWater || P.flying) P.fallDistance = 0;

    /* input wish direction (horizontal, camera-relative) */
    let f = 0, s = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
    const shift = keys.has('ShiftLeft');
    const space = keys.has('Space');
    const fwd = Util.forward(P.yaw, 0), rgt = Util.right(P.yaw);
    let wx = fwd[0] * f + rgt[0] * s;
    let wz = fwd[2] * f + rgt[2] * s;
    const wl = Math.hypot(wx, wz);
    const hasInput = wl > 0;
    if (hasInput) { wx /= wl; wz /= wl; }

    const wasOnGround = P.onGround;
    const sprintMove = shift && f > 0 && !P.inWater;
    const speed = P.flying ? (shift ? FLY_SPRINT : FLY_SPEED)
      : P.inWater ? WATER_SPEED
      : (sprintMove ? SPRINT_SPEED : WALK_SPEED);

    /* horizontal accel / friction */
    if (hasInput) {
      const accel = (P.onGround || P.flying) ? ACCEL_GROUND : ACCEL_AIR;
      const t = Math.min(1, accel * dt);
      P.vx += (wx * speed - P.vx) * t;
      P.vz += (wz * speed - P.vz) * t;
    } else {
      const damp = P.flying ? Math.max(0, 1 - 10 * dt)
        : P.onGround ? Math.max(0, 1 - 10 * dt)
        : P.inWater ? Math.max(0, 1 - 3 * dt)
        : Math.max(0, 1 - 1.5 * dt);
      P.vx *= damp; P.vz *= damp;
    }

    /* vertical */
    if (P.flying) {
      if (space) P.vy = shift ? FLY_SPRINT : FLY_SPEED;
      else if (keys.has('KeyC')) P.vy = -(shift ? FLY_SPRINT : FLY_SPEED);
      else P.vy *= Math.max(0, 1 - 8 * dt);
    } else if (P.inWater) {
      if (space) {
        // swim up toward 3.5; stronger boost near the surface so 1-block shores can be climbed
        const target = P.headUnderwater ? SWIM_UP : 5.5;
        P.vy = Util.lerp(P.vy, target, Math.min(1, 8 * dt));
      } else {
        P.vy -= WATER_GRAVITY * dt;
        P.vy *= Math.max(0, 1 - 3 * dt);
      }
    } else {
      P.vy -= GRAVITY * dt;
      if (P.onGround && space) P.vy = JUMP_VEL;
    }

    /* fall distance (before integration, using this frame's fall speed) */
    if (P.vy < 0 && !P.onGround && !P.flying && !P.inWater) P.fallDistance += -P.vy * dt;

    /* physics */
    Util.Physics.step(World, P, dt);

    /* landing: fall damage + land thud */
    if (P.onGround) {
      if (!wasOnGround) {
        if (P.fallDistance > 3) damage(Math.floor(P.fallDistance - 3));
        if (P.fallDistance > 1.5) play('land', { vol: Util.clamp(P.fallDistance * 0.12, 0.3, 1) });
      }
      P.fallDistance = 0;
    }

    /* sprint flag for FOV kick (only while actually sprint-moving) */
    const hspeed = Math.hypot(P.vx, P.vz);
    P.sprinting = sprintMove && hspeed > 1;
    P.walkPhase += (P.onGround && !P.flying && !P.inWater) ? hspeed * dt : 0;
    P.swing = Math.max(0, P.swing - dt * 3.2);

    /* target ray + break / place */
    const dir = Util.forward(P.yaw, P.pitch);
    const hit = World.raycast(P.x, P.y + EYE, P.z, dir[0], dir[1], dir[2], REACH);
    setSelection(hit);
    updateBreak(hit, dt);
    updatePlace(hit);

    /* step sounds */
    if (P.onGround && !P.flying && !P.inWater && hspeed > 1) {
      stepDist += hspeed * dt;
      while (stepDist >= STEP_DIST) {
        stepDist -= STEP_DIST;
        const id = Util.Physics.groundId(World, P);
        const b = Blocks.BY_ID[id];
        play('step_' + ((b && b.sound) || 'stone'), { vol: 0.35 });
      }
    }

    /* regen: +1 hp every 4 s while hurt and alive */
    if (P.health > 0 && P.health < MAX_HEALTH) {
      regenTimer += dt;
      if (regenTimer >= REGEN_INTERVAL) { regenTimer -= REGEN_INTERVAL; P.health++; }
    } else {
      regenTimer = 0;
    }
  }

  /* ---- public API (state object itself is the body) ---- */
  P.init = init;
  P.update = update;
  P.spawn = spawn;
  P.damage = damage;
  P.heal = heal;
  P.respawn = respawn;
  return P;
})();
