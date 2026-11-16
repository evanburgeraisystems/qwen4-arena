# BODYCAM: OUTBREAK — build contract (READ FULLY BEFORE CODING)

A browser FPS that must look like real police bodycam footage of a zombie outbreak
in an abandoned hospital at night. **Zero dependencies, zero downloaded assets.**
Every texture is drawn on a `<canvas>` in code, every mesh is boxes/cylinders/quads,
every sound is synthesized with WebAudio. Raw WebGL2 engine provided in `js/engine.js`.

## Rules for every agent
- Write ONLY your assigned file. Do not edit engine.js, state.js, index.html, or other agents' files.
- Classic script (no ES modules, no imports). Attach your API to `window.<Name>`.
- You may READ `js/engine.js` and `js/state.js` — they are final. Code exactly against them.
- Other modules may not exist yet; code against the contracts below. Guard optional cross-calls
  (e.g. `if (window.HUD) HUD.toast(...)`), EXCEPT calls marked REQUIRED.
- Validate syntax with `node --check js/<yourfile>.js` before finishing.
- No `alert`, no console spam. Keep per-frame allocations low (reuse arrays where easy).
- Units: meters. +Y up. yaw=0 faces -Z; +yaw turns LEFT; +pitch looks UP.
  forward = fwdVec(yaw,pitch) = [-sin(yaw)cos(pitch), sin(pitch), -cos(yaw)cos(pitch)].
  Mouse: yaw -= dx*sens ; pitch -= dy*sens. Colors are linear-ish 0..1 floats.
- Performance budget: whole frame < 12 ms on a laptop. Static level merged into few meshes.
  Zombies ≤ 26 alive, 11 box parts each. Lights ≤ 20 total in Eng.lights.

## Load order (index.html)
engine.js → state.js → audio.js → level.js → zombies.js → combat.js → postfx.js → main.js

## Engine API (window.Eng) — already implemented, read engine.js for details
- `Eng.init(canvas)` called by main. `Eng.start(loopFn)` runs rAF loop: loopFn(dt,t) then render.
- `Eng.time`, `Eng.dt`, `Eng.frame`.
- Math globals: `M4` (ident,mul,persp,translate,scale,rotX,rotY,rotZ,trs(pos,rotEuler,scl),view,xform),
  `V3` (add,sub,scl,dot,len,dist,distXZ,norm,lerp,cross), `fwdVec(yaw,pitch)`, `rightVec(yaw)`,
  `clamp,lerp,rnd(a,b),pick(arr)`.
- `Eng.camera = {pos,yaw,pitch,roll,fov}` — CameraRig writes this every frame BEFORE render.
- `Eng.ambient=[r,g,b]`, `Eng.fog={color:[..],density}` — Level owns these (may tweak per zone).
- `Eng.lights` — array of `{pos:[x,y,z],color:[r,g,b],radius}`. Level pushes flickering fluorescents;
  Combat pushes a temporary muzzle-flash light (remove after ~60 ms). Max 20 used.
- `Eng.spot = {pos,dir,color,intensity,inner,outer,range,on}` — the flashlight. Combat positions it
  from G.cam each frame. inner/outer are cosines of cone half-angles.
- Meshes: `Eng.meshCube` (unit cube centered origin), `Eng.meshQuad` (unit XY quad facing +Z),
  `Eng.meshCyl` (r=0.5,h=1 along Y). `Eng.createMesh({pos,nrm,uv,col,idx})` for custom.
- `Eng.add(mesh, modelMatrix, color, opts)` → renderable. opts: `{alpha,emissive(0..1),tex,texScale:[u,v],
  blend:'none'|'alpha'|'add',depthWrite,doubleSided,viewSpace}`. Returns object with `.visible`, `.model`,
  `.color`, `.alpha` etc. — mutate freely per frame. `Eng.scene.remove(r)`.
  viewSpace items render with identity view (camera space), depth cleared — for the gun viewmodel.
  In view space, camera looks down -Z; gun sits around [0.25,-0.22,-0.45].
- `Eng.builder(texScaleDefault)` → `{box(cx,cy,cz,sx,sy,sz,[r,g,b],{rotY,uvScale,alpha}), build()→mesh}`.
  Merged static geometry with per-vertex colors; UVs scaled by face size × uvScale (texture repeats).
- `Eng.texFromCanvas(canvas, repeat=true)` → GL texture. flipY is handled: canvas appears upright on
  quads with standard uv (0,0 bottom-left).
- Particles: `Eng.fx.spawn({p,v,col:[r,g,b,a],size,life,grav,drag,grow})`, `Eng.fx.burst(pos,n,{speed,col,size,life,grav,drag,up,grow})`
  (blood/dust/smoke, alpha blend). `Eng.sparks` same API (additive: muzzle flash, sparks).
- Input: `Eng.input.keys` (Set of e.code), `Eng.input.buttons[0..2]`, `Eng.mouseDelta()` → {dx,dy} consumed.
  `Eng.input.locked` = pointer lock active.
- `Eng.internalW/H` = scene FBO size (~960×540). PostFX works at canvas resolution.

## Shared state (window.G) — read js/state.js
- `G.state`: 'boot|menu|play|pause|dead|win' — main owns transitions.
- `G.player`: pos (EYE pos; feet = y-1.62), yaw, pitch, hp, speed, sprint, bob, grabbed (seconds remaining),
  grabber (zombie ref), zone, kills, shots, hits, flashlight, moving.
- `G.cam`: {pos,fwd,right,up} — CameraRig writes each frame (audio listener + muzzle origin use it).
- `G.post`: {motion 0..1, damage 0..1, flash 0..1, fade 0..1, dark 0..1, glitch 0..1} — PostFX reads.
  main/combat set damage=1-hp/100, flash on hit, motion from turn speed. PostFX may refine internally.
- `G.threat` 0..1 — Zombies writes (how close/dangerous nearest chaser is). Audio reads for breathing/heartbeat.
- `G.emitNoise(pos, radius, kind)` — REQUIRED bus. kinds: 'gunshot'(r≈42), 'step'(r≈6), 'sprint'(r≈12),
  'melee'(r≈9), 'door'(r≈26), 'glass'(r≈18). Zombies consumes G.noiseEvents each frame.
- `G.heli` bool — main sets true at extraction; Audio.rotorStart/Stop, PostFX may add searchlight feel.

---

## MODULE: js/audio.js → window.AudioSys  (agent: AUDIO)
All sound synthesized in code (WebAudio). No samples, no speechSynthesis. Master chain:
gain(0.85) → DynamicsCompressor → destination. Create AudioContext lazily in `init()` (called on user gesture).
Positional sounds: PannerNode ('equalpower', refDistance 3, maxDistance 60, rolloffFactor 1.3),
listener at G.cam.pos oriented by G.cam.fwd/up (update in `update(dt)`).
API (all safe to call before init — no-op if ctx missing):
- `init()`, `update(dt)` — per-frame: listener, breathing loop, heartbeat, ambient bed levels.
  Breathing: filtered-noise inhale/exhale envelope; rate 0.25 Hz calm → 0.9 Hz at G.threat=1 or hp<35;
  depth grows with threat/sprint. Heartbeat: low sine thump pairs when hp<40 or threat>0.75.
  Ambient bed: low hospital hum (55/110 Hz sines + filtered noise), occasional distant metallic groan,
  wind on rooftop (raise when G.player.zone>=5). Start bed in init.
- `gunshot()` — loud: noise burst through lowpass sweep 4 kHz→300 Hz, click transient, body thump
  (sine 120→50 Hz), short slapback tail (delay 0.09 s, feedback 0.25) = corridor echo. Slight random pitch.
- `dryFire()`, `reloadStart()` (mag release click), `reloadMag()` (mag insert clack), `reloadSlide()` (metallic slide rack),
  `meleeSwing()` (whoosh), `meleeHit()` (wet thud), `pickup(kind)` ('medkit'|'ammo'), `hurt()` (grunt-ish noise burst + thump),
  `grabAttack(pos)` (snarl + cloth rustle), `flashlightClick()`.
- `footstep(run, surface)` — surface 'tile'|'concrete'|'roof'; short filtered-noise scuff + heel click;
  run louder/lower. Called by main on step cycle.
- `groan(pos, kind)` — kind 'idle'|'shamble'|'run'|'aggro': 0.7–1.8 s voiced sound: sawtooth 70–140 Hz
  with slow random pitch drift, 2–3 bandpass formants (400–1600 Hz) modulated by LFO, breathy noise layer,
  amplitude envelope. 'run'/'aggro' add a ragged scream layer (higher pitch, faster vibrato, distortion via waveshaper).
  Randomize so no two groans identical. Rate-limit: max ~6 groans/sec globally.
- `scream(pos)` — distant or close shriek, 1.2 s, used for scripted scares / runner aggro.
- `deathRattle(pos)` — gurgling exhale (noise + low formant sweep down).
- `doorBang(pos)` — huge impact: low thump + noise crack + rattling decay (3 quick echoes). `doorCreak(pos)`.
- `glassBreak(pos)` — bright noise burst + several descending sine "shards" pings.
- `radio(kind)` → returns the subtitle TEXT (string). Synthesized unintelligible radio voice:
  bandpass(300–3000 Hz) formant babble (syllable-rate amplitude gating of a buzz source), squelch click
  at start/end, bit of static, roger beep for some kinds. kinds: 'dispatch','backup','panic','static','final'.
  Keep a lines table, e.g. dispatch: "DISPATCH: All units, code 30 at Mercy General. Repeat, code 30."
  The VOICE is gibberish radio mush; the TEXT is shown by main via HUD.radio(text). Return text.
- `rotorStart()` / `rotorStop()` — helicopter loop: low thump pulse ~14 Hz blade rate + turbine whine
  (sawtooth 180 Hz + noise), gain ramps in over 3 s. `winSting()`, `deathSting()` (low drone + flatline-ish tone).
- `setZone(z)` — optional ambience shift.
Quality bar: gunshot must feel loud and physical; groans must be unmistakably human-ish and wet;
radio must sound like a real Motorola squelch. Everything dark, compressed, night-shift.

## MODULE: js/level.js → window.Level  (agent: LEVEL)
Procedural abandoned hospital, night. Build with Eng.builder merged meshes + canvas textures.
Canvas textures to generate (256–512 px, grimy, desaturated): floor (vinyl tile, scuffs, dark grout),
wall (two-tone: pale green upper / darker lower, stains, scuff marks), ceiling (stained tiles),
blood (transparent splatter + smears, several variants ok), exitSign (green EXIT running man, emissive),
helipad (yellow H in circle on concrete), roof (gravel concrete), glass (cracked translucent),
poster (anatomy/hospital notice, torn), metal (brushed dark). Expose `Level.tex = {floor,wall,ceil,blood,exit,heli,roof,glass,poster,metal}`.
Layout (all coordinates meters, y=floor height):
- zone 0 LOBBY: 12×10 room centered (0,0,4), spawn {pos:[0,1.62,8.2], yaw:0} facing -Z.
  Reception desk, overturned gurney, scattered chairs, broken glass, blood trail leading north,
  double doors at z=-1 leading to corridor. Big windows (broken glass quads) on east wall, dim moonlight.
- zone 1 WEST WARD CORRIDOR: 3.2 wide, from z=-1 to z=-31, floor y=0. Ward rooms (6×5) on both sides
  every ~8 m with doorways (no door leafs, open), beds, IV poles (cyl), blood trails, one flickering
  fluorescent every 6 m (2 dead). Overturned gurney mid-corridor forcing a slight sidestep.
- zone 2 STAIRWELL A: at corridor end (z≈-33), 4×6 room, RAMP up to y=4 (floorHeight interpolates
  over z -32→-36 or a switchback; simplest: straight ramp along -Z, 4 m rise over 5 m run).
  Emergency light (red, dim), EXIT sign.
- zone 3 ICU CORRIDOR (floor y=4): from z=-37 to z=-61, 3.2 wide, darker (fewer working lights,
  one swinging/flickering hard), more blood, 3 DOOR LEAFS (hinged, closed initially) on rooms,
  doors that bang open on their own (scripted). Gurneys, a wheelchair-ish debris, ceiling tiles fallen.
- zone 4 ROOF ACCESS: stair room at z≈-63, ramp y=4→7 over 5 m, heavy door (door leaf) at top.
- zone 5 ROOFTOP (y=7): 18×18 open area z -66→-84, low parapet walls (1.1 m), gravel texture,
  HELIPAD circle center [0,7,-78] r=2.8 (decal + painted H texture quad), vents/AC boxes,
  distant city glow: a few large emissive dim quads far away (z=-120, y 0..12) + faint orange point light.
  Cold blue ambient up here; fog density lower (0.03).
API:
- `build()` — constructs everything; fills `Level.data`:
  `{spawn:{pos,yaw}, waypoints:[{id,pos:[x,y,z],links:[ids],zone}], spawnPoints:[{pos:[x,feetY,z],zone}],
    zones:[{id,name,floorY}], doors:[Door], pickups:[{pos,type:'medkit'|'ammo',taken:false,r:0.9}],
    helipad:{pos:[0,7,-78],r:2.8}}`.
  Waypoint graph: nodes every ~3 m along corridor centers + room centers + ramp tops/bottoms, links
  bidirectional, each node tagged zone. MUST cover whole path so BFS works. Spawn points: room corners,
  corridor ends, behind player start — tagged with zone (min zone where they may spawn).
  Pickups: 2 medkits (+40 hp) + 3 ammo (+30 reserve) along the path, visible as small emissive-ish boxes
  (white box red cross quad / olive ammo box), bob/spin in update.
- Door object: `{pos:[x,y,z] (hinge at floor), yaw (closed facing), w:1.0, h:2.1, open:0..1, closed:true,
  zone, r (renderable), col (collider entry or null), swing:0, banging:false}`.
  `Level.openDoor(door, violent)` — animates open over 0.35 s (violent: fast + shake), removes collider.
  Doors render as wood/metal box with small window quad; hinge rotation around Y at hinge edge.
- `update(dt)` — fluorescent flicker (each light has state: on/buzz/flicker/dead; flicker = rapid random
  intensity dips + occasional full blackout 0.2–1 s; update Eng.lights colors in place), scripted scares
  (zone 3: a door bursts open on its own when player first enters zone + every ~25 s another; call
  AudioSys.doorBang + G.emitNoise(pos,26,'door')), pickup bob, ambient dust motes (Eng.fx, sparse),
  broken-glass occasional tinkle (AudioSys.glassBreak quiet, rare, zone 1/3).
- `moveCircle(x, z, r, dx, dz)` → `[nx, nz]` — slide collision against wall AABBs + closed doors.
  Walls stored as `{minX,maxX,minZ,maxZ,minY,maxY}`; only collide if player feet Y within wall vertical range
  (so parapets collide on roof, ramp side walls work). Two-pass axis-separated slide.
- `floorHeight(x, z)` → floor Y (0 lobby/ward, ramp interpolation in stair zones, 4 ICU, 7 roof).
  Must be smooth on ramps. Outside built area return current zone guess 0.
- `zoneAt(pos)` → zone id 0..5 (by z/x ranges; stair zones by z & y).
- `raycast(from, to)` → t∈[0,1], 1 = clear. Slab test vs wall AABBs + closed doors (doors as thin AABB).
- `addDecal(pos, size, tex, color, alpha, rotY)` → renderable quad lying flat (rotX -90°), y+0.012 offset,
  blend alpha, depthWrite false. Blood trails = chains of these. Also usable on walls via optional normal arg?
  Keep floor-only; wall blood = thin box with blood tex instead.
- `reset()` not needed (main reloads page on restart).
Lighting: Eng.ambient ≈ [0.035,0.04,0.055] interior; fluorescents color [0.75,0.85,0.8] intensity via
color scale ~0.9, radius 7, pos y=floor+2.7. EXIT signs: emissive green quads + tiny green light radius 3.
Moonlight: 2–3 very dim blue lights radius 14 near windows. Keep total ≤ 18 lights; cull: in update,
set far lights' color to [0,0,0] if > 30 m from player (cheap). Fog interior density 0.05 color near-black blue.
Quality bar: walking through must read as a REAL derelict hospital — grime, clutter, blood logic
(trails dragged toward rooms, splatter at struggle points), not an empty box maze.

## MODULE: js/zombies.js → window.Zombies  (agent: ZOMBIES)
Box-built humanoids, procedural animation, hearing-based swarm AI, wave director.
- `init()` — after Level.build(). `Zombies.list = []`.
- `spawn(type, pos)` → z. type 'shamble'|'run'. z fields:
  `{pos:[x,FEETy,z], yaw, type, hp (shamble 100 / run 60), speed (shamble 0.9–1.3 / run 3.4–4.0),
    state:'idle'|'wander'|'investigate'|'chase'|'attack'|'bash'|'stagger'|'dead', phase (anim), radius:0.34,
    height:1.8, alive:true, stagger:0, attackCd:0, path:[], targetPos, losTimer, groanCd, parts, deathT, sinkT}`.
  Build 11 box renderables (pelvis, torso, head, upperArmL/R, forearmL/R, thighL/R, shinL/R) with
  per-zombie palette: sickly skin [0.55,0.5,0.42]±, clothes torn scrubs (dark teal/grey/blue) or
  hospital gown (pale bloodied), runners leaner + more blood. Blood stains: darker red vertex tint on
  torso/head via color. Parts updated per frame with M4.trs hierarchy (shoulders/hips offsets).
  Shadow: dark flat quad under each (alpha 0.35, size 0.8).
- `update(dt)`:
  * Consume G.noiseEvents: zombies within radius → investigate toward noise pos (gunshot also aggros
    chasers already aware). Clear consumed events (splice the array).
  * Senses: LOS via Level.raycast (throttle 0.2 s/zombie) + distance < 14 (flashlight on: < 18) → chase.
    Chase target = player pos. Hearing radius passive: footsteps handled via noise events.
  * Pathing: if LOS clear → steer direct; else BFS over Level.data.waypoints (cache path, recompute
    every 0.7 s or on target change) → follow node chain. Move with Level.moveCircle (r 0.34).
    Separation: push away from other zombies within 0.7 m (cheap O(n²), n≤26 fine).
    y = Level.floorHeight. Face movement dir (lerp yaw). Closed door within 1.1 m ahead on path →
    state 'bash': 1.1 s windup then Level.openDoor(door,true) + AudioSys.doorBang + G.emitNoise(...,26,'door').
  * Attack: distXZ < 1.05 && attackCd<=0 && G.state=='play' → attack anim (arms raise, lunge 0.25 m);
    after 0.35 s if still < 1.5: REQUIRED Combat.damage(7 + rnd(4), z.pos); G.player.grabbed = 1.1;
    G.player.grabber = z; AudioSys.grabAttack(z.pos); CameraRig.addShake(0.5). attackCd = 1.6.
    While grabbed by this z: keep arms-forward pose, shamble with player.
  * Animation: phase += speed*dt*freq. Walk: thighs swing sin(phase)*0.5, shins knee-bend, arms
    counter-swing; shamble = asymmetric (one leg stiff 0.15 amp, torso lean 0.12, head tilt, one arm
    dangling); run = lean 0.35, amp 0.9, freq high, arms pumping. Idle: slow sway + head twitch
    (random timer). Attack: both arms forward horizontal + fingers? (forearms angle). Stagger: lean back,
    arms flail, move backward. Death: fall over 0.55 s (rotate root around local X to ±90°, drop y),
    then corpse stays; after 14 s sink 0.4 m & remove renderables (cap corpses 18, oldest removed early).
  * Groans: groanCd random 3–9 s; chase/run → 'aggro'/'run' groans louder; idle → 'idle'.
    AudioSys.groan(z.pos, kind). Runner first aggro → AudioSys.scream once.
  * Director (inside update): reads G.player.zone. Budget per zone: z0:2, z1:5, z2:6, z3:9, z4:10, z5:12
    (alive cap 26). Spawn gradually (every 2.5–5 s if under budget) at Level.data.spawnPoints with
    point.zone <= playerZone+1, prefer > 12 m from player & not in LOS (check raycast) — behind/side.
    Runner ratio: zone0 0%, z1 10%, z2 20%, z3 35%, z4 45%, z5 55%. On zone change: burst-spawn 2–3
    ahead + AudioSys.scream distant + HUD.toast optional. Initial: 2 shamblers in lobby far corner +
    3 in ward (spawn at init so world feels inhabited).
  * G.threat = clamp(max over chasers of (1 - dist/12), 0, 1); grabbed → 1.
- `damage(z, dmg, dir, head)` — REQUIRED entry from Combat. hp-=; flinch (stagger 0.25 if not dead);
  blood: Eng.fx.burst at hit point (dark red [0.35,0.02,0.02], grav 6); head → extra spray.
  If hp<=0: state dead, AudioSys.deathRattle, G.player.kills++, Level.addDecal blood pool under corpse
  (grows: 2 decals), release grab if grabber===z.
- `shove(z, dir)` — from Combat melee: stagger 1.4 s, knockback velocity 3 m/s decaying, break grab,
  blood small, AudioSys.meleeHit handled by Combat.
- `reset()` not needed.
Quality bar: silhouettes must read human at 10 m in flashlight; motion must be creepy-uneven,
never robotic-synced (randomize phase/freq per zombie). Runners must be genuinely scary-fast.

## MODULE: js/combat.js → window.Combat  (agent: COMBAT)
Pistol viewmodel + shooting/reload/melee + flashlight + health/damage.
- `init()` — build viewmodel (viewSpace renderables, Eng.meshCube): pistol from ~8 boxes: slide
  (dark gunmetal [0.09,0.09,0.1]), frame, grip (angled), trigger guard, front/rear sights, barrel hint;
  gloved hand (dark [0.12,0.11,0.1]) + forearm sleeve (navy uniform) entering from bottom-right.
  Gun root around [0.24,-0.23,-0.42], slight inward yaw. Muzzle flash: emissive quad (viewSpace,
  additive) at [0.24,-0.185,-0.72] hidden normally + Eng.sparks burst + temporary world light.
  State: mag=15, magSize=15, reserve=60, fireCd=0, reloading=0 (timer), meleeCd=0, meleeT=0,
  recoilSpring {x,v}, sway {x,y}, kick {pitch,yaw}.
- `update(dt)` (only when G.state=='play'; still render idle pose otherwise):
  * Flashlight: Eng.spot.pos = G.cam.pos + fwd*0.12 + right*0.10 - up*0.05; dir = fwd (with tiny lag sway).
    Eng.spot.on = G.player.flashlight. Toggle on KeyL press (edge) → AudioSys.flashlightClick.
  * Fire: buttons[0] (hold allowed, rate 0.21 s) && !reloading && fireCd<=0: if mag>0 → shoot();
    else dryFire (once per press). shoot(): mag--, G.player.shots++, fireCd=0.21,
    CameraRig.kick(0.024+rnd(0.012), rnd(-0.008,0.008)) REQUIRED, recoilSpring.v -= 6,
    muzzle flash visible 50 ms + world light {pos: muzzleWorld, color:[1,0.85,0.55], radius:9} removed after 60 ms,
    Eng.sparks.burst(muzzleWorld, 6, {speed:3,col:[1,0.8,0.4,1],size:0.03,life:0.08,grav:0}),
    smoke Eng.fx few grey particles, AudioSys.gunshot() REQUIRED, G.emitNoise(G.player.pos, 42, 'gunshot') REQUIRED.
    Hitscan: origin G.cam.pos, dir G.cam.fwd + spread rnd 0.006 (bloom when moving).
    Wall t = Level.raycast(origin, origin+dir*80). Zombie hit: sphere tests per alive z:
    torso sphere center z.pos+[0,1.05,0] r 0.42, head z.pos+[0,1.62,0] r 0.24 — ray-sphere, nearest t < wallT.
    Hit → Zombies.damage(z, head?70:34, dir, head) REQUIRED, G.player.hits++ (headshots++),
    Eng.fx.burst blood at hit point, small flinch. Miss wall → dust burst grey + tiny spark.
    HUD.setAmmo(mag, reserve) REQUIRED on change.
  * Reload: KeyR edge && mag<15 && reserve>0 && !reloading → reloading=1.7; timeline:
    t0 AudioSys.reloadStart + gun tilt down/mag drop (animate), 0.85 AudioSys.reloadMag + mag back,
    1.35 AudioSys.reloadSlide + rack anim; end: transfer min(15-mag, reserve). Cancel-safe.
  * Melee: KeyF or buttons[2] edge && meleeCd<=0 → meleeT=0.32, meleeCd=0.75, AudioSys.meleeSwing;
    at meleeT crossing 0.14: arc check zombies distXZ<1.75 && angle to fwd < 65° →
    Zombies.shove(z, dir) + Zombies.damage(z, 12, dir, false); break grab: G.player.grabbed=0,
    G.player.grabber=null; AudioSys.meleeHit if connected; G.emitNoise(pos, 9, 'melee');
    CameraRig.addShake(0.18); viewmodel thrust anim (gun swings left-forward).
  * Viewmodel pose per frame: bob (G.player.bob: y sin*0.012*speedfactor, x cos*0.008), sway from
    Eng.mouseDelta? NO — main consumes mouse for look; Combat reads G.lookDelta {dx,dy} (main sets each
    frame before Combat.update) → sway lag springs. Recoil spring: gun z += recoil.x*0.06, rotX += recoil.x*0.12;
    spring k=90 d=12. Sprint: gun lowered/tilted (lerp). Reload/melee override poses. Grabbed: gun shakes.
  * damage(amount, fromPos) REQUIRED (zombies call): if G.state!=='play' return; hp -= amount;
    G.post.flash = 1; CameraRig.addShake(0.6); AudioSys.hurt(); blood direction indicator optional;
    if hp<=0: hp=0, G.state='dead', AudioSys.deathSting(), Main.onDeath() (guard if window.Main).
  * heal(n), addAmmo(n) — clamp, HUD.setAmmo, AudioSys.pickup handled by main.
- Expose `Combat.state = {mag, reserve, reloading}` for HUD/tests.
Quality bar: recoil must feel snappy; reload readable; muzzle flash must light the corridor for a frame.

## MODULE: js/postfx.js → window.PostFX + window.CameraRig + window.HUD  (agent: CAMERA/POST)
THE bodycam look. Owns the entire post chain + camera rig + OSD overlay DOM.
- `PostFX.init(gl, w, h)`, `resize(w,h)`, `render(sceneTex, dt)` — full-screen passes, own programs/FBOs.
  Chain (can combine into 2 passes for perf):
  1. Temporal motion blur: keep prev FINAL frame FBO; blend prev with current: factor 0.16 + motion*0.30
     (motion = G.post.motion from turn/move speed). Plus 3-tap directional smear along uMotionVec
     (screen-space camera velocity, computed from yaw/pitch deltas × projection) scaled by motion.
  2. Fisheye: barrel distortion r' = r(1 + k1 r² + k2 r⁴), k1≈0.28 k2≈0.06, sample scene with distorted uv;
     chromatic aberration: R/B sampled at ±0.0025*r² offset; edges slightly softer (2-tap).
  3. Grade: desaturate to 0.72, cool shadows (lift blue +0.015), S-curve contrast, slight green-magenta
     split tone, vignette 0.5 smooth, blacks lifted 0.012 (sensor noise floor).
  4. Grain: animated hash(uv*res + t) luminance grain 0.045 + dark*0.10 (dark = 1-luma of scene);
     faint horizontal scanline modulation 0.015; occasional single-frame sensor hot pixel.
  5. Compression artifacts (worse in dark + motion): 8×8 block luma posterize mixed in by
     darkness*0.5+motion*0.3; macroblock glitch: when G.post.glitch>0 or random rare trigger,
     offset 1–3 random 16×16 blocks' uv by a few px + smear their color; block-edge ringing hint.
  6. Damage & state: red vignette pulse (G.post.damage) + procedural blood-splatter edge texture
     (canvas-generated at init: dark red drips/spatter around border, alpha) scaled by damage;
     G.post.flash → brief red-white flash; G.post.fade → multiply to black (death).
     Subtle handheld exposure wobble: global gain 1 + 0.02*sin(t*0.7) + auto-exposure-ish lift when
     scene very dark (sample center luma via a tiny 1×1 readback? NO readbacks — approximate from
     G.player.zone & flashlight: dark areas lift gain 1.15).
  7. Output to default framebuffer; copy final into prev FBO (blit pass).
  All shaders #version 300 es, precision highp float. Fullscreen triangle VAO shared.
- `CameraRig.update(dt)` REQUIRED each frame before render:
  base = G.player.pos/yaw/pitch. Add: head bob (bob phase from main: vertical sin(bob*2)*0.032 +
  lateral cos(bob)*0.02, scaled by speed/4.6, only when moving & grounded), breathing micro-drift
  (sin(t*1.1)*0.004 pitch), trauma shake (trauma decays 1.8/s; offset = trauma²*(noise) on pos xyz
  ±0.06 & roll ±0.05 & yaw/pitch ±0.02), recoil kick springs (pitch/yaw offsets decay k=70 d=10),
  grabbed wobble (extra trauma 0.35 + roll sin), sprint FOV 1.32→1.42 lerp, landing dip (main sets
  G.player.landDip), death: when G.state=='dead' animate pos.y → floor+0.35, roll → 0.55, pitch → -0.1
  over 1.2 s (use Level.floorHeight). Writes Eng.camera {pos,yaw,pitch,roll,fov} and
  G.cam {pos,fwd,right,up} (fwd from final yaw/pitch). Sets G.post.motion = clamp(|yawΔ|+|pitchΔ|)*8 + speed*0.06.
  `CameraRig.addShake(x)` (trauma += x, cap 1.2), `CameraRig.kick(pitch, yaw)` REQUIRED for recoil.
- `HUD.init()` builds DOM inside #hud (exists in index.html): bodycam OSD, monospace, white 0.82,
  subtle text-shadow, pointer-events none:
  top-left: red dot blink 1 Hz + "REC"; under it timestamp "2026-09-14 02:13:07" advancing with G.time
  (start 02:13:07, date fixed); top-right: "AXON BODY 3" / "X60390142" / "BADGE B-2174";
  bottom-right: battery icon bars + "87%" slowly draining (0.1%/10 s); bottom-left: objective line
  (small, grey-white); ammo readout faint bottom-right above battery "15 | 60" (only when play);
  radio subtitle bottom-center (yellow-white, 4.5 s); toast center-top small (2.5 s).
  API: `HUD.setObjective(txt)`, `HUD.radio(txt, dur)`, `HUD.toast(txt, dur)`, `HUD.setAmmo(mag, res)`,
  `HUD.setVisible(bool)` (hide OSD in menu/dead? keep REC always — footage never stops).
  HUD.update(dt) called by main loop (timestamp/battery/blink).
Quality bar: freeze-frame must pass as bodycam: heavy barrel distortion, crushed noisy blacks,
harsh flashlight hotspot, smeared motion, blocky dark corners, OSD typography. NOT a clean game render.

## main.js (owned by lead, not agents)
Boot, menu/pointer-lock, movement controller (walk 2.7 / sprint 4.7 m/s, accel 14, friction 10,
Level.moveCircle r 0.3, eye = floorHeight+1.62 smoothed, bob phase += speed*dt*1.9, footstep audio +
noise on step crossings, sprint noise), zone tracking → objectives/radio milestones, pickups,
win check (distXZ to helipad < 2.8 && zone 5 → G.state='win', G.heli=true, AudioSys.rotorStart,
heli spotlight added, Main.onWin overlay after 3 s), death overlay, pause on lock loss, restart=reload.
Test hooks: window.__test = {tp(zone), look(yaw,pitch), key(code,down), click(btn,down), state(), god(bool)}.
RADIO milestone examples: start dispatch "code 30", zone1 "units hold perimeter", zone3 panic
"they're inside the walls", roof final "extraction inbound, pad is hot".

## Cross-module REQUIRED call map (must exist exactly)
- main → AudioSys.init/update/footstep/radio/rotorStart/winSting, Level.build/update/moveCircle/
  floorHeight/zoneAt/raycast, Zombies.init/update/damage/shove, Combat.init/update/damage/heal/addAmmo,
  PostFX.init/render/resize, CameraRig.update/addShake/kick, HUD.init/update/setObjective/radio/toast/setAmmo.
- Combat → CameraRig.kick/addShake, AudioSys.*, Zombies.damage/shove, Level.raycast, HUD.setAmmo, G.emitNoise.
- Zombies → Level.*, AudioSys.groan/scream/deathRattle/doorBang, Combat.damage, CameraRig.addShake, G.emitNoise.
- Level → AudioSys.doorBang/glassBreak, G.emitNoise, Eng.*.
- PostFX/CameraRig → Level.floorHeight (death cam), G.*, Eng.camera.
- Audio → G.cam/G.threat/G.player only.
