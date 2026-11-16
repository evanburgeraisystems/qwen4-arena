/* ============================================================
   TERRA — main.js (lead-owned integration layer)
   Boot order, render loop, post-processing, fog/bloom schedules,
   floating-origin context plumbing, test hooks.
   ============================================================ */
(function () {
  'use strict';
  var T = window.TERRA;
  var C = T.C, U = T.util;

  function fatal(msg) {
    var el = document.getElementById('error');
    var m = document.getElementById('error-msg');
    if (el && m) { m.textContent = String(msg); el.classList.remove('hidden'); }
    var ld = document.getElementById('loading');
    if (ld) ld.style.display = 'none';
  }
  window.addEventListener('error', function (e) {
    fatal((e.message || 'error') + '\n' + (e.filename || '') + ':' + (e.lineno || ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    fatal('Promise rejection: ' + (e.reason && e.reason.stack || e.reason));
  });

  var canvas = document.getElementById('scene');
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas, antialias: true, alpha: false,
      logarithmicDepthBuffer: true, powerPreference: 'high-performance'
    });
  } catch (e) { fatal('WebGL is not available in this browser.\n' + e.message); return; }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 1);

  var scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0);
  var worldRoot = new THREE.Group();
  scene.add(worldRoot);

  /* ---------- post-processing ---------- */
  var composer = new THREE.EffectComposer(renderer);
  var renderPass = new THREE.RenderPass(scene, new THREE.PerspectiveCamera());
  composer.addPass(renderPass);
  var bloom = new THREE.UnrealBloomPass(
    new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2),
    0.55, 0.7, 0.82
  );
  composer.addPass(bloom);
  var gamma = new THREE.ShaderPass(THREE.GammaCorrectionShader);
  composer.addPass(gamma);

  window.addEventListener('resize', function () {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2);
    if (T.app && T.app.camera) {
      T.app.camera.camera.aspect = w / h;
      T.app.camera.camera.updateProjectionMatrix();
    }
  });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ---------- boot ---------- */
  var ui = T.ui.init();
  var globe, cities, cam;
  var tmpCenter = new THREE.Vector3();
  var black = new THREE.Color(0x000000);
  var fogCol = new THREE.Color();

  async function boot() {
    ui.setProgress(0.02, 'generating planet…');
    var tex = await T.textures.generate(function (f, label) {
      ui.setProgress(0.02 + f * 0.72, label);
    });

    // texture quality
    var maxAniso = renderer.capabilities.getMaxAnisotropy();
    ['day', 'night', 'clouds', 'spec', 'bump'].forEach(function (k) {
      if (tex[k]) { tex[k].anisotropy = Math.min(8, maxAniso); tex[k].needsUpdate = true; }
    });

    ui.setProgress(0.78, 'lighting the atmosphere…');
    globe = T.globe.init(scene, worldRoot, tex);
    // compat shim: camera.js passes an out-vector, ui.js uses the return value
    var _sflt = globe.sunForLocalTime;
    globe.sunForLocalTime = function (lat, lon, hours, out) {
      var v = _sflt.call(globe, lat, lon, hours);
      return out ? out.copy(v) : v;
    };
    // pleasing default: terminator across the visible disc
    globe.setSunDirection(new THREE.Vector3(0.9, 0.22, 0.3).normalize());

    ui.setProgress(0.84, 'building cities…');
    await new Promise(function (r) { setTimeout(r, 0); });
    cities = T.cities.init(globe.group, tex);

    ui.setProgress(0.92, 'calibrating camera…');
    cam = T.camera.init({ canvas: canvas, worldRoot: worldRoot, globe: globe, cities: cities, renderer: renderer });
    renderPass.camera = cam.camera;

    ui.bind({ camera: cam, globe: globe, cities: cities });

    T.app = {
      camera: cam, globe: globe, cities: cities, ui: ui,
      renderer: renderer, scene: scene, composer: composer,
      flyToCity: function (id) {
        var c = T.data.byId[id];
        if (!c) return Promise.reject(new Error('unknown city ' + id));
        var hero = T.data.heroes[id];
        var opts = c.detail && hero
          ? Object.assign({ arrive: 'street' }, hero.arrival)
          : { altitudeM: 180000, elevationDeg: 30 };
        return cam.flyTo(c.lat, c.lon, opts);
      },
      tour: function () { document.getElementById('btn-tour').click(); },
      zoomTo: function (m) { return cam.zoomTo(m); },
      // dev/test hook: advance one frame manually (rAF is paused in hidden tabs)
      step: function (dt, n) {
        n = n || 1;
        for (var i = 0; i < n; i++) frame(dt || 1 / 60);
        return cam.getState();
      },
      // dev/test hook: render one frame and POST it to the local test server
      capture: function (name) {
        composer.render();
        var c = canvas;
        var s = document.createElement('canvas');
        s.width = 960; s.height = Math.round(960 * c.height / Math.max(1, c.width));
        s.getContext('2d').drawImage(c, 0, 0, s.width, s.height);
        return new Promise(function (res, rej) {
          s.toBlob(function (blob) {
            fetch('http://localhost:8124/shot?name=' + encodeURIComponent(name || 'shot'), { method: 'POST', body: blob })
              .then(function (r) { return r.json(); }).then(res, rej);
          }, 'image/jpeg', 0.82);
        });
      }
    };

    ui.setProgress(1, 'ready');
    ui.ready();
    // test hook: ?night aims the sun away from the camera (dark disc, aurora, city lights)
    if (/[?&]night(?=[&=]|$)/.test(window.location.search)) {
      globe.setSunDirection(tmpCenter.copy(cam.camera.position).sub(worldRoot.position).negate().normalize());
    }
    T.state.phase = 'space';
    T.bus.emit('ready', {});
    loop();
  }

  /* ---------- render loop ---------- */
  var clock = new THREE.Clock();
  function frame(dt) {
    T.state.time += dt;

    cam.update(dt);
    var st = cam.getState();

    tmpCenter.copy(worldRoot.position); // earth center in world space (floating origin)
    var alt = st.altitudeM;

    // fog schedule: clear in space, thick at street level
    var fogDensity = 0;
    if (alt < 60000) {
      var k = 1 - U.clamp((alt - 2000) / 58000, 0, 1);
      fogDensity = 26 * k * k;
    }
    fogCol.copy(globe.getHorizonColor());
    fogCol.lerp(black, U.smoothstep(15000, 60000, alt));
    scene.fog.color.copy(fogCol);
    scene.fog.density = fogDensity;

    var ctx = {
      cameraPos: cam.camera.position,
      earthCenter: tmpCenter,
      altitudeM: alt,
      dist: st.dist,
      phase: T.state.phase,
      focusCity: T.state.focusCity,
      allowSpin: T.state.spinEnabled && !st.flying && !T.state.focusCity && st.dist > 2.2 * C.R,
      fogColor: fogCol,
      fogDensity: fogDensity,
      time: T.state.time,
      sunDir: T.state.sunDir
    };

    globe.update(dt, ctx);
    if (globe.updateSats) globe.updateSats(dt, ctx); // live satellites (guarded hook)
    cities.update(dt, ctx);

    // bloom schedule: gentle in space, punchy at street level on the night side
    var low = 1 - U.clamp(alt / 4000, 0, 1);
    var night = globe.getNightFactor(st.lat, st.lon);
    bloom.strength = 0.45 + 0.3 * low * (0.35 + 0.65 * night);

    composer.render();
    T.bus.emit('tick', dt);
  }
  function loop() {
    requestAnimationFrame(loop);
    frame(Math.min(clock.getDelta(), 0.05));
  }

  boot().catch(function (e) { fatal(e && e.stack || e); });
})();