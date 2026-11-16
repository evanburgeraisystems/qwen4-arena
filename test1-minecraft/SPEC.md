# VOXELCRAFT — subsystem contract (READ FULLY BEFORE CODING)

Browser Minecraft-like. **Zero dependencies, zero downloaded assets, works from `file://`.**
Plain classic scripts (NO ES modules, NO import/export, NO fetch of local files).
Each file defines one global via IIFE: `window.Renderer = (function(){ ... return {...}; })();`
All textures/sounds generated in code. Target: 60 fps at render distance 6 chunks.
Verify your file with `node --check js/yourfile.js`. Do NOT edit files owned by others.

## File ownership
- `js/util.js`      — FOUNDATION (exists): math, RNG, simplex noise, mat4, AABB physics.
- `js/blocks.js`    — FOUNDATION (exists): block registry, procedural 16x16 textures, atlas, icons, sun/moon/cloud canvases.
- `js/world.js`     — FOUNDATION (exists): chunk store, get/set, raycast, streaming.
- `js/worldgen.js`  — AGENT worldgen: `WorldGen.generate(cx,cz,seed)`, `WorldGen.getHeight(x,z)`, `WorldGen.biomeAt(x,z)`.
- `js/renderer.js`  — AGENT renderer: raw WebGL engine (see below).
- `js/player.js`    — AGENT player: input, physics, break/place, health, swimming, flying.
- `js/mobs.js`      — AGENT mobs: pigs/sheep/zombies, AI, box models.
- `js/ui.js` + `js/audio.js` + `css/style.css` — AGENT ui: HUD, menus, hotbar, WebAudio synth.
- `js/game.js`, `index.html` — orchestrator (exists).

Script load order in index.html: util, blocks, worldgen, world, audio, renderer, player, mobs, ui, game.
At load time files may only DEFINE things (no DOM/WebGL/audio work at parse time); everything starts via `.init()` called by game.js. Exception: blocks.js builds its canvases at parse time (pure 2D canvas, allowed).

## World constants & conventions
- `CHUNK=16`, `HEIGHT=128`, `SEA_LEVEL=46`. Global coords: +X east, +Y up, +Z south. Blocks are unit cubes; block (x,y,z) occupies [x,x+1)×[y,y+1)×[z,z+1).
- Chunk key: `cx+","+cz` where `cx=Math.floor(x/16)`. Local index in `Uint8Array(16*128*16)`: **`idx = (y*16 + z)*16 + x`**.
- Camera math (USE `Util.forward` / `Util.right`): yaw=0 looks toward −Z. Mouse right ⇒ yaw decreases.
  `forward = (−sin(yaw)·cos(pitch), sin(pitch), −cos(yaw)·cos(pitch))`, pitch + = look up, clamped ±(π/2−0.01).
  `right = (cos(yaw), 0, −sin(yaw))`.
- Day time `Game.time` ∈ [0,1): **0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset**. Sun angle `a=(time−0.25)*2π`; sun direction ≈ normalize(cos(a), sin(a), 0.25). Day starts at 0.30. Full cycle `DAY_LENGTH=480` s. `Game.dayFactor` (0 night .. 1 day) is computed by game.js each frame and passed in render state.

## Block IDs (fixed)
0 air, 1 grass, 2 dirt, 3 stone, 4 cobblestone, 5 planks, 6 log, 7 leaves, 8 sand,
9 glass, 10 brick, 11 water, 12 bedrock, 13 coal ore, 14 iron ore, 15 snow (snowy grass), 16 gravel.
Hotbar (10 slots): [1,2,3,4,5,6,7,8,9,10].

## blocks.js API (exists — read the file)
- `Blocks.BY_ID[id]` → `{id,name,solid,opaque,pass:'solid'|'cutout'|'trans',hardness(seconds),sound:'grass'|'stone'|'wood'|'sand'|'glass'|'gravel',tiles:{top,side,bottom},color:[r,g,b]}`. `BY_ID[0]` is air `{solid:false,opaque:false}`.
- `Blocks.atlasCanvas` 256×256 (16×16 grid of 16px tiles). `Blocks.tileUV(t)` → `[u0,v0,u1,v1]`, **v0 = TOP row of the tile image** (texture uploaded WITHOUT flipY). Side faces must map world +Y to v0 so textures stand upright.
- `Blocks.CRACK_TILES = [t0,t1,t2,t3]` (4 break stages, black lines on transparent).
- `Blocks.sunCanvas`, `Blocks.moonCanvas` (64×64), `Blocks.cloudCanvas` (256×256, white blocky clouds in alpha, tileable).
- `Blocks.drawIcon(canvas, id)` paints an isometric cube icon (used by UI hotbar).
- Water: `solid:false, opaque:false, pass:'trans'`, hardness Infinity. Leaves: `pass:'cutout'` (texture has alpha holes). Glass: `pass:'trans'`. Bedrock: hardness Infinity.

## util.js API (exists — read the file)
`Util.clamp/lerp/smoothstep`, `Util.mulberry32(seed)`, `Util.hash01(x,y,z,seed)` (deterministic 0..1),
`new Util.Noise(seed)` with `.noise2(x,y)`, `.noise3(x,y,z)` (−1..1), `.fbm2(x,y,oct,lac,gain)`, `.fbm3(x,y,z,oct,lac,gain)`,
`Util.forward(yaw,pitch)`, `Util.right(yaw)`,
mat4 (column-major Float32Array): `Util.m4.perspective(fovyRad,aspect,near,far)`, `.lookAt(eye,center,up)`, `.mul(a,b)`, `.identity()`, `.boxModel(cx,cy,cz,sx,sy,sz,rx,ry)` (T·Ry·Rx·S),
`Util.frustumPlanes(vp)` → 6 planes `[a,b,c,d]`, `Util.aabbInFrustum(planes,minx,miny,minz,maxx,maxy,maxz)`,
`Util.Physics.step(world, body, dt)` — body `{x,y,z,w,h,vx,vy,vz,onGround}` (x,z = feet center, y = feet bottom), axis-separated collision vs `world.isSolid(x,y,z)`, mutates body, sets `onGround`, zeroes velocity on hit. Returns `{hitX,hitY,hitZ}` booleans. Also `Util.Physics.groundId(world,body)` → block id under feet.

## world.js API (exists — read the file)
- `World.init(seed)`; `World.seed`.
- `World.get(x,y,z)` → id (y<0→12 bedrock, y≥128→0, unloaded chunk→0).
- `World.isSolid(x,y,z)` → Blocks solid flag; **unloaded chunk → true** (physics safety).
- `World.hasChunk(cx,cz)`, `World.chunks` Map key→`{cx,cz,blocks:Uint8Array,dirty:true,mesh:null,meshTrans:null,...renderer-owned fields}`.
- `World.set(x,y,z,id)` → bool; marks chunk + border neighbors dirty.
- `World.generateChunk(cx,cz)` (calls WorldGen.generate), `World.stream(px,pz)` — budgeted generation/unload around player (gen radius 7, unload radius 10). Call once per frame.
- `World.raycast(ox,oy,oz,dx,dy,dz,maxDist)` → `{x,y,z,nx,ny,nz,px,py,pz,id}` or null. DDA; **skips water & air**; (px,py,pz) = adjacent cell for placement; (nx,ny,nz) = face normal.
- `World.surfaceY(x,z)` → highest non-air, non-water, non-leaves, non-log y (uses generated chunks; falls back to WorldGen.getHeight).

## worldgen.js — AGENT worldgen
`WorldGen.generate(cx,cz,seed)` → filled `Uint8Array(16*128*16)` (idx convention above). Cache Noise instances per seed. Requirements:
- Rolling plains (~y 48–56), forests (tree density ~1/28 columns), mountains up to ~y 105 (ridged/masked fbm), beaches (sand within 2 blocks of sea level), ocean/lakes where terrain < SEA_LEVEL=46 (fill air ≤46 with water id 11), snow (id 15) above y≈90, gravel patches underwater.
- Stone below surface−4, dirt 3–4 deep, grass/sand/snow on top. Bedrock y=0 (always) + rough y=1..2.
- Caves: 3D-noise spaghetti caves (two fbm3 fields, carve where both near zero), y 6..surface−3, plus occasional cheese pockets. Never carve bedrock. Caves may open into oceans — fine.
- Ores in stone: coal (13) clusters y<110, iron (14) y<64, deterministic via hash01 vein seeds.
- Trees: oak — log (6) trunk 4–6 tall, leaves (7) blob canopy. **Deterministic per-column tree decision** (`Util.hash01(x,0,z,seed^0x9e37)` + biome): when generating a chunk, loop columns x,z in local −3..18 so trees rooted in neighbor chunks still contribute their blocks inside this chunk (seamless canopies). No trees on sand/snow/underwater.
- `WorldGen.getHeight(x,z)` → terrain surface y (same function used by generate; excludes trees/water). `WorldGen.biomeAt(x,z)` → `'plains'|'forest'|'mountains'|'ocean'|'beach'`.
- Must be fast: ≤ ~8 ms per chunk. No allocations per block.

## renderer.js — AGENT renderer (raw WebGL, biggest job)
Context: try `webgl2` then `webgl` (GLSL ES 1.00 shaders work in both). `antialias:false`, NEAREST atlas filtering (pixel look), no mipmaps. Canvas sized to devicePixelRatio (cap 2).
API:
- `Renderer.init(canvas)`; `Renderer.resize()`; `Renderer.stats` `{chunks, tris, fps}` (fps set by game).
- `Renderer.updateMeshes(px,pz,budget)` — rebuild dirty chunks within radius 6 whose 4 neighbors exist, nearest first; store GL buffers on chunk (`chunk.mesh`, `chunk.meshTrans`, counts). Delete GL buffers of unloaded chunks (world.js calls `Renderer.onChunkUnload(chunk)` — implement it).
- `Renderer.render(state)` where state = `{camX,camY,camZ,yaw,pitch,fov,time,dayFactor,underwater,flying,sprinting}`.
- `Renderer.setSelection(hit|null)`; `Renderer.setCrack(hit,progress01|null)` (4 stages from Blocks.CRACK_TILES).
- `Renderer.spawnBlockParticles(x,y,z,id,count)` — textured point-sprite burst using the block's side tile, gravity, ~0.6–1.2 s life, fade. Also `Renderer.spawnSplash(x,y,z)` white-blue droplets.
- `Renderer.drawMobs(mobList)` called inside render via state? NO — game passes mobs in state: `state.mobs` = array; each mob exposes `mob.getBoxes()` → `[{cx,cy,cz,sx,sy,sz,rx,ry,color:[r,g,b]}]` (final world-space centers; renderer draws unit cube with `Util.m4.boxModel`, per-face shade, fog, daylight).

Chunk mesh vertex layout (interleaved Float32, stride 7): `pos(3), uv(2), shade(1), wave(1)`.
- Face culling: draw face if neighbor is air, OR neighbor non-opaque AND neighbor id ≠ self id. Same-id water/glass/leaves share no internal faces.
- Water block with air above: top face at y+0.88, side faces shortened to match; `wave=1` on those top verts (vertex shader: `y += sin(uTime*1.7 + pos.x*0.8 + pos.z*0.9)*0.05` when wave>0.5).
- Per-face shade: top 1.0, bottom 0.5, ±Z 0.8, ±X 0.6. **Vertex AO**: sample 3 neighbors (side1, side2, corner) per vertex; ao level 0..3 → multiply shade by [0.45,0.62,0.8,1.0][level]; flip quad diagonal when ao00+ao11 > ao01+ao10.
- UVs: `Blocks.tileUV(tile)` inset by half texel (0.5/256). Side faces: +Y maps to v0.
- Two buffers per chunk: solid+cutout (alpha-test 0.5) and trans (water+glass, alpha blend, depth-write off, chunks sorted far→near).
- Frustum-cull chunks with `Util.frustumPlanes` + AABB (16×128×16).

Shaders/passes (one chunk program reused for crack overlay):
- Chunk FS: `tex.rgb * uLightColor * shade`, linear fog `uFogColor` from `uFogNear` to `uFogFar` (distance from camera). Underwater: fogNear 1, fogFar 20, deep blue; else fogNear = 0.55*viewDist, fogFar = 0.95*viewDist (viewDist = 6*16 = 96), fog color = sky horizon color.
- Day/night: `uLightColor` lerps night (0.30,0.34,0.48) → day (1,1,1); sunset adds warm tint. Compute sky colors from `time`/`dayFactor` with keyframes: midnight zenith #05070f horizon #0b0e1a; noon zenith #4a90e2 horizon #a8cfF0; sunrise/sunset horizon warm #ff9a40 / zenith #35507e with warm band around sun azimuth. **Real sunset**: as sun elevation → 0, horizon near the sun glows orange/red, fading with |dir.y|.
- Sky: draw first, depth-write off — cube (or sphere) centered on camera using rotation-only view; FS gradient by normalized direction + sun glow + **stars** (hash grid on direction, twinkle, fade in as dayFactor→0) + sunset band. Then sun & moon quads (Blocks.sunCanvas/moonCanvas) at dir*400, billboarded, depth-test off, drawn before terrain. Sun visible when above horizon, moon opposite.
- Clouds: `Blocks.cloudCanvas` on a 2048×2048 plane at y=132 centered on camera XZ; UV offset = (camXZ + wind*time)/256 so clouds are world-fixed and drift; alpha blend, depth-write off, fade out near plane edge; tint white by day, pink-orange at sunset, dark blue-gray at night.
- Entities: unit-cube VBO, per-box `uColor` + model matrix, same fog/light. Slight per-face shade.
- Particles: gl.POINTS, attrs pos3/tile1/size1/alpha1/shade1; `gl_PointSize = size * uViewportH / dist` (clamp 2..48); FS samples atlas sub-tile via gl_PointCoord, alpha-test + fade. CPU physics: gravity 20, simple ground bounce (kill velocity on solid), life fade.
- Selection: black wireframe cube (GL_LINES, inflate 1.002), depth test on. Crack: cube overlay with crack tile UVs, blend, only when progress>0.
- Clear color = horizon fog color. `gl.enable(DEPTH_TEST)`, cull back faces (wind CCW outward!).

## player.js — AGENT player
- `Player.init(canvas)`; `Player.update(dt)`; exposes `{x,y,z,vx,vy,vz,yaw,pitch,onGround,inWater,flying,health,selected,breakProgress,fallDistance}`. Spawn set via `Player.spawn(x,y,z)`.
- Pointer lock: game.js requests it; player listens `mousemove` only when `document.pointerLockElement===canvas`. Sensitivity 0.0022 rad/px. Keys tracked on window keydown/keyup (use e.code). Prevent default for Space/arrows/Tab/F3.
- Movement: walk 4.3, sprint 5.6 (ShiftLeft held + moving forward), accel/friction for smooth feel (ground accel 40, air 8; friction exponential). Gravity 32, jump vel 8.8 (only onGround). AABB w=0.6 h=1.8, eye height 1.62. Use `Util.Physics.step`. Sprint gives FOV kick — expose `Player.sprinting` for renderer (game lerps fov 70→78).
- Swimming: body in water (block at feet+0.4 is water) → gravity 6, drag, Space swims up (vy→3.5), sink slowly; `inWater` true; head underwater (block at eye) → `Player.headUnderwater` for UI/audio/renderer. Splash sound on entering water with speed.
- Flying: double-tap Space within 0.35 s toggles `flying`; while flying: Space up / KeyC down (8 m/s, sprint 16), no gravity/fall damage; landing doesn't auto-disable (double-tap again). Expose for UI hint.
- Break: hold LMB → raycast from eye each frame (max 5.5). Progress += dt / hardness (bedrock/water unbreakable). On complete: `World.set(...,0)`, `Audio.play('break_'+soundGroup)`, `Renderer.spawnBlockParticles(x+0.5,y+0.5,z+0.5,id,22)`. While holding: `Renderer.setCrack(hit,progress)` + tick particles every 0.25 s (count 4) + quiet dig sound every 0.25 s. Release resets. `Renderer.setSelection(hit)` every frame.
- Place: RMB (cooldown 0.22 s, also repeat while held every 0.25 s): target = hit.px/py/pz; reject if cell intersects player AABB (or any mob AABB — check `Mobs.list`), reject if cell not air/water; `World.set(cell, hotbarBlock)`, `Audio.play('place')`. Cannot place inside self.
- Hotbar: Digit1..Digit0 → selected 0..9; wheel cycles. Expose `Player.selected`; UI reads it. `Player.hotbar = [1,2,3,4,5,6,7,8,9,10]` (fixed).
- Health 20. Fall damage: track fallDistance while falling (reset on ground/water/fly); on land if >3: damage `floor(fall−3)`, `Audio.play('hurt')`, `UI.damageFlash()`. Regen 1 hp / 4 s when health<20 and not dead. Death at 0 → `Game.onPlayerDeath()`. Zombie touch handled by mobs (calls `Player.damage(n, fromX, fromZ)` — implement damage with 0.5 s invulnerability + knockback).
- Step sounds: while onGround & speed>1, accumulate distance; every 2.0 blocks play `'step_'+groundSoundGroup` (use `Util.Physics.groundId`). Land sound when fallDistance>1.5.
- `Player.damage(n,srcX,srcZ)`, `Player.heal(n)`, `Player.respawn()` (full health, teleport to Game.spawnPoint).
- Mouse buttons only act when pointer-locked & `Game.state==='playing'`.

## mobs.js — AGENT mobs
- `Mobs.init()`, `Mobs.update(dt)`, `Mobs.list` (array), `Mobs.clear()`.
- Types: **pig** (pink, snout), **sheep** (white wool body, pale face), **zombie** (green skin, teal shirt, purple pants, arms held forward). All box models, MC proportions (pig ~0.9 long × 0.9 tall; sheep similar; zombie 1.95 tall humanoid).
- `mob.getBoxes()` → `[{cx,cy,cz,sx,sy,sz,rx,ry,color}]` world-space, legs swing with walkPhase (rotate about hip: compute rotated offset yourself), head yaw follows mob yaw (+ idle look wander), zombie arms rx ≈ −π/2.
- AI: wander (pick random target yaw every 2–6 s, walk 1.2 m/s, pause often), gravity + `Util.Physics.step` (w 0.9 h 0.9 animals / w 0.6 h 1.95 zombie), jump when blocked horizontally & onGround (vy 8). Avoid water (turn around), avoid cliffs (don't walk off >3 drop — check ground ahead). Zombie: at night spawns, slowly chases player within 14 blocks (speed 1.6), touch (dist<1.1) → `Player.damage(2,...)` with 1 s cooldown + groan; despawns when dayFactor>0.6 (poof particles optional). Animals flee 3 s when player sprint-bumps them (dist<0.8).
- Spawning (in Mobs.update): every 1.5 s attempt: animals if dayFactor>0.5, cap 10, spawn 20–44 blocks from player on grass/snow surface (`World.surfaceY`), only in loaded chunks; zombies if dayFactor<0.25, cap 6. Despawn >68 blocks. Never spawn inside blocks.
- Sounds: each mob random 6–16 s timer, if within 18 blocks of player: `Audio.play('oink'|'baa'|'groan', {vol:dist-based})`.
- `Mobs.intersectsBlock(x,y,z)` → bool (player placement check). `Mobs.raycastHit(ox,oy,oz,dx,dy,dz,maxDist)` optional for punching animals (skip if complex).

## audio.js — AGENT ui (WebAudio, ALL synthesized, no samples)
- `Audio.init()` (create AudioContext lazily on first user gesture; resume if suspended), `Audio.play(name,{vol=1,rate=1}={})`, `Audio.setMuted(b)`, `Audio.muted`, `Audio.update(dt,state)` (state: `{dayFactor,headUnderwater,y,camX,camZ}`).
- Master chain: gain(0.5) → DynamicsCompressor → destination. Underwater: lowpass ~600 Hz on master when headUnderwater (smooth).
- Names (must all exist): `step_grass,step_stone,step_wood,step_sand,step_gravel,step_glass`, `dig_grass,dig_stone,dig_wood,dig_sand,dig_gravel,dig_glass`, `break_grass,break_stone,break_wood,break_sand,break_gravel,break_glass`, `place`, `land`, `splash`, `hurt`, `death`, `click`, `oink`, `baa`, `groan`, `zombie_hurt`.
  Recipe ideas: filtered noise bursts (bandpass freq per material: stone 900 Hz short, grass 2500 Hz soft, wood 500 Hz + tone, sand 4000 Hz hiss, glass 3500 Hz + ping), break = louder/longer + pitch drop; place = short thud (sine 180→90 Hz); hurt = square 220→110 blip; oink = sawtooth 300→180 with vibrato ×2; baa = square 420 with tremolo; groan = saw 90→60 slow + noise; splash = noise highpass sweep. Randomize rate ±10% per play. Keep each ≤0.5 s (groan ≤1.2 s).
- Ambience in `Audio.update`: gentle wind (looped filtered noise, gain 0.02–0.05 by day, gust LFO), night crickets (chirp pulses when dayFactor<0.2, gain fades with day), occasional cave drip when y<38 (random 8–20 s, sine ping 1200 Hz + echo). No ambience while muted/menu.

## ui.js + css/style.css — AGENT ui
- `UI.init()` builds DOM inside existing containers (index.html provides `#hud`, `#start-screen`, `#pause-screen`, `#death-screen`, `#debug`, canvas `#game`). `UI.update(state)` per frame; state `{health,fps,px,py,pz,time,dayFactor,seed,selected,hotbar,headUnderwater,flying,chunks,mobs,biome}`.
- Hotbar: 10 slots bottom-center, MC style (dark translucent bg, 2 px borders, selected slot white outline + slight scale). Icons: `Blocks.drawIcon(canvas,id)` per slot (48×48). Slot numbers tiny corner. Selected block name fades in above hotbar on change.
- Hearts: 10 hearts above hotbar-left (20 hp), full/half/empty drawn as inline SVG or canvas pixel hearts (red, dark outline). Damage flash: red vignette pulse (`UI.damageFlash()`), hearts shake on damage.
- Crosshair: white plus, mix-blend-mode difference. Underwater: blue tint overlay + bubble row (10 bubbles, deplete over 12 s, pop sound optional; regen on surface). No drowning damage (keep friendly) — bubbles just visual + blur slightly.
- Debug (F3): top-left monospace panel: fps, xyz, chunk coords, biome, time-of-day HH:MM from time fraction, day %, seed, chunks drawn, mob count, flying state. Hidden by default.
- Start screen: big blocky title "VOXELCRAFT" (CSS 3D text-shadow, pixel font stack `'Courier New',monospace` bold — NO downloaded fonts), subtitle "A tiny voxel world in your browser", seed input (optional, random placeholder), button "▶ Play", controls list (WASD move · Space jump · Shift sprint · LMB break · RMB place · 1-0/wheel hotbar · double-Space fly · F3 debug · M mute · Esc pause). Background: tiled dirt texture from `Blocks.atlasCanvas` dirt tile → dataURL, darkened (real MC menu feel), slight blur.
- Pause screen (Esc / pointer-lock lost while playing): "Game Paused", Resume, New World (prompt seed via input), mute toggle, controls reminder. Death screen: "You Died!" red, score-less, Respawn button.
- Buttons call `Game.start(seed)`, `Game.resume()`, `Game.respawn()`, `Game.newWorld()`. `UI.showScreen(name)` where name ∈ 'start'|'pause'|'death'|null. UI handles button hover/click sounds (`Audio.play('click')`).
- CSS: pixelated image-rendering everywhere, MC-ish gray beveled buttons (border light top-left / dark bottom-right), no external fonts/assets. HUD hidden on start/pause/death screens except crosshair hidden too. Responsive to window size.

## game.js (exists — orchestrator)
States: 'menu' → 'playing' ⇄ 'paused', 'dead'. Owns RAF loop, `Game.time`, `Game.dayFactor`, chunk streaming order (World.stream → Renderer.updateMeshes → Player.update → Mobs.update → Audio.update → UI.update → Renderer.render), pointer-lock management, spawn finding, F3/M/N keys (N = time ×120 fast-forward while held, for demos), `Game.spawnPoint`. Exposes `window.Game`. Test hooks: everything is a global, so `browser.evaluate` can drive `Player`, `World`, `Game` directly.

## Quality bar
Feels like Minecraft: pixel textures, blocky AO shading, fog hiding chunk edge, warm sunset, drifting blocky clouds, stars, satisfying break particles + sounds, hotbar icons, hearts. No placeholder gray boxes. No console errors. 60 fps with ~150 chunks loaded.
