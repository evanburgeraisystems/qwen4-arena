/* ============================================================
   TERRA — camera.js  (SYSTEM C)
   Custom damped orbit controls + cinematic flights + floating
   origin. Plain IIFE on window.TERRA, THREE r128, no modules.
   State model: target T (worldRoot-local) + spherical
   (dist, azimuth, elevation) around T. Camera local pos =
   T + dir(az,el)*dist ; rendered pos = local - O (origin).
   ============================================================ */
(function () {
  'use strict';
  var T = window.TERRA;
  var C = T.C, U = T.util;
  var R = C.R, MPU = C.MPU, DEG = C.DEG, RAD = C.RAD;

  var MIN_ALT_U = C.m2u(2);        // 2 m — never go under ground
  var MAX_DIST = 600;              // world units
  var ORIGIN_ON = C.ORIGIN_SWITCH_DIST;      // 5
  var ORIGIN_OFF = C.ORIGIN_SWITCH_DIST + 0.5; // hysteresis (no flicker)
  var SURFACE_RAY_DIST = 2.2 * R;  // acquire surface target below this
  var CENTER_EASE_DIST = 2.5 * R;  // ease T back to center beyond this
  var FOCUS_SNAP_DIST = C.m2u(4000);
  var FOCUS_RADIUS = C.m2u(5000);
  var FOCUS_RELEASE_DIST = C.m2u(300000);
  var ROT_SPEED = 0.0042;          // rad / px (scaled by distance)
  var WHEEL_K = 0.0012;

  // ---- reusable temporaries (no per-frame allocations) ----
  var _Y = new THREE.Vector3(0, 1, 0);
  var _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(),
      _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(),
      _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
  var _up = new THREE.Vector3(), _normal = new THREE.Vector3(),
      _offset = new THREE.Vector3(), _camLocal = new THREE.Vector3(),
      _look = new THREE.Vector3(), _hitLocal = new THREE.Vector3(),
      _cityLocal = new THREE.Vector3(), _sunTmp = new THREE.Vector3();
  var _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(),
      _qInv = new THREE.Quaternion();
  var _ray = new THREE.Raycaster();
  var _ndc = new THREE.Vector2(0, 0);
  var _hits = [];

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // smallest safe dist for a target at radius tLen (keeps camera outside globe)
  function minDistFor(tLen) { return Math.max(MIN_ALT_U, R + MIN_ALT_U - tLen); }

  T.camera = {
    init: function (opts) {
      var canvas = opts.canvas;
      var worldRoot = opts.worldRoot;
      var globe = opts.globe;
      var cities = opts.cities;
      var renderer = opts.renderer;

      var aspect = (canvas.clientWidth || 1) / (canvas.clientHeight || 1);
      var camera = new THREE.PerspectiveCamera(50, aspect, 2, 9000);

      // ---- core state ----
      var target = new THREE.Vector3(0, 0, 0);   // T (worldRoot-local)
      var dist = 300, targetDist = 300;
      var az = 0, el = 18 * DEG;
      var velAz = 0, velEl = 0;
      var driftRate = 0;
      var enabled = true;
      var originActive = false;
      var surfaceFactor = 0;
      var focusCity = null;
      var lastNear = -1, lastFar = -1;
      var surfaceAcquired = false;   // T has settled onto the globe surface

      // ---- flight state ----
      var flight = {
        active: false, mode: 'fly', t: 0, duration: 1,
        S: new THREE.Vector3(), E: new THREE.Vector3(),
        startT: new THREE.Vector3(), startCam: new THREE.Vector3(),
        arc: 0, h0: 0, h1: 0, cruise: 0,
        startAz: 0, startEl: 0, endEl: 0, startDist: 300,
        fromSpace: false, arrive: 'orbit', drift: 0,
        sunActive: false, sunStart: new THREE.Vector3(), sunTarget: new THREE.Vector3(),
        city: null, resolve: null
      };

      // ---- pointer / touch state ----
      var pointers = new Map();
      var dragging = false, lastX = 0, lastY = 0, lastMoveT = 0;
      var pinchStart = 0, pinchTargetDist = 300;

      canvas.style.touchAction = 'none';

      /* =========================================================
         helpers
         ========================================================= */
      function currentAltitudeM() {
        return Math.max(0, (_camLocal.length() - R) * MPU);
      }
      // geographic lat/lon <-> worldRoot-local surface point, accounting for
      // globe.group spin (same convention as globe.sunForLocalTime)
      function geoToLocal(lat, lon, out) {
        U.latLonToVec3(lat, lon, R, out);
        if (globe && globe.group) out.applyQuaternion(globe.group.quaternion);
        return out;
      }
      function localToGeo(v, out) {
        out.copy(v);
        if (globe && globe.group) {
          _qInv.copy(globe.group.quaternion).invert();
          out.applyQuaternion(_qInv);
        }
        return U.vec3ToLatLon(out);
      }
      function surfacePointOf(v, out) {
        // normalize any vector to the globe surface (radius R)
        var l = v.length();
        if (l < 1e-6) return out.set(0, 0, 0);
        return out.copy(v).multiplyScalar(R / l);
      }
      function detailCityNear(localPoint, radius) {
        if (!cities || !cities.anchors) return null;
        var ids = ['nyc', 'tokyo', 'paris'];
        for (var i = 0; i < ids.length; i++) {
          var a = cities.anchors[ids[i]];
          if (!a) continue;
          a.getWorldPosition(_cityLocal).sub(worldRoot.position);
          if (_cityLocal.distanceTo(localPoint) < radius) {
            return { id: ids[i], city: T.data.byId[ids[i]], point: _cityLocal };
          }
        }
        return null;
      }
      function setFocus(cityObj) {
        if (focusCity === cityObj) return;
        focusCity = cityObj;
        T.state.focusCity = cityObj;
        T.bus.emit('focus', { city: cityObj });
      }
      function computePhase() {
        if (flight.active) return 'flying';
        if (T.state.tourActive) return 'tour';
        var alt = currentAltitudeM();
        if (focusCity) return 'street';
        if (target.length() < 1 && dist > CENTER_EASE_DIST) return 'space';
        if (alt < 1500) return 'street';
        return 'orbit';
      }

      /* =========================================================
         camera placement (shared by controls + flights)
         ========================================================= */
      function placeCamera(bank) {
        var tLen = target.length();

        // up blend: +Y in space -> surface normal near ground
        var fDist = U.smoothstep(30, 12, dist);          // 0 far, 1 near
        var fT = clamp(tLen / 20, 0, 1);                 // 0 at center, 1 on surface
        surfaceFactor = fDist * fT;
        if (tLen > 1e-6) _normal.copy(target).multiplyScalar(1 / tLen);
        else _normal.copy(_Y);
        _up.copy(_Y).lerp(_normal, surfaceFactor).normalize();

        // elevation clamp ranges blend with surfaceFactor
        var elMin = lerp(-80, 3, surfaceFactor) * DEG;
        var elMax = lerp(80, 89, surfaceFactor) * DEG;
        el = clamp(el, elMin, elMax);

        // spherical offset in a frame where +Y maps to _up
        var ce = Math.cos(el), se = Math.sin(el);
        _offset.set(ce * Math.sin(az), se, ce * Math.cos(az));
        _q1.setFromUnitVectors(_Y, _up);
        _offset.applyQuaternion(_q1).multiplyScalar(dist);

        _camLocal.copy(target).add(_offset);

        // hard safety: never let the camera enter the globe
        var camR = _camLocal.length();
        var floor = R + MIN_ALT_U;
        if (camR < floor) {
          if (camR < 1e-6) _camLocal.copy(_up).multiplyScalar(floor);
          else _camLocal.multiplyScalar(floor / camR);
          if (!flight.active) {
            dist = _camLocal.distanceTo(target);
            targetDist = Math.max(targetDist, dist);
          }
        }

        // floating origin (both world + camera shift together -> no pop)
        if (!originActive && dist < ORIGIN_ON) originActive = true;
        else if (originActive && dist > ORIGIN_OFF) originActive = false;
        if (originActive) _v1.copy(target); else _v1.set(0, 0, 0); // O
        worldRoot.position.copy(_v1).negate();

        camera.position.copy(_camLocal).sub(_v1);
        camera.up.copy(_up);
        _look.copy(_lookTarget).sub(_v1);
        camera.lookAt(_look);
        if (bank) camera.rotateZ(bank);
        camera.updateMatrixWorld();

        // near / far
        var near = clamp(dist * 0.02, 0.00003, 2);
        var far = 9000;
        if (near !== lastNear || far !== lastFar) {
          camera.near = near; camera.far = far;
          camera.updateProjectionMatrix();
          lastNear = near; lastFar = far;
        }
      }
      var _lookTarget = new THREE.Vector3(); // where the camera looks (T or look-ahead)

      /* =========================================================
         altitude profile (rise 28% / cruise / descend 38%)
         ========================================================= */
      function altitudeAt(t) {
        if (t < 0.28) return lerp(flight.h0, flight.cruise, U.easeOutCubic(t / 0.28));
        if (t < 0.62) return flight.cruise;
        return lerp(flight.cruise, flight.h1, U.easeInOutCubic((t - 0.62) / 0.38));
      }

      /* =========================================================
         flights
         ========================================================= */
      function beginFlight(mode, lat, lon, o) {
        o = o || {};
        // cancel any in-progress flight (resolve early)
        if (flight.active) finishFlight(true);

        flight.mode = mode;
        flight.t = 0;
        flight.startT.copy(target);
        flight.startCam.copy(_camLocal);
        flight.startDist = dist;
        flight.startAz = az;
        flight.startEl = el;
        flight.fromSpace = target.length() < 0.9 * R;
        flight.drift = o.drift || 0;
        flight.arrive = o.arrive || 'orbit';

        // start surface point S (target direction if partially acquired,
        // otherwise the camera sub-point)
        if (target.length() > 1) surfacePointOf(target, flight.S);
        else surfacePointOf(_camLocal, flight.S);

        // end point E (geographic -> current spun frame)
        if (mode === 'exit') {
          flight.E.copy(flight.S);
        } else {
          geoToLocal(lat, lon, flight.E);
        }
        flight.arc = U.surfaceAngle(flight.S, flight.E);

        // altitudes
        flight.h0 = Math.max(2, (flight.startCam.length() - R) * MPU);
        if (mode === 'exit') {
          flight.h1 = (300 - R) * MPU;
        } else {
          flight.h1 = (o.altitudeM != null ? o.altitudeM : 25000);
        }
        flight.cruise = Math.max(flight.h0, flight.h1, flight.arc * R * MPU * 0.30 + 150000);

        // duration
        if (mode === 'fly') {
          var base = 3.2 + flight.arc * 4.5 +
            Math.log10(Math.max(1, Math.max(flight.h0, flight.h1) / 1000)) * 0.8;
          flight.duration = o.duration || clamp(base, 4, 13);
        } else if (mode === 'zoom') {
          var bz = 2.5 + Math.log10(Math.max(1, Math.max(flight.h0, flight.h1) / 1000)) * 0.5;
          flight.duration = o.duration || clamp(bz, 2.5, 5);
        } else { // exit
          flight.duration = o.duration || clamp(3 + flight.arc * 2, 3, 5);
        }

        // elevation target
        if (mode === 'exit') flight.endEl = 18 * DEG;
        else if (o.elevationDeg != null) flight.endEl = o.elevationDeg * DEG;
        else flight.endEl = el;
        flight.endAz = (mode !== 'exit' && o.azimuthDeg != null) ? o.azimuthDeg * DEG : az;

        // sun (compute target ONCE; spin is disabled during flight)
        flight.sunActive = false;
        if (mode !== 'exit' && o.sunHours != null && globe && typeof globe.sunForLocalTime === 'function') {
          flight.sunStart.copy(T.state.sunDir).normalize();
          var sd = globe.sunForLocalTime(lat, lon, o.sunHours, flight.sunTarget);
          if (sd && sd.isVector3) flight.sunTarget.copy(sd);
          if (flight.sunTarget.lengthSq() > 1e-8) {
            flight.sunTarget.normalize();
            _q1.setFromUnitVectors(flight.sunStart, flight.sunTarget);
            flight.sunQuat = flight.sunQuat || new THREE.Quaternion();
            flight.sunQuat.copy(_q1);
            flight.sunActive = true;
          }
        }

        // destination detail city (for events / focus)
        flight.city = null;
        if (mode !== 'exit') {
          var near = detailCityNear(flight.E, FOCUS_RADIUS);
          if (near) flight.city = near.city;
        }

        enabled = false;
        velAz = velEl = 0;
        dragging = false;
        pointers.clear();
        T.state.phase = 'flying';
        flight.active = true;

        if (mode !== 'exit') {
          var fromLL = localToGeo(flight.S, _v4);
          T.bus.emit('flightstart', {
            from: { lat: fromLL.lat, lon: fromLL.lon },
            to: { lat: lat, lon: lon },
            city: flight.city
          });
        }

        return new Promise(function (resolve) { flight.resolve = resolve; });
      }

      function advanceFlight(dt) {
        flight.t += dt / flight.duration;
        var t = clamp(flight.t, 0, 1);
        var mode = flight.mode;
        var bank = 0;
        _lookTarget.copy(target);

        if (mode === 'exit') {
          var e = U.easeInOutCubic(t);
          target.copy(flight.startT).multiplyScalar(1 - e); // current T -> center
          dist = lerp(flight.startDist, 300, e);
          az = flight.startAz;
          el = lerp(flight.startEl, flight.endEl, e);
          _lookTarget.copy(target);
        } else if (mode === 'zoom') {
          // monotonic vertical zoom at current target (keeps az/el)
          var ez = U.easeInOutCubic(t);
          var hz = lerp(flight.h0, flight.h1, ez);
          // bridge from the exact current state (no first-frame pop)
          var bz = U.smoothstep(0, 0.2, t);
          target.copy(flight.startT).lerp(flight.S, bz);
          dist = lerp(flight.startDist, hz / MPU, bz);
          az = flight.startAz;
          el = flight.startEl;
          _lookTarget.copy(target);
        } else {
          // cinematic fly: horizontal slerp + rise/cruise/descend
          var ht = U.easeInOutQuart(t);
          U.slerpSurface(flight.S, flight.E, ht, _v2);   // P(t) on surface
          var hDist = altitudeAt(t) / MPU;
          // first 15%: bridge T/dist from the exact current state onto the
          // surface path (handles start-from-space without any pop or clip)
          var blend = U.smoothstep(0, 0.15, t);
          target.copy(flight.startT).lerp(_v2, blend);
          dist = lerp(flight.startDist, hDist, blend);
          az = lerp(flight.startAz, flight.endAz, U.easeInOutCubic(t));
          el = lerp(flight.startEl, flight.endEl, U.easeInOutCubic(t));

          // look-ahead during cruise for leading framing
          if (flight.arc > 0.01 && t > 0.28 && t < 0.62) {
            var la = U.easeInOutQuart(Math.min(1, t + 0.04));
            U.slerpSurface(flight.S, flight.E, la, _v3);
            if (flight.fromSpace) _v3.multiplyScalar(U.smoothstep(0, 0.15, t));
            _lookTarget.copy(_v3);
          } else {
            _lookTarget.copy(target);
          }
          // subtle bank roll
          if (flight.arc > 0.01) bank = Math.sin(t * Math.PI) * 2.5 * DEG;
        }

        // enforce safe distance for current target radius
        var md = minDistFor(target.length());
        if (dist < md) dist = md;

        // sun slerp
        if (flight.sunActive) {
          _q2.identity().slerp(flight.sunQuat, t);
          _sunTmp.copy(flight.sunStart).applyQuaternion(_q2).normalize();
          if (globe && typeof globe.setSunDirection === 'function') globe.setSunDirection(_sunTmp);
        }

        placeCamera(bank);

        if (flight.t >= 1) finishFlight(false);
      }

      function finishFlight(cancelled) {
        var mode = flight.mode;
        var resolve = flight.resolve;
        flight.active = false;
        flight.resolve = null;
        enabled = true;
        velAz = velEl = 0;
        targetDist = dist;

        if (!cancelled) {
          if (mode === 'exit') {
            target.set(0, 0, 0);
            dist = 300; targetDist = 300;
            el = 18 * DEG;
            surfaceAcquired = false;
            setFocus(null);
            driftRate = 0;
            T.state.phase = 'space';
          } else {
            if (mode === 'fly') target.copy(flight.E);
            else target.copy(flight.S);
            dist = flight.h1 / MPU;
            targetDist = dist;
            el = flight.endEl;
            az = flight.endAz;
            surfaceAcquired = true;
            // focus if a detail city is within 5 km of the arrival point
            var near = detailCityNear(target, FOCUS_RADIUS);
            if (near) {
              target.copy(near.point);
              setFocus(near.city);
            }
            driftRate = flight.drift;
            T.state.phase = (mode === 'fly' && flight.arrive === 'street') ? 'street' : computePhase();
          }
        } else {
          driftRate = 0;
          surfaceAcquired = target.length() > R - 1e-4;
          T.state.phase = computePhase();
        }

        // settle camera at final state
        _lookTarget.copy(target);
        placeCamera(0);

        if (mode !== 'exit') T.bus.emit('flightend', { city: focusCity, cancelled: !!cancelled });
        if (resolve) resolve();
      }

      /* =========================================================
         controls-mode targeting (raycast / city focus / ease-back)
         ========================================================= */
      function updateTargeting(dt) {
        var tLen = target.length();

        // release focus when zoomed far out
        if (focusCity && dist > FOCUS_RELEASE_DIST) setFocus(null);

        // ease T back to earth center when far away
        if (dist > CENTER_EASE_DIST && tLen > 0.01) {
          var k = 1 - Math.exp(-3 * dt);
          target.multiplyScalar(1 - k);
          if (target.length() < 0.01) target.set(0, 0, 0);
        }
        if (target.length() < 1) surfaceAcquired = false;

        // acquire surface target: raycast screen center vs earth, damp T
        // toward the hit until it fully settles on the surface (radius R)
        if (!surfaceAcquired && dist < SURFACE_RAY_DIST && globe && globe.earthMesh) {
          globe.earthMesh.updateWorldMatrix(true, false);
          _ray.setFromCamera(_ndc, camera);
          _hits.length = 0;
          _ray.intersectObject(globe.earthMesh, false, _hits);
          if (_hits.length) {
            _hitLocal.copy(_hits[0].point).sub(worldRoot.position);
            var kk = 1 - Math.exp(-6 * dt);
            target.lerp(_hitLocal, kk);
          }
          // converge |T| to R so the min-altitude guard fully relaxes
          tLen = target.length();
          if (tLen > 1) {
            var nl = U.damp(tLen, R, 8, dt);
            target.multiplyScalar(nl / tLen);
          }
          if (target.length() > R - 1e-4) surfaceAcquired = true;
        }

        // snap focus to a detail city when very close
        if (dist < FOCUS_SNAP_DIST) {
          var near = detailCityNear(target, FOCUS_RADIUS);
          if (near) {
            var kf = 1 - Math.exp(-12 * dt);
            target.lerp(near.point, kf);
            setFocus(near.city);
          }
        }
      }

      /* =========================================================
         main update
         ========================================================= */
      function update(dt) {
        if (dt > 0.05) dt = 0.05;

        if (flight.active) {
          advanceFlight(dt);
        } else {
          // inertia + drift
          az += velAz * dt;
          el += velEl * dt;
          velAz = U.damp(velAz, 0, 3.5, dt);
          velEl = U.damp(velEl, 0, 3.5, dt);
          if (driftRate) az += driftRate * dt;

          // damped exponential zoom (raw intent clamped per-frame against the
          // dynamic min so zoom momentum survives surface acquisition)
          var md = minDistFor(target.length());
          var effTarget = clamp(targetDist, md, MAX_DIST);
          dist = U.damp(dist, effTarget, 4, dt);
          if (dist < md) dist = md;

          updateTargeting(dt);
          _lookTarget.copy(target);
          placeCamera(0);
        }

        // shared state writes
        T.state.altitudeM = currentAltitudeM();
        T.state.phase = computePhase();
      }

      /* =========================================================
         input handlers
         ========================================================= */
      function rotScale() { return ROT_SPEED * clamp(dist / R, 0.12, 1); }
      function canControl() { return enabled && !flight.active; }

      function onPointerDown(e) {
        if (!canControl()) return;
        canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 1) {
          dragging = true;
          lastX = e.clientX; lastY = e.clientY;
          lastMoveT = performance.now();
          velAz = velEl = 0;
        } else if (pointers.size === 2) {
          dragging = false;
          var pts = Array.from(pointers.values());
          pinchStart = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          pinchTargetDist = targetDist;
        }
      }
      function onPointerMove(e) {
        if (!pointers.has(e.pointerId)) return;
        var p = pointers.get(e.pointerId);
        p.x = e.clientX; p.y = e.clientY;
        if (!canControl()) return;

        if (pointers.size === 1 && dragging) {
          var now = performance.now();
          var dtm = Math.max(0.008, (now - lastMoveT) / 1000);
          var dx = e.clientX - lastX, dy = e.clientY - lastY;
          var rs = rotScale();
          az -= dx * rs;
          el += dy * rs;
          velAz = U.lerp(velAz, -dx * rs / dtm, 0.5);
          velEl = U.lerp(velEl, dy * rs / dtm, 0.5);
          lastX = e.clientX; lastY = e.clientY; lastMoveT = now;
        } else if (pointers.size === 2) {
          var pts = Array.from(pointers.values());
          var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          if (pinchStart > 0 && d > 0) {
            targetDist = clamp(pinchTargetDist * (pinchStart / d), MIN_ALT_U, MAX_DIST);
          }
        }
      }
      function onPointerUp(e) {
        if (pointers.has(e.pointerId)) {
          pointers.delete(e.pointerId);
          try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        }
        if (pointers.size < 2) pinchStart = 0;
        if (pointers.size === 0) dragging = false;
        else if (pointers.size === 1) {
          var pt = Array.from(pointers.values())[0];
          dragging = true; lastX = pt.x; lastY = pt.y; lastMoveT = performance.now();
          velAz = velEl = 0;
        }
      }
      function onWheel(e) {
        if (!canControl()) return;
        e.preventDefault();
        var dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        else if (e.deltaMode === 2) dy *= 100;
        targetDist = clamp(targetDist * Math.exp(dy * WHEEL_K), MIN_ALT_U, MAX_DIST);
      }

      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerUp);
      canvas.addEventListener('wheel', onWheel, { passive: false });

      function onResize() {
        var w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      window.addEventListener('resize', onResize);

      // initial placement
      _lookTarget.copy(target);
      placeCamera(0);

      /* =========================================================
         public API
         ========================================================= */
      var api = {
        camera: camera,
        update: update,
        flyTo: function (lat, lon, o) { return beginFlight('fly', lat, lon, o); },
        zoomTo: function (altitudeM, o) {
          o = o || {};
          var ll = api.getState();
          return beginFlight('zoom', ll.lat, ll.lon, {
            altitudeM: altitudeM,
            duration: o.duration,
            elevationDeg: (o.elevationDeg != null ? o.elevationDeg : el * RAD),
            arrive: altitudeM < 1500 ? 'street' : 'orbit',
            drift: o.drift || 0
          });
        },
        exitToSpace: function () { return beginFlight('exit', 0, 0, {}); },
        getState: function () {
          var ll;
          if (target.length() > 1) ll = localToGeo(target, _v4);
          else ll = localToGeo(_camLocal, _v4);
          return {
            lat: ll.lat, lon: ll.lon,
            altitudeM: currentAltitudeM(),
            dist: dist,
            azimuthDeg: az * RAD,
            elevationDeg: el * RAD,
            focusCityId: focusCity ? focusCity.id : null,
            flying: flight.active,
            phase: T.state.phase
          };
        },
        isFlying: function () { return flight.active; },
        cancelFlight: function () { if (flight.active) finishFlight(true); },
        setDrift: function (radPerSec) { driftRate = radPerSec || 0; },
        setEnabled: function (b) {
          enabled = !!b;
          if (!enabled) { dragging = false; pointers.clear(); velAz = velEl = 0; }
        }
      };
      return api;
    }
  };
})();
