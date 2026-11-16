# TERRA — city system split contract (SUPPLEMENTS CONTRACT.md)

The city system is split across 5 files so agents can work in parallel:

- `js/citykit.js`  — shared builder toolkit (agent B0)
- `js/city-nyc.js` — New York district (agent B1)
- `js/city-tokyo.js` — Tokyo district (agent B2)
- `js/city-paris.js` — Paris district (agent B3)
- `js/cities.js` — orchestrator (ALREADY WRITTEN by lead — do not touch)

Load order: citykit → city-nyc → city-tokyo → city-paris → cities.
All plain IIFE scripts on `window.TERRA`. THREE r128 global. Meters, +Y up,
ground y=0. Read CONTRACT.md (shader rules!) and js/core.js first.

## citykit.js — exact public API (B0 implements; B1/B2/B3 code against this)

```
TERRA.citykit = {
  newUniforms() → { uNight:{value:0}, uTime:{value:0} },

  makeWindowMaterial(U, opts) → THREE.MeshStandardMaterial
    // opts: {color=0x8a8f98, roughness=0.85, metalness=0.15,
    //        litFraction=0.42, warm=[1.0,0.72,0.38]}
    // onBeforeCompile procedural-window shader EXACTLY as described in
    // CONTRACT.md System B "Buildings" (aSize/aSeed attributes, vLocalM,
    // floor grid 3.4m / window grid 2.6m, day glass darkening, night lit
    // windows via hash(cell+aSeed) < litFraction, cool-white minority,
    // roof gravel + red beacon blink when aSize.y>120, base AO gradient).
    // Uses U.uNight / U.uTime. Must work with InstancedMesh + setColorAt.
    // logdepth handled automatically by MeshStandardMaterial chunks.

  makeBuildings(material, items) → THREE.InstancedMesh
    // items: [{x, z, w, d, h, rot=0, color=0xffffff}]  (meters, base y=0)
    // Unit BoxGeometry(1,1,1).translate(0,0.5,0); per-instance matrix
    // compose(pos(x,0,z), quatY(rot), scale(w,h,d)); InstancedBufferAttributes
    // aSize(vec3)=w,h,d and aSeed(float)=random; setColorAt(item.color).
    // frustumCulled=false. count=items.length.

  makeGround(paintFn, sizeM=10000, fadeStart=4200) → THREE.Mesh
    // 2048² canvas; paintFn(ctx2d, sizeM, pxPerM) draws the map (ctx already
    // translated so (0,0)=city center, +x right, +y = +z world... use
    // ctx.scale(pxPerM,pxPerM) yourself INSIDE paintFn if you want meters;
    // kit passes raw ctx with origin at canvas center, y-down = +z).
    // After paint: radial alpha fade (destination-in gradient) transparent
    // beyond fadeStart. PlaneGeometry(sizeM,sizeM).rotateX(-PI/2),
    // MeshStandardMaterial{map, transparent:true, roughness:0.95}.

  makeWaterPoly(points, y=0.3) → THREE.Mesh
    // points: [[x,z],...] closed polygon in meters → THREE.Shape →
    // ShapeGeometry rotated flat at height y. MeshStandardMaterial
    // {color:0x0a1e33, roughness:0.12, metalness:0.65}.

  makeCars(U, segments, count) → {mesh, update(dt)}
    // segments: [{ax,az,bx,bz}] road centerlines. InstancedMesh of tiny boxes
    // (4×1.4×2 m), per-instance color: ~half warm-white (headlights), half red
    // (taillights). Cars travel segments at 8–16 m/s, wrap, orient along
    // direction. Emissive via material.emissive white *0.6 + per-instance
    // color; brightness scaled by (0.35+0.65*U.uNight) in update (set
    // material.emissiveIntensity). update(dt) advances instance matrices.
    // frustumCulled=false.

  makeLamps(U, positions) → THREE.Group
    // positions: [[x,z],...] — instanced dark poles (cyl r0.15 h9) +
    // instanced emissive warm spheres (r0.5 at y9). Sphere material
    // emissiveIntensity = 3.0*U.uNight (update internally via onBeforeRender
    // or return group with .userData.tick(dt) — simplest: material emissive
    // set once, and kit registers an internal ticker array; expose
    // kit.tick(U, dt) that updates all materials bound to U).

  tick(U, dt)  // advances U.uTime and any kit-internal animations bound to U

  box(w,h,d, x,y,z, mat, ry=0) → THREE.Mesh   // y = CENTER height
  cyl(rTop,rBot,h, x,y,z, mat, seg=10) → THREE.Mesh
  stdMat(color, opts={}) → THREE.MeshStandardMaterial  // fog default true
  emissiveMat(U, color, intensity) → THREE.MeshStandardMaterial
    // emissive=color, emissiveIntensity=intensity*(0.15+0.85*uNight) via
    // onBeforeCompile or registered in tick(U); color near-black base.
  rng(seed) → TERRA.util.rng(seed)
}
```

## City builders (B1/B2/B3)

Each file registers: `TERRA.cityBuilders = TERRA.cityBuilders || {};`
`TERRA.cityBuilders.nyc = function (anchor, kit, hero, tex) { ... return {uniforms:[U], update(dt,time){...}} }`
(anchor = THREE.Group already positioned/oriented/scaled by orchestrator;
add all meshes to it; hero = TERRA.data.heroes[id] with .seed; tex = globe
textures if useful). One `U = kit.newUniforms()` per city shared by all its
night-reactive materials; call `kit.tick(U, dt)` in your update. Return ALL
uniform sets in `uniforms` array (orchestrator writes uNight).

Generate the block/building layout FIRST as data, paint the ground from the
SAME data (streets between blocks, parks, riverbeds), then makeBuildings.
Layout specs per city are in CONTRACT.md System B "Layouts" — follow them
(Manhattan grid + Central Park + 2 rivers + Empire/WTC/Chrysler; Tokyo dense
jittered grid + Shinjuku cluster + neon panels + 333m lattice tower + elevated
highway; Paris Haussmann cream blocks + 12 radial avenues + Seine + 324m Eiffel
lattice with curved legs/platforms/arches + Champ-de-Mars + Montparnasse slab).

Landmarks: build from kit.box/cyl + custom geometry; they must be recognizable
silhouettes. Eiffel legs: 4 corners, half-width(y) = 62*exp(-y/95)+7 meters,
stacked tapered box segments every ~12m, platforms at 57/115/276m, half-torus
arches between legs below 57m, bronze 0x6b5a44, night floodlight emissive via
kit.emissiveMat(U, 0xffb060, 1.2) on a few uplight boxes. Tokyo tower: red/white
bands (alternate segment materials 0xd43a2f / 0xe8e4dc), 4 legs tapering,
X-braces thin cylinders, decks at 120/250m. Empire: 3 setback tiers + spire.

Budget: 3500–7000 building instances, <60 draw calls/city, no shadows, no
per-frame allocations in update (reuse vectors). node --check when done.