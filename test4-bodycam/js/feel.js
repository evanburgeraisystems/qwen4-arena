/* Game feel: micro time-dilation (hitstop) + trauma/glitch pulses.
   Loads LAST (after main.js) and wraps Eng._loopFn.
   dt is scaled for the sim while t stays real-time, so G.time keeps correct. */
'use strict';
(function () {
  const PULSES = {
    kill: [0.12, 0.25],   // [shake trauma, min glitch]
    grab: [0.45, 0.5],
    bang: [0.3, 0.6]
  };

  const Feel = {
    _t: 0,          // remaining hitstop, REAL seconds
    _s: 1,          // active time scale
    _last: 1,       // last applied scale (stats)
    _hits: 0,       // hitstop() calls accepted
    _pulses: 0,     // pulse() calls accepted
    _frames: 0,     // wrapped frames seen

    /* One active hitstop max; a new call refreshes it (longer wins, slower wins). */
    hitstop(seconds, scale) {
      const dur = Math.min(3, Math.max(0, +seconds || 0));
      if (dur <= 0) return;
      const sc = Math.min(1, Math.max(0.05, scale == null ? 0.3 : +scale || 0.3));
      if (this._t <= 0) this._s = 1;
      this._t = Math.max(this._t, dur);
      this._s = Math.min(this._s, sc);
      this._hits++;
    },

    /* Counts down in REAL dt; returns the sim scale for this frame. */
    _scale(dt) {
      if (this._t > 0) {
        this._t -= dt;
        if (this._t <= 0) { this._t = 0; this._s = 1; this._last = 1; return 1; }
        this._last = this._s;
        return this._s;
      }
      this._last = 1;
      return 1;
    },

    /* Post-sim hook (real dt). */
    _tick(dt) {
      this._frames++;
    },

    pulse(kind) {
      const p = PULSES[kind];
      if (!p) return;
      this._pulses++;
      if (window.CameraRig && CameraRig.addShake) CameraRig.addShake(p[0]);
      if (window.G && G.post) G.post.glitch = Math.max(G.post.glitch || 0, p[1]);
    },

    deathSlow() {
      this.hitstop(1.2, 0.35);
    },

    stats() {
      return {
        active: this._t > 0,
        remaining: this._t,
        scale: this._t > 0 ? this._s : 1,
        lastScale: this._last,
        hitstops: this._hits,
        pulses: this._pulses,
        frames: this._frames
      };
    }
  };

  window.Feel = Feel;

  /* ---- loop wrap: scaled dt into the sim, real t preserved ---- */
  function makeWrapper(orig) {
    return function (dt, t) {
      const s = Feel._scale(dt);
      orig(dt * s, t);
      Feel._tick(dt);
    };
  }

  if (window.Eng) {
    if (typeof Eng._loopFn === 'function') {
      // main.boot already ran (feel loads after main)
      if (!Eng._feelWrapped) {
        Eng._loopFn = makeWrapper(Eng._loopFn);
        Eng._feelWrapped = true;
      }
    } else {
      // boot not run yet: wrap once the loop is installed
      let raw;
      Object.defineProperty(Eng, '_loopFn', {
        configurable: true,
        get() { return raw; },
        set(fn) {
          if (typeof fn === 'function' && !Eng._feelWrapped) {
            raw = makeWrapper(fn);
            Eng._feelWrapped = true;
          } else {
            raw = fn;
          }
        }
      });
    }
  }
})();
