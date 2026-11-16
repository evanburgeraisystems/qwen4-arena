# VOXELCRAFT

A Minecraft-like voxel game that runs entirely in your browser. **Zero dependencies, zero downloaded assets** — every texture is painted pixel-by-pixel in code, every sound is synthesized with WebAudio, and the renderer is hand-written raw WebGL.

## Run it

Double-click `index.html`. That's it. No server, no build step, no internet needed.
(Any static server also works, e.g. `npx serve` or `python -m http.server`.)

## Controls

| Input | Action |
|---|---|
| WASD / arrows | Move |
| Mouse | Look (pointer lock; auto-fallback to plain mouse-look if lock is unavailable) |
| Space | Jump / swim up / fly up |
| Shift | Sprint (FOV kick) |
| Left click (hold) | Break block — progress cracks, particles, material sound |
| Right click | Place block (hold to repeat) |
| 1–0 / mouse wheel | Hotbar slot (10 block types) |
| Double-tap Space | Toggle fly · Space/C = up/down while flying |
| F3 | Debug panel (fps, coords, biome, time, seed, chunks) |
| M | Mute · N (hold) | fast-forward time ×120 |
| Esc | Pause / release mouse |

## What's in the world

- **Infinite procedural terrain**: plains, forests, mountains (snow-capped), oceans, beaches — seeded simplex noise, streamed in chunks around you (16×128×16), frustum-culled, fog-hidden horizon.
- **Caves** (spaghetti + cheese pockets), coal & iron ore veins, bedrock floor, cave entrances, dark cave interiors (per-column sky-exposure lighting).
- **Seamless cross-chunk trees**, water with animated waves at sea level, double-sided water surface.
- **Day/night cycle** (8 min/day): real sunset with orange horizon band and sun halo, stars + moon at night, drifting blocky clouds tinted by time of day.
- **Mobs**: pigs & sheep wander by day (flee if you sprint into them); zombies spawn at night, chase, and hit you; they despawn at dawn.
- **Survival lite**: 10 hearts, fall damage, regen, death/respawn screen, swim bubbles + underwater tint + muffled audio.
- **Feel**: per-vertex ambient occlusion, break particles, crack overlay, selection wireframe, synthesized footsteps/dig/break per material, wind, night crickets, cave drips, mob voices.

## Files

```
index.html          page + script order
css/style.css       MC-style HUD/menus (no external fonts/images)
js/util.js          math, seeded simplex noise, mat4, frustum, AABB physics
js/blocks.js        block registry + all procedural textures/atlas/icons/sun/moon/clouds
js/worldgen.js      terrain/biomes/caves/ores/trees (deterministic per seed)
js/world.js         chunk store, raycast (DDA), streaming
js/renderer.js      raw WebGL engine: 7 shaders, AO meshing, sky/sunset/stars/clouds,
                    water, particles, entities, selection/cracks
js/player.js        input, physics, break/place, health, swim, fly
js/mobs.js          pig/sheep/zombie models + AI
js/audio.js         ~28 synthesized sounds + ambience (WebAudio only)
js/ui.js            hotbar, hearts, bubbles, menus, debug
js/game.js          orchestrator: state machine, day/night, pointer lock, spawn
shots/              play-test screenshots (evidence, not game assets)
SPEC.md             the subsystem contract the parallel build was merged against
```

## Performance

~0.3–0.5 ms/frame CPU for simulation+meshing at render distance 6 (≈225 chunks live, ~80–130 drawn after culling, 200–500k tris). Meshing is budgeted per frame; chunks unload behind you. Textures use NEAREST filtering for the crisp pixel look.

## Known limitations

- No block-light propagation (torches/glowstone): caves use sky-exposure shading instead.
- No saving/persistence between sessions; "New World" rerolls the seed.
- Clouds are blocky zigzag slabs (MC-ish, not perfect rectangles).
- Water is a simple animated surface, no flow simulation.
- In embedded browser panes that block pointer lock, the game falls back to plain mouse-look (hint banner shown).
