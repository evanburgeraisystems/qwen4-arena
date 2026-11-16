/* ============================================================
   BODYCAM: OUTBREAK — combat: pistol viewmodel, hitscan, reload,
   melee, flashlight, damage pipeline.  window.Combat
   ============================================================ */
'use strict';
(function () {

  const MAG_SIZE = 15;
  const FIRE_RATE = 0.21;
  const RELOAD_TIME = 1.7;
  const MELEE_TIME = 0.32;
  const MELEE_HIT_T = 0.14;
  const MELEE_CD = 0.75;
  const MELEE_RANGE = 1.75;
  const MELEE_COS = Math.cos(65 * Math.PI / 180);

  const C = {
    state: { mag: MAG_SIZE, reserve: 75, reloading: 0 },
    magSize: MAG_SIZE,
    fireCd: 0, meleeCd: 0, meleeT: 0, meleeHitDone: true,
    reloadStage: 0,
    recoil: { x: 0, v: 0 },
    sway: { x: 0, y: 0 },
    sprintAmt: 0,
    flashT: 0, lightT: 0, flashLight: null, flashRot: 0, flashSize: 0.2,
    spotDir: [0, 0, -1],
    magDrop: null, magDropT: 0, magDropPos: [0, 0, 0], magDropVel: [0, 0, 0], magDropRot: 0,
    prev: { r: false, f: false, l: false, fire: false, melee: false },
    parts: [], slidePart: null, flash: null,
    _inited: false
  };

  /* ---------------- viewmodel ---------------- */

  function addPart(pos, rot, size, color, opts) {
    const local = M4.trs(pos, rot, size);
    const o = { viewSpace: true };
    if (opts) for (const k in opts) o[k] = opts[k];
    const r = Eng.add(Eng.meshCube, M4.ident(), color, o);
    const part = { r, pos, rot, size, local };
    C.parts.push(part);
    return part;
  }

  C.init = function () {
    if (C._inited) return;
    C._inited = true;
    C.state.mag = MAG_SIZE;
    C.state.reserve = 75;
    C.state.reloading = 0;

    // pistol (gun-local space: -Z = muzzle direction, root ~[0.24,-0.23,-0.42])
    C.slidePart = addPart([0, 0.035, -0.12], null, [0.055, 0.06, 0.30], [0.09, 0.09, 0.10]);      // slide
    addPart([0, -0.012, -0.09], null, [0.05, 0.045, 0.23], [0.07, 0.07, 0.08]);                   // frame
    addPart([0, -0.10, 0.055], [-0.3, 0, 0], [0.05, 0.15, 0.062], [0.08, 0.08, 0.09]);            // grip (angled)
    addPart([0, -0.05, -0.02], null, [0.042, 0.012, 0.09], [0.07, 0.07, 0.08]);                   // trigger guard
    addPart([0, 0.074, -0.25], null, [0.010, 0.018, 0.012], [0.05, 0.05, 0.06]);                  // front sight
    addPart([0, 0.072, 0.01], null, [0.042, 0.016, 0.016], [0.05, 0.05, 0.06]);                   // rear sight
    addPart([0, 0.035, -0.295], null, [0.03, 0.03, 0.05], [0.04, 0.04, 0.045]);                   // barrel hint
    addPart([0.004, -0.105, 0.08], [-0.3, 0, 0], [0.078, 0.095, 0.095], [0.12, 0.11, 0.10]);      // gloved hand
    addPart([0.10, -0.21, 0.30], [0.55, 0.35, 0], [0.082, 0.082, 0.36], [0.10, 0.12, 0.20]);      // navy sleeve forearm

    // muzzle flash quad — additive, viewSpace, hidden until a shot
    C.flash = Eng.add(Eng.meshQuad, M4.ident(), [1.6, 1.2, 0.6], {
      viewSpace: true, blend: 'add', emissive: 1, depthWrite: false, doubleSided: true
    });
    C.flash.visible = false;

    // dropped magazine — world-space box, hidden until a reload
    C.magDrop = Eng.add(Eng.meshCube, M4.ident(), [0.07, 0.07, 0.08], {});
    C.magDrop.visible = false;

    if (window.HUD) HUD.setAmmo(C.state.mag, C.state.reserve);
  };

  function syncAmmo() {
    if (window.HUD) HUD.setAmmo(C.state.mag, C.state.reserve);
  }

  /* ---------------- helpers ---------------- */

  function muzzleWorld(out) {
    const cam = G.cam;
    out[0] = cam.pos[0] + cam.fwd[0] * 0.55 + cam.right[0] * 0.20 - cam.up[0] * 0.14;
    out[1] = cam.pos[1] + cam.fwd[1] * 0.55 + cam.right[1] * 0.20 - cam.up[1] * 0.14;
    out[2] = cam.pos[2] + cam.fwd[2] * 0.55 + cam.right[2] * 0.20 - cam.up[2] * 0.14;
    return out;
  }

  // nearest positive ray-sphere t (dir normalized), or -1
  function raySphere(o, d, cx, cy, cz, r) {
    const ox = o[0] - cx, oy = o[1] - cy, oz = o[2] - cz;
    const b = ox * d[0] + oy * d[1] + oz * d[2];
    const c = ox * ox + oy * oy + oz * oz - r * r;
    const disc = b * b - c;
    if (disc < 0) return -1;
    const s = Math.sqrt(disc);
    let t = -b - s;
    if (t < 0) t = -b + s;
    return t >= 0 ? t : -1;
  }

  /* ---------------- shooting ---------------- */

  function shoot() {
    const st = C.state, p = G.player;
    st.mag--;
    p.shots++;
    C.fireCd = FIRE_RATE;

    // recoil: camera kick + viewmodel spring (retuned: kick 0.028, k=110 d=13)
    if (window.CameraRig) CameraRig.kick(0.028 + rnd(0.010), rnd(-0.008, 0.008));
    C.recoil.v -= 6;

    // muzzle flash quad + sparks + smoke + temporary world light
    const mw = muzzleWorld([0, 0, 0]);
    C.flashT = 0.05;
    C.flashRot = rnd(Math.PI * 2);
    C.flashSize = rnd(0.16, 0.24);
    C.flash.visible = true;
    if (C.flashLight) { // replace any still-live light
      const i = Eng.lights.indexOf(C.flashLight);
      if (i >= 0) Eng.lights.splice(i, 1);
    }
    C.flashLight = { pos: [mw[0], mw[1], mw[2]], color: [1.6, 1.3, 0.8], radius: 9 };
    Eng.lights.push(C.flashLight);
    C.lightT = 0.06;
    if (Eng.sparks) Eng.sparks.burst(mw, 6, { speed: 3, col: [1, 0.8, 0.4, 1], size: 0.03, life: 0.08, grav: 0 });
    if (Eng.fx) Eng.fx.burst(mw, 3, { speed: 0.5, col: [0.35, 0.35, 0.38, 0.3], size: 0.05, life: 0.5, grav: -0.3, drag: 2, up: 0.4, grow: 0.15 });

    if (window.AudioSys) AudioSys.gunshot();
    G.emitNoise(p.pos, 42, 'gunshot');

    // hitscan: origin at camera, dir = fwd + spread (bloom when moving/sprinting)
    const cam = G.cam;
    let spread = 0.006;
    if (p.moving) spread += 0.012;
    if (p.sprint) spread += 0.010;
    spread += Math.min(0.008, Math.abs(C.recoil.x) * 0.002);
    const dir = V3.norm([
      cam.fwd[0] + cam.right[0] * rnd(-spread, spread) + cam.up[0] * rnd(-spread, spread),
      cam.fwd[1] + cam.right[1] * rnd(-spread, spread) + cam.up[1] * rnd(-spread, spread),
      cam.fwd[2] + cam.right[2] * rnd(-spread, spread) + cam.up[2] * rnd(-spread, spread)
    ]);
    const origin = cam.pos;
    const end = [origin[0] + dir[0] * 80, origin[1] + dir[1] * 80, origin[2] + dir[2] * 80];
    let wallT = 80, wallN = null;
    if (window.Level) {
      if (Level.raycastHit) {
        const h = Level.raycastHit(origin, end);
        if (h && typeof h.t === 'number') { wallT = h.t * 80; wallN = h.normal || null; }
      } else {
        wallT = Level.raycast(origin, end) * 80;
      }
    }

    // nearest alive zombie sphere (head r0.24 @ +1.62, torso r0.42 @ +1.05)
    let bestT = Infinity, bestZ = null, bestHead = false;
    const zl = (window.Zombies && Zombies.list) ? Zombies.list : [];
    for (let i = 0; i < zl.length; i++) {
      const z = zl[i];
      if (!z || !z.alive) continue;
      const th = raySphere(origin, dir, z.pos[0], z.pos[1] + 1.62, z.pos[2], 0.24);
      if (th >= 0 && th < bestT) { bestT = th; bestZ = z; bestHead = true; }
      const tt = raySphere(origin, dir, z.pos[0], z.pos[1] + 1.05, z.pos[2], 0.42);
      if (tt >= 0 && tt < bestT) { bestT = tt; bestZ = z; bestHead = false; }
    }

    if (bestZ && bestT < wallT) {
      const hp = [origin[0] + dir[0] * bestT, origin[1] + dir[1] * bestT, origin[2] + dir[2] * bestT];
      if (window.Zombies) Zombies.damage(bestZ, bestHead ? 70 : 34, dir, bestHead);
      p.hits++;
      if (bestHead) p.headshots++;
      if (Eng.fx) Eng.fx.burst(hp, bestHead ? 14 : 8, { speed: 2.2, col: [0.35, 0.02, 0.02, 0.9], size: 0.035, life: 0.5, grav: 6, drag: 1.5 });
      if (window.AudioSys && AudioSys.fleshHit) AudioSys.fleshHit();
      if (window.Decals && Decals.blood) Decals.blood(hp, dir, bestHead ? 0.45 : 0.3);
    } else if (wallT < 80) {
      const wp = [origin[0] + dir[0] * wallT, origin[1] + dir[1] * wallT, origin[2] + dir[2] * wallT];
      if (Eng.fx) Eng.fx.burst(wp, 5, { speed: 1.2, col: [0.4, 0.38, 0.35, 0.5], size: 0.03, life: 0.4, grav: 2, drag: 2 });
      if (Eng.sparks) Eng.sparks.burst(wp, 2, { speed: 1.5, col: [1, 0.9, 0.6, 0.8], size: 0.02, life: 0.06, grav: 2 });
      if (window.Decals && Decals.bullet) Decals.bullet(wp, wallN || [-dir[0], -dir[1], -dir[2]]);
    }

    syncAmmo();
  }

  /* ---------------- reload mag drop ---------------- */

  // mag box ejects from the grip and falls as a tumbling world-space box
  function dropMag() {
    if (!C.magDrop) return;
    const cam = G.cam, mp = C.magDropPos, mv = C.magDropVel;
    mp[0] = cam.pos[0] + cam.fwd[0] * 0.36 + cam.right[0] * 0.24 - cam.up[0] * 0.34;
    mp[1] = cam.pos[1] + cam.fwd[1] * 0.36 + cam.right[1] * 0.24 - cam.up[1] * 0.34;
    mp[2] = cam.pos[2] + cam.fwd[2] * 0.36 + cam.right[2] * 0.24 - cam.up[2] * 0.34;
    mv[0] = cam.fwd[0] * 0.4 + rnd(-0.2, 0.2);
    mv[1] = -0.4;
    mv[2] = cam.fwd[2] * 0.4 + rnd(-0.2, 0.2);
    C.magDropRot = rnd(Math.PI * 2);
    C.magDropT = 0.7;
    C.magDrop.model = M4.trs(mp, [C.magDropRot, 0, 0], [0.05, 0.11, 0.075]);
    C.magDrop.visible = true;
  }

  /* ---------------- melee ---------------- */

  function meleeStrike() {
    const p = G.player, cam = G.cam;
    const fx = cam.fwd[0], fz = cam.fwd[2];
    const fl = Math.hypot(fx, fz) || 1;
    const fwx = fx / fl, fwz = fz / fl;
    let connected = false;
    const zl = (window.Zombies && Zombies.list) ? Zombies.list : [];
    for (let i = 0; i < zl.length; i++) {
      const z = zl[i];
      if (!z || !z.alive) continue;
      const dx = z.pos[0] - p.pos[0], dz = z.pos[2] - p.pos[2];
      const d = Math.hypot(dx, dz);
      if (d >= MELEE_RANGE || d < 0.001) continue;
      if ((dx / d) * fwx + (dz / d) * fwz < MELEE_COS) continue;
      const dir = V3.norm([dx, 0.05, dz]);
      if (window.Zombies) {
        Zombies.shove(z, dir);
        Zombies.damage(z, 12, dir, false);
      }
      if (window.Decals && Decals.blood) Decals.blood([z.pos[0], z.pos[1] + 1.1, z.pos[2]], dir, 0.3);
      connected = true;
    }
    if (connected) {
      G.player.grabbed = 0;
      G.player.grabber = null;
      if (window.AudioSys) AudioSys.meleeHit();
      if (window.AudioSys && AudioSys.fleshHit) AudioSys.fleshHit();
      if (window.CameraRig) CameraRig.addShake(0.18);
    }
    G.emitNoise(p.pos, 9, 'melee');
  }

  /* ---------------- update ---------------- */

  C.update = function (dt) {
    const st = C.state, p = G.player;

    // --- timers (run in every state so flashes/lights never leak) ---
    C.fireCd = Math.max(0, C.fireCd - dt);
    C.meleeCd = Math.max(0, C.meleeCd - dt);
    if (C.flashT > 0) {
      C.flashT -= dt;
      if (C.flashT <= 0 && C.flash) C.flash.visible = false;
    }
    if (C.lightT > 0) {
      C.lightT -= dt;
      if (C.lightT <= 0 && C.flashLight) {
        const i = Eng.lights.indexOf(C.flashLight);
        if (i >= 0) Eng.lights.splice(i, 1);
        C.flashLight = null;
      }
    }

    // --- recoil spring: x'' = -110x - 13v (snappier retune) ---
    C.recoil.v += (-110 * C.recoil.x - 13 * C.recoil.v) * dt;
    C.recoil.x += C.recoil.v * dt;

    // --- dropped mag physics (runs in every state so it never hangs visible) ---
    if (C.magDropT > 0) {
      C.magDropT -= dt;
      const mp = C.magDropPos, mv = C.magDropVel;
      mv[1] -= 9.8 * dt;
      mp[0] += mv[0] * dt; mp[1] += mv[1] * dt; mp[2] += mv[2] * dt;
      C.magDropRot += 5 * dt;
      if (C.magDropT <= 0) C.magDrop.visible = false;
      else C.magDrop.model = M4.trs(mp, [C.magDropRot, 0, C.magDropRot * 0.6], [0.05, 0.11, 0.075]);
    }

    // --- input edges ---
    const keys = Eng.input.keys, btn = Eng.input.buttons;
    const rNow = keys.has('KeyR'), fNow = keys.has('KeyF'), lNow = keys.has('KeyL');
    const fireNow = !!btn[0], meleeNow = !!btn[2];
    const rEdge = rNow && !C.prev.r, fEdge = fNow && !C.prev.f, lEdge = lNow && !C.prev.l;
    const fireEdge = fireNow && !C.prev.fire;
    const meleeEdge = (fNow && !C.prev.f) || (meleeNow && !C.prev.melee);
    C.prev.r = rNow; C.prev.f = fNow; C.prev.l = lNow;
    C.prev.fire = fireNow; C.prev.melee = meleeNow;

    const canAct = G.state === 'play' && (Eng.input.locked || G.testFire);

    if (canAct) {
      // flashlight toggle
      if (lEdge) {
        p.flashlight = !p.flashlight;
        if (window.AudioSys) AudioSys.flashlightClick();
      }
      // reload start
      if (rEdge && st.mag < MAG_SIZE && st.reserve > 0 && st.reloading <= 0) {
        st.reloading = RELOAD_TIME;
        C.reloadStage = 1;
        if (window.AudioSys) AudioSys.reloadStart();
        dropMag();
      }
      // melee start (cancels reload — cancel-safe, no ammo transfer happens)
      if (meleeEdge && C.meleeCd <= 0) {
        if (st.reloading > 0) { st.reloading = 0; C.reloadStage = 0; }
        C.meleeT = MELEE_TIME;
        C.meleeCd = MELEE_CD;
        C.meleeHitDone = false;
        if (window.AudioSys) AudioSys.meleeSwing();
        // lunge: camera push forward-down
        if (window.CameraRig) { CameraRig.kick(-0.01, 0); CameraRig.addShake(0.12); }
      }
      // semi-auto fire (hold allowed at fixed rate)
      if (fireNow && st.reloading <= 0 && C.fireCd <= 0) {
        if (st.mag > 0) shoot();
        else if (fireEdge && window.AudioSys) AudioSys.dryFire(); // once per press
      }
    }

    // --- reload timeline (3 stages) ---
    if (st.reloading > 0 && G.state === 'play') {
      st.reloading -= dt;
      const e = RELOAD_TIME - st.reloading;
      if (e >= 0.85 && C.reloadStage < 2) {
        C.reloadStage = 2;
        if (window.AudioSys) AudioSys.reloadMag();
      }
      if (e >= 1.35 && C.reloadStage < 3) {
        C.reloadStage = 3;
        if (window.AudioSys) AudioSys.reloadSlide();
      }
      if (st.reloading <= 0) {
        st.reloading = 0;
        C.reloadStage = 0;
        const take = Math.min(MAG_SIZE - st.mag, st.reserve);
        st.mag += take;
        st.reserve -= take;
        syncAmmo();
      }
    }

    // --- melee arc at t=0.14 ---
    if (C.meleeT > 0) {
      if (G.state === 'play') {
        C.meleeT -= dt;
        if (!C.meleeHitDone && (MELEE_TIME - C.meleeT) >= MELEE_HIT_T) {
          C.meleeHitDone = true;
          meleeStrike();
        }
      }
      if (C.meleeT <= 0) C.meleeT = 0;
    }

    // --- flashlight: chest mount, pos sways with step bob/footfall, dir lags ---
    const cam = G.cam, sp = Eng.spot;
    const sf = clamp(p.speed / 4.7, 0, 1);
    const stride = p.sprint ? 2.6 : 2.0;
    const su = (p.stepPhase || 0) / stride * Math.PI;
    const pulse = p.stepPulse || 0;
    const stepSide = p.stepSide || 1;
    const latS = Math.sin(su) * 0.022 * sf;
    const vertS = -pulse * 0.03 - Math.sin(su) * Math.sin(su) * 0.014 * sf + Math.sin(Eng.time * 1.1) * 0.003;
    sp.pos[0] = cam.pos[0] + cam.fwd[0] * 0.12 + cam.right[0] * (0.10 + latS) + cam.up[0] * (-0.05 + vertS);
    sp.pos[1] = cam.pos[1] + cam.fwd[1] * 0.12 + cam.right[1] * (0.10 + latS) + cam.up[1] * (-0.05 + vertS);
    sp.pos[2] = cam.pos[2] + cam.fwd[2] * 0.12 + cam.right[2] * (0.10 + latS) + cam.up[2] * (-0.05 + vertS);
    const k = Math.min(1, dt * 14);
    // chest-mount tilt: beam aims slightly below the view axis so the floor pool reads
    const bx = cam.fwd[0], by = cam.fwd[1] - 0.07, bz = cam.fwd[2];
    C.spotDir = V3.norm([
      C.spotDir[0] + (bx - C.spotDir[0]) * k,
      C.spotDir[1] + (by - C.spotDir[1]) * k,
      C.spotDir[2] + (bz - C.spotDir[2]) * k
    ]);
    sp.dir = C.spotDir;
    sp.on = !!p.flashlight;

    // --- viewmodel pose (idle pose still rendered outside 'play') ---
    let px = 0.24, py = -0.19, pz = -0.42;
    let rx = 0, ry = 0.055, rz = 0; // slight inward yaw

    // bob
    if (p.moving && G.state === 'play') {
      py += Math.sin(p.bob * 2) * 0.012 * sf;
      px += Math.cos(p.bob) * 0.008 * sf;
    } else {
      py += Math.sin(Eng.time * 1.1) * 0.003; // breathing micro-drift
    }

    // figure-8 step sway from stepPhase (1:2 Lissajous) + footfall pulse kick
    px += Math.sin(su) * 0.009 * sf;
    py += Math.sin(su * 2) * 0.005 * sf - pulse * 0.014;
    px += stepSide * pulse * 0.004;
    rz += stepSide * pulse * 0.022;

    // sway from G.lookDelta (set by main each frame) — lag springs
    const ld = G.lookDelta || { dx: 0, dy: 0 };
    const tx = clamp(-ld.dx * 0.0005, -0.035, 0.035);
    const ty = clamp(ld.dy * 0.0005, -0.03, 0.03);
    const sk = Math.min(1, dt * 10);
    C.sway.x += (tx - C.sway.x) * sk;
    C.sway.y += (ty - C.sway.y) * sk;
    px += C.sway.x; py += C.sway.y;
    ry -= C.sway.x * 1.2; rx += C.sway.y * 1.2;

    // sprint lower
    const sprintTarget = (p.sprint && p.moving && G.state === 'play') ? 1 : 0;
    C.sprintAmt += (sprintTarget - C.sprintAmt) * Math.min(1, dt * 8);
    py -= 0.07 * C.sprintAmt;
    rx -= 0.38 * C.sprintAmt;
    rz += 0.12 * C.sprintAmt;

    // recoil spring offset
    pz += C.recoil.x * 0.06;
    rx += C.recoil.x * 0.12;

    // reload pose: tilt down / mag drop, then slide rack
    let rack = 0;
    if (st.reloading > 0) {
      const e = RELOAD_TIME - st.reloading;
      const dip = e < 0.3 ? e / 0.3 : (e > 1.45 ? Math.max(0, (RELOAD_TIME - e) / 0.25) : 1);
      rx -= 0.5 * dip;
      py -= 0.06 * dip;
      rz += 0.15 * dip;
      if (e >= 1.35 && e < 1.55) rack = Math.sin((e - 1.35) / 0.2 * Math.PI) * 0.04;
    }

    // melee thrust: gun swings left-forward
    if (C.meleeT > 0) {
      const q = 1 - C.meleeT / MELEE_TIME;
      const mk = Math.sin(q * Math.PI);
      px -= 0.13 * mk;
      pz -= 0.17 * mk;
      py += 0.02 * mk;
      ry += 0.35 * mk;
      rz -= 0.10 * mk;
    }

    // grabbed: gun shakes
    if (p.grabbed > 0) {
      px += rnd(-0.012, 0.012);
      py += rnd(-0.012, 0.012);
      rz += rnd(-0.03, 0.03);
      rx += Math.sin(Eng.time * 30) * 0.02;
    }

    const root = M4.trs([px, py, pz], [rx, ry, rz], null);
    for (let i = 0; i < C.parts.length; i++) {
      const part = C.parts[i];
      if (part === C.slidePart && rack > 0) {
        part.r.model = M4.mul(root, M4.trs([part.pos[0], part.pos[1], part.pos[2] + rack], part.rot, part.size));
      } else {
        part.r.model = M4.mul(root, part.local);
      }
    }
    if (C.flash && C.flashT > 0) {
      const s = C.flashSize;
      C.flash.model = M4.mul(root, M4.trs([0, 0.045, -0.315], [0, 0, C.flashRot], [s, s, 1]));
    }
  };

  /* ---------------- damage pipeline ---------------- */

  C.damage = function (amount, fromPos) {
    if (G.state !== 'play') return;
    if (G.testGod) return; // god mode: also honored here so late/rewrapped calls stay safe
    const p = G.player;
    p.hp = Math.max(0, p.hp - amount);
    G.post.flash = 1;
    G.post.damage = 1 - p.hp / (p.maxHp || 100);
    // directional damage indicator: screen-space side the attack came from
    if (fromPos && window.G.cam) {
      const d = V3.norm([fromPos[0] - G.cam.pos[0], 0, fromPos[2] - G.cam.pos[2]]);
      const rx = V3.dot(d, G.cam.right), fz = V3.dot(d, G.cam.fwd);
      const up = fromPos[1] - G.cam.pos[1];
      const l = Math.hypot(rx, up * 0.6) || 1;
      G.post.hitDir = [rx / l, (up * 0.6) / l];
      G.post.hitT = 1;
      if (fz < -0.2) G.post.hitDir = [G.post.hitDir[0] * 0.4, -0.9]; // behind: bottom edge
    }
    if (window.CameraRig) CameraRig.addShake(0.6);
    if (window.AudioSys) AudioSys.hurt();
    if (p.hp <= 0) {
      p.hp = 0;
      G.state = 'dead';
      if (window.AudioSys) AudioSys.deathSting();
      if (window.Main && Main.onDeath) Main.onDeath();
    }
  };

  C.heal = function (n) {
    const p = G.player;
    p.hp = clamp(p.hp + n, 0, p.maxHp || 100);
    G.post.damage = 1 - p.hp / (p.maxHp || 100);
  };

  C.addAmmo = function (n) {
    C.state.reserve = clamp(C.state.reserve + n, 0, 240);
    syncAmmo();
  };

  window.Combat = C;
})();