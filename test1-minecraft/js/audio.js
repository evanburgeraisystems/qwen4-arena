/* audio.js — ALL sounds synthesized with WebAudio (no samples, no assets).
   Defines window.Audio (intentionally shadows the native Audio constructor).
   Parse-time safe: nothing touches AudioContext until Audio.init() is called
   from a user gesture. */
window.Audio = (function () {
  'use strict';

  /* Native AudioContext is captured inside init() — window.Audio (this
     module) shadows the HTMLAudioElement constructor, but AudioContext
     is unaffected. Nothing here runs at parse time. */

  var ctx = null;
  var master = null;        // gain 0.5 (mute ramps this)
  var uwFilter = null;      // lowpass between master and compressor (underwater)
  var compressor = null;
  var noiseBuf = null;      // 1s white noise, created once

  /* persistent ambience nodes */
  var windSrc = null, windFilter = null, windGain = null;
  var gustOsc = null, gustDepth = null;

  var voices = 0;           // bounded one-shot node count
  var MAX_VOICES = 48;

  /* ambience timers */
  var cricketTimer = 1.0;
  var dripTimer = 10.0;
  var lastUnderwater = false;

  var api = {
    muted: false,
    init: init,
    play: play,
    setMuted: setMuted,
    update: update
  };

  /* ------------------------------------------------------------------ */
  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    var NativeAudioContext = window.AudioContext || window.webkitAudioContext;
    if (!NativeAudioContext) return;
    try {
      ctx = new NativeAudioContext();
    } catch (e) { ctx = null; return; }

    master = ctx.createGain();
    master.gain.value = api.muted ? 0 : 0.5;

    uwFilter = ctx.createBiquadFilter();
    uwFilter.type = 'lowpass';
    uwFilter.frequency.value = 20000;
    uwFilter.Q.value = 0.5;

    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 20;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;

    master.connect(uwFilter);
    uwFilter.connect(compressor);
    compressor.connect(ctx.destination);

    /* 1s white-noise buffer, once */
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    /* persistent wind loop: noise -> lowpass 400 -> gain (LFO gusts) */
    windSrc = ctx.createBufferSource();
    windSrc.buffer = noiseBuf;
    windSrc.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 400;
    windFilter.Q.value = 0.4;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);
    windSrc.start();

    /* slow gust LFO: 0.1 Hz sine modulating wind gain depth */
    gustOsc = ctx.createOscillator();
    gustOsc.type = 'sine';
    gustOsc.frequency.value = 0.1;
    gustDepth = ctx.createGain();
    gustDepth.gain.value = 0;
    gustOsc.connect(gustDepth);
    gustDepth.connect(windGain.gain);
    gustOsc.start();

    if (ctx.state === 'suspended') ctx.resume();
  }

  function setMuted(b) {
    api.muted = !!b;
    if (!ctx) return;
    master.gain.setTargetAtTime(api.muted ? 0 : 0.5, ctx.currentTime, 0.03);
  }

  /* ------------------------------------------------------------------ */
  /* one-shot helpers — every node disconnects when its source ends      */

  function cleanupOnEnded(nodes, srcs) {
    voices++;
    var done = false;
    srcs[0].onended = function () {
      if (done) return;
      done = true;
      voices--;
      for (var i = 0; i < nodes.length; i++) {
        try { nodes[i].disconnect(); } catch (e) { /* already gone */ }
      }
    };
  }

  function envelope(g, t0, vol, dur, attack) {
    var a = attack || 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  /* filtered noise burst. opts: {type,freq,q,freqEnd,vol,dur,delay,rate} */
  function noiseBurst(o) {
    if (!ctx || voices >= MAX_VOICES) return;
    var t0 = ctx.currentTime + (o.delay || 0);
    var dur = o.dur;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.playbackRate.value = o.rate || 1;
    var f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.freq, t0);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(o.freqEnd, 20), t0 + dur);
    f.Q.value = o.q === undefined ? 1 : o.q;
    var g = ctx.createGain();
    envelope(g, t0, o.vol, dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.03);
    cleanupOnEnded([src, f, g], [src]);
  }

  /* oscillator tone. opts: {type,f0,f1,dur,vol,delay,rate,lp,lpEnd,
     vibratoHz,vibratoDepth,tremoloHz,tremoloDepth} */
  function tone(o) {
    if (!ctx || voices >= MAX_VOICES) return;
    var t0 = ctx.currentTime + (o.delay || 0);
    var dur = o.dur;
    var osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0, t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(o.f1, 1), t0 + dur);
    var nodes = [osc];
    var srcs = [osc];
    var head = osc;
    if (o.lp) {
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(o.lp, t0);
      if (o.lpEnd) f.frequency.exponentialRampToValueAtTime(Math.max(o.lpEnd, 20), t0 + dur);
      f.Q.value = 0.7;
      head.connect(f); head = f;
      nodes.push(f);
    }
    var g = ctx.createGain();
    envelope(g, t0, o.vol, dur, o.attack);
    head.connect(g); g.connect(master);
    nodes.push(g);
    if (o.vibratoHz) {
      var lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = o.vibratoHz;
      var lg = ctx.createGain();
      lg.gain.value = o.vibratoDepth || o.f0 * 0.03;
      lfo.connect(lg); lg.connect(osc.frequency);
      lfo.start(t0); lfo.stop(t0 + dur + 0.03);
      nodes.push(lfo, lg); srcs.push(lfo);
    }
    if (o.tremoloHz) {
      var tlfo = ctx.createOscillator();
      tlfo.type = 'sine';
      tlfo.frequency.value = o.tremoloHz;
      var tg = ctx.createGain();
      tg.gain.value = o.tremoloDepth || o.vol * 0.5;
      tlfo.connect(tg); tg.connect(g.gain);
      tlfo.start(t0); tlfo.stop(t0 + dur + 0.03);
      nodes.push(tlfo, tg); srcs.push(tlfo);
    }
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
    cleanupOnEnded(nodes, srcs);
  }

  /* ------------------------------------------------------------------ */
  /* material recipes (bandpass noise per material)                      */

  var MATS = {
    grass:  { type: 'bandpass', freq: 2400, q: 0.8, vol: 0.50, dur: 0.07 },
    stone:  { type: 'bandpass', freq: 850,  q: 1.0, vol: 0.80, dur: 0.09 },
    wood:   { type: 'bandpass', freq: 480,  q: 1.0, vol: 0.80, dur: 0.09, thump: true },
    sand:   { type: 'highpass', freq: 4200, q: 0.7, vol: 0.60, dur: 0.08 },
    gravel: { type: 'bandpass', freq: 1300, q: 0.7, vol: 0.85, dur: 0.09 },
    glass:  { type: 'bandpass', freq: 3400, q: 1.2, vol: 0.70, dur: 0.06, ping: 2100 }
  };

  function materialSound(mat, kind, r) {
    var m = MATS[mat];
    if (!m) return;
    var dur, vol, freqEnd = 0;
    if (kind === 'step') { dur = m.dur * 0.85; vol = m.vol * 0.55; }
    else if (kind === 'dig') { dur = m.dur * 0.6; vol = m.vol * 0.45; }
    else { /* break: louder, longer, pitch drops, second micro-burst */
      dur = 0.16 + Math.random() * 0.06;
      vol = m.vol;
      freqEnd = m.freq * 0.55;
    }
    noiseBurst({
      type: m.type, freq: m.freq * r, freqEnd: freqEnd ? freqEnd * r : 0,
      q: m.q, vol: vol, dur: dur, rate: r
    });
    if (kind === 'break') {
      noiseBurst({
        type: m.type, freq: m.freq * 0.8 * r, q: m.q,
        vol: vol * 0.4, dur: 0.05, delay: 0.07, rate: r
      });
    }
    if (m.thump) {
      tone({
        type: 'triangle', f0: 140 * r, f1: 85 * r,
        dur: kind === 'break' ? 0.11 : 0.06,
        vol: kind === 'break' ? 0.55 : 0.35
      });
    }
    if (m.ping) {
      tone({
        type: 'sine', f0: m.ping * r, f1: m.ping * 0.92 * r,
        dur: kind === 'break' ? 0.09 : 0.05,
        vol: kind === 'break' ? 0.4 : 0.3
      });
    }
  }

  /* ------------------------------------------------------------------ */
  function play(name, opts) {
    if (!ctx || api.muted) return;
    opts = opts || {};
    var vol = opts.vol === undefined ? 1 : opts.vol;
    var r = (opts.rate === undefined ? 1 : opts.rate) * (0.92 + Math.random() * 0.16);

    if (name.indexOf('step_') === 0) { materialSound(name.slice(5), 'step', r); return; }
    if (name.indexOf('dig_') === 0) { materialSound(name.slice(4), 'dig', r); return; }
    if (name.indexOf('break_') === 0) { materialSound(name.slice(6), 'break', r); return; }

    switch (name) {
      case 'place':
        tone({ type: 'sine', f0: 180 * r, f1: 90 * r, dur: 0.09, vol: 0.7 * vol });
        noiseBurst({ type: 'highpass', freq: 2500 * r, q: 0.7, vol: 0.12 * vol, dur: 0.02, rate: r });
        break;
      case 'land':
        tone({ type: 'sine', f0: 120 * r, f1: 60 * r, dur: 0.1, vol: 0.65 * vol });
        noiseBurst({ type: 'lowpass', freq: 500 * r, q: 0.6, vol: 0.18 * vol, dur: 0.06, rate: r });
        break;
      case 'splash':
        noiseBurst({ type: 'highpass', freq: 800 * r, freqEnd: 3000 * r, q: 0.6, vol: 0.55 * vol, dur: 0.25, rate: r });
        break;
      case 'hurt':
        tone({ type: 'square', f0: 220 * r, f1: 110 * r, dur: 0.14, vol: 0.5 * vol });
        break;
      case 'death':
        tone({ type: 'square', f0: 180 * r, f1: 50 * r, dur: 0.5, vol: 0.5 * vol });
        noiseBurst({ type: 'lowpass', freq: 900 * r, freqEnd: 200 * r, q: 0.7, vol: 0.3 * vol, dur: 0.45, rate: r });
        break;
      case 'click':
        tone({ type: 'square', f0: 700 * r, dur: 0.03, vol: 0.25 * vol, attack: 0.002 });
        break;
      case 'oink':
        tone({ type: 'sawtooth', f0: 300 * r, f1: 190 * r, dur: 0.09, vol: 0.4 * vol, lp: 900, vibratoHz: 6, vibratoDepth: 18 * r });
        tone({ type: 'sawtooth', f0: 280 * r, f1: 175 * r, dur: 0.09, vol: 0.35 * vol, lp: 900, vibratoHz: 6, vibratoDepth: 16 * r, delay: 0.12 });
        break;
      case 'baa':
        tone({ type: 'square', f0: 420 * r, f1: 370 * r, dur: 0.3, vol: 0.35 * vol, lp: 1500, tremoloHz: 9, tremoloDepth: 0.16 * vol });
        break;
      case 'groan':
        tone({ type: 'sawtooth', f0: 95 * r, f1: 62 * r, dur: 0.8, vol: 0.4 * vol, lp: 400, vibratoHz: 4.5, vibratoDepth: 5 * r });
        noiseBurst({ type: 'bandpass', freq: 500 * r, freqEnd: 260 * r, q: 0.6, vol: 0.12 * vol, dur: 0.75, rate: r });
        break;
      case 'zombie_hurt':
        tone({ type: 'sawtooth', f0: 135 * r, f1: 85 * r, dur: 0.32, vol: 0.45 * vol, lp: 550, vibratoHz: 5.5, vibratoDepth: 7 * r });
        noiseBurst({ type: 'bandpass', freq: 650 * r, freqEnd: 320 * r, q: 0.7, vol: 0.14 * vol, dur: 0.28, rate: r });
        break;
      default:
        break; /* unknown name: safe no-op */
    }
  }

  /* ------------------------------------------------------------------ */
  /* ambience — state: {dayFactor,headUnderwater,y,camX,camZ,playing}    */

  function update(dt, state) {
    if (!ctx || !state) return;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.1) dt = 0.1;
    var now = ctx.currentTime;
    var playing = !!state.playing;
    var day = state.dayFactor === undefined ? 1 : state.dayFactor;

    /* underwater master lowpass: 20000 -> 500, smooth */
    var uw = !!state.headUnderwater;
    if (uw !== lastUnderwater) {
      lastUnderwater = uw;
      uwFilter.frequency.setTargetAtTime(uw ? 500 : 20000, now, 0.18);
    }

    /* wind: gain by day, gust LFO depth follows; silent in menu/mute */
    var windBase = (playing && !api.muted) ? 0.015 + 0.03 * day : 0;
    windGain.gain.setTargetAtTime(windBase, now, 0.5);
    gustDepth.gain.setTargetAtTime(windBase * 0.6, now, 0.5);

    if (!playing || api.muted) return;

    /* crickets at night: 3-pulse chirps every 0.8–2 s, fade with day */
    if (day < 0.2) {
      cricketTimer -= dt;
      if (cricketTimer <= 0) {
        cricketTimer = 0.8 + Math.random() * 1.2;
        var fade = Math.max(0, Math.min(1, (0.2 - day) / 0.2));
        var cv = 0.05 * fade;
        var cr = 0.95 + Math.random() * 0.1;
        for (var k = 0; k < 3; k++) {
          tone({ type: 'sine', f0: 4200 * cr, dur: 0.03, vol: cv, delay: k * 0.07, attack: 0.005 });
        }
      }
    } else {
      cricketTimer = Math.min(cricketTimer, 0.5);
    }

    /* cave drip deep underground: ping + delayed echo, every 8–20 s */
    if (state.y !== undefined && state.y < 38) {
      dripTimer -= dt;
      if (dripTimer <= 0) {
        dripTimer = 8 + Math.random() * 12;
        var dr = 0.94 + Math.random() * 0.12;
        tone({ type: 'sine', f0: 1200 * dr, f1: 800 * dr, dur: 0.08, vol: 0.2 });
        tone({ type: 'sine', f0: 1100 * dr, f1: 750 * dr, dur: 0.07, vol: 0.12, delay: 0.15 });
      }
    } else {
      dripTimer = Math.min(dripTimer, 6);
    }
  }

  return api;
})();
