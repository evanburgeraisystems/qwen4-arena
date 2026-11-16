/* game.js — orchestrator: state machine, day/night, streaming order, pointer lock, boot. */
window.Game = (function () {
  'use strict';

  const DAY_LENGTH = 480;           // seconds per full day
  const RENDER_DIST = 6;            // chunks
  const VIEW_DIST = RENDER_DIST * 16;

  let state = 'menu';               // menu | playing | paused | dead
  let time = 0.35;                  // 0=midnight .25=sunrise .5=noon .75=sunset
  let dayFactor = 1;
  let seed = (Math.random() * 2147483647) | 0;
  let spawnPoint = { x: 0.5, y: 70, z: 0.5 };
  let canvas, last = 0, fps = 60, fov = 70;
  let fastTime = false;             // N held = time x120
  let menuAngle = 0;
  let bobAmt = 0;
  let menuParity = 0;
  let bootDone = false;

  /* ---------- helpers ---------- */
  function hashSeed(str) {
    str = String(str).trim();
    if (str === '') return (Math.random() * 2147483647) | 0;
    if (/^-?\d+$/.test(str)) return parseInt(str, 10) | 0;
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h | 0;
  }

  function computeDayFactor() {
    const a = (time - 0.25) * Math.PI * 2;
    dayFactor = Util.clamp((Math.sin(a) + 0.15) / 0.45, 0, 1);
  }

  function pregenerate(cx, cz, r) {
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++)
        World.generateChunk(cx + dx, cz + dz);
  }

  function findSpawn() {
    // spiral search for a dry, walkable column near origin
    for (let r = 0; r < 44; r += 2) {
      for (let a = 0; a < Math.max(1, r * 4); a++) {
        const ang = (a / Math.max(1, r * 4)) * Math.PI * 2;
        const x = Math.round(Math.cos(ang) * r), z = Math.round(Math.sin(ang) * r);
        const y = World.surfaceY(x, z);
        const id = World.get(x, y, z);
        if (y > World.SEA_LEVEL && (id === 1 || id === 8 || id === 15) &&
            World.get(x, y + 1, z) === 0 && World.get(x, y + 2, z) === 0 &&
            World.get(x, y + 3, z) === 0 && World.get(x, y + 4, z) === 0) {
          // avoid spawning under overhanging canopies
          let clear = true;
          for (let dx = -1; dx <= 1 && clear; dx++)
            for (let dz = -1; dz <= 1 && clear; dz++)
              for (let dy = 1; dy <= 3 && clear; dy++) {
                const nid = World.get(x + dx, y + dy, z + dz);
                if (nid === 6 || nid === 7) clear = false;
              }
          if (clear) return { x: x + 0.5, y: y + 1.05, z: z + 0.5 };
        }
      }
    }
    const y = WorldGen.getHeight(0, 0);
    return { x: 0.5, y: Math.max(y, World.SEA_LEVEL) + 2.05, z: 0.5 };
  }

  function lockPointer() {
    const fail = () => { if (window.Player) Player.fallbackLook = true; };
    try {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {
        fail();
        setTimeout(() => { try { const p2 = canvas.requestPointerLock(); if (p2 && p2.catch) p2.catch(fail); } catch (e) { fail(); } }, 1300);
      });
    } catch (e) { fail(); }
    /* embedded panes may silently never engage the lock */
    setTimeout(() => { if (state === 'playing' && !document.pointerLockElement) fail(); }, 900);
  }

  /* ---------- public state transitions ---------- */
  function start(seedStr) {
    Audio.init();
    const newSeed = hashSeed(seedStr === undefined ? '' : seedStr);
    seed = newSeed;
    World.init(seed);
    Mobs.clear();
    const btn = document.getElementById('play-btn');
    if (btn) btn.textContent = 'Generating world…';
    setTimeout(() => {
      pregenerate(0, 0, 4);
      spawnPoint = findSpawn();
      Player.spawn(spawnPoint.x, spawnPoint.y, spawnPoint.z);
      Player.yaw = Math.PI * 0.25; Player.pitch = -0.05;
      time = 0.30; computeDayFactor();
      state = 'playing';
      UI.showScreen(null);
      if (btn) btn.textContent = 'Play';
      lockPointer();
    }, 30);
  }

  function resume() {
    Audio.init();
    if (state !== 'paused') return;
    state = 'playing';
    UI.showScreen(null);
    lockPointer();
  }

  function respawn() {
    Audio.init();
    Player.respawn();
    state = 'playing';
    UI.showScreen(null);
    lockPointer();
  }

  function newWorld() {
    Audio.init();
    start(String((Math.random() * 2147483647) | 0));
  }

  function onPlayerDeath() {
    state = 'dead';
    Audio.play('death');
    UI.showScreen('death');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /* ---------- per-frame ---------- */
  function frame(now) {
    requestAnimationFrame(frame);
    if (!bootDone) return;
    const dt = Util.clamp((now - last) / 1000, 0.0001, 0.05);
    last = now;
    if (state === 'menu') { menuParity = 1 - menuParity; if (menuParity) return; } // menu panorama at 30fps
    fps = Util.lerp(fps, 1 / dt, 0.05);
    Renderer.stats.fps = fps;

    if (state === 'playing') {
      time = (time + dt / DAY_LENGTH * (fastTime ? 120 : 1)) % 1;
      computeDayFactor();
      World.stream(Player.x, Player.z);
      Renderer.updateMeshes(Player.x, Player.z, 3);
      Player.update(dt);
      Mobs.update(dt);
    } else if (state === 'menu') {
      time = (time + dt / DAY_LENGTH) % 1;
      computeDayFactor();
      menuAngle += dt * 0.045;
      World.stream(spawnPoint.x, spawnPoint.z);
      Renderer.updateMeshes(spawnPoint.x, spawnPoint.z, 3);
    }

    const playing = state === 'playing';
    Audio.update(dt, {
      dayFactor, headUnderwater: playing && Player.headUnderwater,
      y: playing ? Player.y : spawnPoint.y, playing
    });

    // camera
    let camX, camY, camZ, yaw, pitch;
    if (state === 'menu') {
      const r = 16;
      camX = spawnPoint.x + Math.sin(menuAngle) * r;
      camZ = spawnPoint.z + Math.cos(menuAngle) * r;
      camY = spawnPoint.y + 9;
      yaw = menuAngle; pitch = -0.12;
    } else {
      camX = Player.x; camY = Player.y + 1.62; camZ = Player.z;
      yaw = Player.yaw; pitch = Player.pitch;
      if (state === 'dead') { pitch = Util.lerp(pitch, 0.5, 0.02); camY = Player.y + 0.4; }
    }

    // view bob (walk cadence) + held-block swing state
    var bobX = 0, bobY = 0;
    if (playing && Player.onGround && !Player.flying && !Player.inWater) {
      var hsp = Math.hypot(Player.vx, Player.vz);
      bobAmt = Util.lerp(bobAmt, Math.min(1, hsp / 4.3), Math.min(1, dt * 8));
    } else {
      bobAmt = Util.lerp(bobAmt, 0, Math.min(1, dt * 8));
    }
    if (bobAmt > 0.001) {
      var ph = Player.walkPhase * Math.PI;
      bobY = -Math.abs(Math.sin(ph)) * 0.05 * bobAmt;
      bobX = Math.sin(ph) * 0.035 * bobAmt;
      var rv = Util.right(Player.yaw);
      camX += rv[0] * bobX; camZ += rv[2] * bobX; camY += bobY;
    }

    // fov kick
    const targetFov = playing && Player.sprinting ? 78 : (playing && Player.flying ? 74 : 70);
    fov = Util.lerp(fov, targetFov, Math.min(1, dt * 9));

    // hide cursor in fallback look mode (real pointer lock hides it natively)
    const wantCursor = (playing && Player.fallbackLook && !document.pointerLockElement) ? 'none' : '';
    if (canvas.style.cursor !== wantCursor) canvas.style.cursor = wantCursor;

    Renderer.render({
      camX, camY, camZ, yaw, pitch, fov,
      time, dayFactor,
      underwater: playing && Player.headUnderwater,
      flying: Player.flying, sprinting: Player.sprinting,
      showViewmodel: playing,
      selectedBlock: Player.hotbar[Player.selected],
      swing: Player.swing, bobX: bobX, bobY: bobY,
      mobs: state === 'menu' ? [] : Mobs.list
    });

    UI.update({
      health: Player.health, fps,
      px: camX, py: camY, pz: camZ,
      time, dayFactor, seed,
      selected: Player.selected, hotbar: Player.hotbar,
      headUnderwater: playing && Player.headUnderwater,
      flying: Player.flying,
      fallbackLook: playing && Player.fallbackLook && !document.pointerLockElement,
      chunks: Renderer.stats.chunks, tris: Renderer.stats.tris,
      mobs: Mobs.list.length,
      biome: WorldGen.biomeAt(Math.floor(camX), Math.floor(camZ))
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    canvas = document.getElementById('game');
    UI.init();
    Renderer.init(canvas);
    Renderer.resize();
    Player.init(canvas);
    Mobs.init();
    Audio.init === undefined && console.warn('Audio missing');

    window.addEventListener('resize', () => Renderer.resize());

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === canvas) {
        if (state === 'paused') { state = 'playing'; UI.showScreen(null); }
      } else if (state === 'playing') {
        state = 'paused';
        UI.showScreen('pause');
      }
    });

    canvas.addEventListener('click', () => {
      if (state === 'paused') resume();
      else if (state === 'playing' && !document.pointerLockElement) lockPointer();
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') { e.preventDefault(); UI.toggleDebug(); }
      if (e.code === 'KeyM') { Audio.setMuted(!Audio.muted); }
      if (e.code === 'KeyN') fastTime = true;
      if (e.code === 'Escape' && state === 'playing' && !document.pointerLockElement) {
        state = 'paused'; UI.showScreen('pause');
      }
    });
    window.addEventListener('keyup', (e) => { if (e.code === 'KeyN') fastTime = false; });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state === 'playing') {
        state = 'paused'; UI.showScreen('pause');
        if (document.pointerLockElement) document.exitPointerLock();
      }
    });

    // menu panorama world
    World.init(seed);
    pregenerate(0, 0, 3);
    spawnPoint = findSpawn();
    computeDayFactor();

    UI.showScreen('start');
    bootDone = true;
    last = performance.now();
    requestAnimationFrame(frame);

    // headless/verification hook: ?autostart=1&seed=42&slot=9
    const qs = new URLSearchParams(location.search);
    if (qs.has('autostart')) {
      setTimeout(() => {
        start(qs.get('seed') || '42');
        setTimeout(() => {
          if (qs.get('slot')) Player.selected = Util.clamp(parseInt(qs.get('slot'), 10) || 0, 0, 9);
          if (qs.get('pitch')) Player.pitch = parseFloat(qs.get('pitch')) || 0;
          if (qs.get('yaw')) Player.yaw = parseFloat(qs.get('yaw')) || 0;
        }, 600);
      }, 60);
    }
  }

  /* test/demo hooks (also handy for demos) */
  function setTime(t) { time = ((t % 1) + 1) % 1; computeDayFactor(); }
  function teleport(x, y, z) { Player.spawn(x, y, z); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  return {
    get state() { return state; },
    get time() { return time; },
    get dayFactor() { return dayFactor; },
    get seed() { return seed; },
    get spawnPoint() { return spawnPoint; },
    start, resume, respawn, newWorld, onPlayerDeath,
    setTime, teleport,
    _frame: frame,   // test hook: step one frame with a synthetic timestamp
    DAY_LENGTH, VIEW_DIST
  };
})();
