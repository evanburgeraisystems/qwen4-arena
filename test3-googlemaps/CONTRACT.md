# TERRA — system contract (READ FULLY BEFORE WRITING CODE)

Google-Earth-style procedural globe. One folder, opened from `index.html` over
`file://`. **Plain scripts only — NO ES modules, NO import/export, NO fetch, NO
external assets.** Every texture/model is generated in code. THREE is the r128
UMD global (`js/lib/three.min.js`). Post-processing globals available:
`THREE.EffectComposer`, `THREE.RenderPass`, `THREE.ShaderPass`,
`THREE.UnrealBloomPass`, `THREE.CopyShader`, `THREE.LuminosityHighPassShader`,
`THREE.GammaCorrectionShader`.

Shared foundation already written (READ THEM): `js/core.js` (namespace
`window.TERRA`, constants `TERRA.C`, utils `TERRA.util` — seeded rng, simplex
noise2/noise3, fbm2/fbm3, easing, damp, latLonToVec3/vec3ToLatLon/slerpSurface,
event bus `TERRA.bus`, shared `TERRA.state`), `js/data/cities.js`
(`TERRA.data.cities`, `TERRA.data.byId`, `TERRA.data.heroes`), `index.html`
(all DOM ids are fixed — do not change them).

## Scene graph & units (owned by main.js — do not restructure)

```
scene
 ├ worldRoot (Group)          // floating-origin offset applied by CAMERA system
 │   └ globe.group (Group)    // spins around Y; earth/clouds/atmosphere + city anchors
 └ globe.skyGroup (Group)     // stars, sky dome, sun sprite — re-centered on camera each frame
```

- Globe radius `R = 100` world units. `1 unit = 63710 m` (`TERRA.C.MPU`).
- Camera distance from surface ranges from ~2 m to ~38,000 km.
- **Floating origin:** when camera distance-to-target `< 5` units, camera system
  sets `worldRoot.position = -targetPoint`, so everything near the camera renders
  around the origin (float32 precision). Both world and camera shift together →
  no visual pop. Custom shaders therefore must NOT assume earth center at (0,0,0);
  `ctx.earthCenter` gives the current world-space earth center.
- Renderer: `logarithmicDepthBuffer: true`, `outputEncoding = sRGBEncoding`,
  ACESFilmic tone mapping OFF (NoToneMapping). Composer ends with a
  GammaCorrectionShader pass. **Consequences for EVERY custom ShaderMaterial:**
  1. Include `#include <logdepthbuf_pars_vertex>` in vertex shader and
     `#include <logdepthbuf_vertex>` right after `gl_Position = ...`.
  2. Include `#include <logdepthbuf_pars_fragment>` in fragment shader and
     `#include <logdepthbuf_fragment>` as the FIRST line of `main()`.
  3. End fragment `main()` with `#include <encodings_fragment>` (after setting
     `gl_FragColor`). Work in linear-ish space; the gamma pass converts at the end.
  4. Do NOT set `texture.encoding` (leave default). Paint canvas colors a bit
     brighter/more saturated than final intent if needed; tune by eye.
  5. Fog is MANUAL in custom shaders (see below). Built-in materials
     (MeshStandardMaterial etc.) get `scene.fog` (FogExp2) automatically — keep
     `fog: true` (default) on them.
- **Manual fog uniforms** (main.js updates them each frame on the earth material
  via `globe.update(ctx)`): `uFogColor` (vec3), `uFogDensity` (float, world-unit
  exp2 density; 0 in space, ~26 at street level). Vertex: `vFogDist = -mvPosition.z;`
  Fragment: `float ff = 1.0 - exp(-uFogDensity*uFogDensity*vFogDist*vFogDist);
  color = mix(color, uFogColor, clamp(ff,0.,1.));`
- Coordinate convention (core.js implements; textures MUST match):
  `u=(lon+180)/360`, canvas `x = u*W`; `v=(90-lat)/180`, canvas `y = v*H`.
  `latLonToVec3(0,0,R) = (R,0,0)`. For seamless textures sample noise on the
  unit sphere: `p = latLonToVec3(lat,lon,1)` then `fbm3(p.x*f, p.y*f, p.z*f, ...)`.

## Sun model

- `TERRA.state.sunDir` — world-space unit vector toward the sun. Globe system
  owns it; everyone else reads.
- `globe.sunForLocalTime(lat, lon, hours)` → world-space sun dir such that the
  given city has local solar time `hours` (0–24), accounting for current
  `globe.group.rotation.y`. Declination fixed ~12°. Formula: effective city lon
  `lonE = lon + rotation.y*RAD`; sun lon `L = lonE - (hours-12)*15`;
  `dir = latLonToVec3(decl, L, 1).normalize()`.
- Night factor at a surface point: `smoothstep(0.06, -0.14, dot(worldNormal, sunDir))`.

---

## SYSTEM A — globe & atmosphere  (files: `js/textures.js`, `js/globe.js`)

### `TERRA.textures.generate(onProgress) → Promise<{day, night, clouds, spec, bump}>`
All `THREE.CanvasTexture`. `onProgress(fraction0to1, label)` called between
stages; yield to the event loop between stages (`await new Promise(r=>setTimeout(r,0))`)
so the loading bar paints. Suggested sizes: day 2048×1024, night 2048×1024,
clouds 1024×512, spec 1024×512, bump 1024×512. Use ImageData loops + core noise.

- **Continents must look like Earth.** Hand-author simplified lon/lat polygon
  outlines IN CODE (30–70 vertices each) for: North America, South America,
  Africa, Eurasia (or Europe+Asia), Australia, Antarctica, Greenland, and islands
  (UK, Ireland, Japan, Madagascar, New Zealand, Borneo/Sumatra/Java/New Guinea,
  Philippines, Sri Lanka, Cuba, Iceland, Svalbard, Tasmania). Anchor points you
  should hit (lon,lat): Africa: (-5.9,35.8),(10,37),(32.5,30),(43,11.5),(51.4,11.8),
  (41,-2),(40,-15),(35,-24),(20,-34.8),(18,-34.4),(12,-18),(13,-8.8),(9.3,0.5),
  (3,6.2),(-7.5,4.6),(-17.5,14.7),(-13,27.7). S.America: (-77,8),(-60,10),(-52,4),
  (-35,-6),(-38,-13),(-48,-25),(-53,-34),(-62,-40),(-65,-47),(-68,-55),(-72,-52),
  (-73,-44),(-71,-30),(-70,-18),(-76,-14),(-81,-6),(-80,0). N.America: (-168,65),
  (-165,60),(-150,59),(-130,54),(-124,48),(-124,40),(-117,32),(-105,20),(-97,16),
  (-90,15),(-83,9),(-77,8),(-82,10),(-88,16),(-90,21),(-97,26),(-94,29),(-89,29),
  (-84,30),(-81,25),(-80,32),(-76,35),(-70,42),(-66,45),(-60,46),(-64,50),(-58,54),
  (-64,60),(-78,62),(-85,66),(-95,68),(-110,68),(-125,70),(-140,70),(-156,71).
  Eurasia: (-9,43),(-9,38),(-6,36),(3,37),(10,37),(20,32),(32,31),(35,28),(43,12),
  (51,12),(59,22),(56,27),(48,30),(50,26),(56,24),(60,25),(66,25),(72,20),(77,8),
  (80,10),(87,21),(92,20),(98,8),(103,1),(105,10),(109,18),(108,21),(117,23),
  (122,30),(122,37),(126,40),(131,43),(135,48),(142,54),(156,51),(162,60),(170,66),
  (180,68),(180,71),(160,70),(140,72),(120,73),(105,77),(90,75),(70,73),(60,70),
  (45,68),(33,69),(25,71),(15,68),(5,62),(5,58),(10,54),(4,52),(-2,48),(-5,48).
  Australia: (113,-22),(114,-34),(118,-35),(124,-33),(130,-32),(138,-35),(141,-38),
  (147,-38),(150,-37),(153,-30),(153,-25),(146,-19),(142,-11),(136,-12),(131,-11),
  (125,-14),(122,-17). Adjust/close polygons sensibly; fill with canvas path
  (equirectangular). Handle polygons crossing ±180 by splitting or clamping
  (Chukotka edge is fine to clamp at 179.9). Antarctica: fill lat < -70 band with
  noisy edge down to -63 in places (Antarctic peninsula reaches (-60,-63)).
- **Day map:** ocean = deep blue with subtle fbm depth variation + lighter
  continental shelf near coasts; land = biome color by latitude & noise:
  equatorial rainforest deep green, subtropical desert bands (~15–33° both
  hemispheres: Sahara lon -15..35, Arabia 35..55, Australia interior, Kalahari,
  Atacama, SW USA) sandy tan, temperate green, boreal dark green-gray, tundra
  above ~60° gray-brown, ice caps white (Greenland interior, Antarctica, arctic
  sea ice above ~80°N noisy). Mountain streaks (Andes along west S.America coast,
  Rockies, Himalayas ~ (75..95, 28..35), Alps) lighter rock + snow hints. Add
  fine fbm detail everywhere so it doesn't look flat. Subtle river hints optional.
- **Night map:** black ocean/land base; city light clusters — for EVERY city in
  `TERRA.data.cities` draw a warm gaussian blob sized by population at its
  lat/lon, plus scattered smaller town lights on land (use the land mask you
  built), denser near coasts/rivers and in Europe/India/East-Asia/US-east.
  Color warm sodium (1.0, 0.75, 0.4) with a few cool-white cores. Keep lights
  OFF in oceans/deserts/ice. This texture is used as emissive on the dark side.
- **Clouds:** RGBA canvas; alpha from domain-warped fbm3 on sphere (swirls:
  warp sample coords by another fbm), latitude bands (ITCZ band near equator,
  mid-latitude storm tracks ±45°, sparse subtropics), soft edges. RGB white.
- **Spec:** white ocean / black land (ocean specular mask), slight blur at coasts.
- **Bump:** grayscale elevation — land fbm + mountain boosts, ocean mid-gray flat.
- Expose the land test for reuse: `TERRA.textures.isLand(lat, lon)` (from your
  polygon fill — keep a 1024×512 mask Uint8Array).

### `TERRA.globe.init(scene, worldRoot, tex) → api`
Build meshes, add `group` to `worldRoot`, `skyGroup` to `scene`. Return:
```
{
  group, skyGroup, earthMesh, cloudsMesh,
  setSunDirection(v),            // updates TERRA.state.sunDir + all uniforms + directional light
  getSunDirection(),
  sunForLocalTime(lat, lon, hours),   // see formula above
  getNightFactor(lat, lon),
  setSpinEnabled(b),
  getHorizonColor(),             // THREE.Color — current sky horizon color (for fog sync)
  update(dt, ctx)
}
```
`ctx = { cameraPos:Vector3(world), earthCenter:Vector3(world), altitudeM, dist,
phase, focusCity, allowSpin:bool, fogColor:Color, fogDensity:float, time }`.

Meshes & shaders (all custom shaders obey the 5 rules above):
1. **Earth** `SphereGeometry(100, 96, 64)`, ShaderMaterial:
   - uniforms: dayMap, nightMap, specMap, bumpMap, sunDir, uFogColor, uFogDensity,
     uTime, cameraPosition (built-in).
   - world normal `N` (normalMatrix), view dir `V`, `ndl = dot(N, sunDir)`.
   - day color from dayMap; subtle bump perturb from bumpMap (cheap 2-tap).
   - night side: `nightMix = smoothstep(0.09, -0.12, ndl)`; add
     `nightMap.rgb * nightMix * 1.6` (lights bloom later). Twilight band: near
     terminator tint day color warm orange `exp(-abs(ndl)*9.)` factor.
   - ocean specular: `specMap.r * pow(max(dot(reflect(-sunDir,N),V),0.),48.) *
     smoothstep(-0.05,0.25,ndl) * 0.9` warm-white.
   - inner atmosphere rim: `pow(1.-max(dot(N,V),0.),3.5) * mix(nightBlue,
     dayBlue, dayFactor) * 0.55` added.
   - manual fog, logdepth, encodings chunks.
2. **Clouds** `SphereGeometry(100.35, 64, 48)`, transparent ShaderMaterial,
   depthWrite:false: sample clouds alpha; lit `wrap = clamp((ndl+0.18)/1.18,0,1)`;
   color = mix(dark blue-gray night, white day, wrap) with silver lining near
   terminator; alpha *= uCloudOpacity (fade to 0 when ctx.altitudeM < 2500 so
   streets get clear sky; also fade slightly when camera is ABOVE clouds looking
   down? no — keep visible from space). Rotate mesh slowly (spin + drift).
3. **Atmosphere glow** `SphereGeometry(103.2, 64, 48)`, BackSide, additive,
   depthWrite:false, transparent: fresnel `pow(clamp(dot(vNormalW, viewDirW)+1.04,
   0.,1.), 6.)`-style rim (tune so glow hugs the limb), color mixes day blue
   (0.3,0.6,1.0) → sunset orange near terminator (use sunDir vs normal), intensity
   uniform fades out when ctx.altitudeM < 120000 (camera entering atmosphere).
4. **Sky dome** (in skyGroup) `SphereGeometry(6000, 32, 24)` BackSide ShaderMaterial:
   gradient zenith→horizon. Compute local sun elevation from ctx (up =
   normalize(cameraPos - earthCenter), elev = dot(up, sunDir)). Blend three
   palettes: DAY (zenith deep blue → horizon pale blue), SUNSET (|elev|<0.25:
   horizon orange/pink toward sun azimuth, zenith purple-blue), NIGHT (near-black
   blue). `uSkyMix` uniform = smoothstep(120000, 8000, altitudeM) fades dome in
   as camera descends (0 in space → black space shows). Sun disc glow in dome
   shader: `pow(max(dot(viewDirW, sunDir),0.),350.)*2. + pow(...,24.)*0.35` tinted.
   Manual fog NOT applied to sky (it IS the fog color source). getHorizonColor()
   returns the current horizon color computed from the same palette logic.
5. **Stars** (skyGroup): ~2600 THREE.Points on sphere r=5500, sizes varied,
   subtle color temperature variation, custom shader with twinkle (uTime,
   per-star phase attribute), `uStarFade` = 1 - uSkyMix (fade out in atmosphere).
   Additive, depthWrite:false. Also a faint milky-way band: concentrate ~35% of
   stars near a great-circle band + a few large soft nebula sprites (canvas
   radial-gradient textures, additive, very subtle).
6. **Sun sprite** (skyGroup): canvas radial gradient (white core → warm → clear),
   AdditiveBlending Sprite, positioned `cameraPos + sunDir*5200`, scale ~700.
   Hide when local sun elevation < -0.08 and altitudeM < 100000.
7. **Directional light** (for city standard materials): color warm white,
   intensity 1.35, position = earthCenter + sunDir*500, target earthCenter —
   BUT with floating origin the light must track: set position each update from
   ctx.earthCenter. Add low ambient (0x223344, 0.5) + hemisphere subtle. Light
   intensity scales down at night automatically? No — cities handle night look
   via their own uniforms; keep sun light constant, add `uNight`-driven ambient
   in city materials.
8. `update`: spin `group.rotation.y += 0.018*dt` ONLY when ctx.allowSpin;
   clouds extra drift; re-center skyGroup on cameraPos; update sky/star/sun
   uniforms & palette from ctx; cloud opacity fade; atmosphere fade; fog uniforms;
   light position; twinkle time.

Quality bar: this must read as *Earth* from space — recognizable continents,
believable biome colors, crisp terminator with orange twilight rim, glowing
city lights on the night side, soft blue limb. From the ground: convincing blue
sky / sunset / starry night, sun disc, fog-matched horizon.

---

## SYSTEM B — city detail  (file: `js/cities.js`)

### `TERRA.cities.init(globeGroup, tex) → api`
Build three procedural districts (NYC, Tokyo, Paris) as children of
`globeGroup` (so they spin with Earth). Each anchor:
```
anchor.position = TERRA.util.latLonToVec3(lat, lon, TERRA.C.R)
anchor.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), normal)
anchor.scale.setScalar(1 / TERRA.C.MPU)      // children authored in METERS
```
Return `{ anchors:{nyc,tokyo,paris}, update(dt, ctx), getCity(id) }`.
`ctx = { cameraPos, earthCenter, altitudeM, focusCityId, sunDir, time }`.

`update`: for each city compute world position of anchor
(`anchor.getWorldPosition`), distance to camera; `anchor.visible = dist <
TERRA.C.CITY_VISIBLE_DIST` (~38 km). Compute `night = smoothstep(0.06,-0.14,
dot(worldNormal, sunDir))` and write into shared uniform objects (one per city
material set): `uNight.value`. Animate cars/beacons if present.

Content per city (all geometry in meters, ground at y=0):
- **Ground**: 10,000×10,000 m plane (PlaneGeometry rotated -PI/2), 2048² canvas
  texture: asphalt block grid / streets / parks / riverbed painted to match the
  layout you generate; radial alpha fade to 0 beyond ~4200 m from center
  (transparent material) so it blends into the globe. MeshStandardMaterial,
  roughness 0.95. Streets read as slightly lighter gray lines with dashed
  centerlines where scale allows.
- **Buildings**: ONE InstancedMesh per city, 3500–7000 instances of a unit box
  (BoxGeometry(1,1,1) translated so base at y=0: translate(0,0.5,0)). Per-instance
  attributes: `aSize` (vec3 meters), `aSeed` (float). Material:
  MeshStandardMaterial({color:0x8a8f98, roughness:0.85, metalness:0.15}) with
  `onBeforeCompile` injecting a **procedural window shader**:
  - vertex: `attribute vec3 aSize; attribute float aSeed; varying vec3 vLocalM;
    varying float vSeed;` in main after `#include <begin_vertex>`:
    `vLocalM = position * aSize; vSeed = aSeed;` (position is unit-box local).
  - fragment: after `#include <emissivemap_fragment>` compute window grid from
    vLocalM: floors every 3.4 m (y), windows every 2.6 m (x/z depending on face
    normal — use vNormal object-space passed as varying or pick axis by
    abs(normal)); facade mask = window rectangles (inset 0.55 m); day: darken
    diffuseColor.rgb by window mask * 0.35 (glass) + per-instance facade tint
    from hash(vSeed); night: `lit = step(hash(cell + vSeed), 0.42)` warm
    (1.0,0.72,0.38) * lit * uNight * 2.2 added to totalEmissiveRadiance; some
    windows cool-white (hash>0.8), occasional flicker via uTime slow hash.
    Roof face (normal.y>0.5): no windows, darker gravel + occasional red beacon
    blink on tall ones (aSize.y>120: emissive red pulse).
  - Shared uniform objects: `uNight:{value:0}`, `uTime:{value:0}` — keep
    references so update() can write them. Set `material.customProgramCacheKey`
    if needed. InstancedMesh frustumCulled=false (instances span the city).
  - Per-instance color via setColorAt for facade variety (concrete, glass-blue,
    brick, steel) — multiplied with shader tint.
- **Layouts** (seeded rng from TERRA.data.heroes[id].seed):
  - NYC: Manhattan-like island ~2.4 km wide × 6.5 km long along local Z, rotated
    ~29°; grid streets every 80 m (streets) / 220 m (avenues); Central Park
    rectangle (~800×2500 m) upper-middle with trees (dark green ground patch +
    low instanced blobs optional); two height clusters: Midtown (z≈+900, heights
    120–380 m) and Downtown (z≈-2300, 90–300 m), elsewhere 20–70 m; rivers:
    Hudson west (x≈-1500, width 700 m) & East river east (x≈+1500, width 500 m)
    as dark water planes y=0.3 with 2 simple bridges (deck + towers); landmarks:
    Empire-State-like stepped tower (380 m, setbacks + spire) midtown,
    WTC-like tapered glass tower (420 m) downtown, Chrysler-like crown (320 m).
  - Tokyo: jittered dense grid, mostly 10–45 m small blocks, Shinjuku-like tower
    cluster west (x≈-1400, 120–240 m), a few 180 m+ elsewhere; neon: ~250
    emissive sign panels (PlaneGeometry boxes on building sides, random hues
    pink/cyan/orange/green, emissiveIntensity driven by uNight, some flicker);
    Tokyo-Tower-like 333 m red/white lattice (4 tapered legs + X-braces from
    thin cylinders, 2 observation decks); elevated highway ribbon curving
    through (ExtrudeGeometry or box segments); a scramble-crossing open plaza.
  - Paris: Haussmann blocks ~20–24 m uniform cream color with darker mansard
    top (two-tier instance sizes or a second InstancedMesh for roof caps);
    12 radial avenues from an Étoile-like hub (offset from center), Seine river
    curving through (wide dark plane strip built from segments, ~12 bridges);
    Eiffel-Tower-like 324 m iron lattice: 4 legs curving inward (stacked tapered
    box segments following x = ±(45*exp(-y/90)+8) style curve), platforms at
    57/115/276 m, arches between lower legs (half-torus), bronze-brown color,
    warm floodlight emissive at night (uNight); Champ-de-Mars green strip;
    Montparnasse-like dark slab 210 m; invalides-like golden dome optional.
- **Street life**: ~150–300 moving car dots per city (InstancedMesh tiny boxes
  2×1.2×4 m, emissive headlights white front / red rear approximated by two
  instanced sets or per-instance color; move along grid lines, wrap around).
  Update positions in update() only when city visible. Street lamps: instanced
  small emissive spheres along roads, intensity via uNight (cheap, no real
  lights).
- Performance: everything instanced/merged; total draw calls per city < 60.
  No shadows (fake AO: darken building bases via shader gradient).

Quality bar: from 300 m up the districts must read as real cities (grid, rivers,
parks, landmark silhouettes); at street level: window grids, neon (Tokyo), warm
sodium glow (Paris), moving cars, landmark detail. Night must be spectacular
with bloom (main.js adds UnrealBloomPass).

---

## SYSTEM C — camera & flights  (file: `js/camera.js`)

### `TERRA.camera.init({canvas, worldRoot, globe, cities, renderer}) → api`
```
{
  camera,                       // THREE.PerspectiveCamera(50, aspect, near, far)
  update(dt),                   // controls damping, flights, floating origin, near/far
  flyTo(lat, lon, opts) → Promise,   // resolves on arrival
  zoomTo(altitudeM, opts) → Promise, // vertical-only cinematic zoom at current target
  exitToSpace() → Promise,      // fly back to dist 300, target = earth center
  getState(),                   // {lat, lon, altitudeM, dist, azimuthDeg, elevationDeg,
                                //  focusCityId, flying, phase}
  isFlying(), cancelFlight(),
  setDrift(radPerSec),          // slow auto-orbit for tour dwells (0 = off)
  setEnabled(b)
}
```
State model: target point `T` (Vector3, world space BEFORE origin offset — i.e.
in worldRoot-local coords), spherical offset `(dist, azimuth, elevation)` around
T. Camera local pos = T + dir(az,el)*dist; rendered pos = that + worldRoot.position.
- Space default: T=(0,0,0), dist=300, elevation 18°, azimuth 0. Up = +Y.
- Near surface: up = surface normal at T (blend from +Y to normal as dist drops
  below ~30 units; use quaternion slerp or lookAt with computed up). Elevation
  measured above local horizon there. Clamp elevation [3°, 89°] near surface,
  [-80°, 80°] in space.
- **Floating origin**: `O = dist < TERRA.C.ORIGIN_SWITCH_DIST ? T : (0,0,0)`;
  `worldRoot.position.copy(O).negate()`. camera.position = T + offset - O.
  camera.up set appropriately; camera.lookAt(T - O).
- **Controls** (custom, no OrbitControls): pointer drag → azimuth/elevation
  velocity with inertia + exponential damping (`TERRA.util.damp`); wheel →
  `targetDist *= exp(deltaY * 0.0012)` clamped [C.m2u(2), 600], dist damped
  toward targetDist (lambda ~4); touch: 1-finger orbit, 2-finger pinch zoom.
  Disable during flights. `canvas.style.touchAction='none'`.
- **Zoom-to-surface targeting**: when dist < 2.2*R and T is near center, raycast
  screen-center through camera against `globe.earthMesh` (world matrices are
  current; account for worldRoot offset automatically via matrixWorld); move T
  toward hit point (damped). When dist < C.m2u(4000) and a detail city anchor is
  within C.m2u(5000) of T → snap focus: T = city surface point, set
  `TERRA.state.focusCity`, emit bus 'focus' {city}. When zoomed out beyond
  C.m2u(300000) release focus (emit 'focus' {city:null}); beyond dist 2.5*R ease
  T back to center. Min altitude clamp 2 m — never go under ground.
- **flyTo(lat, lon, opts)**: opts `{altitudeM=25000, duration=auto, elevationDeg=35,
  sunHours=null, arrive='orbit'|'street', drift=0}`. Cinematic arc:
  - start surface point S = current T normalized*R (if T≈0 use camera sub-point),
    end E = latLonToVec3(lat,lon,R). arcAngle = surfaceAngle(S,E).
  - duration auto = clamp(3.2 + arcAngle*4.5 + log10(max(h0,h1)/1000)*0.8, 4, 13) s.
  - horizontal: slerpSurface(S, E, easeInOutQuart(t)).
  - altitude profile h(t): rise from h0 to cruise over first 28% (easeOutCubic),
    cruise = max(h0, h1, arcAngle*R*MPU*0.30 + 150000), descend to h1 over last
    38% (easeInOutCubic → soft landing). dist = R + h/MPU… careful: dist is
    distance from T (surface point) so dist = h/MPU when T on surface; while T
    migrates from center handle blend: during first 15% also slerp T from center
    to S (dist accordingly). Simplest robust: keep T ALWAYS on surface during
    flight (start S), dist = h/MPU; if starting from space (T=center) prepend a
    0.8 s "drop" phase easing T from center→S and dist 300→h0/MPU+R… you may
    implement as: flight has phases but the public behavior must be smooth and
    never clip through the globe.
  - camera looks at a point slightly AHEAD on the path (t+0.04) during cruise
    for leading framing; at arrival look exactly at E.
  - subtle bank: roll camera up-vector by sin(t*PI)*2.5° around view axis.
  - sun: if opts.sunHours != null, slerp TERRA sun dir from current to
    globe.sunForLocalTime(lat, lon, sunHours) over the flight (call
    globe.setSunDirection each frame; compute target ONCE at flight start since
    spin is disabled during flight).
  - emit bus 'flightstart' {from:{lat,lon}, to:{lat,lon}, city}, set
    TERRA.state.phase='flying'; on end phase = arrive==='street'?'street':'orbit',
    focusCity set if detail city within 5 km, emit 'flightend', enable controls,
    set drift.
  - cancelFlight(): resolve promise early, hand current state to controls.
- **zoomTo(altitudeM)**: same vertical profile, 2.5–5 s, keeps az/el.
- **update(dt)** also sets: `camera.near = clamp(dist*0.02, 0.00003, 2)`,
  `camera.far = 9000`, updateProjectionMatrix when changed; writes
  TERRA.state.altitudeM = (dist - R)*MPU when T on surface else dist*MPU;
  TERRA.state.phase unless flying/tour.
- getState().lat/lon = vec3ToLatLon(T) when |T|>1 else camera sub-point.
- Expose nothing else global; main.js drives update.

Quality bar: buttery damping, no gimbal flips, no ground clipping, flights feel
like a film (rise–cruise–descend, leading look, gentle bank, sun shifting to
golden hour / night on arrival).

---

## SYSTEM D — search & UI  (files: `js/ui.js`, `css/style.css`)

All DOM ids exist in index.html (read it). `TERRA.ui.init()` wires DOM +
loading screen immediately (before 3D exists) and returns:
```
{
  setProgress(f, label),        // loading bar 0..1
  ready(),                      // fade out loading, reveal UI
  bind({camera, globe, cities}),// called once systems exist; wires actions
  showError(msg),
  setLetterbox(b),              // cinematic bars in/out (CSS transition)
  caption(title, sub, kicker)   // tour captions; null hides
}
```
Behavior:
- **Search**: input filters TERRA.data.cities (case/diacritic-insensitive
  substring on name+country; rank: startsWith > includes; detail cities first on
  ties). Dropdown #suggestions max 8 rows: name, country, pop, "3D" badge for
  detail cities. ArrowUp/Down + Enter navigate; click flies. On select:
  `camera.flyTo(city.lat, city.lon, city.detail ? heroes[id].arrival merged with
  {arrive:'street', sunHours:arrival.sunHours} : {altitudeM:180000, elevationDeg:30})`.
  Blur input, hide dropdown. `/` focuses search (unless typing). Esc closes.
- **Tour** (#btn-tour): requestFullscreen(#app) (catch errors silently),
  letterbox in, hide topbar/bottombar/hud/citycard (CSS class on #app e.g.
  `touring`), TERRA.state.tourActive=true, bus 'tourstart'. Sequence (await each
  flyTo, then dwell with camera.setDrift(0.02)):
  1. space hold 2.5 s — caption "EARTH" / "100% procedural · no satellites, no maps"
  2. NYC  flyTo arrival street sunHours 17.8 — dwell 9 s — "NEW YORK" / "40.71°N 74.01°W · golden hour"
  3. Tokyo flyTo street sunHours 21.4 — dwell 10 s — "TOKYO" / "35.68°N 139.65°E · neon night"
  4. Paris flyTo street sunHours 6.3 — dwell 9 s — "PARIS" / "48.86°N 2.35°E · first light"
  5. Rio flyTo {altitudeM:26000, elevationDeg:25, sunHours:11} — dwell 6 s — "RIO DE JANEIRO" / "22.91°S 43.17°W"
  6. exitToSpace — dwell 5 s — "TERRA" / "everything you saw was generated in code"
  Then end: letterbox out, touring class removed, drift 0, tourActive=false,
  bus 'tourend', exitFullscreen if we entered it, button text reset. Progress
  dots #tour-dots (6). #btn-skip → advance to next leg immediately (cancelFlight
  + resolve). Esc → abort whole tour, stay where camera is, restore UI.
  Tour must be re-runnable. Guard against double-start.
- **HUD**: every ~120 ms update #hud-alt (TERRA.util.formatAlt), #hud-coords
  (formatLatLon), #hud-phase (SPACE / ORBIT / STREET / IN FLIGHT / TOUR).
- **City card**: bus 'focus' → show #citycard with name/country/pop/coords;
  badge "PROCEDURAL DISTRICT" only for detail cities else "FLYOVER"; tagline from
  heroes or country. Hide when focus null.
- **Sun slider**: on input → `globe.setSunDirection(globe.sunForLocalTime(
  state.focusCity?lat:viewLat, lon, value))`; label HH:MM. Disable during flights
  (or let it fight? disable). Sync slider when tour moves sun (read back via
  globe helper? optional: skip sync, fine).
- **Buttons**: #btn-spin toggles globe.setSpinEnabled + .active class;
  #btn-fullscreen toggles document fullscreen on #app; #btn-help / #help /
  #btn-help-close; keyboard: /, T, F, R, H, Space (exitToSpace), Esc.
- **Loading**: #loading covers all; setProgress drives #load-bar width +
  #load-status text; ready() fades it (CSS opacity transition then display:none).
- **Error**: showError fills #error-msg, unhides #error.
- **CSS** (style.css): cinematic dark glass UI. Palette: bg #05070d, panel
  rgba(10,14,22,0.72) + backdrop-filter blur(14px), 1px border rgba(255,255,255,
  0.08), accent amber #ffb454, secondary cyan #7fd4ff, text #e8edf5. Font:
  system-ui stack; brand + captions uppercase, letter-spacing .18em, thin weight.
  #vignette: radial-gradient transparent 55% → rgba(0,0,0,0.55) 100%,
  pointer-events none. #grain: subtle animated noise via repeating conic/linear
  gradients or an inline SVG feTurbulence data-URI background, opacity 0.05,
  pointer-events none (keep cheap). Letterbox bars: fixed top/bottom, height 0 →
  7vh transition .8s cubic-bezier. Buttons: glass pills, hover glow, active
  accent. Search dropdown: glass, rows hover accent-left-border. City card:
  bottom-left glass, big thin name. Tour captions: bottom-center above letterbox,
  kicker small amber, caption 42px thin uppercase, sub muted; fade/slide
  transitions. HUD: top-right under topbar, monospace, small, muted. Loading:
  centered logo huge letter-spaced, thin progress track. `#app.touring` hides
  .ui-hidden elements + citycard. Responsive: <720px shrink brand/hide zoomhint,
  search full-width. All overlays pointer-events:none except interactive ones.
  Canvas fixed full-viewport. `.hidden{display:none!important}`.
  Respect prefers-reduced-motion: disable grain animation.

---

## main.js (owned by lead — for your reference)

Boot order: `ui.init()` → `await textures.generate(ui.setProgress)` →
`globe.init(scene, worldRoot, tex)` → `cities.init(globe.group, tex)` →
`camera.init({...})` → `ui.bind({camera, globe, cities})` → `ui.ready()`.
Loop: dt clamp 0.05 → camera.update(dt) → build ctx (cameraPos, earthCenter =
worldRoot.position, altitudeM, dist, phase, focusCity, allowSpin = spinEnabled &&
!flying && !focusCity && dist > 2.2R, fogColor = globe.getHorizonColor() blended
to black above 60 km, fogDensity schedule) → globe.update(dt, ctx) →
cities.update(dt, ctx) → composer.render(). Bloom: strength 0.55 space → 0.95
street-night, radius 0.7, threshold 0.82. `window.TERRA.app = {camera, globe,
cities, ui, flyTo, tour}` test hooks. window.onerror → ui.showError.

## Rules for every agent
- Write ONLY your assigned files. Plain IIFE scripts attaching to window.TERRA.
- three r128 API only (SphereGeometry is BufferGeometry; InstancedMesh ✓;
  setColorAt ✓; no ColorManagement).
- No `import`, no `fetch`, no external URLs, no downloaded data. All canvas
  textures procedural. Hand-authored coordinate data is fine.
- GLSL: precision handled by three; obey logdepth/encodings/fog rules above.
- Performance: texture generation < ~6 s total; per-frame allocations minimal
  (reuse temp vectors).
- When done run `node --check` on each file you wrote (syntax only) and fix any
  errors. Report: files written, public API actually implemented, any contract
  deviations, known risks.