/* ============================================================
   BODYCAM: OUTBREAK — post chain + camera rig + bodycam OSD
   window.PostFX / window.CameraRig / window.HUD
   3 fullscreen passes: temporal blur -> grade/lens -> blit.
   ============================================================ */
'use strict';

/* ---------------- PostFX ---------------- */
const PostFX = {
  gl: null, w: 0, h: 0, time: 0,
  prev: null, cur: null, blur: null,
  vao: null, p1: null, p2: null, p3: null,
  bloodTex: null,
  prevYaw: null, prevPitch: null,
  glitchBurst: 0, glitchAmt: 0, glitchSeed: 0,
  quality: 1, exposure: 1,

  init(gl, w, h) {
    if (this.gl) { this.resize(w, h); return; }
    this.gl = gl; this.w = w; this.h = h;
    this._makePrograms();
    // fullscreen triangle
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.bloodTex = Eng.texFromCanvas(this._bloodCanvas(), false);
    this.blur = this._target(w, h);
    this.prev = this._target(w, h);
    this.cur = this._target(w, h);
    this._clearBlack(this.prev);
    this._clearBlack(this.cur);
    this._clearBlack(this.blur);
  },

  // Perf calls this (0..1): scales blur taps / grain / glitch cost
  setQuality(q) { this.quality = clamp(q == null ? 1 : q, 0, 1); },

  resize(w, h) {
    if (!this.gl) return;
    const gl = this.gl;
    this.w = w; this.h = h;
    for (const t of [this.blur, this.prev, this.cur]) {
      if (t) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); }
    }
    this.blur = this._target(w, h);
    this.prev = this._target(w, h);
    this.cur = this._target(w, h);
    this._clearBlack(this.prev);
    this._clearBlack(this.cur);
  },

  _target(w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex };
  },

  _clearBlack(t) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },

  _bloodCanvas() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const x = c.getContext('2d');
    x.clearRect(0, 0, 512, 512);
    const drop = (px, py, r, a) => {
      x.fillStyle = 'rgba(' + (85 + (Math.random() * 45 | 0)) + ',' + (6 + (Math.random() * 10 | 0)) + ',' + (5 + (Math.random() * 8 | 0)) + ',' + a.toFixed(2) + ')';
      x.beginPath(); x.arc(px, py, r, 0, 6.2832); x.fill();
    };
    // spatter clusters biased to the border band
    for (let i = 0; i < 30; i++) {
      const edge = (Math.random() * 4) | 0;
      const band = 85;
      let px, py;
      if (edge === 0) { px = rnd(512); py = rnd(band); }
      else if (edge === 1) { px = rnd(512); py = 512 - rnd(band); }
      else if (edge === 2) { px = rnd(band); py = rnd(512); }
      else { px = 512 - rnd(band); py = rnd(512); }
      const n = 5 + (Math.random() * 14) | 0;
      for (let j = 0; j < n; j++) {
        const gx = px + (Math.random() + Math.random() - 1) * 46;
        const gy = py + (Math.random() + Math.random() - 1) * 46;
        drop(gx, gy, rnd(1.5, 8), rnd(0.2, 0.65));
      }
      drop(px, py, rnd(7, 16), rnd(0.3, 0.55));
    }
    // drips running down from the top edge
    for (let i = 0; i < 8; i++) {
      const px = rnd(20, 492), len = rnd(36, 170), wd = rnd(2, 5);
      x.fillStyle = 'rgba(96,9,7,' + rnd(0.25, 0.5).toFixed(2) + ')';
      x.fillRect(px, 0, wd, len);
      drop(px + wd * 0.5, len, wd * rnd(1.1, 1.9), rnd(0.35, 0.6));
    }
    // heavy corner smears
    const corners = [[0, 0], [512, 0], [0, 512], [512, 512]];
    for (const [cx, cy] of corners) {
      const g = x.createRadialGradient(cx, cy, 8, cx, cy, 190);
      g.addColorStop(0, 'rgba(80,7,6,0.5)');
      g.addColorStop(1, 'rgba(80,7,6,0)');
      x.fillStyle = g;
      x.fillRect(cx - 190, cy - 190, 380, 380);
    }
    return c;
  },

  _shader(type, src) {
    const gl = this.gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('postfx shader: ' + gl.getShaderInfoLog(s));
    return s;
  },

  _program(fsSrc, uniforms, samplers) {
    const gl = this.gl;
    const vs = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUV;
void main(){ vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
    const p = gl.createProgram();
    gl.attachShader(p, this._shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, this._shader(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('postfx link: ' + gl.getProgramInfoLog(p));
    const u = {};
    for (const n of uniforms) u[n] = gl.getUniformLocation(p, n);
    gl.useProgram(p);
    for (const k in samplers) gl.uniform1i(u[k], samplers[k]);
    return { prog: p, u };
  },

  _makePrograms() {
    // pass 1: temporal feedback + 3-tap directional smear
    const fs1 = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 frag;
uniform sampler2D uScene, uPrev;
uniform float uPrevFactor, uMotion, uSmear;
uniform vec2 uMotionVec;
void main(){
  vec2 mv = uMotionVec * uMotion;
  float ml = length(mv);
  if (ml > 0.05) mv *= 0.05 / ml;
  vec3 c0 = texture(uScene, vUV).rgb;
  vec3 cur = c0;
  if (uSmear > 0.02) {
    vec3 c1 = texture(uScene, vUV - mv * 0.5).rgb;
    vec3 c2 = texture(uScene, vUV - mv).rgb;
    vec3 smear = c0 * 0.5 + c1 * 0.3 + c2 * 0.2;
    cur = mix(c0, smear, clamp(uMotion * 1.4, 0.0, 1.0) * uSmear);
  }
  vec3 prev = texture(uPrev, vUV).rgb;
  frag = vec4(mix(cur, prev, uPrevFactor), 1.0);
}`;
    this.p1 = this._program(fs1,
      ['uScene', 'uPrev', 'uPrevFactor', 'uMotion', 'uMotionVec', 'uSmear'],
      { uScene: 0, uPrev: 1 });

    // pass 2: fisheye + CA + compression + grade + grain + damage + state
    const fs2 = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 frag;
uniform sampler2D uBlur, uBlood;
uniform vec2 uRes;
uniform float uAspect, uTime, uMotion, uDamage, uFlash, uFade, uGain, uGlitch, uGlitchSeed;
uniform float uGrain, uGlitchBlocks, uHitT;
uniform vec2 uHitDir;
float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
void main(){
  // --- fisheye barrel distortion (aspect-corrected) ---
  vec2 asp = vec2(uAspect, 1.0);
  vec2 p = (vUV - 0.5) * asp * 0.98;
  float r2 = dot(p, p);
  float distort = 1.0 + 0.42 * r2 + 0.10 * r2 * r2;
  vec2 pc = vec2(0.5 * uAspect, 0.5) * 0.98;
  float rc2 = dot(pc, pc);
  float fit = 1.0 / (1.0 + 0.42 * rc2 + 0.10 * rc2 * rc2);
  vec2 uv = 0.5 + p * distort * fit / asp;
  float r = sqrt(r2);
  vec2 dir = r2 > 1e-5 ? p / r : vec2(0.0);

  // --- macroblock glitch: offset up to 3 random 16x16 blocks ---
  vec2 guv = uv;
  float gFlag = 0.0;
  if (uGlitch > 0.01) {
    vec2 block = floor(vUV * uRes / 16.0);
    for (int i = 0; i < 3; i++) {
      if (float(i) >= uGlitchBlocks) break;
      float fi = float(i);
      vec2 rb = floor(vec2(
        hash21(vec2(uGlitchSeed + fi * 7.13, fi * 3.71)),
        hash21(vec2(fi * 9.21, uGlitchSeed + fi * 5.37))) * (uRes / 16.0));
      if (all(equal(block, rb))) {
        vec2 off = (vec2(hash21(rb + uGlitchSeed), hash21(rb.yx + uGlitchSeed)) - 0.5)
                   * vec2(10.0, 3.0) / uRes;
        guv += off * uGlitch;
        gFlag = 1.0;
      }
    }
  }

  // --- radial chromatic aberration + edge softening (2-tap) ---
  vec2 caOff = dir * (0.0025 * r2) / asp;
  vec3 col;
  col.r = texture(uBlur, guv + caOff).r;
  col.g = texture(uBlur, guv).g;
  col.b = texture(uBlur, guv - caOff).b;
  float edge = smoothstep(0.45, 1.0, r2);
  vec3 soft = texture(uBlur, guv + dir * 0.004 / asp).rgb;
  col = mix(col, soft, edge * 0.55);
  if (gFlag > 0.5) {
    vec3 sm = texture(uBlur, guv + vec2(6.0, 0.0) / uRes).rgb;
    col = mix(col, sm, 0.5);
    col = mix(col, col.brg, 0.3 * uGlitch);
  }

  // --- exposure wobble / dark-scene gain ---
  col *= uGain;

  // --- compression: 8x8 block luma posterize + edge ringing hint ---
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  float dark = 1.0 - clamp(luma, 0.0, 1.0);
  float cStr = clamp(dark * 0.5 + uMotion * 0.3, 0.0, 0.85);
  float levels = mix(24.0, 6.0, cStr);
  float ql = floor(luma * levels + 0.5) / levels;
  vec3 post = clamp(col * (ql / max(luma, 0.004)), 0.0, 2.0);
  col = mix(col, post, cStr);
  vec2 bf = fract(vUV * uRes / 8.0);
  float be = clamp(step(bf.x, 0.12) + step(bf.y, 0.12), 0.0, 1.0);
  col *= 1.0 - 0.035 * cStr * be;

  // --- grade: desat, cool shadows, split tone, S-curve, vignette, lifted blacks ---
  luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(luma), col, 0.72);
  col += (1.0 - luma) * vec3(-0.004, 0.004, 0.015);
  col += luma * vec3(0.010, -0.003, 0.008);
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.55);
  float vig = 1.0 - 0.5 * smoothstep(0.35, 1.05, r);
  col *= vig;
  col = max(col, vec3(0.012, 0.012, 0.014));

  // --- animated grain + scanlines + rare hot pixel (uGrain: toggle x quality) ---
  float gn = hash21(vUV * uRes + vec2(fract(uTime * 13.7) * 1000.0, fract(uTime * 7.31) * 1000.0)) - 0.5;
  col += gn * 2.0 * (0.045 + dark * 0.10) * uGrain;
  col *= 1.0 - 0.015 * (0.5 + 0.5 * sin(vUV.y * uRes.y * 3.14159));
  float hot = hash21(floor(vUV * uRes) + floor(uTime * 24.0) * 7.77);
  col += step(0.999998, hot) * vec3(0.55, 0.5, 0.45) * uGrain;

  // --- damage: red vignette pulse + blood splatter edges, biased to hit side ---
  float pulse = 0.72 + 0.28 * sin(uTime * 2.8);
  float hitAmt = clamp(uHitT, 0.0, 1.0);
  float dmg = clamp(uDamage + hitAmt * 0.3, 0.0, 1.0);
  float rv = smoothstep(0.30, 1.0, r);
  col = mix(col, vec3(0.32, 0.015, 0.015), dmg * pulse * 0.55 * rv);
  vec2 hd = uHitDir * vec2(uAspect, 1.0);
  float hl = length(hd);
  vec2 hdn = hl > 1e-4 ? hd / hl : vec2(0.0);
  vec2 buv = clamp(vUV - hdn * (0.22 * hitAmt), vec2(0.002), vec2(0.998));
  vec4 blood = texture(uBlood, buv);
  col = mix(col, blood.rgb, blood.a * (dmg * 0.9 + hitAmt * 0.7));
  float sideW = smoothstep(-0.1, 0.9, dot(p / max(r, 1e-4), hdn)) * step(1e-4, hl);
  col = mix(col, vec3(0.36, 0.02, 0.02), sideW * rv * hitAmt * 0.55);

  // --- hit flash / fade ---
  col = mix(col, vec3(1.0, 0.86, 0.82), clamp(uFlash, 0.0, 1.0) * 0.85);
  col *= 1.0 - clamp(uFade, 0.0, 1.0);
  frag = vec4(col, 1.0);
}`;
    this.p2 = this._program(fs2,
      ['uBlur', 'uBlood', 'uRes', 'uAspect', 'uTime', 'uMotion', 'uDamage', 'uFlash', 'uFade', 'uGain', 'uGlitch', 'uGlitchSeed', 'uGrain', 'uGlitchBlocks', 'uHitDir', 'uHitT'],
      { uBlur: 0, uBlood: 1 });

    // pass 3: blit final to screen
    const fs3 = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 frag;
uniform sampler2D uTex;
void main(){ frag = vec4(texture(uTex, vUV).rgb, 1.0); }`;
    this.p3 = this._program(fs3, ['uTex'], { uTex: 0 });
  },

  render(sceneTex, dt) {
    if (!this.gl) return;
    const gl = this.gl, w = this.w, h = this.h;
    this.time += dt;
    const post = G.post;
    const motion = clamp(post.motion || 0, 0, 1);
    const q = this.quality;

    // directional damage state (init if missing; rig-side decay ~2.5/s)
    if (!post.hitDir) post.hitDir = [0, 0];
    if (post.hitT == null) post.hitT = 0;
    post.hitT = Math.max(0, post.hitT - dt * 2.5);

    // screen-space motion vector from look deltas x projection
    const cam = Eng.camera;
    if (this.prevYaw === null) { this.prevYaw = cam.yaw; this.prevPitch = cam.pitch; }
    let dy = cam.yaw - this.prevYaw, dp = cam.pitch - this.prevPitch;
    this.prevYaw = cam.yaw; this.prevPitch = cam.pitch;
    const aspect = w / h;
    let mvx = clamp(dy / (cam.fov * aspect), -0.06, 0.06);
    let mvy = clamp(-dp / cam.fov, -0.06, 0.06);

    // glitch bursts: driven by G.post.glitch or rare random trigger (cost scales with quality)
    let glitch = clamp(post.glitch || 0, 0, 1);
    this.glitchBurst -= dt;
    if (this.glitchBurst <= 0 && glitch <= 0 &&
        Math.random() < dt * (0.05 + ((post.damage || 0) > 0.7 ? 0.15 : 0)) * (0.3 + 0.7 * q)) {
      this.glitchBurst = rnd(0.08, 0.28);
      this.glitchAmt = rnd(0.4, 1.0);
      this.glitchSeed = rnd(1000);
    }
    if (this.glitchBurst > 0) glitch = Math.max(glitch, this.glitchAmt);
    glitch *= 0.4 + 0.6 * q;
    const gBlocks = q < 0.05 ? 0 : Math.max(1, Math.round(3 * q));

    // grain toggle from settings (guarded, default on), amplitude scales with quality
    const grainOn = !(G.settings && G.settings.grain === false);
    const grainAmt = grainOn ? 0.55 + 0.45 * q : 0;

    // exposure wobble + dark-scene gain lift (no readbacks)
    const P = G.player;
    let gain = 1 + 0.02 * Math.sin(this.time * 0.7);
    const darkIn = clamp((post.dark || 0) + (P.flashlight ? 0 : 0.45) +
      ((P.zone >= 1 && P.zone <= 4) ? 0.15 : 0), 0, 1);
    gain *= 1 + 0.15 * darkIn;

    // auto-exposure pump: flash dips gain fast (attack), then slow recover
    const flashV = clamp(post.flash || 0, 0, 1);
    const expT = 1 - 0.35 * flashV;
    this.exposure = lerp(this.exposure, expT, clamp(dt * (expT < this.exposure ? 18 : 2.2), 0, 1));
    gain *= this.exposure;

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.depthMask(false);
    gl.bindVertexArray(this.vao);

    // pass 1: temporal motion blur -> blur FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.blur.fb);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.p1.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.prev.tex);
    gl.uniform1f(this.p1.u.uPrevFactor, 0.16 + motion * 0.30);
    gl.uniform1f(this.p1.u.uMotion, motion);
    gl.uniform1f(this.p1.u.uSmear, q);
    gl.uniform2f(this.p1.u.uMotionVec, mvx, mvy);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // pass 2: lens + grade + artifacts -> cur history FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.cur.fb);
    gl.useProgram(this.p2.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.blur.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.bloodTex);
    const u2 = this.p2.u;
    gl.uniform2f(u2.uRes, w, h);
    gl.uniform1f(u2.uAspect, aspect);
    gl.uniform1f(u2.uTime, this.time);
    gl.uniform1f(u2.uMotion, motion);
    gl.uniform1f(u2.uDamage, post.damage || 0);
    gl.uniform1f(u2.uFlash, post.flash || 0);
    gl.uniform1f(u2.uFade, post.fade || 0);
    gl.uniform1f(u2.uGain, gain);
    gl.uniform1f(u2.uGlitch, glitch);
    gl.uniform1f(u2.uGlitchSeed, this.glitchSeed);
    gl.uniform1f(u2.uGrain, grainAmt);
    gl.uniform1f(u2.uGlitchBlocks, gBlocks);
    gl.uniform2f(u2.uHitDir, post.hitDir[0] || 0, post.hitDir[1] || 0);
    gl.uniform1f(u2.uHitT, post.hitT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // pass 3: blit to default framebuffer (engine-bound, canvas viewport)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.p3.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.cur.tex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // cur becomes next frame's prev (no extra copy pass)
    const t = this.prev; this.prev = this.cur; this.cur = t;
    gl.bindVertexArray(null);
  }
};

/* ---------------- CameraRig ---------------- */
const CameraRig = {
  trauma: 0,
  kickP: { x: 0, v: 0 },
  kickY: { x: 0, v: 0 },
  fov: 1.32,
  prevYaw: null, prevPitch: null,
  dead: false, deathT: 0, deathFromY: 1.62, deathFromPitch: 0,
  stepSpring: { x: 0, v: 0 }, stepRoll: 0, stepLat: 0, _lastPulse: 0,
  _prevBaseYaw: null, yawRateSm: 0, strafeLean: 0,
  _pos: [0, 0, 0],

  addShake(x) { this.trauma = Math.min(1.2, this.trauma + x); },
  kick(pitch, yaw) { this.kickP.x += pitch; this.kickY.x += yaw; },

  update(dt) {
    const P = G.player;
    const t = G.time;
    let yaw = P.yaw, pitch = P.pitch, roll = P.roll || 0;
    const px = P.pos[0], py = P.pos[1], pz = P.pos[2];
    let ox = 0, oy = 0, oz = 0;

    // head bob from stepPhase (stride 2.0 walk / 2.6 sprint), scaled by speed
    const spd = clamp(P.speed / 4.6, 0, 1);
    const rv = rightVec(P.yaw);
    if (P.moving && P.speed > 0.1 && G.state === 'play') {
      const stride = P.sprint ? 2.6 : 2.0;
      const s = Math.sin((P.stepPhase || 0) / stride * Math.PI);
      const lat = s * 0.022 * spd;
      ox += rv[0] * lat; oz += rv[2] * lat;
      oy += -s * s * 0.035 * spd;
    }

    // footfall sync: sharp dip spring + stepSide lateral sway + per-step roll impulse
    const pulse = P.stepPulse || 0;
    if (pulse > this._lastPulse + 0.3 && G.state === 'play') {
      const side = P.stepSide || 1;
      this.stepSpring.v -= 0.55;
      this.stepRoll = side * 0.008;
      this.stepLat = side * 0.016 * spd;
    }
    this._lastPulse = pulse;
    P.stepPulse = Math.max(0, pulse - dt * 5);
    const ss = this.stepSpring;
    ss.v += (-110 * ss.x - 13 * ss.v) * dt;
    ss.x += ss.v * dt;
    this.stepRoll = lerp(this.stepRoll, 0, clamp(dt * 9, 0, 1));
    this.stepLat = lerp(this.stepLat, 0, clamp(dt * 7, 0, 1));
    oy += ss.x * (0.6 + 0.4 * spd);
    ox += rv[0] * this.stepLat; oz += rv[2] * this.stepLat;
    roll += this.stepRoll;

    // roll lean: yaw rate (clamped ±0.035) + strafe lean
    if (this._prevBaseYaw === null) this._prevBaseYaw = P.yaw;
    const yawRate = (P.yaw - this._prevBaseYaw) / Math.max(dt, 1e-4);
    this._prevBaseYaw = P.yaw;
    this.yawRateSm = lerp(this.yawRateSm, yawRate, clamp(dt * 10, 0, 1));
    const keys = Eng.input.keys;
    const strafeIn = ((keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)) * (P.moving ? 1 : 0);
    this.strafeLean = lerp(this.strafeLean, -strafeIn * 0.012, clamp(dt * 8, 0, 1));
    if (G.state === 'play') roll += clamp(-this.yawRateSm * 0.03, -0.035, 0.035) + this.strafeLean;

    // breathing micro-drift (+ heavier exhausted sway)
    const ex = P.exhausted ? 0.004 : 0;
    pitch += Math.sin(t * 1.1) * 0.004 + Math.sin(t * 1.35 + 2.0) * ex * 0.7;
    yaw += Math.sin(t * 0.6 + 1.3) * 0.0015;
    oy += Math.sin(t * 0.9) * 0.0025 + Math.sin(t * 1.6 + 0.7) * ex;
    roll += Math.sin(t * 1.15 + 1.2) * ex * 0.8;

    // landing dip (main sets G.player.landDip)
    const dip = P.landDip || 0;
    if (dip > 0) { oy -= dip * 0.09; pitch -= dip * 0.02; }

    // stop-settle dip (main sets stopDip on hard decel; rig settles it out)
    const sd = P.stopDip || 0;
    if (sd > 0) {
      oy -= sd * 0.055; pitch -= sd * 0.014;
      P.stopDip = Math.max(0, sd - dt * 3);
    }

    // grabbed wobble: floor trauma + roll oscillation
    if (P.grabbed > 0) {
      this.trauma = Math.max(this.trauma, 0.35);
      roll += Math.sin(t * 11) * 0.05;
      ox += Math.sin(t * 17.3) * 0.012;
      oy += Math.sin(t * 13.7 + 2.1) * 0.012;
    }
    // struggle oscillation on look (Zombies sets grabWobble)
    if (P.grabWobble) {
      yaw += Math.sin(t * 12.7) * P.grabWobble * 0.06;
      pitch += Math.sin(t * 9.3 + 1.0) * P.grabWobble * 0.04;
    }

    // trauma shake: trauma^2 * smooth noise
    this.trauma = Math.max(0, this.trauma - 1.8 * dt);
    const sh = this.trauma * this.trauma;
    if (sh > 0.0001) {
      const n = (f1, f2, f3) => (Math.sin(t * f1) + Math.sin(t * f2 + 1.7) + Math.sin(t * f3 + 4.1)) / 3;
      ox += n(29.7, 17.3, 41.9) * 0.06 * sh;
      oy += n(33.1, 21.7, 47.3) * 0.06 * sh;
      oz += n(27.3, 19.1, 43.7) * 0.06 * sh;
      roll += n(31.7, 23.3, 39.1) * 0.05 * sh;
      yaw += n(37.9, 25.7, 45.3) * 0.02 * sh;
      pitch += n(35.3, 27.1, 49.7) * 0.02 * sh;
    }

    // recoil kick springs (k=70 d=10)
    const spring = (s) => {
      s.v += (-70 * s.x - 10 * s.v) * dt;
      s.x += s.v * dt;
    };
    spring(this.kickP); spring(this.kickY);
    pitch += this.kickP.x;
    yaw += this.kickY.x;

    // sprint FOV 1.46: attack 8/s, release 3/s
    const fovT = (P.sprint && P.moving && G.state === 'play') ? 1.46 : 1.32;
    this.fov = lerp(this.fov, fovT, clamp(dt * (fovT > this.fov ? 8 : 3), 0, 1));

    // death cam: drop to floor + 0.35, roll 0.55, pitch -0.1 over 1.2 s
    if (G.state === 'dead') {
      if (!this.dead) {
        this.dead = true; this.deathT = 0;
        this.deathFromY = py; this.deathFromPitch = P.pitch;
      }
      this.deathT += dt;
      const k = clamp(this.deathT / 1.2, 0, 1);
      const e = k * k * (3 - 2 * k);
      let floorY = py - 1.62;
      if (window.Level && Level.floorHeight) floorY = Level.floorHeight(px, pz);
      oy = 0; ox = 0; oz = 0;
      const dy = lerp(this.deathFromY, floorY + 0.35, e) - py;
      roll = lerp(roll, 0.55, e);
      pitch = lerp(this.deathFromPitch, -0.1, e);
      this._pos[0] = px; this._pos[1] = py + dy; this._pos[2] = pz;
    } else {
      this.dead = false;
      this._pos[0] = px + ox; this._pos[1] = py + oy; this._pos[2] = pz + oz;
    }

    // write engine camera (reuse arrays)
    const ec = Eng.camera;
    ec.pos[0] = this._pos[0]; ec.pos[1] = this._pos[1]; ec.pos[2] = this._pos[2];
    ec.yaw = yaw; ec.pitch = pitch; ec.roll = roll; ec.fov = this.fov;

    // write G.cam for audio listener / muzzle origin
    const f = fwdVec(yaw, pitch);
    const r = rightVec(yaw);
    const up = V3.cross(r, f);
    const gc = G.cam;
    gc.pos[0] = this._pos[0]; gc.pos[1] = this._pos[1]; gc.pos[2] = this._pos[2];
    gc.fwd[0] = f[0]; gc.fwd[1] = f[1]; gc.fwd[2] = f[2];
    gc.right[0] = r[0]; gc.right[1] = r[1]; gc.right[2] = r[2];
    gc.up[0] = up[0]; gc.up[1] = up[1]; gc.up[2] = up[2];

    // motion metric from look deltas + speed
    if (this.prevYaw === null) { this.prevYaw = yaw; this.prevPitch = pitch; }
    const dYaw = Math.abs(yaw - this.prevYaw), dPitch = Math.abs(pitch - this.prevPitch);
    this.prevYaw = yaw; this.prevPitch = pitch;
    G.post.motion = clamp((dYaw + dPitch) * 8 + P.speed * 0.06, 0, 1);
  }
};

/* ---------------- HUD (bodycam OSD) ---------------- */
const HUD = {
  root: null, els: null,
  radioT: 0, radioDur: 1, toastT: 0, toastDur: 1,
  flickerT: 0, lastSec: -1, lastBatt: -1, lastAmmo: '',
  visible: true,

  init() {
    const hud = document.getElementById('hud');
    if (!hud || this.root) return;
    const root = document.createElement('div');
    root.style.cssText = 'position:absolute;inset:0;pointer-events:none;font-family:"Courier New",Consolas,monospace;' +
      'color:rgba(255,255,255,0.82);text-shadow:0 0 3px rgba(0,0,0,0.9),0 1px 2px rgba(0,0,0,0.7);' +
      'font-size:13px;letter-spacing:1px;user-select:none;';
    hud.appendChild(root);
    this.root = root;

    const mk = (css, parent) => {
      const d = document.createElement('div');
      d.style.cssText = css;
      (parent || root).appendChild(d);
      return d;
    };

    // top-left: REC dot + timestamp
    const tl = mk('position:absolute;top:18px;left:20px;');
    const recRow = mk('display:flex;align-items:center;gap:7px;font-weight:700;font-size:14px;', tl);
    const dot = document.createElement('span');
    dot.style.cssText = 'display:inline-block;width:10px;height:10px;border-radius:50%;background:#ff3b30;box-shadow:0 0 6px rgba(255,59,48,0.9);';
    recRow.appendChild(dot);
    const recTxt = document.createElement('span');
    recTxt.textContent = 'REC';
    recRow.appendChild(recTxt);
    const stamp = mk('margin-top:5px;font-size:12px;opacity:0.75;', tl);
    stamp.textContent = '2026-09-14 02:13:07';

    // top-right: device info
    const tr = mk('position:absolute;top:18px;right:20px;text-align:right;font-size:12px;line-height:1.55;opacity:0.8;', root);
    tr.innerHTML = 'AXON BODY 3<br>X60390142<br>BADGE B-2174';

    // bottom-right: ammo above battery
    const br = mk('position:absolute;bottom:18px;right:20px;text-align:right;', root);
    const ammo = mk('font-size:12px;opacity:0.5;margin-bottom:7px;', br);
    ammo.textContent = '15 | 60';
    const battRow = mk('display:flex;align-items:center;justify-content:flex-end;gap:7px;font-size:12px;', br);
    const battIcon = document.createElement('span');
    battIcon.style.cssText = 'position:relative;display:inline-block;width:26px;height:12px;border:1px solid rgba(255,255,255,0.7);border-radius:2px;padding:1px;box-sizing:border-box;';
    const nub = document.createElement('span');
    nub.style.cssText = 'position:absolute;right:-4px;top:3px;width:3px;height:5px;background:rgba(255,255,255,0.7);border-radius:1px;';
    battIcon.appendChild(nub);
    const bars = [];
    for (let i = 0; i < 4; i++) {
      const bar = document.createElement('span');
      bar.style.cssText = 'display:inline-block;width:4px;height:8px;margin-right:1px;background:rgba(255,255,255,0.8);vertical-align:top;';
      battIcon.appendChild(bar);
      bars.push(bar);
    }
    battRow.appendChild(battIcon);
    const battTxt = document.createElement('span');
    battTxt.textContent = '87%';
    battRow.appendChild(battTxt);

    // bottom-left: objective
    const bl = mk('position:absolute;bottom:18px;left:20px;font-size:12px;color:rgba(212,217,207,0.75);max-width:44vw;line-height:1.5;', root);
    bl.textContent = 'OBJECTIVE: REACH THE ROOFTOP HELIPAD';

    // radio subtitle: bottom-center
    const radio = mk('position:absolute;bottom:64px;left:50%;transform:translateX(-50%);text-align:center;' +
      'font-size:14px;color:#ffe9a8;max-width:70vw;opacity:0;text-shadow:0 0 4px rgba(0,0,0,0.95),0 1px 3px rgba(0,0,0,0.8);', root);

    // toast: center-top
    const toast = mk('position:absolute;top:64px;left:50%;transform:translateX(-50%);text-align:center;' +
      'font-size:13px;color:rgba(235,238,230,0.9);max-width:70vw;opacity:0;', root);

    this.els = { tl, dot, stamp, tr, br, ammo, battTxt, bars, bl, radio, toast };
  },

  setObjective(txt) {
    if (!this.els) return;
    this.els.bl.textContent = /OBJECTIVE/i.test(txt) ? txt : 'OBJECTIVE: ' + txt;
  },

  radio(txt, dur) {
    if (!this.els) return;
    this.els.radio.textContent = txt;
    this.radioDur = dur || 4.5;
    this.radioT = this.radioDur;
    this.els.radio.style.opacity = '1';
  },

  toast(txt, dur) {
    if (!this.els) return;
    this.els.toast.textContent = txt;
    this.toastDur = dur || 2.5;
    this.toastT = this.toastDur;
    this.els.toast.style.opacity = '1';
  },

  setAmmo(mag, res) {
    if (!this.els) return;
    const s = mag + ' | ' + res;
    if (s !== this.lastAmmo) { this.lastAmmo = s; this.els.ammo.textContent = s; }
  },

  setVisible(v) {
    this.visible = v;
    if (!this.els) return;
    const disp = v ? '' : 'none';
    // footage never stops: REC + timestamp always stay
    this.els.tr.style.display = disp;
    this.els.br.style.display = disp;
    this.els.bl.style.display = disp;
    if (!v) {
      this.els.radio.style.opacity = '0';
      this.els.toast.style.opacity = '0';
    }
  },

  update(dt) {
    if (!this.els) return;
    const e = this.els, t = G.time;

    // timestamp advancing with G.time (date fixed)
    const sec = Math.floor(t);
    if (sec !== this.lastSec) {
      this.lastSec = sec;
      const s = 7987 + sec; // 02:13:07
      const hh = String(Math.floor(s / 3600) % 24).padStart(2, '0');
      const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      e.stamp.textContent = '2026-09-14 ' + hh + ':' + mm + ':' + ss;
    }

    // battery: 87% draining 0.1% per 10 s
    const pct = Math.max(5, Math.floor(87 - t * 0.01));
    if (pct !== this.lastBatt) {
      this.lastBatt = pct;
      e.battTxt.textContent = pct + '%';
      const filled = Math.ceil(pct / 25);
      for (let i = 0; i < 4; i++) e.bars[i].style.opacity = i < filled ? '1' : '0.15';
    }

    // REC blink ~1 Hz
    e.dot.style.opacity = (t % 1) < 0.55 ? '1' : '0.12';

    // ammo only while playing
    e.ammo.style.display = G.state === 'play' ? '' : 'none';

    // radio / toast timers with short fade-out
    if (this.radioT > 0) {
      this.radioT -= dt;
      e.radio.style.opacity = String(clamp(this.radioT / 0.4, 0, 1));
    }
    if (this.toastT > 0) {
      this.toastT -= dt;
      e.toast.style.opacity = String(clamp(this.toastT / 0.4, 0, 1));
    }

    // rare whole-OSD opacity flicker (sensor feel)
    if (this.flickerT > 0) {
      this.flickerT -= dt;
      this.root.style.opacity = String(rnd(0.5, 0.8));
    } else {
      this.root.style.opacity = '1';
      if (Math.random() < dt * 0.06) this.flickerT = rnd(0.05, 0.18);
    }
  }
};

window.PostFX = PostFX;
window.CameraRig = CameraRig;
window.HUD = HUD;