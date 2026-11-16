/* ============================================================
   BODYCAM: OUTBREAK — main.js (lead / agent MAIN)
   Boot, state machine, movement controller (feel pass 2),
   zone/objective tracking, pickups, win/death/pause, test hooks.
   Classic script. Codes strictly against ENGINE.md + IMPROVE.md.
   All overlay DOM is owned by window.UI (js/menu.js) — main only
   calls UI.* guarded. New feel fields live on G.player.
   ============================================================ */
'use strict';

(function () {
  const BASE_SENS = 0.0023;
  const WALK = 2.7, SPRINT_MULT = 1.75;      // sprint = 2.7 * 1.75 ≈ 4.7 m/s
  const ACCEL = 20, FRICTION = 13;
  const STRAFE_MULT = 0.82, BACK_MULT = 0.7;
  const SPRINT_RAMP = 0.25;                  // seconds to ramp sprint in/out
  const STAMINA_DRAIN = 1 / 7, STAMINA_REGEN = 1 / 5;
  const EXHAUST_RECOVER = 0.35, EXHAUST_SPEED = 0.92;
  const STRIDE_WALK = 2.0, STRIDE_SPRINT = 2.6;  // meters per footfall
  const EYE = 1.62, RADIUS = 0.3;
  // ?autostart=1 — headless/test mode: skip menu click + pointer lock (the lock
  // permission prompt blocks headless screenshot capture). Harmless in normal play.
  let AUTOSTART = false;
  try { AUTOSTART = /[?&]autostart=1/.test(location.search); } catch (e) { }

  const vel = [0, 0];            // horizontal velocity x,z
  const _f = [0, 0, 0];          // scratch forward (yaw only)
  const _r = [0, 0, 0];          // scratch right
  let lastEyeY = EYE;
  let pauseAt = 0;               // Eng.time when pause began
  let deathShown = false, winShown = false, faultShown = false;
  let canvas = null;
  let origDamage = null;         // saved Combat.damage for god mode
  let sprintBlend = 0;           // 0..1 sprint speed ramp
  let stopRefSpeed = 0, stopT = 0;   // hard-decel (stopDip) window

  const OBJECTIVES = {
    0: 'REACH THE ROOFTOP HELIPAD',
    1: 'FIND THE STAIRWELL — NORTH WING',
    2: 'CLIMB STAIRWELL A — UPPER FLOORS',
    3: 'CROSS THE ICU — ROOF ACCESS AHEAD',
    4: 'REACH ROOF ACCESS — TOP OF THE STAIRS',
    5: 'REACH THE HELIPAD'
  };
  const RADIO_MILESTONES = { 1: 'backup', 3: 'panic', 5: 'final' };

  /* ---------------- helpers ---------------- */
  function approach(v, target, step) {
    if (v < target) return Math.min(target, v + step);
    return Math.max(target, v - step);
  }
  function fmtTime(s) {
    s = Math.max(0, Math.floor(s));
    const m = (s / 60) | 0, ss = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
  }
  function makeStats() {
    const P = G.player;
    const acc = P.shots > 0 ? Math.round(P.hits / P.shots * 100) : 0;
    return {
      time: G.time, timeStr: fmtTime(G.time),
      kills: P.kills, shots: P.shots, hits: P.hits, accuracy: acc
    };
  }
  function lookSens() {
    const s = (G.settings && typeof G.settings.sens === 'number') ? G.settings.sens : 1;
    return BASE_SENS * s;
  }
  function clearInput() {
    Eng.input.keys.clear();
    Eng.input.buttons[0] = Eng.input.buttons[1] = Eng.input.buttons[2] = false;
    vel[0] = vel[1] = 0;
  }
  function lockPointer() {
    if (AUTOSTART) return; // headless: no pointer lock prompt
    try {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(function () { });
    } catch (e) { /* lock unsupported/denied — game still runs */ }
  }
  function unlockPointer() {
    try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) { }
  }
  function surfaceForZone(z) {
    if (z >= 5) return 'roof';
    if (z === 2 || z === 4) return 'concrete';
    return 'tile';
  }
  function resetFeelState() {
    const P = G.player;
    P.stepPhase = 0; P.stepPulse = 0; P.stepSide = 1;
    P.stamina = 1; P.exhausted = false; P.stopDip = 0;
    sprintBlend = 0; stopRefSpeed = 0; stopT = 0;
  }

  /* ---------------- boot ---------------- */
  function boot() {
    canvas = document.getElementById('glcanvas');

    // shared settings — UI owns/persists them; default if UI absent
    if (!G.settings) G.settings = { sens: 1, vol: 0.85, grain: true };
    if (window.UI && UI.init) UI.init();
    if (window.UI && UI.onStart) UI.onStart(start);
    if (window.UI && UI.onResume) UI.onResume(resume);

    Eng.init(canvas);
    if (window.Level) Level.build();
    if (window.Zombies) Zombies.init();
    if (window.Combat) Combat.init();
    if (window.PostFX) PostFX.init(Eng.gl, canvas.width, canvas.height);
    if (window.CameraRig && CameraRig.init) CameraRig.init();
    if (window.HUD) HUD.init();

    // spawn
    const P = G.player;
    if (window.Level && Level.data && Level.data.spawn) {
      P.pos[0] = Level.data.spawn.pos[0];
      P.pos[1] = Level.data.spawn.pos[1];
      P.pos[2] = Level.data.spawn.pos[2];
      P.yaw = Level.data.spawn.yaw || 0;
    }
    P.pitch = 0; P.zone = 0; P.landDip = 0;
    P.surface = surfaceForZone(0);
    resetFeelState();
    lastEyeY = P.pos[1];
    G.lookDelta = { dx: 0, dy: 0 };
    G.runStart = Eng.time;
    G.state = 'menu';
    if (window.UI && UI.showMenu) UI.showMenu();

    // fallback start path only when the UI module is absent (UI owns #overlay)
    canvas.addEventListener('click', function () {
      if (window.UI) return;
      if (faultShown) { location.reload(); return; }
      const st = G.state;
      if (st === 'menu') start();
      else if (st === 'pause') resume();
      else if (st === 'dead' || st === 'win') location.reload();
    });

    Eng.start(loop);

    // ?autostart=1 — skip the menu click, god-mode on (stable capture: no
    // death/flash frames), short walk so headless shots land mid-gameplay.
    if (AUTOSTART) {
      setTimeout(function () {
        G.testGod = true; // set before start() so the guard holds even if start throws
        if (G.state === 'menu') start();
        if (window.__test && __test.god) __test.god(true);
      }, 300);
      setTimeout(function () { if (G.state === 'play') Eng.input.keys.add('KeyW'); }, 900);
      setTimeout(function () { Eng.input.keys.delete('KeyW'); }, 2100);
    }
  }

  /* ---------------- start / resume / pause ---------------- */
  function start() {
    if (G.state !== 'menu') return;
    if (window.AudioSys) AudioSys.init();
    lockPointer();
    clearInput();
    resetFeelState();
    G.state = 'play';
    G.runStart = Eng.time;
    G.time = 0;
    if (window.UI && UI.hide) UI.hide();
    if (window.HUD) {
      HUD.setObjective('REACH THE ROOFTOP HELIPAD');
      if (window.Combat && Combat.state) HUD.setAmmo(Combat.state.mag, Combat.state.reserve);
    }
    if (window.AudioSys && AudioSys.radio) {
      const txt = AudioSys.radio('dispatch');
      if (txt && window.HUD) HUD.radio(txt);
    }
  }

  function resume() {
    if (G.state !== 'pause') return;
    G.runStart += Eng.time - pauseAt;   // keep G.time continuous across pause
    lockPointer();
    clearInput();
    G.state = 'play';
    if (window.UI && UI.hide) UI.hide();
  }

  function onLockChange(locked) {
    if (!locked && G.state === 'play') {
      G.state = 'pause';
      pauseAt = Eng.time;
      clearInput();
      if (window.UI && UI.showPause) UI.showPause();
    } else if (locked && G.state === 'pause') {
      resume();
    }
  }

  /* ---------------- death / win ---------------- */
  function onDeath() {
    if (deathShown) return;
    deathShown = true;
    clearInput();
    G.player.moving = false; G.player.speed = 0; G.player.sprint = false;
    if (window.Feel && Feel.deathSlow) Feel.deathSlow();
    unlockPointer();
    setTimeout(function () {
      if (window.UI && UI.showDeath) UI.showDeath(makeStats());
    }, 1600);
  }

  function triggerWin() {
    if (G.state !== 'play') return;
    G.state = 'win';
    G.heli = true;
    clearInput();
    G.player.moving = false; G.player.speed = 0; G.player.sprint = false;
    unlockPointer();
    if (window.AudioSys) {
      if (AudioSys.rotorStart) AudioSys.rotorStart();
      if (AudioSys.winSting) AudioSys.winSting();
    }
    Eng.lights.push({ pos: [0, 26, -78], color: [1.2, 1.25, 1.3], radius: 40 });
    if (window.HUD) HUD.setObjective('EXTRACTION CONFIRMED');
    setTimeout(function () {
      if (winShown) return;
      winShown = true;
      if (window.UI && UI.showWin) UI.showWin(makeStats());
    }, 3000);
  }

  /* ---------------- look / movement ---------------- */
  function updateLook() {
    const md = Eng.mouseDelta();
    const P = G.player;
    const sens = lookSens();
    P.yaw -= md.dx * sens;
    P.pitch = clamp(P.pitch - md.dy * sens, -1.45, 1.45);
    G.lookDelta.dx = md.dx;
    G.lookDelta.dy = md.dy;
  }

  function updateMovement(dt) {
    const P = G.player, keys = Eng.input.keys;
    P.grabbed = Math.max(0, P.grabbed - dt);
    if (P.grabbed <= 0) P.grabber = null;
    P.stagger = Math.max(0, (P.stagger || 0) - dt);
    P.landDip = Math.max(0, (P.landDip || 0) * Math.max(0, 1 - 5 * dt));
    P.stopDip = Math.max(0, (P.stopDip || 0) - dt * 2.2);

    let f = 0, s = 0;
    if (keys.has('KeyW')) f += 1;
    if (keys.has('KeyS')) f -= 1;
    if (keys.has('KeyD')) s += 1;
    if (keys.has('KeyA')) s -= 1;
    const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    _f[0] = -sy; _f[2] = -cy;         // fwdVec(yaw, 0)
    _r[0] = cy; _r[2] = -sy;          // rightVec(yaw)
    const fs = f < 0 ? f * BACK_MULT : f;   // backpedal slower
    const ss = s * STRAFE_MULT;             // strafe slower
    let wx = _f[0] * fs + _r[0] * ss;
    let wz = _f[2] * fs + _r[2] * ss;
    const wl = Math.hypot(wx, wz);

    // sprint: gated by stamina/exhaustion, speed ramps over 0.25 s
    const wantSprint = keys.has('ShiftLeft') && wl > 0 && P.grabbed <= 0 && !P.exhausted;
    sprintBlend = approach(sprintBlend, wantSprint ? 1 : 0, dt / SPRINT_RAMP);
    let maxSp = WALK * (1 + (SPRINT_MULT - 1) * sprintBlend);
    if (P.exhausted) maxSp *= EXHAUST_SPEED;
    if (P.grabbed > 0) maxSp *= 0.35;
    if (P.stagger > 0) maxSp *= 0.55;

    if (wl > 0) {
      // wish dir normalized; wish magnitude (≤1) scales target speed so
      // pure strafe/back are slower but diagonals stay near full speed
      const k = Math.min(1, wl) / wl * maxSp;
      vel[0] = approach(vel[0], wx * k, ACCEL * dt);
      vel[1] = approach(vel[1], wz * k, ACCEL * dt);
    } else {
      const fr = Math.max(0, 1 - FRICTION * dt);
      vel[0] *= fr; vel[1] *= fr;
    }

    const dx = vel[0] * dt, dz = vel[1] * dt;
    let nx = P.pos[0], nz = P.pos[2];
    if (window.Level && Level.moveCircle) {
      const res = Level.moveCircle(P.pos[0], P.pos[2], RADIUS, dx, dz);
      nx = res[0]; nz = res[1];
    } else { nx += dx; nz += dz; }
    const moved = Math.hypot(nx - P.pos[0], nz - P.pos[2]);
    P.pos[0] = nx; P.pos[2] = nz;
    const speed = dt > 0 ? moved / dt : 0;
    P.speed = speed;
    P.moving = speed > 0.1;
    P.sprint = wantSprint && P.moving;

    // stamina: 7 s of sprint to empty, 5 s to refill; exhausted until 0.35
    if (P.sprint) {
      P.stamina = Math.max(0, P.stamina - dt * STAMINA_DRAIN);
      if (P.stamina <= 0) P.exhausted = true;
    } else {
      P.stamina = Math.min(1, P.stamina + dt * STAMINA_REGEN);
      if (P.exhausted && P.stamina >= EXHAUST_RECOVER) P.exhausted = false;
    }

    // stop-settle dip: speed dropped > 2 m/s within a 0.15 s window
    stopT += dt;
    if (stopT >= 0.15) {
      const drop = stopRefSpeed - speed;
      if (drop > 2) P.stopDip = Math.min(1, drop / 4);
      stopRefSpeed = speed; stopT = 0;
    }

    // eye height: smooth follow of floor (ramps), landing dip on fast drops
    let fy = P.pos[1] - EYE;
    if (window.Level && Level.floorHeight) fy = Level.floorHeight(nx, nz);
    const targetY = fy + EYE;
    P.pos[1] += (targetY - P.pos[1]) * Math.min(1, 12 * dt);
    const vy = dt > 0 ? (P.pos[1] - lastEyeY) / dt : 0;
    if (vy < -3) P.landDip = Math.min(0.14, -vy * 0.025);
    lastEyeY = P.pos[1];

    // surface underfoot (glass patches etc.), zone-based fallback
    if (window.Level && Level.surfaceAt) {
      P.surface = Level.surfaceAt(nx, nz) || surfaceForZone(P.zone);
    } else {
      P.surface = surfaceForZone(P.zone);
    }

    // unified step events: distance-based phase, one footfall per stride
    if (P.moving) {
      P.bob += speed * dt * 1.9;      // legacy bob phase (rig may still read)
      P.stepPhase += moved;
      const stride = P.sprint ? STRIDE_SPRINT : STRIDE_WALK;
      if (P.stepPhase >= stride) {
        P.stepPhase -= stride;
        P.stepPulse = 1;              // rig decays it
        P.stepSide = -(P.stepSide || 1);
        if (window.AudioSys && AudioSys.footstep) AudioSys.footstep(P.sprint, P.surface);
        G.emitNoise(P.pos, P.sprint ? 12 : 6, P.sprint ? 'sprint' : 'step');
      }
    }
  }

  /* ---------------- zone / pickups / win checks ---------------- */
  function checkZone() {
    if (!window.Level || !Level.zoneAt) return;
    const z = Level.zoneAt(G.player.pos);
    if (z === G.player.zone) return;
    G.player.zone = z;
    if (window.HUD) HUD.setObjective(OBJECTIVES[z] || OBJECTIVES[0]);
    if (window.AudioSys) {
      if (AudioSys.setZone) AudioSys.setZone(z);
      const kind = RADIO_MILESTONES[z];
      if (kind && AudioSys.radio) {
        const txt = AudioSys.radio(kind);
        if (txt && window.HUD) HUD.radio(txt);
      }
    }
  }

  function checkPickups() {
    if (!window.Level || !Level.data || !Level.data.pickups) return;
    const P = G.player, list = Level.data.pickups;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.taken) continue;
      if (V3.distXZ(P.pos, p.pos) >= 0.9) continue;
      p.taken = true;
      if (p.r) p.r.visible = false;
      if (p.type === 'medkit') {
        if (window.Combat && Combat.heal) Combat.heal(40);
        if (window.HUD) HUD.toast('MEDKIT +40 HP');
      } else {
        if (window.Combat && Combat.addAmmo) Combat.addAmmo(30);
        if (window.HUD) HUD.toast('AMMO +30');
      }
      if (window.AudioSys && AudioSys.pickup) AudioSys.pickup(p.type);
    }
  }

  function checkWin() {
    if (!window.Level || !Level.data || !Level.data.helipad) return;
    if (G.player.zone !== 5) return;
    if (V3.distXZ(G.player.pos, Level.data.helipad.pos) < 2.8) triggerWin();
  }

  // compression-glitch spikes from nearby door bangs / gunshots
  function processNoiseGlitch() {
    const evs = G.noiseEvents;
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      if (ev._fx) continue;
      ev._fx = true;
      if (ev.kind === 'gunshot') {
        G.post.glitch = Math.max(G.post.glitch, 0.4);
      } else if (ev.kind === 'door' && V3.distXZ(G.player.pos, ev.pos) < 14) {
        G.post.glitch = Math.max(G.post.glitch, 0.4);
      }
    }
  }

  /* ---------------- main loop ---------------- */
  function loop(dt, t) {
    const st = G.state;
    if (st === 'play') G.time = t - G.runStart;

    // post state decays / fades
    G.post.flash = Math.max(0, G.post.flash - dt * 4);
    G.post.glitch = Math.max(0, G.post.glitch - dt * 2);
    if (st === 'dead') G.post.fade = Math.min(1, G.post.fade + dt * 0.6);
    else if (st === 'win') G.post.fade = Math.min(0.3, G.post.fade + dt * 0.12);
    else G.post.fade = Math.max(0, G.post.fade - dt * 1.5);
    G.post.damage = 1 - G.player.hp / 100;
    processNoiseGlitch();

    if (st === 'play') {
      updateLook();
      updateMovement(dt);
      if (window.CameraRig) CameraRig.update(dt);
      if (window.Combat) Combat.update(dt);
      if (window.Zombies) Zombies.update(dt);
      if (window.Level) Level.update(dt);
      if (window.Decals && Decals.update) Decals.update(dt);
      if (window.AudioSys) AudioSys.update(dt);
      if (window.HUD) HUD.update(dt);
      checkZone();
      checkPickups();
      checkWin();
    } else {
      // drain mouse so deltas never accumulate across states
      Eng.mouseDelta();
      G.lookDelta.dx = 0; G.lookDelta.dy = 0;
      if (window.CameraRig) CameraRig.update(dt);   // death cam lives here
      if (st === 'dead' && window.Zombies) Zombies.update(dt); // death anims keep running
      if (window.Level) Level.update(dt);
      if (window.Decals && Decals.update) Decals.update(dt);
      if (window.AudioSys) AudioSys.update(dt);
      if (window.HUD) HUD.update(dt);
    }
  }

  /* ---------------- test hooks ---------------- */
  window.__test = {
    tp(zone) {
      if (!window.Level || !Level.data) return;
      const wps = (Level.data.waypoints || []).filter(function (w) { return w.zone === zone; });
      let x = 0, z = 0;
      if (wps.length) {
        const w = wps[(wps.length / 2) | 0];
        x = w.pos[0]; z = w.pos[2];
      } else if (zone === 5 && Level.data.helipad) {
        x = Level.data.helipad.pos[0]; z = Level.data.helipad.pos[2];
      }
      const fy = Level.floorHeight ? Level.floorHeight(x, z) : 0;
      G.player.pos[0] = x; G.player.pos[1] = fy + EYE; G.player.pos[2] = z;
      G.player.zone = zone;
      vel[0] = vel[1] = 0;
      lastEyeY = G.player.pos[1];
      stopRefSpeed = 0; stopT = 0; sprintBlend = 0;
      G.player.stepPhase = 0;
    },
    look(yaw, pitch) {
      G.player.yaw = yaw;
      G.player.pitch = clamp(pitch, -1.45, 1.45);
    },
    key(code, down) {
      if (down) Eng.input.keys.add(code); else Eng.input.keys.delete(code);
    },
    click(btn, down) { Eng.input.buttons[btn] = !!down; },
    state() {
      const cs = (window.Combat && Combat.state) ? Combat.state : { mag: 0, reserve: 0 };
      const zl = (window.Zombies && Zombies.list) ? Zombies.list : [];
      return {
        state: G.state, hp: G.player.hp, pos: G.player.pos.slice(), zone: G.player.zone,
        mag: cs.mag, reserve: cs.reserve, kills: G.player.kills,
        alive: zl.filter(function (z) { return z.alive; }).length, threat: G.threat,
        stamina: G.player.stamina, exhausted: G.player.exhausted, surface: G.player.surface
      };
    },
    god(b) {
      G.testGod = !!b;
      if (!window.Combat) return;
      if (!origDamage) origDamage = Combat.damage;
      Combat.damage = b ? function () { } : origDamage;
    },
    fire() {
      Eng.input.buttons[0] = true;
      setTimeout(function () { Eng.input.buttons[0] = false; }, 60);
    },
    win() {
      if (!window.Level || !Level.data || !Level.data.helipad) return;
      const hp = Level.data.helipad.pos;
      G.player.pos[0] = hp[0]; G.player.pos[1] = hp[1] + EYE; G.player.pos[2] = hp[2];
      G.player.zone = 5;
      vel[0] = vel[1] = 0;
      lastEyeY = G.player.pos[1];
      stopRefSpeed = 0; stopT = 0; sprintBlend = 0;
      G.player.stepPhase = 0;
    }
  };

  /* ---------------- expose + auto-boot ---------------- */
  window.Main = { boot: boot, start: start, resume: resume, onDeath: onDeath, onLockChange: onLockChange };

  function fault(err) {
    faultShown = true;
    const msg = String(err && err.message ? err.message : err).replace(/</g, '&lt;');
    if (window.UI && UI.showDeath) {
      UI.showDeath({ time: 0, timeStr: '00:00', kills: 0, shots: 0, hits: 0, accuracy: 0, fault: msg });
    }
  }

  try {
    boot();
  } catch (err) {
    fault(err);
  }
})();
