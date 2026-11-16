/* ============================================================
   TERRA — ui.js  (SYSTEM D)
   Search, cinematic tour, HUD, city card, sun control, loading.
   Plain IIFE on window.TERRA — no modules, no fetch, no assets.
   Codes against the contract APIs of camera.js / globe.js only.
   ============================================================ */
(function () {
  'use strict';

  var T = window.TERRA;
  var util = T.util, bus = T.bus, state = T.state;

  function $(id) { return document.getElementById(id); }

  var dom = {};
  var api = { camera: null, globe: null, cities: null };
  var bound = false;
  var hudTimer = null;

  /* ---------- search state ---------- */
  var rows = [];          // cities currently shown in dropdown
  var activeIdx = -1;
  var sugOpen = false;

  /* ---------- tour state ---------- */
  var tour = {
    active: false, aborted: false, enteredFS: false,
    leg: -1, timer: null, waitResolve: null, dots: []
  };

  /* ============================================================
     helpers
     ============================================================ */
  function norm(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function clamp01(f) { return f < 0 ? 0 : (f > 1 ? 1 : f); }
  function hhmm(v) {
    var h = Math.floor(v), m = Math.round((v - h) * 60);
    if (m === 60) { h += 1; m = 0; }
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }
  function safeP(p) { if (p && p.catch) p.catch(function () {}); return p; }

  function inFS() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement ||
              document.mozFullScreenElement || document.msFullscreenElement);
  }
  function requestFS(el) {
    var fn = el.requestFullscreen || el.webkitRequestFullscreen ||
             el.mozRequestFullScreen || el.msRequestFullscreen;
    if (!fn) return Promise.resolve(false);
    try {
      var p = fn.call(el);
      return (p && p.then)
        ? p.then(function () { return true; }, function () { return false; })
        : Promise.resolve(true);
    } catch (e) { return Promise.resolve(false); }
  }
  function exitFS() {
    var fn = document.exitFullscreen || document.webkitExitFullscreen ||
             document.mozCancelFullScreen || document.msExitFullscreen;
    if (!fn) return;
    try { var p = fn.call(document); if (p && p.catch) p.catch(function () {}); }
    catch (e) { /* silent */ }
  }

  /* ============================================================
     loading / error
     ============================================================ */
  function setProgress(f, label) {
    dom.loadBar.style.width = (clamp01(f) * 100).toFixed(1) + '%';
    if (label != null) dom.loadStatus.textContent = label;
  }
  function ready() {
    dom.app.classList.add('ready');
    dom.loading.classList.add('done');
    setTimeout(function () { dom.loading.classList.add('hidden'); }, 800);
    showBootCard();
  }

  /* ---------- cinematic boot title card (2.5 s, non-blocking) ---------- */
  var bootCard = null, bootGone = false;
  function buildBootCard() {
    var el = document.createElement('div');
    el.id = 'bootcard';
    var inner = document.createElement('div');
    inner.id = 'boot-inner';
    var title = document.createElement('div');
    title.id = 'boot-title';
    title.textContent = 'TERRA';
    var sub = document.createElement('span');
    sub.textContent = '// a procedural Earth';
    title.appendChild(sub);
    var rule = document.createElement('div');
    rule.id = 'boot-rule';
    var hint = document.createElement('div');
    hint.id = 'boot-hint';
    hint.textContent = 'drag to orbit · scroll to descend';
    inner.appendChild(title); inner.appendChild(rule); inner.appendChild(hint);
    el.appendChild(inner);
    dom.app.appendChild(el);
    bootCard = el;
  }
  function bootEarly() { dismissBootCard(); }
  function showBootCard() {
    if (!bootCard || bootGone) return;
    bootCard.classList.add('show');
    setTimeout(dismissBootCard, 2500);
    window.addEventListener('pointerdown', bootEarly);
    window.addEventListener('wheel', bootEarly);
    window.addEventListener('keydown', bootEarly);
  }
  function dismissBootCard() {
    if (!bootCard || bootGone) return;
    bootGone = true;
    window.removeEventListener('pointerdown', bootEarly);
    window.removeEventListener('wheel', bootEarly);
    window.removeEventListener('keydown', bootEarly);
    bootCard.classList.add('out');
    setTimeout(function () {
      if (bootCard && bootCard.parentNode) bootCard.parentNode.removeChild(bootCard);
      bootCard = null;
    }, 950);
  }
  function showError(msg) {
    dom.loading.classList.add('hidden');
    dom.errorMsg.textContent = String(msg == null ? 'Unknown error' : msg);
    dom.error.classList.remove('hidden');
  }

  /* ============================================================
     letterbox / captions
     ============================================================ */
  function setLetterbox(b) {
    dom.lbTop.classList.toggle('on', !!b);
    dom.lbBottom.classList.toggle('on', !!b);
  }
  function capIn(el) {
    el.classList.remove('cap-in');
    void el.offsetWidth;               // restart CSS animation
    el.classList.add('cap-in');
  }
  function caption(title, sub, kicker) {
    if (title == null) { dom.tourbar.classList.add('nocap'); return; }
    dom.tourbar.classList.remove('nocap');
    dom.tourKicker.textContent = kicker || 'CINEMATIC TOUR';
    dom.tourCaption.textContent = title;
    dom.tourSub.textContent = sub || '';
    capIn(dom.tourKicker); capIn(dom.tourCaption); capIn(dom.tourSub);
  }

  /* ============================================================
     search
     ============================================================ */
  function filterCities(q) {
    var cities = T.data.cities, out = [], i, c, r;
    if (!q) {
      // featured list: detail cities first, then population
      out = cities.slice().sort(function (a, b) {
        return (b.detail ? 1 : 0) - (a.detail ? 1 : 0) || b.pop - a.pop;
      });
      return out.slice(0, 8);
    }
    for (i = 0; i < cities.length; i++) {
      c = cities[i];
      if (c._n.indexOf(q) === 0) r = 0;            // name startsWith
      else if (c._c.indexOf(q) === 0) r = 1;       // country startsWith
      else if (c._n.indexOf(q) >= 0 || c._c.indexOf(q) >= 0) r = 2;
      else continue;
      out.push({ c: c, r: r });
    }
    out.sort(function (a, b) {
      return a.r - b.r ||
             (b.c.detail ? 1 : 0) - (a.c.detail ? 1 : 0) ||
             b.c.pop - a.c.pop;
    });
    return out.slice(0, 8).map(function (x) { return x.c; });
  }

  function paintActive() {
    var kids = dom.suggestions.children, i;
    for (i = 0; i < kids.length; i++) {
      kids[i].classList.toggle('active', i === activeIdx);
    }
    if (activeIdx >= 0 && kids[activeIdx] && kids[activeIdx].scrollIntoView) {
      kids[activeIdx].scrollIntoView({ block: 'nearest' });
    }
  }

  function renderSuggestions(list) {
    rows = list;
    activeIdx = list.length ? 0 : -1;
    dom.suggestions.textContent = '';
    if (!list.length) {
      var empty = document.createElement('div');
      empty.className = 's-empty';
      empty.textContent = 'No matches';
      dom.suggestions.appendChild(empty);
      return;
    }
    list.forEach(function (c, idx) {
      var row = document.createElement('div');
      row.className = 's-row';
      var main = document.createElement('div');
      main.className = 's-main';
      var nm = document.createElement('span');
      nm.className = 's-name'; nm.textContent = c.name;
      var co = document.createElement('span');
      co.className = 's-country'; co.textContent = c.country;
      main.appendChild(nm); main.appendChild(co);
      var pop = document.createElement('span');
      pop.className = 's-pop'; pop.textContent = util.formatPop(c.pop);
      row.appendChild(main); row.appendChild(pop);
      if (c.detail) {
        var badge = document.createElement('span');
        badge.className = 's-badge'; badge.textContent = '3D';
        row.appendChild(badge);
      }
      row.addEventListener('mouseenter', function () { activeIdx = idx; paintActive(); });
      row.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep input focus
      row.addEventListener('click', function () { selectCity(c); });
      dom.suggestions.appendChild(row);
    });
    paintActive();
  }

  function openSuggestions() {
    sugOpen = true;
    dom.suggestions.classList.remove('hidden');
  }
  function closeSuggestions() {
    sugOpen = false;
    activeIdx = -1;
    dom.suggestions.classList.add('hidden');
  }
  function refreshSuggestions() {
    renderSuggestions(filterCities(norm(dom.search.value.trim())));
    openSuggestions();
  }

  function selectCity(c) {
    closeSuggestions();
    dom.search.value = c.name;
    dom.search.blur();
    if (!bound || !api.camera || state.tourActive) return;
    var opts;
    if (c.detail) {
      var h = T.data.heroes[c.id] || {};
      opts = Object.assign({}, h.arrival || {}, { arrive: 'street' });
    } else {
      opts = { altitudeM: 180000, elevationDeg: 30 };
    }
    safeP(api.camera.flyTo(c.lat, c.lon, opts));
  }

  function wireSearch() {
    // precompute normalized search fields once
    T.data.cities.forEach(function (c) {
      c._n = norm(c.name);
      c._c = norm(c.country);
    });

    dom.search.addEventListener('input', refreshSuggestions);
    dom.search.addEventListener('focus', function () {
      renderSuggestions(filterCities(norm(dom.search.value.trim())));
      openSuggestions();
    });
    dom.search.addEventListener('blur', function () { closeSuggestions(); });
    dom.search.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!sugOpen) { refreshSuggestions(); return; }
        if (!rows.length) return;
        var d = e.key === 'ArrowDown' ? 1 : -1;
        activeIdx = (activeIdx + d + rows.length) % rows.length;
        paintActive();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (rows.length) selectCity(rows[activeIdx >= 0 ? activeIdx : 0]);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        closeSuggestions();
        dom.search.blur();
      } else if (e.key === 'Tab') {
        closeSuggestions();
      }
    });
    document.addEventListener('pointerdown', function (e) {
      if (sugOpen && !dom.searchwrap.contains(e.target)) closeSuggestions();
    });
  }

  /* ============================================================
     HUD + city card + sun
     ============================================================ */
  function updateHud() {
    if (!api.camera) return;
    var st = api.camera.getState();
    var alt = st.altitudeM;
    dom.hudAlt.textContent = 'ALT ' + (isFinite(alt) ? util.formatAlt(Math.max(0, alt)) : '—');
    if (isFinite(st.lat) && isFinite(st.lon)) {
      dom.hudCoords.textContent = util.formatLatLon(st.lat, st.lon);
    }
    dom.hudPhase.textContent = state.tourActive ? 'TOUR'
      : (st.flying ? 'IN FLIGHT' : String(st.phase || 'space').toUpperCase());
    dom.sunSlider.disabled = !!(st.flying || state.tourActive);
  }

  function onFocus(data) {
    var c = data && data.city;
    if (!c) { dom.citycard.classList.add('hidden'); return; }
    var h = T.data.heroes[c.id];
    dom.ccBadge.textContent = c.detail ? 'PROCEDURAL DISTRICT' : 'FLYOVER';
    dom.citycard.classList.toggle('flyover', !c.detail);
    dom.ccName.textContent = c.name;
    dom.ccCountry.textContent = c.country;
    dom.ccMeta.textContent = util.formatPop(c.pop) + '  ·  ' + util.formatLatLon(c.lat, c.lon);
    dom.ccTag.textContent = (h && h.tagline) ? h.tagline : c.country;
    dom.citycard.classList.remove('hidden');
  }

  function onSunInput() {
    var v = parseFloat(dom.sunSlider.value);
    dom.sunValue.textContent = hhmm(v);
    if (!bound || !api.globe || !api.camera) return;
    if (api.camera.isFlying() || state.tourActive) return;
    var st = api.camera.getState();
    var lat = state.focusCity ? state.focusCity.lat : st.lat;
    var lon = state.focusCity ? state.focusCity.lon : st.lon;
    if (!isFinite(lat) || !isFinite(lon)) return;
    api.globe.setSunDirection(api.globe.sunForLocalTime(lat, lon, v));
  }

  /* ============================================================
     buttons / help / keys
     ============================================================ */
  function toggleSpin() {
    state.spinEnabled = !state.spinEnabled;
    if (api.globe) api.globe.setSpinEnabled(state.spinEnabled);
    dom.btnSpin.classList.toggle('active', state.spinEnabled);
  }
  function toggleFullscreen() {
    if (inFS()) exitFS();
    else requestFS(dom.app);
  }
  function openHelp() { dom.help.classList.remove('hidden'); }
  function closeHelp() { dom.help.classList.add('hidden'); }
  function toggleHelp() { dom.help.classList.toggle('hidden'); }

  function wireButtons() {
    dom.btnSpin.addEventListener('click', toggleSpin);
    dom.btnFullscreen.addEventListener('click', toggleFullscreen);
    dom.btnHelp.addEventListener('click', toggleHelp);
    dom.btnHelpClose.addEventListener('click', closeHelp);
    dom.help.addEventListener('click', function (e) {
      if (e.target === dom.help) closeHelp();
    });
    dom.btnTour.addEventListener('click', startTour);
    dom.btnSkip.addEventListener('click', skipLeg);
    dom.sunSlider.addEventListener('input', onSunInput);
  }

  function isTyping(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  }

  function wireKeys() {
    document.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (tour.active) { abortTour(); return; }
        if (sugOpen) { closeSuggestions(); return; }
        if (!dom.help.classList.contains('hidden')) { closeHelp(); return; }
        if (document.activeElement === dom.search) dom.search.blur();
        return;
      }
      if (isTyping(e.target)) return;
      switch (e.key) {
        case '/':
          e.preventDefault();
          dom.search.focus();
          break;
        case 't': case 'T':
          startTour();
          break;
        case 'f': case 'F':
          toggleFullscreen();
          break;
        case 'r': case 'R':
          if (bound) toggleSpin();
          break;
        case 'h': case 'H':
          toggleHelp();
          break;
        case ' ':
          e.preventDefault();
          if (bound && api.camera && !state.tourActive && !api.camera.isFlying()) {
            safeP(api.camera.exitToSpace());
          }
          break;
      }
    });
  }

  /* ============================================================
     cinematic tour
     ============================================================ */
  function buildLegs() {
    var heroes = T.data.heroes, byId = T.data.byId;
    function street(id) {
      var c = byId[id], h = heroes[id] || {};
      return {
        lat: c.lat, lon: c.lon,
        opts: Object.assign({}, h.arrival || {}, { arrive: 'street' })
      };
    }
    function coords(c) { return util.formatLatLon(c.lat, c.lon).replace(/\s+/g, ' '); }
    var nyc = street('nyc'), tokyo = street('tokyo'), paris = street('paris');
    var rio = byId.rio;
    return [
      { dwell: 2500, space: true, title: 'EARTH',
        sub: '100% procedural · no satellites, no maps' },
      { dwell: 9000, fly: nyc, title: 'NEW YORK',
        sub: coords(byId.nyc) + ' · golden hour' },
      { dwell: 10000, fly: tokyo, title: 'TOKYO',
        sub: coords(byId.tokyo) + ' · neon night' },
      { dwell: 9000, fly: paris, title: 'PARIS',
        sub: coords(byId.paris) + ' · first light' },
      { dwell: 6000, title: 'RIO DE JANEIRO', sub: coords(rio),
        fly: { lat: rio.lat, lon: rio.lon,
               opts: { altitudeM: 26000, elevationDeg: 25, sunHours: 11 } } },
      { dwell: 5000, exit: true, title: 'TERRA',
        sub: 'everything you saw was generated in code' }
    ];
  }

  function paintDots(i) {
    for (var j = 0; j < tour.dots.length; j++) {
      tour.dots[j].classList.toggle('active', j === i);
      tour.dots[j].classList.toggle('done', j < i);
    }
  }

  function setTourBtnText(running) {
    var tn = dom.btnTour.childNodes[1];
    if (tn && tn.nodeType === 3) tn.textContent = running ? ' TOURING…' : ' CINEMATIC TOUR';
    dom.tourPlay.textContent = running ? '■' : '▶';
  }

  function dwell(ms) {
    return new Promise(function (res) {
      tour.waitResolve = res;
      tour.dwellLeft = ms / 1000;   // sim-clock dwell, advanced by bus 'tick'
    });
  }
  bus.on('tick', function (dt) {
    if (tour.dwellLeft == null) return;
    tour.dwellLeft -= dt;
    if (tour.dwellLeft <= 0) {
      tour.dwellLeft = null;
      var r = tour.waitResolve; tour.waitResolve = null;
      if (r) r();
    }
  });

  function skipLeg() {
    if (!tour.active) return;
    if (tour.dwellLeft != null) {
      tour.dwellLeft = null;
      var r = tour.waitResolve; tour.waitResolve = null;
      if (r) r();
    } else if (api.camera && api.camera.isFlying()) {
      api.camera.cancelFlight();      // resolves the flyTo promise early
    }
  }

  function abortTour() {
    if (!tour.active) return;
    tour.aborted = true;
    skipLeg();                        // unblock current await; camera stays put
  }

  function startTour() {
    if (tour.active || !bound || !api.camera) return;   // double-start guard
    tour.active = true; tour.aborted = false; tour.enteredFS = false; tour.leg = -1;
    closeSuggestions(); closeHelp();
    if (api.camera.isFlying()) api.camera.cancelFlight();
    api.camera.setDrift(0);
    state.tourActive = true;
    dom.app.classList.add('touring');
    setLetterbox(true);
    dom.tourbar.classList.remove('hidden');
    dom.tourbar.classList.add('nocap');
    paintDots(-1);
    setTourBtnText(true);
    bus.emit('tourstart');
    // fullscreen — silent failure, remember if WE entered it; never gate the tour on it
    var fsP = inFS() ? Promise.resolve(false) : requestFS(dom.app);
    fsP.then(function (ok) { if (ok) tour.enteredFS = true; });
    runTour();
  }

  function runTour() {
    var legs = buildLegs();
    var i = 0;
    function next() {
      if (tour.aborted || i >= legs.length) { endTour(); return; }
      var leg = legs[i];
      tour.leg = i;
      paintDots(i);
      caption(null);                              // clean frame during flight
      var move;
      if (leg.space) {
        var st = api.camera.getState();
        move = (st.dist < 260) ? api.camera.exitToSpace() : Promise.resolve();
      } else if (leg.exit) {
        move = api.camera.exitToSpace();
      } else if (leg.fly) {
        move = api.camera.flyTo(leg.fly.lat, leg.fly.lon, leg.fly.opts);
      } else {
        move = Promise.resolve();
      }
      Promise.resolve(move).then(function () {
        if (tour.aborted) { endTour(); return; }
        caption(leg.title, leg.sub, ('0' + (i + 1)).slice(-2) + ' / 06');
        api.camera.setDrift(0.02);                // slow auto-orbit during dwell
        return dwell(leg.dwell);
      }).then(function () {
        if (api.camera) api.camera.setDrift(0);
        i++;
        next();
      }).catch(function (e) {
        console.error('[tour]', e);
        endTour();
      });
    }
    next();
  }

  function endTour() {
    if (!tour.active) return;
    tour.active = false;
    tour.dwellLeft = null;
    if (tour.timer != null) { clearTimeout(tour.timer); tour.timer = null; }
    tour.waitResolve = null;
    if (api.camera) api.camera.setDrift(0);
    state.tourActive = false;
    dom.app.classList.remove('touring');
    setLetterbox(false);
    dom.tourbar.classList.add('hidden');
    dom.tourbar.classList.remove('nocap');
    setTourBtnText(false);
    bus.emit('tourend');
    if (tour.enteredFS && inFS()) exitFS();
    tour.enteredFS = false;
  }

  /* ============================================================
     bind + init
     ============================================================ */
  function bind(sys) {
    api.camera = sys.camera || null;
    api.globe = sys.globe || null;
    api.cities = sys.cities || null;
    bound = !!(api.camera && api.globe);
    dom.btnSpin.classList.toggle('active', !!state.spinEnabled);
    if (!hudTimer) hudTimer = setInterval(updateHud, 120);
    updateHud();
  }

  function collectDom() {
    var ids = [
      'app', 'loading', 'load-bar', 'load-status',
      'vignette', 'grain', 'letterbox-top', 'letterbox-bottom',
      'topbar', 'brand', 'searchwrap', 'search', 'suggestions',
      'btn-spin', 'btn-fullscreen', 'btn-help',
      'hud', 'hud-alt', 'hud-coords', 'hud-phase',
      'citycard', 'cc-badge', 'cc-name', 'cc-country', 'cc-meta', 'cc-tag',
      'tourbar', 'tour-kicker', 'tour-caption', 'tour-sub', 'tour-dots',
      'btn-skip', 'tour-hint',
      'bottombar', 'btn-tour', 'tour-play', 'sun-slider', 'sun-value', 'zoomhint',
      'help', 'btn-help-close', 'error', 'error-msg'
    ];
    ids.forEach(function (id) {
      var key = id.replace(/-([a-z])/g, function (_, ch) { return ch.toUpperCase(); });
      dom[key] = $(id);
    });
    dom.lbTop = dom.letterboxTop;
    dom.lbBottom = dom.letterboxBottom;
  }

  function init() {
    collectDom();

    // tour progress dots (6 legs)
    for (var i = 0; i < 6; i++) {
      var d = document.createElement('span');
      d.className = 'dot';
      dom.tourDots.appendChild(d);
      tour.dots.push(d);
    }

    wireSearch();
    wireButtons();
    wireKeys();
    buildBootCard();

    bus.on('focus', onFocus);
    bus.on('flightstart', function () { dom.sunSlider.disabled = true; });
    bus.on('flightend', function () { dom.sunSlider.disabled = !!state.tourActive; });

    dom.sunValue.textContent = hhmm(parseFloat(dom.sunSlider.value));

    return {
      setProgress: setProgress,
      ready: ready,
      bind: bind,
      showError: showError,
      setLetterbox: setLetterbox,
      caption: caption,
      // extras (handy for main.js test hooks)
      startTour: startTour,
      abortTour: abortTour
    };
  }

  T.ui = { init: init };
})();