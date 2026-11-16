# IMPROVE pass 2 — feel & fear contract (READ FULLY)
Base contract: ENGINE.md (still valid). This pass adds game-feel. 12 agents, EXCLUSIVE file ownership.
Load order in index.html (agent MENU owns index.html):
engine, state, audio, level, zombies, combat, postfx, decals, director, perf, menu, main, feel

## New shared state fields (create at runtime if missing; do NOT edit state.js)
- G.player.stepPhase (meters traveled, main accumulates), G.player.stepPulse (1 on footfall, rig decays),
  G.player.stepSide (+1/-1 alternating feet), G.player.stamina (0..1), G.player.exhausted (bool),
  G.player.stopDip (0..1), G.player.surface ('tile'|'concrete'|'roof'|'glass').
- G.post.hitDir [x,y] screen-space direction of incoming damage, G.post.hitT (0..1 decay).
- G.settings = {sens:1, vol:0.85, grain:true} — UI owns, others read guarded.

## New module APIs (guard every cross-call with if(window.X))
- window.Decals (js/decals.js): bullet(point, normal) small dark hole quad + crack; blood(point, dir, size)
  splat decal oriented to surface; pool(point, size) growing floor pool; shards(point) persistent glass quads;
  update(dt) growth/fade; cap 120 decals (oldest removed). Floor quads rotX -90, wall quads oriented by normal.
- window.Feel (js/feel.js): hitstop(seconds, scale) micro time-dilation (wraps Eng._loopFn dt);
  pulse(kind) ('kill'|'grab'|'bang') → trauma/glitch spikes via CameraRig.addShake + G.post.glitch;
  deathSlow() 0.35x for 1.2s on death; update via own loop wrap. MUST load AFTER main.js.
- window.Director (js/director.js): fear pacing scheduler, own loop wrap: light blackout sweeps
  (zero Level lights briefly + AudioSys buzz), distant scream + HUD.radio static lines, door creak scares,
  "silhouette" event (spawn idle shamble at far corridor node, lights out 0.6s), rooftop wind gust particles.
  Rate-limited, never during first 8s of run, escalates with zone.
- window.Perf (js/perf.js): wraps Eng.render to measure ms; adaptive: Eng.setInternalScale(0.7..1),
  PostFX.setQuality(0..1), Eng.fx.cap(n)/Eng.sparks.cap(n); target <11ms; own loop wrap for sampling.
- window.UI (js/menu.js): init(), showMenu(), hide(), showPause(), showDeath(stats), showWin(stats),
  settings {sens,vol,grain} persisted localStorage; diegetic AXON boot sequence on menu (sensor check lines),
  pause = "STANDBY // SIGNAL HELD", death/win stats typewriter (time, kills, accuracy), sensitivity slider
  0.5..2, volume slider, grain toggle. Owns #overlay entirely. main calls UI.* (no direct overlay DOM in main).
- AudioSys additions (agent AUDIO): fleshHit(), bodyFall(pos), glassCrunch footstep surface 'glass',
  breath reads G.player.stamina/exhausted, sprint wind layer, struggle grunts on grab (grabAttack exists—extend),
  flickerBuzz(pos,on) short ballast buzz, volume from G.settings.vol.
- Level additions (agent LEVEL): surfaceAt(x,z) (glass patches lobby/ward near windows), raycastHit(from,to)
  → {t, normal:[x,y,z]} (keep raycast), hanging cable sway props, flicker calls AudioSys.flickerBuzz on state change,
  roof paper/debris gust particles when Director gusts (Director calls Level.gust()).
- Engine additions (agent ENGINE): flashlight lens cookie — procedural canvas dirt/smudge texture modulating
  spot cone in fragment shader (uSpotCookie sampler, subtle 0.75..1.0); Eng.setInternalScale(s);
  Eng.fx.cap(n)/sparks.cap(n); blob-shadow softness: zombie shadow quads get radial alpha texture (engine provides
  Eng.texShadow radial gradient canvas texture); particle depth-sort improvement optional.
- PostFX additions (agent POSTFX): setQuality(q) scales grain taps/blur taps/glitch; directional damage:
  red smear + blood edge intensity biased toward G.post.hitDir side while hitT>0; auto-exposure pump:
  brief gain dip when muzzle flash (G.post.flash) then recover; reads G.settings.grain.
- CameraRig (agent POSTFX): footfall sync — vertical dip = -stepPulse curve (sharp attack, spring release) +
  lateral stepSide sway + per-step roll impulse (±0.008); bob from stepPhase (stride 2.0 walk/2.6 sprint):
  vertical -sin(phase/stride*PI)^2 * 0.035 * spd, lateral sin(...)*0.022; roll lean = -yawRate*0.03 clamp ±0.035
  + strafe lean 0.012; sprint FOV 1.46 attack 8/s release 3/s; stop-settle dip from stopDip; exhausted sway +0.004.
- Combat (agent COMBAT): viewmodel step sway (figure-8 from stepPhase + stepPulse kick), flashlight pos sway with
  bob/stepPulse (chest mount), recoil retune (kick 0.028, spring k=110 d=13), melee lunge camera push
  (CameraRig.kick(-0.01,0) + forward pos impulse via CameraRig.addShake(0.12)), fleshHit + Decals.blood on zombie hit,
  Decals.bullet on wall miss (normal from Level.raycastHit), reload mag-drop visual (mag box falls as particle),
  sens from G.settings.sens applied in main (main owns look).
- Zombies (agent ZOMBIES): gait unevenness (per-zombie limp pause micro-hesitations), runner juke (small sine
  strafe while chasing), attack telegraph 0.25s arms-coil before lunge, flinch direction from hit dir,
  death: Feel.hitstop(0.05,0.3) + AudioSys.bodyFall + Decals.pool, grab: struggle oscillation on player yaw
  (G.player.grabWobble set, rig reads), shadow quads use Eng.texShadow.
- Main (agent MAIN): movement rewrite — accel 20 ground, friction 13, air n/a; strafe ×0.82, back ×0.7;
  sprint ×1.75 base 2.7 with 0.25s ramp; stamina 7s sprint drain / 5s regen, exhausted until 0.35 → sprint off,
  speed ×0.92 when exhausted; step events: stepPhase += dist; every stride (2.0 walk / 2.6 sprint) →
  stepPulse=1, stepSide flip, AudioSys.footstep(sprint, surface), G.emitNoise; stopDip when speed drops >2 m/s
  in 0.15s; surface = Level.surfaceAt; look sens 0.0023 * G.settings.sens; UI.* for all overlays;
  Feel.deathSlow on death; keep __test hooks working (tp/look/key/click/state/god/fire/win).

## Rules
- Only touch your owned files. node --check each. No new deps/assets. Keep 60fps budget.
- Everything generated in code. Preserve all existing APIs (other agents call them).
- Report: 4 lines max — what changed, new APIs, deviations.
