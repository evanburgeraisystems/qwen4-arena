/* ============================================================
   js/director.js — window.Director
   Fear-pacing scheduler: blackout sweeps, distant screams + radio
   static, door creak scares, silhouette spawns, rooftop gusts.
   Rate-limited, silent for the first 8 s, escalates with zone.
   Loads BEFORE main.js; wraps Eng.start so Director.update runs
   AFTER the main loop fn (i.e. after Level.update), applying a
   per-light multiplier (light._dirMul) so Level's own flicker and
   distance culling are never broken.
   ============================================================ */
'use strict';
(function () {
  if (!window.Eng) return;

  const STATIC_LINES = [
    '…unit 7… do you copy?… [static]',
    'DISPATCH: …last known… Mercy General… [static]',
    '…they\'re in the vents… repeat… [static]',
    '…any unit… respond… [carrier lost]',
    'BACKUP: …we can\'t hold the… [static]',
    '…command, this is… [signal lost]'
  ];

  // per-event cooldowns (seconds) — events never stack within 6 s
  const CD = { blackout: 20, scream: 18, creak: 15, silhouette: 32, gust: 9 };

  const D = {
    clock: 0,          // own always-running clock
    lastEvent: -100,   // clock time of last fired event
    nextEvent: 10,     // earliest clock time for the next event
    cd: { blackout: 0, scream: 0, creak: 0, silhouette: 0, gust: 0 },
    active: [],        // live blackouts: {L, t, buzzed}
    events: 0          // counter (debug/tests)
  };

  /* ---------- helpers ---------- */
  function levelLights() {
    // only Level-owned lights (they carry .base); never touch transient
    // muzzle-flash lights Combat pushes/pops.
    const out = [];
    const ls = Eng.lights;
    for (let i = 0; i < ls.length; i++) if (ls[i].base) out.push(ls[i]);
    return out;
  }

  function nearLights(pos, r) {
    const out = [], all = levelLights(), r2 = r * r;
    for (let i = 0; i < all.length; i++) {
      const L = all[i];
      const dx = L.pos[0] - pos[0], dy = L.pos[1] - pos[1], dz = L.pos[2] - pos[2];
      if (dx * dx + dy * dy + dz * dz < r2) out.push(L);
    }
    return out;
  }

  function buzz(pos, on) {
    if (window.AudioSys && AudioSys.flickerBuzz) AudioSys.flickerBuzz(pos, on);
  }

  // Zero a subset of lights for dur seconds via _dirMul (applied post-Level.update).
  function blackout(lights, dur) {
    if (!lights.length) return false;
    const frac = rnd(0.4, 0.75);
    let n = Math.max(1, Math.round(lights.length * frac));
    // shuffle-pick without allocating much: swap to front
    for (let i = 0; i < n; i++) {
      const j = i + ((Math.random() * (lights.length - i)) | 0);
      const tmp = lights[i]; lights[i] = lights[j]; lights[j] = tmp;
      const L = lights[i];
      L._dirMul = 0;
      D.active.push({ L: L, t: dur, buzzed: false });
    }
    buzz(lights[0].pos, true);
    return true;
  }

  function farWaypoint(minD, maxD, zone) {
    if (!window.Level || !Level.data || !Level.data.waypoints) return null;
    const wps = Level.data.waypoints, pp = G.player.pos, cands = [];
    for (let i = 0; i < wps.length; i++) {
      const w = wps[i];
      const d = V3.dist(w.pos, pp);
      if (d < minD || d > maxD) continue;
      if (zone >= 0 && w.zone > zone + 1) continue;
      cands.push(w);
    }
    return cands.length ? pick(cands) : null;
  }

  /* ---------- events (return true if fired) ---------- */
  function evBlackout(zone) {
    const ls = nearLights(G.player.pos, 26);
    if (!ls.length) return false;
    return blackout(ls, rnd(0.4, 0.9));
  }

  function evScream(zone) {
    const w = farWaypoint(14, 40, -1);
    const pos = w ? w.pos : [G.player.pos[0], G.player.pos[1], G.player.pos[2] - 20];
    if (window.AudioSys && AudioSys.scream) AudioSys.scream(pos);
    if (window.AudioSys && AudioSys.radio) AudioSys.radio('static');
    if (window.HUD && HUD.radio) HUD.radio(pick(STATIC_LINES), 4.5);
    return true;
  }

  function evCreak(zone) {
    if (!window.Level || !Level.data || !Level.data.doors) return false;
    const doors = Level.data.doors, cands = [];
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      if ((d.closed || d.open < 0.05) && V3.dist(d.pos, G.player.pos) < 22) cands.push(d);
    }
    if (!cands.length) return false;
    const d = pick(cands);
    if (window.AudioSys && AudioSys.doorCreak) AudioSys.doorCreak(d.pos);
    G.emitNoise(d.pos, 8, 'door'); // small — just enough to turn heads
    return true;
  }

  function evSilhouette(zone) {
    if (!window.Zombies || !Zombies.spawn) return false;
    if (Zombies.list && Zombies.list.length >= 24) return false; // respect alive cap
    const w = farWaypoint(12, 26, zone);
    if (!w) return false;
    const z = Zombies.spawn('shamble', w.pos);
    if (z) { z.state = 'idle'; z.groanCd = rnd(5, 9); } // lurk, don't announce
    blackout(nearLights(w.pos, 20), 0.6);
    return true;
  }

  function evGust(zone) {
    if (zone < 5) return false;
    if (!window.Level || !Level.gust) return false;
    Level.gust();
    if (window.CameraRig && CameraRig.addShake) CameraRig.addShake(0.05);
    return true;
  }

  /* ---------- scheduler ---------- */
  function trySchedule() {
    const zone = G.player.zone | 0;
    // global rate limit: ~1/12 s early → ~1/7 s late, never within 6 s
    if (D.clock < D.nextEvent || D.clock - D.lastEvent < 6) return;
    if (G.player.grabbed > 0) return; // don't pile scares onto a grab

    const c = D.cd, cands = [];
    if (c.blackout <= 0) cands.push({ k: 'blackout', w: 3, f: evBlackout });
    if (c.scream <= 0) cands.push({ k: 'scream', w: 2.5, f: evScream });
    if (c.creak <= 0 && zone >= 1) cands.push({ k: 'creak', w: 2, f: evCreak });
    if (c.silhouette <= 0 && zone >= 1) cands.push({ k: 'silhouette', w: 1 + zone * 0.6, f: evSilhouette });
    if (c.gust <= 0 && zone >= 5) cands.push({ k: 'gust', w: 3, f: evGust });
    if (!cands.length) return;

    let sum = 0;
    for (let i = 0; i < cands.length; i++) sum += cands[i].w;
    let roll = Math.random() * sum, ev = cands[cands.length - 1];
    for (let i = 0; i < cands.length; i++) {
      roll -= cands[i].w;
      if (roll <= 0) { ev = cands[i]; break; }
    }
    if (!ev.f(zone)) return; // event couldn't fire — don't burn the slot

    D.cd[ev.k] = CD[ev.k];
    D.lastEvent = D.clock;
    D.events++;
    const gap = lerp(12, 7, clamp((zone - 1) / 3, 0, 1));
    D.nextEvent = D.clock + gap + rnd(0, 3);
  }

  /* ---------- per-frame ---------- */
  function update(dt) {
    D.clock += dt;

    // tick blackout timers regardless of game state so lights always restore
    for (let i = D.active.length - 1; i >= 0; i--) {
      const b = D.active[i];
      b.t -= dt;
      if (b.t <= 0) {
        b.L._dirMul = 1;
        buzz(b.L.pos, false);
        D.active.splice(i, 1);
      }
    }

    if (G.state === 'play' && G.time > 8) {
      for (const k in D.cd) if (D.cd[k] > 0) D.cd[k] -= dt;
      trySchedule();
    }

    // apply AFTER Level.update (hook order guarantees this): multiply the
    // color Level just wrote. Culling (color already 0) and flicker are
    // untouched — we only ever scale by the stored multiplier.
    const ls = Eng.lights;
    for (let i = 0; i < ls.length; i++) {
      const L = ls[i], m = L._dirMul;
      if (m !== undefined && m !== 1) {
        L.color[0] *= m; L.color[1] *= m; L.color[2] *= m;
      }
    }
  }

  window.Director = { update: update, events: function () { return D.events; } };

  // hook: Director.update runs AFTER the main loop fn (Level.update etc.)
  const os = Eng.start.bind(Eng);
  Eng.start = function (fn) {
    os(function (dt, t) { fn(dt, t); update(dt); });
  };
})();
