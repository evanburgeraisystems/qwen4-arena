/* Shared game state. Loaded after engine.js, before all system modules. */
'use strict';
window.G = {
  state: 'boot',            // boot | menu | play | pause | dead | win
  time: 0,                  // seconds since run start
  runStart: 0,
  player: {
    pos: [0, 1.62, 8],      // eye position (feet = pos.y - 1.62)
    yaw: 0, pitch: 0, roll: 0,
    hp: 100, maxHp: 100,
    speed: 0, sprint: false, bob: 0, stepPhase: 0,
    grabbed: 0, grabber: null, stagger: 0,
    zone: 0, kills: 0, shots: 0, hits: 0, headshots: 0,
    flashlight: true, moving: false
  },
  cam: { pos: [0, 1.62, 8], fwd: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0] },
  post: { motion: 0, damage: 0, flash: 0, fade: 0, dark: 0, glitch: 0 },
  threat: 0,                // 0..1 set by Zombies (nearest chaser proximity)
  noiseEvents: [],          // {pos:[x,y,z], radius, kind, t}
  emitNoise(pos, radius, kind) {
    G.noiseEvents.push({ pos: pos.slice(), radius, kind, t: G.time });
    if (G.noiseEvents.length > 40) G.noiseEvents.shift();
  },
  heli: false,              // extraction helicopter active
  muted: false
};
