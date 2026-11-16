/* ============================================================
   BODYCAM: OUTBREAK — js/menu.js (agent MENU)
   window.UI — owns #overlay entirely: diegetic AXON BODY 3 boot
   menu, settings (persisted), pause / death / win screens.
   main.js calls UI.* and wires UI.onStart / UI.onResume.
   Classic script, no deps. Codes against ENGINE.md / IMPROVE.md.
   ============================================================ */
'use strict';

(function () {
  /* ---------------- settings (created at load) ---------------- */
  const DEFAULTS = { sens: 1, vol: 0.85, grain: true };
  const LS_KEY = 'bodycam_settings';
  if (!window.G) window.G = {};
  const G = window.G;

  function clampNum(v, lo, hi, fb) {
    v = Number(v);
    if (!isFinite(v)) return fb;
    return Math.min(hi, Math.max(lo, v));
  }
  function loadSettings() {
    const s = { sens: DEFAULTS.sens, vol: DEFAULTS.vol, grain: DEFAULTS.grain };
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        if (o && typeof o === 'object') {
          s.sens = clampNum(o.sens, 0.5, 2, DEFAULTS.sens);
          s.vol = clampNum(o.vol, 0, 1, DEFAULTS.vol);
          s.grain = (o.grain === undefined) ? DEFAULTS.grain : !!o.grain;
        }
      }
    } catch (e) { /* storage unavailable — defaults */ }
    return s;
  }
  function saveSettings() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(G.settings)); } catch (e) { }
  }
  G.settings = loadSettings();

  /* ---------------- overlay state ---------------- */
  let overlay = null, canvas = null;
  let mode = 'menu';               // menu | pause | dead | win
  let wired = false;
  let startCb = null, resumeCb = null;
  let twTimer = 0, twToken = 0;    // typewriter

  const BOOT_LINES = [
    '> AXON BODY 3 // FW 4.2.1',
    '> SENSOR OK',
    '> IR CUT OK',
    '> STORAGE 87%',
    '> GPS NO FIX',
    '> SIGNAL LIVE'
  ];
  // per-line typography: dim device header, amber warning, bright live signal
  const BOOT_CLASSES = ['hdr', 'ok', 'ok', 'ok', 'warn', 'live'];

  function cancelType() {
    twToken++;
    if (twTimer) { clearTimeout(twTimer); twTimer = 0; }
  }

  // Type lines char-by-char into container (one div per line).
  // Optional classes[] tags each line for per-line styling (boot typography).
  function typeLines(el, lines, cps, gap, done, classes) {
    const token = ++twToken;
    const divs = [];
    for (let i = 0; i < lines.length; i++) {
      const d = document.createElement('div');
      if (classes && classes[i]) d.className = classes[i];
      el.appendChild(d);
      divs.push(d);
    }
    let li = 0, ci = 0;
    function step() {
      if (token !== twToken) return;
      if (li >= lines.length) { twTimer = 0; if (done) done(); return; }
      ci++;
      divs[li].textContent = lines[li].slice(0, ci);
      if (ci >= lines[li].length) { li++; ci = 0; twTimer = setTimeout(step, gap); }
      else twTimer = setTimeout(step, cps);
    }
    step();
  }

  function fmtTime(s) {
    if (typeof s === 'string') return s;
    s = Math.max(0, Math.floor(Number(s) || 0));
    const m = (s / 60) | 0, ss = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
  }
  function fmtAcc(a) {
    a = Number(a);
    if (!isFinite(a)) a = 0;
    if (a > 0 && a <= 1) a *= 100;   // accept fraction or percent
    return Math.round(Math.min(100, Math.max(0, a))) + '%';
  }
  function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

  /* ---------------- menu build ---------------- */
  function buildMenu() {
    overlay.innerHTML =
      '<h1>BODYCAM: OUTBREAK</h1>' +
      '<h2>MERCY GENERAL HOSPITAL &mdash; 02:13 AM &mdash; SIGNAL LIVE</h2>' +
      '<div class="boot"></div>' +
      '<div class="keys">' +
      'WASD move &nbsp;&middot;&nbsp; SHIFT sprint &nbsp;&middot;&nbsp; MOUSE look<br>' +
      'LEFT CLICK fire &nbsp;&middot;&nbsp; R reload &nbsp;&middot;&nbsp; F / RIGHT CLICK shove<br>' +
      'L flashlight &nbsp;&middot;&nbsp; ESC pause<br><br>' +
      'OBJECTIVE: REACH THE ROOFTOP HELIPAD' +
      '</div>' +
      '<div class="settings">' +
      '<div class="row"><label for="ui-sens">SENSITIVITY</label>' +
      '<input id="ui-sens" type="range" min="0.5" max="2" step="0.05">' +
      '<span class="val" id="ui-sens-val"></span></div>' +
      '<div class="row"><label for="ui-vol">VOLUME</label>' +
      '<input id="ui-vol" type="range" min="0" max="1" step="0.05">' +
      '<span class="val" id="ui-vol-val"></span></div>' +
      '<div class="row"><label for="ui-grain">FILM GRAIN</label>' +
      '<input id="ui-grain" type="checkbox">' +
      '<span class="val" id="ui-grain-val"></span></div>' +
      '</div>' +
      '<div class="start">[ CLICK TO BEGIN &mdash; HEADPHONES RECOMMENDED ]</div>' +
      '<div class="warn">AXON BODY 3 &middot; X60390142 &middot; OFFICER D. REYES &middot; BADGE B-2174</div>';

    const sens = overlay.querySelector('#ui-sens');
    const vol = overlay.querySelector('#ui-vol');
    const grain = overlay.querySelector('#ui-grain');
    const sensVal = overlay.querySelector('#ui-sens-val');
    const volVal = overlay.querySelector('#ui-vol-val');
    const grainVal = overlay.querySelector('#ui-grain-val');

    function sync() {
      sens.value = String(G.settings.sens);
      vol.value = String(G.settings.vol);
      grain.checked = !!G.settings.grain;
      sensVal.textContent = G.settings.sens.toFixed(2);
      volVal.textContent = Math.round(G.settings.vol * 100) + '%';
      grainVal.textContent = G.settings.grain ? 'ON' : 'OFF';
    }
    sens.addEventListener('input', function () {
      G.settings.sens = clampNum(sens.value, 0.5, 2, 1);
      sensVal.textContent = G.settings.sens.toFixed(2);
      saveSettings();
    });
    vol.addEventListener('input', function () {
      G.settings.vol = clampNum(vol.value, 0, 1, 0.85);
      volVal.textContent = Math.round(G.settings.vol * 100) + '%';
      saveSettings();
      if (window.AudioSys && AudioSys.setVolume) AudioSys.setVolume(G.settings.vol);
    });
    grain.addEventListener('change', function () {
      G.settings.grain = !!grain.checked;
      grainVal.textContent = G.settings.grain ? 'ON' : 'OFF';
      saveSettings();
    });
    sync();

    cancelType();
    typeLines(overlay.querySelector('.boot'), BOOT_LINES, 16, 150, null, BOOT_CLASSES);
  }

  /* ---------------- screens ---------------- */
  function showMenu() {
    if (!overlay) return;
    mode = 'menu';
    overlay.className = 'menu';
    buildMenu();
  }

  function hide() {
    if (!overlay) return;
    cancelType();
    overlay.classList.add('hidden');
  }

  function showPause() {
    if (!overlay) return;
    cancelType();
    mode = 'pause';
    overlay.className = 'pause';
    overlay.innerHTML =
      '<h1>STANDBY // SIGNAL HELD</h1>' +
      '<h2>FEED BUFFERED &mdash; RECORDING CONTINUES</h2>' +
      '<div class="start">[ CLICK TO RESUME ]</div>';
  }

  function statsLines(stats) {
    stats = stats || {};
    const P = G.player || {};
    const time = (stats.time !== undefined) ? stats.time : G.time;
    const kills = (stats.kills !== undefined) ? stats.kills : (P.kills || 0);
    let acc = stats.accuracy;
    if (acc === undefined) acc = (P.shots > 0) ? (P.hits / P.shots) : 0;
    return [
      pad('TIME', 12) + fmtTime(time),
      pad('KILLS', 12) + String(kills),
      pad('ACCURACY', 12) + fmtAcc(acc)
    ];
  }

  function showEnd(cls, title, sub, stats) {
    if (!overlay) return;
    cancelType();
    mode = cls;
    overlay.className = cls;
    overlay.innerHTML =
      '<h1>' + title + '</h1>' +
      '<h2>' + sub + '</h2>' +
      '<div class="stats"></div>' +
      '<div class="start">[ CLICK TO REDEPLOY ]</div>' +
      '<div class="warn">AXON BODY 3 &middot; X60390142 &middot; FOOTAGE ARCHIVED</div>';
    typeLines(overlay.querySelector('.stats'), statsLines(stats), 14, 220);
  }

  function showDeath(stats) {
    showEnd('dead', 'SIGNAL LOST &mdash; OFFICER DOWN',
      'BIOSIGNS FLATLINE &mdash; FEED TERMINATED', stats);
  }

  function showWin(stats) {
    showEnd('win', 'EXTRACTION CONFIRMED',
      'AIRBORNE &mdash; MERCY GENERAL PERIMETER CLEARED', stats);
  }

  /* ---------------- click routing ---------------- */
  function defaultStart() {
    try {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(function () { });
    } catch (e) { }
    hide();
  }

  function onOverlayClick(e) {
    if (!overlay || overlay.classList.contains('hidden')) return;
    // settings interactions must not start/resume the game
    if (e.target && e.target.closest && e.target.closest('.settings')) return;
    if (mode === 'menu') { (startCb || defaultStart)(); }
    else if (mode === 'pause') { (resumeCb || defaultStart)(); }
    else if (mode === 'dead' || mode === 'win') { location.reload(); }
  }

  /* ---------------- public API ---------------- */
  function init() {
    overlay = document.getElementById('overlay');
    canvas = document.getElementById('glcanvas');
    if (!overlay) return;
    if (!wired) {
      wired = true;
      overlay.addEventListener('click', onOverlayClick);
    }
    showMenu();
  }

  window.UI = {
    init: init,
    showMenu: showMenu,
    hide: hide,
    showPause: showPause,
    showDeath: showDeath,
    showWin: showWin,
    onStart: function (fn) { startCb = (typeof fn === 'function') ? fn : null; },
    onResume: function (fn) { resumeCb = (typeof fn === 'function') ? fn : null; },
    settings: G.settings,
    save: saveSettings
  };
})();
