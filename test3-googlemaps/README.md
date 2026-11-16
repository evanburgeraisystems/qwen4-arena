# TERRA — a procedural Earth

A Google-Earth-style 3D globe that runs entirely in the browser.
**Everything is generated in code** — continents, biomes, clouds, city lights,
streets, buildings and landmarks. No map data, no satellite imagery, no APIs,
no downloads at runtime.

## Run it

Open `index.html` in any modern browser (double-click works — no server needed,
no ES modules). For the best experience use Chrome/Edge with hardware
acceleration enabled.

## What's inside

- **Spinning Earth** with hand-authored continent geometry, latitude biomes
  (rainforest / desert / tundra / ice), ocean specular, bump relief.
- **Day/night terminator** with warm twilight band and **procedural city lights**
  on the dark side (every city in the database emits light sized by population).
- **Cloud layer** with domain-warped cyclone swirls, and a fresnel
  **atmosphere glow** that transitions into a real sky dome (day / sunset /
  starry night) as you descend.
- **Continuous zoom from space to street level** (~2 m minimum altitude) with a
  floating-origin renderer + logarithmic depth buffer for precision.
- **Three full procedural 3D districts**: New York (Manhattan grid, Central
  Park, Hudson/East rivers, Empire-State/WTC/Chrysler-like towers), Tokyo
  (dense neon blocks, Shinjuku towers, 333 m lattice tower, elevated highway),
  Paris (Haussmann fabric, radial avenues, the Seine, 324 m Eiffel-like lattice).
  Thousands of instanced buildings with shader-generated windows that light up
  at night, moving cars, street lamps.
- **Search** any of ~85 world cities — the camera flies a cinematic
  rise/cruise/descent arc, and the sun shifts to the city's signature hour
  (NYC golden hour, Tokyo neon night, Paris first light).
- **Cinematic tour mode**: fullscreen + letterbox, auto-flies
  Earth → New York → Tokyo → Paris → Rio → space with captions.
- **LOCAL SUN slider** moves the day/night line in real time.
- Bloom post-processing, film grain, vignette, star field with milky-way band.

## Controls

| Input | Action |
|---|---|
| Drag | orbit globe / city |
| Scroll / pinch | zoom (space → street) |
| `/` | focus search |
| `T` | cinematic tour |
| `F` | fullscreen |
| `R` | toggle rotation |
| `Space` | return to space |
| `Esc` | exit tour / close panels |

## Architecture

Plain scripts (file://-safe), Three.js r128 UMD + bloom composer bundled in
`js/lib/` (the only third-party code — a rendering library, not map data).

```
js/core.js        math, seeded simplex noise, geodesy, event bus
js/data/cities.js hand-authored city database + hero-city briefs
js/textures.js    procedural day/night/cloud/spec/bump maps   [system A1]
js/globe.js       earth shader, atmosphere, sky, stars, sun   [system A2]
js/citykit.js     instanced-building/window-shader toolkit    [system B0]
js/city-nyc.js    New York district                           [system B1]
js/city-tokyo.js  Tokyo district                              [system B2]
js/city-paris.js  Paris district                              [system B3]
js/cities.js      district orchestrator (LOD, night uniforms)
js/camera.js      damped orbit controls, flights, floating origin [system C]
js/ui.js          search, tour, HUD, loading                  [system D]
js/main.js        boot, render loop, fog/bloom schedules
```

Built by 8 parallel system agents against `CONTRACT.md` / `CONTRACT-CITIES.md`,
merged and browser-tested by the lead.