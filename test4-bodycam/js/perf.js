/* perf.js — adaptive quality governor (agent PERF).
 * Wraps Eng.render to measure frame ms, rolling 30-frame average.
 * Every 2s: avg > 11ms → step quality down; avg < 7ms sustained 4s → step up one.
 * Hysteresis: 2s eval cadence, 4s low-average requirement + 4s cooldown after
 * any step-up before another change, low-window reset on every change.
 * Steps: scale 1→0.85→0.7, PostFX quality 1→0.6→0.35, fx cap 600→350→200,
 * sparks cap 256→128→64. All cross-API calls guarded.
 */
(function () {
  'use strict';
  if (window.Perf) return; // idempotent

  const SCALE   = [1, 0.85, 0.7];
  const QUALITY = [1, 0.6, 0.35];
  const FXCAP   = [600, 350, 200];
  const SPCAP   = [256, 128, 64];
  const N = 30;              // rolling window
  const DOWN_MS = 11, UP_MS = 7;
  const CHECK_MS = 2000, UP_HOLD_MS = 4000;

  const Perf = {
    level: 0,                // 0 = full quality, 2 = lowest
    _buf: new Float64Array(N),
    _idx: 0, _count: 0, _sum: 0,
    _lastCheck: 0, _lastChange: 0, _lowStart: 0,

    _avg() { return this._count ? this._sum / this._count : 0; },

    _sample(ms) {
      if (!(ms >= 0)) return;
      const i = this._idx;
      if (this._count === N) this._sum -= this._buf[i]; else this._count++;
      this._buf[i] = ms; this._sum += ms;
      this._idx = (i + 1) % N;
      const now = performance.now();
      if (this._lastCheck === 0) this._lastCheck = now;
      if (now - this._lastCheck >= CHECK_MS) {
        this._lastCheck = now;
        this._evaluate(now);
      }
    },

    _evaluate(now) {
      if (this._count < 10) return; // not enough data yet
      const avg = this._avg();
      if (avg > DOWN_MS) {
        this._lowStart = 0;
        if (this.level < 2 && now - this._lastChange >= CHECK_MS) {
          this._setLevel(this.level + 1, now);
        }
      } else if (avg < UP_MS) {
        if (!this._lowStart) this._lowStart = now;
        if (this.level > 0 &&
            now - this._lowStart >= UP_HOLD_MS &&
            now - this._lastChange >= UP_HOLD_MS) {
          this._setLevel(this.level - 1, now);
        }
      } else {
        this._lowStart = 0; // between thresholds: hold, reset up-window
      }
    },

    _setLevel(lv, now) {
      const down = lv > this.level;
      this.level = lv;
      this._lastChange = now;
      // stepping down needs a fresh 4s low window before any step back up;
      // stepping up restarts the window too — never two quick changes.
      this._lowStart = down ? 0 : now;
      this._apply();
    },

    _apply() {
      const lv = this.level;
      if (window.Eng) {
        if (typeof Eng.setInternalScale === 'function') Eng.setInternalScale(SCALE[lv]);
        if (Eng.fx && typeof Eng.fx.cap === 'function') Eng.fx.cap(FXCAP[lv]);
        if (Eng.sparks && typeof Eng.sparks.cap === 'function') Eng.sparks.cap(SPCAP[lv]);
      }
      if (window.PostFX && typeof PostFX.setQuality === 'function') PostFX.setQuality(QUALITY[lv]);
    },

    stats() {
      return {
        ms: Math.round(this._avg() * 100) / 100,
        scale: SCALE[this.level],
        quality: QUALITY[this.level],
        level: this.level
      };
    }
  };

  window.Perf = Perf;

  // Hook at load: time the real render (scene + PostFX), feed the sampler.
  if (window.Eng && typeof Eng.render === 'function') {
    const or = Eng.render.bind(Eng);
    Eng.render = () => {
      const t0 = performance.now();
      or();
      const cpu = performance.now() - t0;
      // GL submit time alone under-reports GPU cost; when the tab is visible,
      // frame period reveals GPU-bound frames. Hidden tabs use CPU only.
      let ms = cpu;
      if (!document.hidden && Perf._lastT) {
        const period = t0 - Perf._lastT;
        if (period > 0 && period < 250) ms = Math.max(cpu, period - 16.7);
      }
      Perf._lastT = t0;
      Perf._sample(ms);
    };
    Perf._apply(); // level 0 defaults; guarded no-ops until APIs exist
  }
})();
