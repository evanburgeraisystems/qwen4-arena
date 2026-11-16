/* ============================================================
   TERRA — cities.js (orchestrator, lead-owned)
   Anchors the three procedural districts onto the globe and
   drives visibility / night uniforms. Builders live in
   city-nyc.js / city-tokyo.js / city-paris.js, toolkit in
   citykit.js. See CONTRACT-CITIES.md.
   ============================================================ */
(function () {
  'use strict';
  var T = window.TERRA;
  var C = T.C, U = T.util;

  var entries = [];
  var anchors = {};
  var tmpV = new THREE.Vector3();
  var tmpQ = new THREE.Quaternion();
  var tmpN = new THREE.Vector3();
  var UP = new THREE.Vector3(0, 1, 0);

  T.cities = {
    anchors: anchors,

    init: function (globeGroup, tex) {
      ['nyc', 'tokyo', 'paris'].forEach(function (id) {
        var c = T.data.byId[id];
        var hero = T.data.heroes[id];
        var normal = U.latLonToVec3(c.lat, c.lon, 1);
        var anchor = new THREE.Group();
        anchor.name = 'city-' + id;
        anchor.position.copy(U.latLonToVec3(c.lat, c.lon, C.R));
        anchor.quaternion.setFromUnitVectors(UP, normal);
        anchor.scale.setScalar(1 / C.MPU);
        anchor.visible = false;
        globeGroup.add(anchor);

        var builder = T.cityBuilders && T.cityBuilders[id];
        var built = { uniforms: [], update: null };
        if (builder) {
          try { built = builder(anchor, T.citykit, hero, tex) || built; }
          catch (e) { console.error('[cities:' + id + ']', e); }
        } else {
          console.warn('[cities] no builder for', id);
        }
        anchors[id] = anchor;
        entries.push({ id: id, anchor: anchor, normal: normal, built: built, globeGroup: globeGroup });
      });
      return T.cities;
    },

    getCity: function (id) { return anchors[id] || null; },

    // worldRoot-local surface point of a city (for camera targeting)
    surfacePoint: function (id, out) {
      var c = T.data.byId[id];
      return U.latLonToVec3(c.lat, c.lon, C.R, out);
    },

    update: function (dt, ctx) {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        e.anchor.getWorldPosition(tmpV);
        var d = tmpV.distanceTo(ctx.cameraPos);
        var vis = d < C.CITY_VISIBLE_DIST;
        e.anchor.visible = vis;
        if (!vis) continue;

        // world-space normal (globe may be spinning)
        e.globeGroup.getWorldQuaternion(tmpQ);
        tmpN.copy(e.normal).applyQuaternion(tmpQ);
        var night = U.smoothstep(0.06, -0.14, tmpN.dot(ctx.sunDir));

        var unis = e.built.uniforms || [];
        for (var j = 0; j < unis.length; j++) {
          if (unis[j].uNight) unis[j].uNight.value = night;
        }
        if (e.built.update) e.built.update(dt, ctx.time);
      }
    }
  };
})();