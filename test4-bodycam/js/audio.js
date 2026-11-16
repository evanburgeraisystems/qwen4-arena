/* ============================================================
   BODYCAM: OUTBREAK — audio (pure WebAudio synthesis, zero assets)
   Master: gain(0.85) -> DynamicsCompressor -> destination.
   Shared noise buffers, capped voices, rate-limited groans.
   Reads G.cam / G.threat / G.player / G.state only.
   ============================================================ */
'use strict';
(function () {

  let ctx = null, master = null, comp = null;
  let sfx = null;            // one-shot bus (bodycam mic band-limit)
  let bedGain = null, windGain = null, windFilter = null;
  let slapIn = null;         // corridor slapback send
  let radioBus = null;       // 300-3000 Hz radio channel
  let bufWhite = null, bufBrown = null, bufPink = null;
  let distCurve = null;

  let zone = 0, lastWindZone = -1, lastVol = 0.85;
  let breathT = 0.6, heartT = 0.5, ambGroanT = 9;
  let rotorOn = false, rotorNodes = null, rotorGain = null;
  let sprintGain = null, lastSprintWind = false, lastBuzzT = -1;

  const MAX_VOICES = 26;
  let activeVoices = 0;
  const groanLog = [];       // timestamps for ~6 groans/sec cap

  /* ---------- tiny local helpers (no engine dependency) ---------- */
  const R = Math.random;
  function rr(a, b) { return a + R() * (b - a); }
  function cl(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function now() { return ctx.currentTime; }

  function mkGain(v) { const g = ctx.createGain(); g.gain.value = v; return g; }
  function mkOsc(type, f) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; }
  function mkFilter(type, f, q) {
    const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q || 0.8; return b;
  }
  function mkNoise(buf, rate) {
    const s = ctx.createBufferSource();
    s.buffer = buf; s.loop = true; s.playbackRate.value = rate || 1;
    return s;
  }
  function startNoise(s, t, off) { s.start(t, off === undefined ? rr(0, s.buffer.duration) : off); return s; }

  // one-shot amplitude envelope
  function env(p, t, attack, peak, dur, release) {
    const holdEnd = Math.max(t + attack + 0.005, t + dur - release);
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(peak, t + attack);
    p.setValueAtTime(peak, holdEnd);
    p.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  // voice budget: attach to the last-stopping source of a sound
  function ticket(lastSrc) {
    if (activeVoices >= MAX_VOICES) return false;
    activeVoices++;
    lastSrc.onended = function () { activeVoices--; };
    return true;
  }

  function setPos(node, pos) {
    if (node.positionX) {
      node.positionX.value = pos[0]; node.positionY.value = pos[1]; node.positionZ.value = pos[2];
    } else if (node.setPosition) {
      node.setPosition(pos[0], pos[1], pos[2]);
    }
  }

  function panner(pos) {
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 3; p.maxDistance = 60; p.rolloffFactor = 1.3;
    setPos(p, pos);
    p.connect(sfx);
    return p;
  }

  function shaper() {
    const w = ctx.createWaveShaper();
    w.curve = distCurve; w.oversample = '2x';
    return w;
  }

  /* ---------- shared noise buffers (created once) ---------- */
  function makeBuffers() {
    const sr = ctx.sampleRate;
    function buf(sec) { return ctx.createBuffer(1, Math.floor(sr * sec), sr); }
    bufWhite = buf(1.3); bufBrown = buf(2.5); bufPink = buf(1.6);
    let w = bufWhite.getChannelData(0);
    for (let i = 0; i < w.length; i++) w[i] = R() * 2 - 1;
    let b = bufBrown.getChannelData(0), last = 0;
    for (let i = 0; i < b.length; i++) {
      last = (last + 0.02 * (R() * 2 - 1)) / 1.02;
      b[i] = cl(last * 3.5, -1, 1);
    }
    let p = bufPink.getChannelData(0), b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < p.length; i++) {
      const x = R() * 2 - 1;
      b0 = 0.99765 * b0 + x * 0.0990460;
      b1 = 0.96300 * b1 + x * 0.2965164;
      b2 = 0.57000 * b2 + x * 1.0526913;
      p[i] = cl((b0 + b1 + b2 + x * 0.1848) * 0.22, -1, 1);
    }
    // shared soft-clip distortion curve
    distCurve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 128) - 1;
      distCurve[i] = Math.tanh(2.4 * x);
    }
  }

  /* ---------- init ---------- */
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC(); } catch (e) { ctx = null; return; }
    if (ctx.state === 'suspended') ctx.resume();

    makeBuffers();

    master = mkGain(0.85);
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 20; comp.ratio.value = 8;
    comp.attack.value = 0.002; comp.release.value = 0.18;
    master.connect(comp); comp.connect(ctx.destination);

    // bodycam mic band-limit for one-shots
    sfx = mkGain(1);
    const hp = mkFilter('highpass', 100, 0.7);
    const lp = mkFilter('lowpass', 8000, 0.7);
    sfx.connect(hp); hp.connect(lp); lp.connect(master);

    // corridor slapback: delay 0.09 s, feedback 0.25, damped
    slapIn = mkGain(1);
    const dly = ctx.createDelay(0.5); dly.delayTime.value = 0.09;
    const fb = mkGain(0.25);
    const damp = mkFilter('lowpass', 1600, 0.7);
    const wet = mkGain(0.5);
    slapIn.connect(dly); dly.connect(damp); damp.connect(fb); fb.connect(dly);
    dly.connect(wet); wet.connect(master);

    // radio channel: Motorola bandwidth + grit
    radioBus = mkGain(0.9);
    const rhp = mkFilter('highpass', 300, 0.9);
    const rlp = mkFilter('lowpass', 3000, 0.9);
    const rsh = shaper();
    radioBus.connect(rhp); rhp.connect(rlp); rlp.connect(rsh); rsh.connect(master);

    startBed();
  }

  /* ---------- ambient bed (started in init) ---------- */
  function startBed() {
    const t = now();
    bedGain = mkGain(0.05); bedGain.connect(master);
    // hospital electrical hum: 55 + 110 Hz + filtered noise
    const o1 = mkOsc('sine', 55), o2 = mkOsc('sine', 110);
    const g1 = mkGain(0.5), g2 = mkGain(0.22);
    o1.connect(g1); g1.connect(bedGain);
    o2.connect(g2); g2.connect(bedGain);
    const hn = startNoise(mkNoise(bufBrown, 1), t);
    const hlp = mkFilter('lowpass', 170, 0.6);
    const hg = mkGain(0.5);
    hn.connect(hlp); hlp.connect(hg); hg.connect(bedGain);
    // slow fluorescent-ish flicker on the bed
    const fl = mkOsc('sine', 0.31), flg = mkGain(0.012);
    fl.connect(flg); flg.connect(bedGain.gain);
    o1.start(t); o2.start(t); fl.start(t);

    // wind (raises on rooftop, zone >= 5)
    windGain = mkGain(0.0); windGain.connect(master);
    const wn = startNoise(mkNoise(bufPink, 1), t);
    windFilter = mkFilter('bandpass', 480, 0.55);
    wn.connect(windFilter); windFilter.connect(windGain);
    const wl = mkOsc('sine', 0.13), wlg = mkGain(220);
    wl.connect(wlg); wlg.connect(windFilter.frequency);
    const wa = mkOsc('sine', 0.09), wag = mkGain(0.03);
    wa.connect(wag); wag.connect(windGain.gain);
    wl.start(t); wa.start(t);

    // sprint wind + gear rustle layer (gain gated in update while sprinting & moving)
    sprintGain = mkGain(0.0001); sprintGain.connect(master);
    const sn = startNoise(mkNoise(bufPink, 1.1), t);
    const sbp = mkFilter('bandpass', 750, 0.6);
    sn.connect(sbp); sbp.connect(sprintGain);
    const sl = mkOsc('sine', 0.5), slg = mkGain(300);
    sl.connect(slg); slg.connect(sbp.frequency);
    const rn = startNoise(mkNoise(bufWhite, 1), t);
    const rhp = mkFilter('highpass', 2600, 0.8);
    const rg = mkGain(0.3);
    rn.connect(rhp); rhp.connect(rg); rg.connect(sprintGain);
    const rfl = mkOsc('sine', rr(8, 11)), rflg = mkGain(0.16);
    rfl.connect(rflg); rflg.connect(rg.gain);
    sl.start(t); rfl.start(t);
  }

  /* ---------- per-frame update ---------- */
  function update(dt) {
    if (!ctx) return;
    if (ctx.state === 'suspended') { ctx.resume(); return; }
    const g = window.G; if (!g) return;
    const t = now();

    // listener from camera rig
    const cam = g.cam || { pos: g.player.pos, fwd: [0, 0, -1], up: [0, 1, 0] };
    const L = ctx.listener;
    const p = cam.pos, f = cam.fwd, u = cam.up;
    const fin = (a) => a && a.length === 3 && isFinite(a[0]) && isFinite(a[1]) && isFinite(a[2]);
    if (!fin(p) || !fin(f) || !fin(u)) return;
    if (L.positionX) {
      L.positionX.value = p[0]; L.positionY.value = p[1]; L.positionZ.value = p[2];
      L.forwardX.value = f[0]; L.forwardY.value = f[1]; L.forwardZ.value = f[2];
      L.upX.value = u[0]; L.upY.value = u[1]; L.upZ.value = u[2];
    } else if (L.setPosition) {
      L.setPosition(p[0], p[1], p[2]);
      L.setOrientation(f[0], f[1], f[2], u[0], u[1], u[2]);
    }

    // master volume: G.settings.vol (guarded, default 0.85), smoothed; mute overrides
    const muted = !!g.muted;
    const volSet = (g.settings && typeof g.settings.vol === 'number' && isFinite(g.settings.vol))
      ? cl(g.settings.vol, 0, 1) : 0.85;
    const volTarget = muted ? 0 : volSet;
    if (volTarget !== lastVol) {
      lastVol = volTarget;
      master.gain.setTargetAtTime(volTarget, t, 0.06);
    }

    const pl = g.player;
    const threat = cl(g.threat || 0, 0, 1);
    const playing = g.state === 'play';

    // rooftop wind + zone bed shift
    const z = (pl && typeof pl.zone === 'number') ? pl.zone : zone;
    if (z !== lastWindZone) {
      lastWindZone = z;
      windGain.gain.setTargetAtTime(z >= 5 ? 0.17 : 0.012, t, 1.4);
      windFilter.frequency.setTargetAtTime(z >= 5 ? 560 : 380, t, 1.4);
      bedGain.gain.setTargetAtTime(z >= 5 ? 0.028 : 0.05, t, 1.4);
    }

    // sprint wind/rustle while sprinting & moving
    const sprinting = playing && !!(pl && pl.sprint && pl.moving);
    if (sprinting !== lastSprintWind) {
      lastSprintWind = sprinting;
      sprintGain.gain.setTargetAtTime(sprinting ? 0.09 : 0.0001, t, sprinting ? 0.15 : 0.35);
    }

    // occasional distant metallic groan in the structure
    ambGroanT -= dt;
    if (ambGroanT <= 0) {
      ambGroanT = rr(9, 22);
      if (g.state !== 'boot') {
        const a = rr(0, Math.PI * 2), d = rr(14, 30);
        distantCreak([p[0] + Math.cos(a) * d, p[1] + rr(-1, 3), p[2] + Math.sin(a) * d]);
      }
    }

    if (!playing) return;

    // breathing: 0.25 Hz calm -> 0.9 Hz at threat 1 / hp < 35; +0.25 Hz exhausted;
    // depth grows with threat/sprint and low stamina
    const hp = pl ? pl.hp : 100;
    const lowHp = hp < 35 ? cl(1 - hp / 35, 0, 1) : 0;
    const sprint = pl && pl.sprint ? 0.25 : 0;
    const stamina = (pl && typeof pl.stamina === 'number' && isFinite(pl.stamina)) ? cl(pl.stamina, 0, 1) : 1;
    const exhausted = !!(pl && pl.exhausted);
    const drive = cl(Math.max(threat, lowHp * 0.9) + sprint + (1 - stamina) * 0.5, 0, 1);
    breathT -= dt;
    if (breathT <= 0) {
      const rate = 0.25 + 0.65 * drive + (exhausted ? 0.25 : 0);
      breathT += 1 / rate;
      doBreath(t, drive, 1 / rate, 1 + (1 - stamina) * 0.9 + (exhausted ? 0.35 : 0));
    }

    // heartbeat: lub-dub when hurt or terrified
    const sev = cl(Math.max(hp < 40 ? 1 - hp / 40 : 0, threat > 0.75 ? (threat - 0.75) * 4 : 0), 0, 1);
    if (sev > 0) {
      heartT -= dt;
      if (heartT <= 0) {
        heartT = 1.05 - 0.4 * sev;
        thump(t, 0.16 + 0.2 * sev);
        thump(t + 0.18, (0.16 + 0.2 * sev) * 0.7);
      }
    } else {
      heartT = 0.3;
    }
  }

  function doBreath(t, drive, period, depthMul) {
    const depth = cl((0.045 + 0.2 * drive) * (depthMul || 1), 0.03, 0.5);
    const dur = period * 0.92;
    const src = startNoise(mkNoise(bufPink, rr(0.9, 1.1)), t);
    const bp = mkFilter('bandpass', rr(650, 1050), 0.7);
    const g = mkGain(0.0001);
    src.connect(bp); bp.connect(g); g.connect(sfx);
    const inhale = dur * 0.42;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(depth, t + inhale);
    g.gain.setValueAtTime(depth, t + inhale + dur * 0.06);
    g.gain.linearRampToValueAtTime(depth * 0.85, t + inhale + dur * 0.14);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    bp.frequency.setValueAtTime(rr(750, 1150), t);
    bp.frequency.linearRampToValueAtTime(rr(280, 430), t + inhale + dur * 0.12);
    src.stop(t + dur + 0.03);
    ticket(src);
    // exhausted/low-stamina wheeze: thin high whistle catching at the exhale tail
    if ((depthMul || 1) > 1.4) {
      const wt = t + dur * 0.72, wd = dur * 0.24;
      const wsrc = startNoise(mkNoise(bufPink, rr(0.95, 1.05)), wt);
      const wbp = mkFilter('bandpass', rr(1700, 2300), 6);
      const wg = mkGain(0.0001);
      wsrc.connect(wbp); wbp.connect(wg); wg.connect(sfx);
      wg.gain.setValueAtTime(0.0001, wt);
      wg.gain.linearRampToValueAtTime(depth * 0.22, wt + wd * 0.3);
      wg.gain.exponentialRampToValueAtTime(0.0001, wt + wd);
      wbp.frequency.linearRampToValueAtTime(rr(1200, 1500), wt + wd);
      wsrc.stop(wt + wd + 0.02);
      ticket(wsrc);
    }
  }

  function thump(t, vol) {
    const o = mkOsc('sine', 62);
    o.frequency.exponentialRampToValueAtTime(36, t + 0.11);
    const g = mkGain(0.0001);
    env(g.gain, t, 0.008, vol, 0.16, 0.1);
    o.connect(g); g.connect(sfx);
    o.start(t); o.stop(t + 0.2);
    ticket(o);
  }

  /* ---------- player weapon / actions ---------- */
  function gunshot() {
    if (!ctx) return;
    const t = now(), pitch = rr(0.92, 1.08);

    // click transient
    const click = startNoise(mkNoise(bufWhite, rr(1, 1.3)), t);
    const chp = mkFilter('highpass', 3500, 0.8);
    const cg = mkGain(0.0001);
    env(cg.gain, t, 0.001, 0.55, 0.02, 0.012);
    click.connect(chp); chp.connect(cg); cg.connect(sfx); cg.connect(slapIn);
    click.stop(t + 0.04);

    // main crack: noise through lowpass sweep 4k -> 300
    const crack = startNoise(mkNoise(bufWhite, pitch), t);
    const lp = mkFilter('lowpass', 4000, 0.9);
    lp.frequency.setValueAtTime(4000, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + 0.24);
    const kg = mkGain(0.0001);
    env(kg.gain, t, 0.001, 1.1, 0.3, 0.22);
    crack.connect(lp); lp.connect(kg); kg.connect(sfx); kg.connect(slapIn);
    crack.stop(t + 0.34);

    // body thump: sine 120 -> 50
    const o = mkOsc('sine', 120 * pitch);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.12);
    const bg = mkGain(0.0001);
    env(bg.gain, t, 0.002, 0.95, 0.17, 0.12);
    o.connect(bg); bg.connect(sfx); bg.connect(slapIn);
    o.start(t); o.stop(t + 0.22);

    // mechanical action tick
    const act = startNoise(mkNoise(bufWhite, 1.4), t + 0.03);
    const abp = mkFilter('bandpass', 2200, 2);
    const ag = mkGain(0.0001);
    env(ag.gain, t + 0.03, 0.001, 0.16, 0.03, 0.02);
    act.connect(abp); abp.connect(ag); ag.connect(sfx);
    act.stop(t + 0.09);

    ticket(crack);
  }

  function dryFire() {
    if (!ctx) return;
    const t = now();
    const s = startNoise(mkNoise(bufWhite, rr(1, 1.4)), t);
    const hp = mkFilter('highpass', 2000, 1);
    const g = mkGain(0.0001);
    env(g.gain, t, 0.001, 0.3, 0.025, 0.018);
    s.connect(hp); hp.connect(g); g.connect(sfx);
    s.stop(t + 0.05);
    const o = mkOsc('sine', rr(1700, 2000));
    const og = mkGain(0.0001);
    env(og.gain, t, 0.001, 0.1, 0.03, 0.025);
    o.connect(og); og.connect(sfx);
    o.start(t); o.stop(t + 0.05);
    ticket(s);
  }

  function reloadStart() { // mag release click
    if (!ctx) return;
    const t = now();
    const s = startNoise(mkNoise(bufWhite, rr(1, 1.3)), t);
    const bp = mkFilter('bandpass', 2600, 2.5);
    const g = mkGain(0.0001);
    env(g.gain, t, 0.001, 0.35, 0.03, 0.02);
    s.connect(bp); bp.connect(g); g.connect(sfx);
    s.stop(t + 0.06);
    const s2 = startNoise(mkNoise(bufWhite, 1.2), t + 0.055);
    const bp2 = mkFilter('bandpass', 1500, 3);
    const g2 = mkGain(0.0001);
    env(g2.gain, t + 0.055, 0.001, 0.2, 0.035, 0.025);
    s2.connect(bp2); bp2.connect(g2); g2.connect(sfx);
    s2.stop(t + 0.12);
    ticket(s2);
  }

  function reloadMag() { // mag insert clack
    if (!ctx) return;
    const t = now();
    const s = startNoise(mkNoise(bufWhite, rr(0.85, 1.1)), t);
    const lp = mkFilter('lowpass', 900, 1);
    const g = mkGain(0.0001);
    env(g.gain, t, 0.001, 0.5, 0.06, 0.045);
    s.connect(lp); lp.connect(g); g.connect(sfx);
    s.stop(t + 0.1);
    const o = mkOsc('triangle', rr(180, 220));
    o.frequency.exponentialRampToValueAtTime(90, t + 0.05);
    const og = mkGain(0.0001);
    env(og.gain, t, 0.001, 0.4, 0.07, 0.05);
    o.connect(og); og.connect(sfx);
    o.start(t); o.stop(t + 0.1);
    ticket(s);
  }

  function reloadSlide() { // metallic slide rack: scrape + clack + ring
    if (!ctx) return;
    const t = now();
    const s = startNoise(mkNoise(bufWhite, rr(0.9, 1.15)), t);
    const bp = mkFilter('bandpass', 2400, 1.4);
    bp.frequency.setValueAtTime(1800, t);
    bp.frequency.linearRampToValueAtTime(3200, t + 0.07);
    const g = mkGain(0.0001);
    env(g.gain, t, 0.004, 0.35, 0.09, 0.04);
    s.connect(bp); bp.connect(g); g.connect(sfx);
    s.stop(t + 0.13);
    // clack
    const s2 = startNoise(mkNoise(bufWhite, 1), t + 0.09);
    const lp2 = mkFilter('lowpass', 1400, 1);
    const g2 = mkGain(0.0001);
    env(g2.gain, t + 0.09, 0.001, 0.5, 0.05, 0.035);
    s2.connect(lp2); lp2.connect(g2); g2.connect(sfx);
    s2.stop(t + 0.17);
    // metallic ring
    const o = mkOsc('sine', rr(1250, 1500));
    const og = mkGain(0.0001);
    env(og.gain, t + 0.09, 0.001, 0.12, 0.16, 0.13);
    o.connect(og); og.connect(sfx);
    o.start(t + 0.09); o.stop(t + 0.28);
    ticket(o);
  }

  function meleeSwing() { // whoosh
    if (!ctx) return;
    const t = now();
    const s = startNoise(mkNoise(bufPink, rr(0.9, 1.2)), t);
    const bp = mkFilter('bandpass', 350, 1.1);
    bp.frequency.setValueAtTime(320, t);
    bp.frequency.linearRampToValueAtTime(rr(1300, 1700), t + 0.1);
    bp.frequency.linearRampToValueAtTime(480, t + 0.22);
    const g = mkGain(0.0001);
    env(g.gain, t, 0.05, 0.32, 0.24, 0.1);
    s.connect(bp); bp.connect(g); g.connect(sfx);
    s.stop(t + 0.28);
    ticket(s);
  }

  function meleeHit() { // wet thud
    if (!ctx) return;
    const t = now();
    const s = startNoise(mkNoise(bufWhite, rr(0.8, 1)), t);
    const lp = mkFilter('lowpass', 380, 0.9);
    const g = mkGain(0.0001);
    env(g.gain, t, 0.002, 0.6, 0.09, 0.06);
    s.connect(lp); lp.connect(g); g.connect(sfx);
    s.stop(t + 0.13);
    const o = mkOsc('sine', 95);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    const og = mkGain(0.0001);
    env(og.gain, t, 0.002, 0.55, 0.12, 0.08);
    o.connect(og); og.connect(sfx);
    o.start(t); o.stop(t + 0.16);
    // wet splatter layer
    const w = startNoise(mkNoise(bufWhite, 1.2), t + 0.01);
    const wbp = mkFilter('bandpass', rr(700, 1000), 1.5);
    const wg = mkGain(0.0001);
    env(wg.gain, t + 0.01, 0.003, 0.22, 0.08, 0.06);
    w.connect(wbp); wbp.connect(wg); wg.connect(sfx);
    w.stop(t + 0.12);
    ticket(o);
  }

  function fleshHit() { // wet bullet-impact thack
    if (!ctx) return;
    const t = now();
    // fast wet slap: mid noise burst, pitch dropping
    const s = startNoise(mkNoise(bufWhite, rr(0.9, 1.2)), t);
    const bp = mkFilter('bandpass', rr(1400, 1900), 1.1);
    bp.frequency.exponentialRampToValueAtTime(rr(500, 750), t + 0.06);
    const g = mkGain(0.0001);
    env(g.gain, t, 0.001, 0.55, 0.07, 0.05);
    s.connect(bp); bp.connect(g); g.connect(sfx);
    const send = mkGain(0.4); g.connect(send); send.connect(slapIn);
    s.stop(t + 0.1);
    // meaty thump
    const o = mkOsc('sine', rr(130, 160));
    o.frequency.exponentialRampToValueAtTime(55, t + 0.07);
    const og = mkGain(0.0001);
    env(og.gain, t, 0.001, 0.5, 0.1, 0.07);
    o.connect(og); og.connect(sfx);
    o.start(t); o.stop(t + 0.13);
    // wet squelch tail
    const w = startNoise(mkNoise(bufWhite, rr(1.1, 1.5)), t + 0.015);
    const wbp = mkFilter('bandpass', rr(1600, 2400), 2);
    const wg = mkGain(0.0001);
    env(wg.gain, t + 0.015, 0.004, 0.18, 0.09, 0.07);
    w.connect(wbp); wbp.connect(wg); wg.connect(sfx);
    w.stop(t + 0.13);
    ticket(o);
  }

  function bodyFall(pos) { // heavy corpse thud + cloth
    if (!ctx) return;
    const t = now();
    if (activeVoices >= MAX_VOICES) return;
    const out = panner([pos[0], pos[1] + 0.4, pos[2]]);
    // heavy low thump
    const o = mkOsc('sine', rr(68, 80));
    o.frequency.exponentialRampToValueAtTime(30, t + 0.16);
    const g = mkGain(0.0001);
    env(g.gain, t, 0.003, 0.9, 0.26, 0.18);
    o.connect(g); g.connect(out); g.connect(slapIn);
    o.start(t); o.stop(t + 0.3);
    // body mass: brown noise thud
    const s = startNoise(mkNoise(bufBrown, rr(0.9, 1.1)), t);
    const lp = mkFilter('lowpass', 500, 0.8);
    lp.frequency.exponentialRampToValueAtTime(150, t + 0.18);
    const sg = mkGain(0.0001);
    env(sg.gain, t, 0.002, 0.6, 0.2, 0.14);
    s.connect(lp); lp.connect(sg); sg.connect(out);
    s.stop(t + 0.25);
    // secondary settle bump
    const o2 = mkOsc('sine', 55);
    o2.frequency.exponentialRampToValueAtTime(32, t + 0.24);
    const g2 = mkGain(0.0001);
    env(g2.gain, t + 0.14, 0.004, 0.3, 0.14, 0.1);
    o2.connect(g2); g2.connect(out);
    o2.start(t + 0.14); o2.stop(t + 0.32);
    // cloth rustle as the body lands
    const c = startNoise(mkNoise(bufWhite, rr(0.9, 1.2)), t + 0.04);
    const chp = mkFilter('highpass', 1500, 0.8);
    const cg = mkGain(0.0001);
    env(cg.gain, t + 0.04, 0.02, 0.2, 0.3, 0.2);
    const flut = mkOsc('sine', rr(10, 16)), flg = mkGain(0.08);
    flut.connect(flg); flg.connect(cg.gain);
    c.connect(chp); chp.connect(cg); cg.connect(out);
    c.stop(t + 0.4); flut.start(t + 0.04); flut.stop(t + 0.4);
    ticket(c);
  }

  function pickup(kind) {
    if (!ctx) return;
    const t = now();
    if (kind === 'medkit') {
      // soft zip-click + gentle two-tone
      const s = startNoise(mkNoise(bufWhite, 1.1), t);
      const bp = mkFilter('bandpass', 1800, 1.2);
      const g = mkGain(0.0001);
      env(g.gain, t, 0.004, 0.22, 0.09, 0.06);
      s.connect(bp); bp.connect(g); g.connect(sfx);
      s.stop(t + 0.13);
      const o = mkOsc('sine', 520);
      o.frequency.setValueAtTime(660, t + 0.1);
      const og = mkGain(0.0001);
      env(og.gain, t + 0.06, 0.01, 0.12, 0.3, 0.18);
      o.connect(og); og.connect(sfx);
      o.start(t + 0.06); o.stop(t + 0.4);
      ticket(o);
    } else {
      // ammo box clack + brief rattle
      const s = startNoise(mkNoise(bufWhite, rr(0.85, 1)), t);
      const lp = mkFilter('lowpass', 1100, 1);
      const g = mkGain(0.0001);
      env(g.gain, t, 0.001, 0.4, 0.06, 0.04);
      s.connect(lp); lp.connect(g); g.connect(sfx);
      s.stop(t + 0.1);
      for (let i = 0; i < 3; i++) {
        const tt = t + 0.05 + i * rr(0.03, 0.05);
        const r = startNoise(mkNoise(bufWhite, rr(1.1, 1.5)), tt);
        const bp = mkFilter('bandpass', rr(2200, 3400), 4);
        const rg = mkGain(0.0001);
        env(rg.gain, tt, 0.001, 0.12, 0.025, 0.018);
        r.connect(bp); bp.connect(rg); rg.connect(sfx);
        r.stop(tt + 0.05);
      }
      ticket(s);
    }
  }

  function hurt() { // grunt-ish noise burst + thump
    if (!ctx) return;
    const t = now();
    const o = mkOsc('sawtooth', rr(120, 150));
    o.frequency.exponentialRampToValueAtTime(rr(70, 90), t + 0.16);
    const bp = mkFilter('bandpass', rr(420, 620), 2);
    const g = mkGain(0.0001);
    env(g.gain, t, 0.012, 0.4, 0.2, 0.12);
    o.connect(bp); bp.connect(g); g.connect(sfx);
    o.start(t); o.stop(t + 0.25);
    const s = startNoise(mkNoise(bufPink, 1), t);
    const sbp = mkFilter('bandpass', 800, 0.9);
    const sg = mkGain(0.0001);
    env(sg.gain, t, 0.01, 0.2, 0.18, 0.12);
    s.connect(sbp); sbp.connect(sg); sg.connect(sfx);
    s.stop(t + 0.24);
    const th = mkOsc('sine', 85);
    th.frequency.exponentialRampToValueAtTime(40, t + 0.1);
    const tg = mkGain(0.0001);
    env(tg.gain, t, 0.003, 0.5, 0.13, 0.09);
    th.connect(tg); tg.connect(sfx);
    th.start(t); th.stop(t + 0.18);
    ticket(o);
  }

  function grabAttack(pos) { // snarl + cloth rustle
    if (!ctx) return;
    const t = now();
    const out = panner([pos[0], pos[1] + 1.4, pos[2]]);
    // short ragged snarl
    const o = mkOsc('sawtooth', rr(100, 160));
    o.frequency.exponentialRampToValueAtTime(rr(65, 90), t + 0.4);
    const vib = mkOsc('sine', rr(7, 11)), vibg = mkGain(25);
    vib.connect(vibg); vibg.connect(o.frequency);
    const sh = shaper();
    const bp = mkFilter('bandpass', rr(700, 1100), 2);
    const g = mkGain(0.0001);
    env(g.gain, t, 0.02, 0.7, 0.42, 0.16);
    o.connect(sh); sh.connect(bp); bp.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.5); vib.start(t); vib.stop(t + 0.5);
    // cloth rustle
    const s = startNoise(mkNoise(bufWhite, rr(0.9, 1.2)), t);
    const hp = mkFilter('highpass', 1300, 0.8);
    const sg = mkGain(0.0001);
    env(sg.gain, t, 0.02, 0.25, 0.3, 0.18);
    const flut = mkOsc('sine', rr(11, 17)), flg = mkGain(0.1);
    flut.connect(flg); flg.connect(sg.gain);
    s.connect(hp); hp.connect(sg); sg.connect(out);
    s.stop(t + 0.36); flut.start(t); flut.stop(t + 0.36);
    // player struggle grunts: two short strained efforts (close mic, non-positional)
    let last = o;
    for (let i = 0; i < 2; i++) {
      const tt = t + 0.1 + i * rr(0.18, 0.26);
      const gd = rr(0.14, 0.22);
      const go = mkOsc('sawtooth', rr(115, 150));
      go.frequency.exponentialRampToValueAtTime(rr(75, 95), tt + gd);
      const gv = mkOsc('sine', rr(9, 13)), gvg = mkGain(12);
      gv.connect(gvg); gvg.connect(go.frequency);
      const gbp = mkFilter('bandpass', rr(450, 700), 2.2);
      const gg = mkGain(0.0001);
      env(gg.gain, tt, 0.015, 0.4, gd, gd * 0.5);
      go.connect(gbp); gbp.connect(gg); gg.connect(sfx);
      go.start(tt); go.stop(tt + gd + 0.03);
      gv.start(tt); gv.stop(tt + gd + 0.03);
      // breathy strain layer
      const gn = startNoise(mkNoise(bufPink, 1), tt);
      const gbp2 = mkFilter('bandpass', rr(900, 1300), 1);
      const gng = mkGain(0.0001);
      env(gng.gain, tt, 0.02, 0.14, gd, gd * 0.5);
      gn.connect(gbp2); gbp2.connect(gng); gng.connect(sfx);
      gn.stop(tt + gd + 0.03);
      last = go;
    }
    ticket(last);
  }

  function flashlightClick() {
    if (!ctx) return;
    const t = now();
    const s = startNoise(mkNoise(bufWhite, rr(1.2, 1.6)), t);
    const hp = mkFilter('highpass', 3000, 1);
    const g = mkGain(0.0001);
    env(g.gain, t, 0.001, 0.22, 0.018, 0.012);
    s.connect(hp); hp.connect(g); g.connect(sfx);
    s.stop(t + 0.04);
    const o = mkOsc('sine', rr(2400, 2700));
    const og = mkGain(0.0001);
    env(og.gain, t, 0.001, 0.08, 0.02, 0.015);
    o.connect(og); og.connect(sfx);
    o.start(t); o.stop(t + 0.04);
    ticket(s);
  }

  function footstep(run, surface) {
    if (!ctx) return;
    const t = now();
    surface = surface || 'tile';
    const vol = run ? 0.42 : 0.24;
    const dur = run ? 0.075 : 0.055;
    let f = 1000, type = 'lowpass', q = 0.8;
    if (surface === 'tile') { f = run ? 1400 : 1800; }
    else if (surface === 'concrete') { f = run ? 700 : 950; }
    else if (surface === 'glass') { f = run ? 3200 : 3800; type = 'highpass'; q = 0.8; }
    else { f = run ? 2000 : 2600; type = 'bandpass'; q = 0.9; } // roof gravel
    const s = startNoise(mkNoise(bufWhite, rr(0.85, 1.2)), t);
    const flt = mkFilter(type, f * rr(0.9, 1.1), q);
    const g = mkGain(0.0001);
    env(g.gain, t, 0.003, vol * rr(0.85, 1.1), dur, dur * 0.7);
    s.connect(flt); flt.connect(g); g.connect(sfx);
    s.stop(t + dur + 0.04);
    // heel click (hard surfaces)
    if (surface === 'glass') {
      // glass crunch: gritty ticks + tiny shard pings
      for (let i = 0; i < 3; i++) {
        const tt = t + rr(0, 0.045);
        const r = startNoise(mkNoise(bufWhite, rr(1.3, 1.8)), tt);
        const bp = mkFilter('bandpass', rr(3000, 5600), 2.5);
        const rg = mkGain(0.0001);
        env(rg.gain, tt, 0.001, vol * rr(0.35, 0.55), 0.02, 0.015);
        r.connect(bp); bp.connect(rg); rg.connect(sfx);
        r.stop(tt + 0.04);
      }
      const nP = 1 + ((R() * 2) | 0);
      for (let i = 0; i < nP; i++) {
        const tt = t + rr(0.01, 0.06);
        const f0 = rr(2400, 5200);
        const po = mkOsc('sine', f0);
        po.frequency.exponentialRampToValueAtTime(f0 * rr(0.6, 0.8), tt + 0.1);
        const pg = mkGain(0.0001);
        env(pg.gain, tt, 0.001, vol * 0.22, 0.1, 0.08);
        po.connect(pg); pg.connect(sfx);
        po.start(tt); po.stop(tt + 0.14);
      }
    } else if (surface !== 'roof') {
      const o = mkOsc('sine', rr(900, 1400) * (run ? 0.8 : 1));
      const og = mkGain(0.0001);
      env(og.gain, t, 0.001, vol * 0.35, 0.025, 0.02);
      o.connect(og); og.connect(sfx);
      o.start(t); o.stop(t + 0.05);
    } else {
      // gravel crunch: two extra micro ticks
      for (let i = 0; i < 2; i++) {
        const tt = t + rr(0.01, 0.04);
        const r = startNoise(mkNoise(bufWhite, rr(1.2, 1.7)), tt);
        const bp = mkFilter('bandpass', rr(2800, 4200), 2);
        const rg = mkGain(0.0001);
        env(rg.gain, tt, 0.001, vol * 0.4, 0.02, 0.015);
        r.connect(bp); bp.connect(rg); rg.connect(sfx);
        r.stop(tt + 0.04);
      }
    }
    // running body thump
    if (run) {
      const th = mkOsc('sine', 75);
      th.frequency.exponentialRampToValueAtTime(42, t + 0.06);
      const tg = mkGain(0.0001);
      env(tg.gain, t, 0.002, 0.22, 0.08, 0.05);
      th.connect(tg); tg.connect(sfx);
      th.start(t); th.stop(t + 0.11);
    }
    ticket(s);
  }

  /* ---------- zombie voices ---------- */
  function groan(pos, kind) {
    if (!ctx) return;
    const t = now();
    // global rate limit ~6/sec
    while (groanLog.length && groanLog[0] < t - 1) groanLog.shift();
    if (groanLog.length >= 6) return;
    if (activeVoices >= MAX_VOICES) return;
    groanLog.push(t);

    kind = kind || 'idle';
    const dur = rr(0.7, 1.8);
    const hot = kind === 'run' || kind === 'aggro';
    const peak = kind === 'idle' ? rr(0.3, 0.42) : kind === 'shamble' ? rr(0.45, 0.6) : rr(0.65, 0.85);
    const out = panner([pos[0], pos[1] + 1.45, pos[2]]);

    // voiced source: sawtooth 70-140 Hz with slow random pitch drift
    const base = rr(70, hot ? 150 : 125);
    const o = mkOsc('sawtooth', base);
    const nPts = 9, curve = new Float32Array(nPts);
    let f = base;
    for (let i = 0; i < nPts; i++) {
      f = cl(f + rr(-0.13, 0.13) * base, base * 0.72, base * 1.3);
      curve[i] = f;
    }
    o.frequency.setValueCurveAtTime(curve, t, dur);
    // slow wobble LFO (wet, unsteady)
    const wob = mkOsc('sine', rr(0.6, 2.2)), wobg = mkGain(rr(3, 9));
    wob.connect(wobg); wobg.connect(o.frequency);

    const vg = mkGain(0.0001);
    env(vg.gain, t, rr(0.05, 0.16), peak, dur, dur * 0.3);
    // wet gurgle: subtle amplitude flutter
    const gur = mkOsc('sine', rr(5.5, 10)), gurg = mkGain(peak * 0.14);
    gur.connect(gurg); gurg.connect(vg.gain);

    // 2-3 bandpass formants, each LFO-modulated
    const nForm = R() < 0.5 ? 3 : 2;
    const fFreqs = [rr(380, 640), rr(850, 1300), rr(1350, 1650)];
    const fGains = [1.0, 0.65, 0.35];
    const body = mkFilter('lowpass', 900, 0.7);
    const bodyG = mkGain(0.25);
    o.connect(body); body.connect(bodyG); bodyG.connect(vg);
    for (let i = 0; i < nForm; i++) {
      const bp = mkFilter('bandpass', fFreqs[i], rr(5, 9));
      const lfo = mkOsc('sine', rr(0.4, 3.4)), lg = mkGain(rr(40, 120));
      lfo.connect(lg); lg.connect(bp.frequency);
      const fg = mkGain(fGains[i]);
      o.connect(bp); bp.connect(fg); fg.connect(vg);
      lfo.start(t); lfo.stop(t + dur + 0.1);
    }
    vg.connect(out);

    // breathy noise layer
    const br = startNoise(mkNoise(bufPink, rr(0.85, 1.15)), t);
    const bbp = mkFilter('bandpass', fFreqs[1] * rr(0.9, 1.1), 1.2);
    const bg = mkGain(0.0001);
    env(bg.gain, t, dur * 0.2, peak * 0.22, dur, dur * 0.35);
    br.connect(bbp); bbp.connect(bg); bg.connect(out);
    br.stop(t + dur + 0.1);

    o.start(t); o.stop(t + dur + 0.1);
    wob.start(t); wob.stop(t + dur + 0.1);
    gur.start(t); gur.stop(t + dur + 0.1);

    // ragged scream layer for run / aggro
    if (hot) {
      const so = mkOsc('sawtooth', base * rr(1.7, 2.3));
      const sv = mkOsc('sine', rr(5.5, 8.5)), svg = mkGain(rr(20, 45));
      sv.connect(svg); svg.connect(so.frequency);
      const sh = shaper();
      const sbp = mkFilter('bandpass', rr(1100, 1700), 2.5);
      const sg = mkGain(0.0001);
      env(sg.gain, t, dur * 0.15, peak * 0.5, dur * 0.85, dur * 0.3);
      so.connect(sh); sh.connect(sbp); sbp.connect(sg); sg.connect(out);
      so.start(t); so.stop(t + dur);
      sv.start(t); sv.stop(t + dur);
    }
    ticket(o);
  }

  function scream(pos) {
    if (!ctx) return;
    const t = now();
    if (activeVoices >= MAX_VOICES) return;
    const dur = 1.2;
    const out = panner([pos[0], pos[1] + 1.5, pos[2]]);
    const o = mkOsc('sawtooth', rr(520, 700));
    o.frequency.setValueAtTime(rr(520, 700), t);
    o.frequency.linearRampToValueAtTime(rr(850, 1050), t + dur * 0.35);
    o.frequency.exponentialRampToValueAtTime(rr(420, 560), t + dur);
    const vib = mkOsc('sine', rr(6, 9.5)), vg = mkGain(rr(30, 60));
    vib.connect(vg); vg.connect(o.frequency);
    const sh = shaper();
    const f1 = mkFilter('bandpass', rr(1400, 1800), 3);
    const f2 = mkFilter('bandpass', rr(2400, 2900), 4);
    const g = mkGain(0.0001);
    env(g.gain, t, 0.03, 0.8, dur, dur * 0.35);
    const g2 = mkGain(0.4);
    o.connect(sh); sh.connect(f1); sh.connect(f2);
    f1.connect(g); f2.connect(g2); g2.connect(g);
    g.connect(out);
    // shriek breath
    const s = startNoise(mkNoise(bufWhite, rr(1, 1.3)), t);
    const hp = mkFilter('highpass', 1800, 0.8);
    const sg = mkGain(0.0001);
    env(sg.gain, t, 0.04, 0.2, dur, dur * 0.4);
    s.connect(hp); hp.connect(sg); sg.connect(out);
    s.stop(t + dur + 0.05);
    o.start(t); o.stop(t + dur + 0.05); vib.start(t); vib.stop(t + dur + 0.05);
    ticket(o);
  }

  function deathRattle(pos) {
    if (!ctx) return;
    const t = now();
    if (activeVoices >= MAX_VOICES) return;
    const dur = rr(0.7, 1.1);
    const out = panner([pos[0], pos[1] + 0.9, pos[2]]);
    // gurgling exhale noise, lowpass sweeping down
    const s = startNoise(mkNoise(bufBrown, rr(0.9, 1.2)), t);
    const lp = mkFilter('lowpass', 850, 1);
    lp.frequency.setValueAtTime(850, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + dur);
    const g = mkGain(0.0001);
    env(g.gain, t, 0.05, 0.5, dur, dur * 0.4);
    // gurgle stutter
    const gur = mkOsc('sine', rr(8, 13)), gg = mkGain(0.22);
    gur.connect(gg); gg.connect(g.gain);
    s.connect(lp); lp.connect(g); g.connect(out);
    s.stop(t + dur + 0.05); gur.start(t); gur.stop(t + dur + 0.05);
    // low formant sweep down
    const o = mkOsc('sawtooth', rr(80, 110));
    o.frequency.exponentialRampToValueAtTime(rr(40, 55), t + dur);
    const bp = mkFilter('bandpass', 480, 4);
    bp.frequency.setValueAtTime(480, t);
    bp.frequency.exponentialRampToValueAtTime(140, t + dur);
    const og = mkGain(0.0001);
    env(og.gain, t, 0.06, 0.3, dur, dur * 0.45);
    o.connect(bp); bp.connect(og); og.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
    ticket(s);
  }

  /* ---------- environment ---------- */
  function doorBang(pos) {
    if (!ctx) return;
    const t = now();
    const out = panner(pos);
    // huge low thump
    const o = mkOsc('sine', 75);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.18);
    const g = mkGain(0.0001);
    env(g.gain, t, 0.002, 1.0, 0.28, 0.2);
    o.connect(g); g.connect(out); g.connect(slapIn);
    o.start(t); o.stop(t + 0.34);
    // noise crack
    const s = startNoise(mkNoise(bufWhite, rr(0.9, 1.1)), t);
    const lp = mkFilter('lowpass', 3000, 0.9);
    lp.frequency.exponentialRampToValueAtTime(400, t + 0.15);
    const sg = mkGain(0.0001);
    env(sg.gain, t, 0.001, 0.85, 0.16, 0.12);
    s.connect(lp); lp.connect(sg); sg.connect(out); sg.connect(slapIn);
    s.stop(t + 0.2);
    // rattling decay: 3 quick echoes + metal rattle ticks
    for (let i = 0; i < 3; i++) {
      const tt = t + 0.09 + i * rr(0.09, 0.12);
      const e = startNoise(mkNoise(bufWhite, rr(0.9, 1.2)), tt);
      const bp = mkFilter('bandpass', rr(600, 1100), 1.2);
      const eg = mkGain(0.0001);
      env(eg.gain, tt, 0.002, 0.4 * (1 - i * 0.28), 0.09, 0.06);
      e.connect(bp); bp.connect(eg); eg.connect(out);
      e.stop(tt + 0.13);
    }
    for (let i = 0; i < 4; i++) {
      const tt = t + rr(0.12, 0.45);
      const r = startNoise(mkNoise(bufWhite, rr(1.2, 1.6)), tt);
      const bp = mkFilter('bandpass', rr(1800, 3200), 6);
      const rg = mkGain(0.0001);
      env(rg.gain, tt, 0.001, rr(0.06, 0.14), 0.04, 0.03);
      r.connect(bp); bp.connect(rg); rg.connect(out);
      r.stop(tt + 0.07);
    }
    ticket(o);
  }

  function doorCreak(pos) {
    if (!ctx) return;
    const t = now();
    if (activeVoices >= MAX_VOICES) return;
    const dur = rr(0.6, 1.2);
    const out = panner(pos);
    const o = mkOsc('sawtooth', rr(45, 80));
    const nPts = 7, curve = new Float32Array(nPts);
    let f = o.frequency.value;
    for (let i = 0; i < nPts; i++) { f = cl(f + rr(-14, 14), 35, 110); curve[i] = f; }
    o.frequency.setValueCurveAtTime(curve, t, dur);
    const bp = mkFilter('bandpass', rr(450, 700), 8);
    bp.frequency.linearRampToValueAtTime(rr(750, 1000), t + dur * 0.6);
    bp.frequency.linearRampToValueAtTime(rr(500, 700), t + dur);
    const g = mkGain(0.0001);
    env(g.gain, t, 0.15, 0.22, dur, dur * 0.35);
    // stick-slip flutter
    const ss = mkOsc('sine', rr(6, 9)), ssg = mkGain(0.08);
    ss.connect(ssg); ssg.connect(g.gain);
    o.connect(bp); bp.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.05); ss.start(t); ss.stop(t + dur + 0.05);
    ticket(o);
  }

  function distantCreak(pos) {
    if (!ctx || activeVoices >= MAX_VOICES) return;
    const t = now(), dur = rr(1.2, 2.4);
    const out = panner(pos);
    const o = mkOsc('sawtooth', rr(30, 55));
    const bp = mkFilter('bandpass', rr(250, 500), 6);
    bp.frequency.linearRampToValueAtTime(rr(350, 750), t + dur);
    const g = mkGain(0.0001);
    env(g.gain, t, dur * 0.3, 0.12, dur, dur * 0.4);
    o.connect(bp); bp.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
    ticket(o);
  }

  function glassBreak(pos) {
    if (!ctx) return;
    const t = now();
    const out = panner(pos);
    // bright noise burst
    const s = startNoise(mkNoise(bufWhite, rr(1, 1.3)), t);
    const hp = mkFilter('highpass', 2500, 0.8);
    const g = mkGain(0.0001);
    env(g.gain, t, 0.001, 0.55, 0.13, 0.1);
    s.connect(hp); hp.connect(g); g.connect(out);
    s.stop(t + 0.18);
    // descending sine shard pings
    const n = 5 + ((R() * 4) | 0);
    for (let i = 0; i < n; i++) {
      const tt = t + rr(0, 0.25);
      const f0 = rr(1800, 5200);
      const o = mkOsc('sine', f0);
      o.frequency.exponentialRampToValueAtTime(f0 * rr(0.55, 0.75), tt + rr(0.15, 0.4));
      const og = mkGain(0.0001);
      env(og.gain, tt, 0.001, rr(0.05, 0.14), rr(0.15, 0.4), 0.12);
      o.connect(og); og.connect(out);
      o.start(tt); o.stop(tt + 0.5);
    }
    // tinkle tail
    const s2 = startNoise(mkNoise(bufWhite, 1.5), t + 0.1);
    const bp = mkFilter('bandpass', 4500, 2);
    const g2 = mkGain(0.0001);
    env(g2.gain, t + 0.1, 0.01, 0.12, 0.35, 0.25);
    s2.connect(bp); bp.connect(g2); g2.connect(out);
    s2.stop(t + 0.5);
    ticket(s);
  }

  function flickerBuzz(pos, on) { // short fluorescent ballast buzz on flicker state change
    if (!ctx) return;
    const t = now();
    if (t - lastBuzzT < 0.07) return; // rate-limit flicker storms
    lastBuzzT = t;
    if (activeVoices >= MAX_VOICES) return;
    const dur = on ? rr(0.18, 0.42) : 0.12;
    const out = panner(pos);
    // ballast buzz: 120 Hz saw + 240 Hz square through band-limited grit
    const o = mkOsc('sawtooth', 120);
    const o2 = mkOsc('square', 240);
    const o2g = mkGain(0.4);
    const bp = mkFilter('bandpass', rr(800, 1300), 1.6);
    const hp = mkFilter('highpass', 350, 0.7);
    const g = mkGain(0.0001);
    const peak = on ? rr(0.12, 0.2) : 0.1;
    env(g.gain, t, 0.008, peak, dur, dur * 0.5);
    // mains flutter
    const fl = mkOsc('sine', rr(43, 61)), flg = mkGain(peak * 0.5);
    fl.connect(flg); flg.connect(g.gain);
    o.connect(bp); o2.connect(o2g); o2g.connect(bp);
    bp.connect(hp); hp.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.03);
    o2.start(t); o2.stop(t + dur + 0.03);
    fl.start(t); fl.stop(t + dur + 0.03);
    // ignition crackle ticks
    if (on) {
      for (let i = 0; i < 2; i++) {
        const tt = t + rr(0, dur * 0.6);
        const s = startNoise(mkNoise(bufWhite, rr(1.2, 1.6)), tt);
        const sbp = mkFilter('bandpass', rr(2600, 4200), 3);
        const sg = mkGain(0.0001);
        env(sg.gain, tt, 0.001, rr(0.05, 0.1), 0.02, 0.015);
        s.connect(sbp); sbp.connect(sg); sg.connect(out);
        s.stop(tt + 0.04);
      }
    }
    ticket(o);
  }

  /* ---------- radio ---------- */
  const RADIO_LINES = {
    dispatch: [
      'DISPATCH: All units, code 30 at Mercy General. Repeat, code 30.',
      'DISPATCH: Multiple assaults reported inside Mercy General. Respond code 3.',
      'DISPATCH: Be advised, subjects are violent and unresponsive. Do not approach alone.'
    ],
    backup: [
      'BACKUP: 4-Adam rolling to Mercy General, ETA two minutes.',
      'BACKUP: Hold your perimeter, officer. We are coming to you.',
      'BACKUP: 4-Adam on scene. Where is the officer? Respond.'
    ],
    panic: [
      'PANIC: They\'re inside the walls! They\'re inside the walls!',
      'PANIC: Shots fired, officer down! Send everything you have!',
      'PANIC: Don\'t let them bite you! Fall back to the roof!'
    ],
    static: [
      '[STATIC]',
      'DISPATCH: ...repeat... code... [STATIC]',
      '...any unit... respond... [STATIC]'
    ],
    final: [
      'DISPATCH: Extraction inbound. Pad is hot, roof access. Move now.',
      'FINAL: Bird is thirty seconds out. Get to the pad.',
      'DISPATCH: This is the last call. Roof. Now.'
    ]
  };

  function squelch(t, vol) {
    const s = startNoise(mkNoise(bufWhite, rr(1, 1.4)), t);
    const bp = mkFilter('bandpass', 2400, 1.5);
    const g = mkGain(0.0001);
    env(g.gain, t, 0.002, vol, 0.07, 0.05);
    s.connect(bp); bp.connect(g); g.connect(radioBus);
    s.stop(t + 0.1);
    const o = mkOsc('square', rr(1600, 2000));
    const og = mkGain(0.0001);
    env(og.gain, t, 0.001, vol * 0.25, 0.02, 0.015);
    o.connect(og); og.connect(radioBus);
    o.start(t); o.stop(t + 0.04);
  }

  function radio(kind) {
    const lines = RADIO_LINES[kind] || RADIO_LINES.dispatch;
    const text = lines[(R() * lines.length) | 0];
    if (!ctx) return text;
    const t = now();
    if (activeVoices >= MAX_VOICES) return text;

    const panic = kind === 'panic';
    const staticOnly = kind === 'static';
    const nSyl = staticOnly ? 2 + ((R() * 3) | 0) : cl(Math.round(text.length / 5), 6, 18);
    const sylDur = panic ? rr(0.07, 0.14) : rr(0.09, 0.2);
    const gap = panic ? rr(0.02, 0.06) : rr(0.03, 0.1);

    squelch(t, 0.3);
    const vStart = t + 0.07;

    // buzz source with per-syllable pitch jumps
    const base = panic ? rr(150, 195) : rr(105, 150);
    const buzz = mkOsc('sawtooth', base);
    const vg = mkGain(0.0001);
    // formant babble: two bandpass formants inside radio bandwidth
    const f1 = mkFilter('bandpass', rr(420, 850), 5);
    const f2 = mkFilter('bandpass', rr(1200, 2500), 6);
    const f2g = mkGain(0.55);
    buzz.connect(f1); buzz.connect(f2);
    f1.connect(vg); f2.connect(f2g); f2g.connect(vg);
    vg.connect(radioBus);

    let tt = vStart;
    for (let i = 0; i < nSyl; i++) {
      const d = sylDur * rr(0.7, 1.3);
      const amp = staticOnly ? rr(0.08, 0.2) : rr(0.35, 0.7);
      vg.gain.setValueAtTime(0.0001, tt);
      vg.gain.linearRampToValueAtTime(amp, tt + 0.015);
      vg.gain.setValueAtTime(amp * rr(0.6, 1), tt + d * 0.6);
      vg.gain.linearRampToValueAtTime(0.0001, tt + d);
      buzz.frequency.setValueAtTime(base * rr(0.82, 1.22), tt);
      f1.frequency.setValueAtTime(rr(380, 900), tt);
      f2.frequency.setValueAtTime(rr(1100, 2600), tt);
      tt += d + gap * rr(0.5, 1.5);
    }
    const vEnd = tt + 0.03;
    buzz.start(vStart); buzz.stop(vEnd);

    // static bed under the voice
    const st = startNoise(mkNoise(bufWhite, 1), t);
    const sbp = mkFilter('bandpass', 1800, 0.5);
    const sg = mkGain(0.0001);
    const stLevel = staticOnly ? 0.3 : 0.05;
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.linearRampToValueAtTime(stLevel, t + 0.03);
    sg.gain.setValueAtTime(stLevel, vEnd - 0.02);
    sg.gain.linearRampToValueAtTime(0.0001, vEnd + 0.1);
    st.connect(sbp); sbp.connect(sg); sg.connect(radioBus);
    st.stop(vEnd + 0.15);

    squelch(vEnd, 0.26);

    // roger beep on some kinds
    if (!staticOnly && (kind === 'dispatch' || kind === 'final' || (kind === 'backup' && R() < 0.6))) {
      const bt = vEnd + 0.1;
      const o = mkOsc('sine', 1050);
      const og = mkGain(0.0001);
      env(og.gain, bt, 0.005, 0.16, 0.14, 0.05);
      o.connect(og); og.connect(radioBus);
      o.start(bt); o.stop(bt + 0.2);
    }
    ticket(buzz);
    return text;
  }

  /* ---------- helicopter ---------- */
  function rotorStart() {
    if (!ctx || rotorOn) return;
    rotorOn = true;
    const t = now();
    rotorGain = mkGain(0.0001);
    rotorGain.gain.setValueAtTime(0.0001, t);
    rotorGain.gain.linearRampToValueAtTime(1, t + 3);
    rotorGain.connect(sfx);

    // blade thump: brown noise gated by shaped 14 Hz LFO
    const thumpG = mkGain(0);
    const bn = startNoise(mkNoise(bufBrown, 1), t);
    const tlp = mkFilter('lowpass', 140, 1);
    bn.connect(tlp); tlp.connect(thumpG); thumpG.connect(rotorGain);
    const lfo = mkOsc('sine', 14);
    const pulse = ctx.createWaveShaper();
    const pc = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      const x = (i / 64) - 1;
      pc[i] = x > 0 ? Math.pow(x, 0.6) : 0;
    }
    pulse.curve = pc;
    const lfoG = mkGain(0.9);
    lfo.connect(pulse); pulse.connect(lfoG); lfoG.connect(thumpG.gain);

    // turbine whine: detuned saws + hiss
    const w1 = mkOsc('sawtooth', 110), w2 = mkOsc('sawtooth', 111.3);
    w1.frequency.linearRampToValueAtTime(180, t + 3);
    w2.frequency.linearRampToValueAtTime(181.5, t + 3);
    const wbp = mkFilter('bandpass', 850, 1.6);
    const wg = mkGain(0.07);
    w1.connect(wbp); w2.connect(wbp); wbp.connect(wg); wg.connect(rotorGain);
    const hiss = startNoise(mkNoise(bufWhite, 1), t);
    const hhp = mkFilter('highpass', 2500, 0.8);
    const hg = mkGain(0.022);
    hiss.connect(hhp); hhp.connect(hg); hg.connect(rotorGain);

    bn.start(t); lfo.start(t); w1.start(t); w2.start(t); hiss.start(t);
    rotorNodes = [bn, lfo, w1, w2, hiss];
  }

  function rotorStop() {
    if (!ctx || !rotorOn) return;
    rotorOn = false;
    const t = now();
    rotorGain.gain.setTargetAtTime(0.0001, t, 0.8);
    const nodes = rotorNodes; rotorNodes = null;
    for (let i = 0; i < nodes.length; i++) nodes[i].stop(t + 3.2);
  }

  /* ---------- stings ---------- */
  function winSting() {
    if (!ctx) return;
    const t = now();
    const o1 = mkOsc('sine', 110), o2 = mkOsc('sine', 164.8);
    const g = mkGain(0.0001);
    env(g.gain, t, 1.2, 0.22, 4.2, 1.6);
    o1.connect(g); o2.connect(g); g.connect(sfx);
    o1.start(t); o1.stop(t + 4.4); o2.start(t); o2.stop(t + 4.4);
    const s = startNoise(mkNoise(bufPink, 1), t);
    const lp = mkFilter('lowpass', 900, 0.7);
    const sg = mkGain(0.0001);
    env(sg.gain, t, 1.4, 0.06, 4.2, 1.6);
    s.connect(lp); lp.connect(sg); sg.connect(sfx);
    s.stop(t + 4.4);
    ticket(o1);
  }

  function deathSting() {
    if (!ctx) return;
    const t = now();
    // low drone
    const o = mkOsc('sawtooth', 38);
    const lp = mkFilter('lowpass', 130, 1);
    const g = mkGain(0.0001);
    env(g.gain, t, 0.8, 0.32, 5, 2);
    o.connect(lp); lp.connect(g); g.connect(sfx);
    o.start(t); o.stop(t + 5.2);
    // flatline-ish tone
    const f = mkOsc('sine', 960);
    const fg = mkGain(0.0001);
    fg.gain.setValueAtTime(0.0001, t + 0.6);
    fg.gain.linearRampToValueAtTime(0.07, t + 1.8);
    fg.gain.setValueAtTime(0.07, t + 4.2);
    fg.gain.linearRampToValueAtTime(0.0001, t + 5.4);
    f.connect(fg); fg.connect(sfx);
    f.start(t + 0.6); f.stop(t + 5.5);
    ticket(o);
  }

  function setZone(z) { zone = z | 0; }

  /* ---------- public API ---------- */
  window.AudioSys = {
    init: init,
    update: update,
    gunshot: gunshot,
    dryFire: dryFire,
    reloadStart: reloadStart,
    reloadMag: reloadMag,
    reloadSlide: reloadSlide,
    meleeSwing: meleeSwing,
    meleeHit: meleeHit,
    fleshHit: fleshHit,
    bodyFall: bodyFall,
    pickup: pickup,
    hurt: hurt,
    grabAttack: grabAttack,
    flashlightClick: flashlightClick,
    footstep: footstep,
    groan: groan,
    scream: scream,
    deathRattle: deathRattle,
    doorBang: doorBang,
    doorCreak: doorCreak,
    glassBreak: glassBreak,
    flickerBuzz: flickerBuzz,
    radio: radio,
    rotorStart: rotorStart,
    rotorStop: rotorStop,
    winSting: winSting,
    deathSting: deathSting,
    setZone: setZone
  };
})();