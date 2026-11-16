/* ui.js — HUD, menus, hotbar, hearts, debug panel. All DOM is built inside
   UI.init() (parse-time safe). No external fonts/images/CSS. */
window.UI = (function () {
  'use strict';

  var DEFAULT_HOTBAR = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  var inited = false;
  var hud, debugEl, screens;
  var crosshair, hotbarEl, slots = [], slotIcons = [], slotNums = [];
  var heartsEl, heartCanvases = [], bubblesEl, bubbleEls = [];
  var nameLabel, nameFadeTimer = 0;
  var vignette, uwOverlay, flyingHint, lockHint;
  var muteBtn = null, seedInput = null;

  var currentScreen = 'start';
  var debugVisible = false;
  var lastHealth = -1;
  var lastSelected = -1;
  var lastHotbarKey = '';
  var lastDebugText = '';
  var lastSlowUpdate = 0;
  var lastNow = 0;
  var submerged = 0;
  var lastUnderwater = false;
  var lastFlying = false;
  var shakeTimer = 0;

  /* 7x7 pixel heart, drawn at offset (1,1) on a 9x9 canvas; the outline is
     the 8-neighbour dilation of the fill mask. */
  var HEART = [
    '.XX.XX.',
    'XXXXXXX',
    'XXXXXXX',
    'XXXXXXX',
    '.XXXXX.',
    '..XXX..',
    '...X...'
  ];

  /* ------------------------------------------------------------------ */
  function el(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  function mcButton(parent, label, onClick) {
    var b = el('button', 'mc-btn', parent, label);
    b.type = 'button';
    b.addEventListener('click', function () {
      if (window.Audio) window.Audio.play('click');
      onClick();
    });
    return b;
  }

  function parseSeed(s) {
    s = (s || '').trim();
    if (!s) return (Math.random() * 0x7fffffff) | 0;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10) | 0;
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    return h;
  }

  /* dirt tile (atlas index 2 at (32,0)) scaled x4, pixelated */
  function dirtBackgroundURL() {
    try {
      var c = document.createElement('canvas');
      c.width = c.height = 64;
      var g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(window.Blocks.atlasCanvas, 32, 0, 16, 16, 0, 0, 64, 64);
      return c.toDataURL();
    } catch (e) {
      return '';
    }
  }

  function drawHeart(canvas, mode) { /* 2 full, 1 half, 0 empty */
    var g = canvas.getContext('2d');
    g.clearRect(0, 0, 9, 9);
    var fill = [], outline = [];
    var x, y, i;
    for (y = 0; y < 7; y++) for (x = 0; x < 7; x++) {
      if (HEART[y][x] === 'X') fill.push([x + 1, y + 1]);
    }
    var isFill = {};
    for (i = 0; i < fill.length; i++) isFill[fill[i][0] + ',' + fill[i][1]] = true;
    var seen = {};
    for (i = 0; i < fill.length; i++) {
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var ox = fill[i][0] + dx, oy = fill[i][1] + dy;
        var key = ox + ',' + oy;
        if (!isFill[key] && !seen[key]) { seen[key] = true; outline.push([ox, oy]); }
      }
    }
    var outlineColor = mode === 0 ? '#101010' : '#2a0606';
    g.fillStyle = outlineColor;
    for (i = 0; i < outline.length; i++) g.fillRect(outline[i][0], outline[i][1], 1, 1);
    for (i = 0; i < fill.length; i++) {
      x = fill[i][0]; y = fill[i][1];
      var red = mode === 2 || (mode === 1 && x < 5);
      g.fillStyle = red ? '#e33b3b' : (mode === 0 ? '#3a3a3a' : '#4a2a2a');
      g.fillRect(x, y, 1, 1);
    }
    if (mode > 0) { /* shine */
      g.fillStyle = '#ff8f8f';
      g.fillRect(2, 2, 1, 1);
      g.fillRect(3, 2, 1, 1);
      g.fillRect(2, 3, 1, 1);
    }
  }

  function updateHearts(health) {
    var h = Math.max(0, Math.min(20, Math.round(health)));
    if (h === lastHealth) return;
    lastHealth = h;
    for (var i = 0; i < 10; i++) {
      var mode = h >= (i + 1) * 2 ? 2 : (h === i * 2 + 1 ? 1 : 0);
      drawHeart(heartCanvases[i], mode);
    }
    heartsEl.classList.toggle('low', h > 0 && h <= 6);
  }

  /* ------------------------------------------------------------------ */
  function buildHUD() {
    /* crosshair */
    crosshair = el('div', 'crosshair', hud);
    el('div', 'ch-h', crosshair);
    el('div', 'ch-v', crosshair);

    /* damage vignette + underwater tint */
    vignette = el('div', 'damage-vignette', hud);
    uwOverlay = el('div', 'underwater-overlay', hud);

    /* bottom cluster: hearts/bubbles row, name label, hotbar */
    var bottom = el('div', 'hud-bottom', hud);
    var topRow = el('div', 'hud-top-row', bottom);
    heartsEl = el('div', 'hearts', topRow);
    for (var i = 0; i < 10; i++) {
      var hc = document.createElement('canvas');
      hc.width = hc.height = 9;
      hc.className = 'heart';
      heartsEl.appendChild(hc);
      heartCanvases.push(hc);
    }
    bubblesEl = el('div', 'bubbles', topRow);
    for (i = 0; i < 10; i++) bubbleEls.push(el('div', 'bubble', bubblesEl));

    nameLabel = el('div', 'name-label', bottom);

    hotbarEl = el('div', 'hotbar', bottom);
    for (i = 0; i < 10; i++) {
      var slot = el('div', 'slot', hotbarEl);
      var num = el('span', 'slot-num', slot, String((i + 1) % 10));
      var icon = document.createElement('canvas');
      icon.width = icon.height = 48;
      icon.className = 'slot-icon';
      slot.appendChild(icon);
      slots.push(slot); slotIcons.push(icon); slotNums.push(num);
    }
    flyingHint = el('div', 'flying-hint', bottom, 'flying');
    lockHint = el('div', 'lock-hint', hud, 'pointer lock unavailable — move mouse to look · Esc pauses');

    paintHotbarIcons(DEFAULT_HOTBAR);
    updateHearts(20);
  }

  function paintHotbarIcons(hotbar) {
    for (var i = 0; i < 10; i++) {
      var id = hotbar && hotbar[i] !== undefined ? hotbar[i] : DEFAULT_HOTBAR[i];
      try { window.Blocks.drawIcon(slotIcons[i], id); } catch (e) { /* icon stays clear */ }
    }
  }

  function selectSlot(sel) {
    if (sel === lastSelected) return;
    if (lastSelected >= 0 && slots[lastSelected]) slots[lastSelected].classList.remove('selected');
    lastSelected = sel;
    if (slots[sel]) slots[sel].classList.add('selected');
  }

  function showName(id) {
    var b = window.Blocks.BY_ID[id];
    nameLabel.textContent = b ? b.name : '';
    nameLabel.classList.add('visible');
    if (nameFadeTimer) clearTimeout(nameFadeTimer);
    nameFadeTimer = setTimeout(function () {
      nameLabel.classList.remove('visible');
      nameFadeTimer = 0;
    }, 1500);
  }

  /* ------------------------------------------------------------------ */
  function buildScreens() {
    var dirt = dirtBackgroundURL();
    var dirtBg = dirt ? 'url(' + dirt + ')' : 'none';

    /* --- start --- */
    var start = screens.start;
    start.style.backgroundImage = 'linear-gradient(rgba(0,0,0,0.62),rgba(0,0,0,0.62)),' + dirtBg;
    el('h1', 'game-title', start, 'VOXELCRAFT');
    el('div', 'subtitle', start, 'A tiny voxel world — infinite, in your browser');
    seedInput = el('input', 'mc-input', start);
    seedInput.type = 'text';
    seedInput.placeholder = 'random seed';
    seedInput.maxLength = 40;
    seedInput.setAttribute('autocomplete', 'off');
    seedInput.setAttribute('spellcheck', 'false');
    mcButton(start, 'Play', function () {
      if (window.Audio) window.Audio.init();
      if (window.Game) window.Game.start(parseSeed(seedInput.value));
    }).id = 'play-btn';
    var controls = el('div', 'controls', start);
    var pairs = [
      ['WASD', 'Move'], ['Space', 'Jump'], ['Shift', 'Sprint'],
      ['Left click', 'Break'], ['Right click', 'Place'], ['1–0 / Wheel', 'Hotbar'],
      ['Double-Space', 'Fly'], ['Space / C', 'Fly up / down'], ['F3', 'Debug'],
      ['M', 'Mute'], ['Esc', 'Pause']
    ];
    for (var i = 0; i < pairs.length; i++) {
      var cell = el('div', 'control-item', controls);
      el('b', null, cell, pairs[i][0]);
      cell.appendChild(document.createTextNode(' ' + pairs[i][1]));
    }

    /* --- pause --- */
    var pause = screens.pause;
    el('h2', 'screen-title', pause, 'Game Paused');
    mcButton(pause, 'Resume', function () { if (window.Game) window.Game.resume(); });
    mcButton(pause, 'New World', function () { if (window.Game) window.Game.newWorld(); });
    muteBtn = mcButton(pause, 'Sound: On', function () {
      if (!window.Audio) return;
      window.Audio.setMuted(!window.Audio.muted);
      syncMuteLabel();
    });
    el('div', 'pause-hint', pause, 'Esc — resume · M — mute');

    /* --- death --- */
    var death = screens.death;
    death.style.backgroundImage = 'linear-gradient(rgba(120,0,0,0.5),rgba(120,0,0,0.5)),' + dirtBg;
    el('h2', 'death-title', death, 'You Died!');
    mcButton(death, 'Respawn', function () { if (window.Game) window.Game.respawn(); });
  }

  function syncMuteLabel() {
    if (muteBtn && window.Audio) {
      muteBtn.textContent = window.Audio.muted ? 'Sound: Off' : 'Sound: On';
    }
  }

  /* ------------------------------------------------------------------ */
  function showScreen(name) {
    currentScreen = name || null;
    screens.start.style.display = name === 'start' ? 'flex' : 'none';
    screens.pause.style.display = name === 'pause' ? 'flex' : 'none';
    screens.death.style.display = name === 'death' ? 'flex' : 'none';
    var covered = !!name;
    hud.style.display = covered ? 'none' : 'block';
    debugEl.style.display = (!covered && debugVisible) ? 'block' : 'none';
    if (name === 'pause') syncMuteLabel();
    if (name === 'start' && seedInput) seedInput.value = '';
  }

  function toggleDebug() {
    debugVisible = !debugVisible;
    debugEl.style.display = (debugVisible && !currentScreen) ? 'block' : 'none';
  }

  function damageFlash() {
    if (!inited) return;
    vignette.style.transition = 'none';
    vignette.style.opacity = '0.35';
    void vignette.offsetWidth; /* restart transition */
    vignette.style.transition = 'opacity 0.4s ease-out';
    vignette.style.opacity = '0';
    heartsEl.classList.remove('shake');
    void heartsEl.offsetWidth;
    heartsEl.classList.add('shake');
    if (shakeTimer) clearTimeout(shakeTimer);
    shakeTimer = setTimeout(function () {
      heartsEl.classList.remove('shake');
      shakeTimer = 0;
    }, 300);
  }

  /* ------------------------------------------------------------------ */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function updateDebug(s) {
    var t = s.time || 0;
    var hours = Math.floor(t * 24) % 24;
    var mins = Math.floor((t * 24 - Math.floor(t * 24)) * 60);
    var text =
      'Voxelcraft (' + Math.round(s.fps || 0) + ' fps)\n' +
      'XYZ: ' + (s.px || 0).toFixed(1) + ' / ' + (s.py || 0).toFixed(1) + ' / ' + (s.pz || 0).toFixed(1) + '\n' +
      'Chunk: ' + Math.floor((s.px || 0) / 16) + ' ' + Math.floor((s.pz || 0) / 16) + '\n' +
      'Biome: ' + (s.biome || '—') + '\n' +
      'Time: ' + pad2(hours) + ':' + pad2(mins) + ' (day ' + Math.round((s.dayFactor || 0) * 100) + '%)\n' +
      'Seed: ' + (s.seed === undefined ? '—' : s.seed) + '\n' +
      'Chunks: ' + (s.chunks || 0) + ' drawn\n' +
      'Mobs: ' + (s.mobs || 0) + '\n' +
      'Flying: ' + (s.flying ? 'yes' : 'no');
    if (text !== lastDebugText) {
      lastDebugText = text;
      debugEl.textContent = text;
    }
  }

  function updateBubbles(dt, underwater) {
    if (underwater) {
      submerged += dt;
    } else {
      submerged = 0;
    }
    var shown = Math.max(0, Math.ceil(10 * (1 - submerged / 12)));
    for (var i = 0; i < 10; i++) {
      bubbleEls[i].classList.toggle('pop', i >= shown);
    }
    bubblesEl.style.display = underwater ? 'flex' : 'none';
  }

  function update(state) {
    if (!inited || !state) return;
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    var dt = lastNow ? Math.min(0.1, Math.max(0, (now - lastNow) / 1000)) : 0.016;
    lastNow = now;

    /* immediate: selection + name label */
    var hotbar = state.hotbar || DEFAULT_HOTBAR;
    var hbKey = hotbar.join(',');
    if (hbKey !== lastHotbarKey) {
      lastHotbarKey = hbKey;
      paintHotbarIcons(hotbar);
      lastSelected = -1; /* force re-select + name refresh */
    }
    var sel = state.selected || 0;
    if (sel !== lastSelected) {
      selectSlot(sel);
      showName(hotbar[sel]);
    }

    /* flying hint + underwater overlay: toggle on change */
    var flying = !!state.flying;
    if (flying !== lastFlying) {
      lastFlying = flying;
      flyingHint.style.display = flying ? 'block' : 'none';
    }
    var uw = !!state.headUnderwater;
    if (uw !== lastUnderwater) {
      lastUnderwater = uw;
      uwOverlay.style.display = uw ? 'block' : 'none';
    }
    if (lockHint) lockHint.style.display = state.fallbackLook ? 'block' : 'none';
    updateBubbles(dt, uw);

    /* throttled (100 ms): hearts + debug */
    if (now - lastSlowUpdate >= 100) {
      lastSlowUpdate = now;
      updateHearts(state.health === undefined ? 20 : state.health);
      if (debugVisible && !currentScreen) updateDebug(state);
    }
  }

  /* ------------------------------------------------------------------ */
  function init() {
    if (inited) return;
    hud = document.getElementById('hud');
    debugEl = document.getElementById('debug');
    screens = {
      start: document.getElementById('start-screen'),
      pause: document.getElementById('pause-screen'),
      death: document.getElementById('death-screen')
    };
    if (!hud || !debugEl || !screens.start || !screens.pause || !screens.death) return;

    buildHUD();
    buildScreens();
    inited = true;
    showScreen('start');
  }

  return {
    init: init,
    update: update,
    showScreen: showScreen,
    toggleDebug: toggleDebug,
    damageFlash: damageFlash
  };
})();
