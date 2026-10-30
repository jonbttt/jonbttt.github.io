/* ────────────────────────────────────────────────────────────────────────────
   The booster pack: a real 3D pillow pack you can spin, then slice open.

   Mechanics and timings are matched frame by frame to a 60 fps recording of
   Pokémon TCG Pocket:
     select    the pack floats over a glossy floor; drag anywhere to turn it
               (it resists toward edge-on, never shows its back, and springs
               back to face you); tap it to open
     open      it zooms into a close-up; trace the seal from anywhere, either
               way; the stage dims while you cut and the cut-away corner peels
               back on its hinge; lifting early runs the line back and resets
     complete  bloom, an edge-to-edge streak, the strip is thrown clear, a beat
               with the pack held open, then it drops as the first card rises
     hand-off  the card glides into the carousel's front slot

   The geometry is measured from a front-on photo of the real Bloomburrow
   Collector Booster: its silhouette, the crimp bands, and the 3.6% pinch where
   the puffed body pulls in from the sealed edges. Because the texture is a
   photo of the already-puffed pack, projecting it straight onto the puffed mesh
   reproduces the photo head-on and gives true parallax as it turns.

   Needs THREE r160 (classic build) and window.PackHandoff from index.html.
──────────────────────────────────────────────────────────────────────────── */
(function () {
'use strict';

const $ = (id) => document.getElementById(id);
const root = $('screen-pack'), canvas = $('pack-canvas'), envEl = $('pack-env'),
      dimEl = $('pack-dim'), introEl = $('pack-intro'),
      traceEl = $('pack-trace'), btn = $('pack-open-btn'), fallbackImg = $('pack-fallback');
if (!root || !canvas) return;

/* ── The pack ──────────────────────────────────────────────────────────── */
const ASPECT = 729 / 1376;             // width / height of the sealed pack
const PACK_W = 1;
const PACK_H = PACK_W / ASPECT;
const CUT_V  = 0.105;                  // the seal cut: below the crimp, above "15 CARDS"
const CUT_Y  = (0.5 - CUT_V) * PACK_H;
const STRIP_CY = (0.5 - CUT_V / 2) * PACK_H;
const BULGE  = 0.08;                   // puff of each face, in pack widths
const EPS    = 0.0035;                 // the crimps are flat; keep the two sheets apart
// silhouette width ÷ crimp width, sampled top → bottom from the pack image,
// kept a pixel or two inside it
const PROFILE = [0.9945, 0.9945, 0.9945, 0.9945, 0.9863, 0.9698, 0.9588, 0.9561, 0.9561, 0.9561, 0.9561,
  0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561,
  0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561,
  0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561,
  0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561, 0.9561,
  0.9561, 0.9561, 0.9561, 0.9588, 0.9698, 0.9863, 0.9945, 0.9945, 0.9945, 0.9945];

const CARD_W = 0.84, CARD_H = CARD_W * 1040 / 745;
const CARD_Y0 = CUT_Y - 0.06 * CARD_H - CARD_H / 2;   // waiting inside, just under the lip
const CARD_Y1 = CUT_Y + 0.30 * CARD_H - CARD_H / 2;   // risen out
const FOV = 30, CAM_Z = 7, TAU = Math.PI * 2;
// The turn rubber-bands toward this limit (~66°), so the back never faces you.
const YAW_LIMIT = 1.15;
const rubber = (x) => Math.sign(x) * YAW_LIMIT * (1 - Math.exp(-Math.abs(x) / YAW_LIMIT));
const unrubber = (y) => -Math.sign(y) * YAW_LIMIT * Math.log(1 - Math.min(Math.abs(y), YAW_LIMIT * 0.98) / YAW_LIMIT);

/* ── Timings, read off a 60 fps recording of TCG Pocket (ms) ───────────── */
const T = {
  intro: 820,        // the pack's first arrival
  toOpen: 620,       // select → close-up (22.8 → 23.4 s)
  dimIn: 500, dimOut: 250,
  retract: 200,      // early release: the line runs back to where it began
  relax: 300,        // ...and the peeled corner settles flat
  bloom: 33,         // completion bloom peaks in one frame
  streak: 200,       // then the edge-to-edge streak
  detach: 233,       // the strip leaves
  fly: 560,          // and is off the top corner
  drop: 900,         // the open pack holds still, then drops...
  dropDur: 220,
  riseDur: 220,      // ...as the first card rises out of it
  beat: 380,         // the card rests before moving on
  handoff: 560,
  hintIdle: 5000,    // "Trace line to open" after ~5 s idle
  glintEvery: 3400, glintDur: 520,
};

/* ── Small helpers ─────────────────────────────────────────────────────── */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const now = () => performance.now();
const E = {
  linear: (t) => t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inQuad: (t) => t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

function profileAt(v) {
  const f = clamp(v, 0, 1) * (PROFILE.length - 1), i = Math.floor(f), t = f - i;
  const a = PROFILE[i], b = PROFILE[Math.min(i + 1, PROFILE.length - 1)];
  return a + (b - a) * t;
}
const halfWidth = (v) => 0.5 * PACK_W * profileAt(v);
const HW_CUT = halfWidth(CUT_V);
const START_ZONE = 0.2;   // share of the seal at each end that a cut can start from
// puff across the width: steep at the folds, flat across the face
const sx = (s) => Math.pow(Math.max(0, 1 - Math.pow(Math.abs(s), 2.4)), 0.6);
// puff down the height: nothing in the crimps, full across the body
const sy = (v) => smooth(0.052, 0.12, v) * (1 - smooth(0.88, 0.948, v));
const bulge = (s, v) => BULGE * sx(s) * sy(v);

/* ── Tweens ────────────────────────────────────────────────────────────── */
const tweens = new Set();
function tween(ms, fn, { ease = E.outCubic, delay = 0, tag = null } = {}) {
  return new Promise((resolve) => {
    tweens.add({ start: now() + delay, ms, fn, ease, tag, resolve });
  });
}
function cancel(tag) { for (const tw of tweens) if (tw.tag === tag) tweens.delete(tw); }
function runTweens(t) {
  for (const tw of tweens) {
    if (t < tw.start) continue;
    const raw = tw.ms <= 0 ? 1 : clamp((t - tw.start) / tw.ms, 0, 1);
    tw.fn(tw.ease(raw), raw);
    if (raw >= 1) { tweens.delete(tw); tw.resolve(); }
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── State ─────────────────────────────────────────────────────────────── */
const S = {
  stage: 'boot',     // boot · select · toOpen · open · cutting · opening · handoff · done
  yaw: -0.7, pitch: 0, yawV: 0, pitchV: 0, yawTarget: 0, dragYaw: 0,
  dragging: false, moved: 0, downT: 0, lastX: 0, lastY: 0, lastT: 0,
  hoverYaw: 0, hoverPitch: 0, hoverYawT: 0, hoverPitchT: 0,
  frame: { s: 1, y: 0 }, idleW: 1, reflect: 1,
  rx: 0, ry: 0, floorY: -10,
  cut: { min: 0, max: 0, tip: 0, x0: 0, lastTick: 0, firstFree: 0 },
  hintTimer: 0, lastGlint: 0, glintDir: 1, raf: 0,
  reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
};
let vw = innerWidth, vh = innerHeight;
let renderer, scene, camera, stage, packGroup, strip, stripPivot, body, stripRefl, bodyRefl;
let card, bloom, streak, slitRibbon, glowRibbon;
const F = { select: null, open: null };
const TEX = {};

/* ── Shaders ───────────────────────────────────────────────────────────── */
const GLSL_RAINBOW = `
  vec3 rainbow(float t) { return 0.5 + 0.5 * cos(6.2831853 * (t + vec3(0.0, 0.33, 0.67))); }`;

const PACK_VS = `
  attribute float aSide;
  uniform float uIsStrip, uReflect, uFloorY;
  uniform float uCutY, uHW, uPeelSide, uPeelTip, uPeelLen, uPeelAmt, uPeelMax;
  uniform float uCutMin, uCutMax, uCutOn, uMouth;
  varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying float vSide;

  // How far each column of the strip has folded back on its hinge. A free
  // corner (the cut has reached that edge) peels most at the edge and eases to
  // nothing at the tip; a cut wholly inside the pack can only lift a little.
  float peelAngle(float x) {
    if (uPeelAmt <= 0.0001) return 0.0;
    if (uPeelSide < -0.5) {
      float f = clamp((uPeelTip - x) / max(uPeelTip + uHW, 1e-3), 0.0, 1.0);
      return pow(f, 1.7) * uPeelMax * uPeelLen * uPeelAmt;
    }
    if (uPeelSide > 0.5) {
      float f = clamp((x - uPeelTip) / max(uHW - uPeelTip, 1e-3), 0.0, 1.0);
      return pow(f, 1.7) * uPeelMax * uPeelLen * uPeelAmt;
    }
    float span = uCutMax - uCutMin;
    if (span < 1e-3 || x < uCutMin || x > uCutMax) return 0.0;
    return 0.16 * sin(3.14159265 * (x - uCutMin) / span) * uPeelMax * uPeelAmt;
  }

  void main() {
    vec3 p = position; vec3 n = normal;
    vUv = uv; vSide = aSide;
    if (uIsStrip > 0.5) {
      float th = peelAngle(p.x);
      float inCut = uCutOn * smoothstep(uCutMin - 0.02, uCutMin + 0.006, p.x)
                           * (1.0 - smoothstep(uCutMax - 0.006, uCutMax + 0.02, p.x));
      float dy = p.y - uCutY, dz = p.z, c = cos(th), s = sin(th);
      p.y = uCutY + dy * c + dz * s + inCut * 0.009;   // backward fold: top goes away
      p.z = -dy * s + dz * c - inCut * 0.003;
      n = vec3(n.x, n.y * c + n.z * s, -n.y * s + n.z * c);
    } else if (uMouth > 0.0) {
      // once the strip has gone the mouth opens and the lip goes wavy
      float top = 1.0 - smoothstep(0.0, 0.18, uCutY - p.y);
      float wave = sin(p.x * 9.0 + 1.3) * 0.6 + sin(p.x * 19.0 - 0.4) * 0.3;
      p.z += uMouth * top * top * (aSide < 0.5 ? 1.0 : -1.0) * 0.05;
      p.y += uMouth * top * top * top * wave * 0.012;
    }
    vec4 w = modelMatrix * vec4(p, 1.0);
    vec3 wn = normalize(mat3(modelMatrix) * n);
    if (uReflect > 0.5) { w.y = 2.0 * uFloorY - w.y; wn.y = -wn.y; }
    vW = w.xyz; vN = wn;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const PACK_FS = `
  uniform sampler2D tFront, tBack;
  uniform float uIsStrip, uReflect, uFloorY, uReflAlpha, uSheen, uRim, uCutV;
  uniform vec3 uLight;
  varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying float vSide;
  ${GLSL_RAINBOW}
  void main() {
    // the mirror image flips winding, so it flips which side faces out
    bool outward = (gl_FrontFacing == (uReflect < 0.5));
    vec3 N = normalize(vN); if (!outward) N = -N;
    vec3 V = normalize(cameraPosition - vW);
    vec3 col;
    if (outward) {
      vec3 base = vSide < 0.5 ? texture2D(tFront, vUv).rgb
                              : texture2D(tBack, vec2(1.0 - vUv.x, vUv.y)).rgb;
      // the heat-sealed crimps are ridged; the ridges catch the light
      float crimp = 1.0 - smoothstep(0.052, 0.07, vUv.y) + smoothstep(0.93, 0.948, vUv.y);
      vec3 Np = normalize(N + vec3(sin(vUv.x * 540.0) * 0.30 * crimp, 0.0, 0.0));
      float ndl = max(dot(Np, uLight), 0.0);
      vec3 H = normalize(uLight + V);
      float lum = dot(base, vec3(0.299, 0.587, 0.114));
      float foil = 0.25 + 0.75 * smoothstep(0.55, 0.92, lum);   // pale foil shimmers most
      float spec = pow(max(dot(Np, H), 0.0), 36.0) * (0.22 + 0.48 * foil);
      float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.5);
      vec3 irid = rainbow(dot(N, V) * 1.3 + vUv.y * 0.9 + vUv.x * 0.25 + uSheen) * foil;
      col = base * (0.70 + 0.42 * ndl) + spec + irid * (0.06 + 0.18 * fres);
    } else {
      // the inside of the foil: bare silver, mostly in shadow
      col = vec3(0.60, 0.61, 0.66) * (0.28 + 0.36 * max(dot(N, uLight), 0.0));
    }
    // the freshly cut lip glows once the strip has gone
    float rim = uRim * (1.0 - uIsStrip) * exp(-max(vUv.y - uCutV, 0.0) / 0.006);
    col += vec3(0.62, 0.92, 1.0) * rim * 0.9;
    float a = 1.0;
    if (uReflect > 0.5) {
      float below = uFloorY - vW.y;
      a = uReflAlpha * exp(-below * 2.6) * smoothstep(0.0, 0.05, below);
    }
    gl_FragColor = vec4(col, a);
  }`;

const RIBBON_VS = `
  attribute vec2 aLoc;
  varying vec2 vL;
  void main() { vL = aLoc; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const GLSL_SEG = `
  float seg(vec2 p, float a, float b) { float x = clamp(p.x, a, b); return length(vec2(p.x - x, p.y)); }`;

// Normal-blended pass, drawn on the foil. Additive light can't show against
// near-white foil (white + white saturates), so here the cut is solid colour:
// a white-hot core, a lime body, and a dark lip where the foil has parted,
// over a lime cast. Also the printed guide line.
const SLIT_FS = `
  uniform float uMin, uMax, uGlow, uGuide, uHW;
  varying vec2 vL;
  ${GLSL_SEG}
  vec4 over(vec4 top, vec4 bot) {
    float a = top.a + bot.a * (1.0 - top.a);
    return vec4((top.rgb * top.a + bot.rgb * bot.a * (1.0 - top.a)) / max(a, 1e-4), a);
  }
  void main() {
    float inside = 1.0 - smoothstep(uHW - 0.006, uHW + 0.002, abs(vL.x));
    vec4 o = vec4(vec3(0.97, 0.70, 0.08), exp(-pow(vL.y / 0.0058, 2.0)) * inside * uGuide * 0.96);
    if (uGlow > 0.001 && uMax >= uMin) {
      float d = seg(vL, uMin, uMax);
      vec3 lime = vec3(0.80, 0.97, 0.36);
      o = over(vec4(lime, exp(-max(d - 0.032, 0.0) / 0.024) * 0.38 * inside * uGlow), o);
      float core = 1.0 - smoothstep(0.010, 0.016, d);
      float body = 1.0 - smoothstep(0.022, 0.027, d);
      float lip  = (1.0 - smoothstep(0.026, 0.038, d)) * 0.85;   // a shadow, not an outline
      vec3 c = mix(mix(vec3(0.22, 0.28, 0.09), lime, body), vec3(1.0), core);
      // past the pack edges there's no foil to part, so no dark lip
      o = over(vec4(c, lip * mix(body, 1.0, inside) * uGlow), o);
    }
    gl_FragColor = o;
  }`;

// Additive pass: the light that spills past the pack onto the dark page, a
// flare at the fingertip, the guide's halo, and the glint that runs along it.
const GLOW_FS = `
  uniform float uMin, uMax, uTip, uGlow, uGuide, uGlintX, uGlint, uHW;
  varying vec2 vL;
  ${GLSL_SEG}
  void main() {
    vec3 col = vec3(0.0);
    float inside  = 1.0 - smoothstep(uHW - 0.004, uHW + 0.03, abs(vL.x));
    float outside = smoothstep(uHW - 0.004, uHW + 0.006, abs(vL.x));
    if (uGlow > 0.001 && uMax >= uMin) {
      float d = seg(vL, uMin, uMax);
      vec3 lime = vec3(0.86, 0.98, 0.52);
      float halo = exp(-max(d - 0.026, 0.0) / 0.03) * 0.6;
      float hot  = exp(-length(vL - vec2(uTip, 0.0)) / 0.05) * 0.5;
      col += (lime * halo * outside + (vec3(0.6) + lime * 0.3) * hot) * uGlow;
    }
    float gh = exp(-abs(vL.y) / 0.011) * (1.0 - smoothstep(uHW, uHW + 0.07, abs(vL.x))) * 0.3 * outside;
    col += vec3(0.70, 0.92, 1.0) * gh * uGuide;
    float gl = exp(-pow((vL.x - uGlintX) / 0.055, 2.0) - pow(vL.y / 0.014, 2.0));
    col += vec3(1.0, 0.98, 0.9) * gl * uGlint * inside * 1.2;
    gl_FragColor = vec4(col, 0.0);
  }`;

const QUAD_VS = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// The completion bloom: an elliptical white burst with a prismatic rim.
const BLOOM_FS = `
  uniform float uA; varying vec2 vUv;
  ${GLSL_RAINBOW}
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float e = length(p);
    float core = exp(-e * e * 2.2);
    float ring = exp(-pow((e - 0.82) / 0.08, 2.0));
    vec3 prism = rainbow(atan(p.y, p.x) / 6.2831853 + e * 0.6);
    float win = 1.0 - smoothstep(0.6, 1.0, e);   // reach zero inside the quad, or its edge shows
    gl_FragColor = vec4((vec3(1.0) * core * 2.2 + prism * ring * 0.3) * uA * win, 0.0);
  }`;

// The streak: a white band across the whole screen with chromatic fringes.
const STREAK_FS = `
  uniform float uA; varying vec2 vUv;
  ${GLSL_RAINBOW}
  void main() {
    float y = (vUv.y - 0.5) * 2.0;
    float core = exp(-pow(y / 0.40, 2.0));
    float fr = exp(-pow((abs(y) - 0.74) / 0.12, 2.0));
    vec3 prism = rainbow(y * 0.85 + 0.12);
    float xf = 1.0 - smoothstep(0.47, 0.5, abs(vUv.x - 0.5));
    gl_FragColor = vec4((vec3(1.0) * core * 1.35 + prism * fr * 0.65) * uA * xf, 0.0);
  }`;

// The card: same corner radius as the carousel's .c-face (border-radius 4.5%).
const CARD_FS = `
  uniform sampler2D tCard; uniform vec2 uR; varying vec2 vUv;
  void main() {
    vec2 q = max(abs(vUv - 0.5) - (0.5 - uR), 0.0) / uR;
    if (dot(q, q) > 1.0) discard;
    gl_FragColor = vec4(texture2D(tCard, vUv).rgb, 1.0);
  }`;

// The backdrop: a seamless cove (floor curving up into the wall) under one soft
// light from above, like a product shot. The pack's shadow is worked out here
// too, from its footprint on the floor, so it turns as the pack turns.
const COVE_VS = `
  varying vec3 vP; varying vec3 vN;
  void main() {
    vP = position; vN = normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const COVE_FS = `
  uniform vec3 uBg, uLit, uLightPos;
  uniform float uYaw, uLift, uShadow, uDim, uA;
  varying vec3 vP; varying vec3 vN;
  void main() {
    vec3 n = normalize(vN), L = uLightPos - vP;
    float d = length(L); L /= d;
    float cone = smoothstep(0.30, 0.95, dot(-L, vec3(0.0, -1.0, 0.0)));
    float I = max(dot(n, L), 0.0) * cone * 9.0 / (1.0 + d * d);
    vec3 col = mix(uBg, uLit, clamp(I, 0.0, 1.0));
    // the shadow: a soft slab the width of the pack, softer the higher it floats
    float c = cos(uYaw), s = sin(uYaw);
    vec2 q = vec2(vP.x * c - vP.z * s, vP.x * s + vP.z * c);
    float soft = 1.0 + uLift * 6.0;
    float sh = exp(-pow(abs(q.x) / (0.50 * soft), 3.0) - pow(q.y / (0.16 * soft), 2.0));
    col = mix(col, uBg * 0.6, sh * uShadow * smoothstep(0.5, 0.9, n.y) / soft);
    col *= 1.0 - 0.55 * uDim;
    // dark gradients band in 8 bits; a little noise hides the steps
    col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    gl_FragColor = vec4(col * uA, uA);   // drawn unblended, so premultiplied by hand
  }`;

/* ── Uniforms ──────────────────────────────────────────────────────────── */
let U, G, B, St, C;

function packMaterial(isStrip, reflect) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, {
      uIsStrip: { value: isStrip ? 1 : 0 },
      uReflect: { value: reflect ? 1 : 0 },
    }),
    vertexShader: PACK_VS,
    fragmentShader: PACK_FS,
    side: THREE.DoubleSide,
    transparent: reflect,
    depthWrite: !reflect,
  });
}

// Adds light without touching the canvas alpha, so glows pile onto the page
// behind the transparent canvas instead of blacking it out.
function additive(params) {
  return new THREE.ShaderMaterial(Object.assign({
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  }, params));
}

/* ── Geometry ──────────────────────────────────────────────────────────── */
// Front and back sheets between v0 and v1, meeting at the folds and crimps.
function buildSheets(v0, v1, rows, cols) {
  const n = (rows + 1) * (cols + 1);
  const pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), side = new Float32Array(n * 2);
  const idx = [];
  let p = 0, q = 0, r = 0;
  for (let sheet = 0; sheet < 2; sheet++) {
    const base = sheet * n;
    for (let j = 0; j <= rows; j++) {
      const v = v0 + (v1 - v0) * j / rows;
      const hw = halfWidth(v), y = (0.5 - v) * PACK_H;
      for (let i = 0; i <= cols; i++) {
        const s = Math.sin((i / cols - 0.5) * Math.PI), x = s * hw;   // denser at the folds
        const t = Math.max(bulge(s, v), EPS);
        pos[p++] = x; pos[p++] = y; pos[p++] = sheet ? -t : t;
        uv[q++] = 0.5 + x / PACK_W; uv[q++] = v;       // planar: the photo was taken head-on
        side[r++] = sheet;
      }
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = base + j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
        if (sheet === 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A band along the seal hugging the front face, running past both edges so
// the glow can spill off the pack.
function buildRibbon(xExt, half, cols) {
  const pos = [], loc = [], idx = [];
  for (let i = 0; i <= cols; i++) {
    const x = -xExt + 2 * xExt * i / cols;
    const s = clamp(x / HW_CUT, -1, 1);
    const z = (Math.abs(x) < HW_CUT ? Math.max(bulge(s, CUT_V), EPS) : EPS) + 0.007;
    pos.push(x, CUT_Y - half, z, x, CUT_Y + half, z);
    loc.push(x, -half, x, half);
  }
  for (let i = 0; i < cols; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aLoc', new THREE.Float32BufferAttribute(loc, 2));
  g.setIndex(idx);
  return g;
}

// The cove's profile swept across x: floor from the front, a quarter-circle,
// then the wall. Floor at y = 0 under the pack, the pack at z = 0.
function buildCove() {
  const prof = [], R = 1.3, zBack = -1.0;
  for (let i = 0; i <= 10; i++) prof.push([0, 7 - i * (7 - zBack) / 10, 0, 1]);
  for (let i = 1; i <= 24; i++) {
    const a = (i / 24) * Math.PI / 2;
    prof.push([R - R * Math.cos(a), zBack - R * Math.sin(a), Math.sin(a), Math.cos(a)]);
  }
  for (let i = 1; i <= 8; i++) prof.push([R + i * 1.5, zBack - R, 1, 0]);
  const pos = [], nor = [], idx = [], X = 14;
  prof.forEach(([y, z, nz, ny]) => {
    pos.push(-X, y, z, X, y, z);
    nor.push(0, ny, nz, 0, ny, nz);
  });
  for (let i = 0; i < prof.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/* ── Loading ───────────────────────────────────────────────────────────── */
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}
function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img); img.onerror = rej; img.src = src;
  });
}
// Over http(s) the images load normally. Opened straight from disk, Chrome
// refuses to upload local images to WebGL, so the textures come embedded.
async function loadArt() {
  let src = { packFront: 'img/pack-front.jpg', packBack: 'img/pack-back.jpg', card: 'img/card-1-gl.jpg' };
  if (location.protocol === 'file:') {
    if (!window.PACK_ASSETS) await loadScript('js/pack-assets.js');
    src = window.PACK_ASSETS;
  }
  const [packFront, packBack, cardImg] = await Promise.all([src.packFront, src.packBack, src.card].map(loadImage));
  return { packFront, packBack, cardImg };
}
function texture(img, flipY) {
  const t = new THREE.Texture(img);
  t.flipY = flipY;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/* ── Layout ────────────────────────────────────────────────────────────── */
// world units per CSS pixel for something at depth z
const upp = (z = 0) => 2 * (CAM_Z - z) * Math.tan(FOV * Math.PI / 360) / vh;

function framingFor(stage) {
  let hPx, cy;
  if (stage === 'select') {
    const top = introEl.offsetTop + introEl.offsetHeight + Math.max(22, vh * 0.035);
    const bottom = btn.offsetTop - Math.max(18, vh * 0.025);
    // pack + its floor gap + room for the reflection
    hPx = Math.max(160, Math.min(vh * 0.46, vw * 0.58 / ASPECT, (bottom - top) / 1.24));
    cy = top + hPx / 2;
  } else {
    // the close-up: big, sunk low, the bottom fifth off-screen (as in TCG Pocket)
    hPx = Math.min(vh * 0.70, vw * 0.80 / ASPECT);
    cy = vh * 0.43 + hPx / 2;
  }
  const u = upp(0), s = hPx * u / PACK_H, y = (vh / 2 - cy) * u;
  return { s, y, hPx, cy, top: cy - hPx / 2, floorY: y - (PACK_H / 2) * s - 0.055 * PACK_H * s };
}

function placeTrace() { traceEl.style.top = Math.max(vh * 0.1, F.open.top - vh * 0.14) + 'px'; }

function layout() {
  vw = innerWidth; vh = innerHeight;
  renderer.setSize(vw, vh, false);
  camera.aspect = vw / vh;
  camera.updateProjectionMatrix();
  F.select = framingFor('select');
  F.open = framingFor('open');
  S.floorY = F.select.floorY;
  if (S.stage === 'select') { S.frame.s = F.select.s; S.frame.y = F.select.y; }
  if (S.stage === 'open' || S.stage === 'cutting') { S.frame.s = F.open.s; S.frame.y = F.open.y; }
  placeTrace();
}

/* ── Projection helpers ────────────────────────────────────────────────── */
const _v = new THREE.Vector3();
function toScreen(x, y, z, obj) {
  _v.set(x, y, z);
  if (obj) _v.applyMatrix4(obj.matrixWorld);
  _v.project(camera);
  return { x: (_v.x * 0.5 + 0.5) * vw, y: (-_v.y * 0.5 + 0.5) * vh };
}
function hitPack(px, py) {
  packGroup.updateMatrixWorld(true);
  const pts = [[-0.5, 1], [0.5, 1], [-0.5, -1], [0.5, -1]]
    .map(([x, k]) => toScreen(x * PACK_W, k * PACK_H / 2, 0, packGroup));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const m = 14;
  return px >= Math.min(...xs) - m && px <= Math.max(...xs) + m &&
         py >= Math.min(...ys) - m && py <= Math.max(...ys) + m;
}
function cutEdgesPx() {
  packGroup.updateMatrixWorld(true);
  const L = toScreen(-HW_CUT, CUT_Y, EPS, packGroup), R = toScreen(HW_CUT, CUT_Y, EPS, packGroup);
  return { xl: L.x, xr: R.x };
}
// Any pointer x maps onto the seal: left of the pack is its left edge, right
// of it its right edge. Height doesn't matter — slice from anywhere.
function pxToCutX(px) {
  const e = cutEdgesPx();
  return lerp(-HW_CUT, HW_CUT, clamp((px - e.xl) / (e.xr - e.xl), 0, 1));
}

/* ── Stage effects ─────────────────────────────────────────────────────── */
function setDim(on, ms) {
  const d = (ms != null ? ms : on ? T.dimIn : T.dimOut) + 'ms';
  dimEl.style.transitionDuration = d;
  dimEl.style.opacity = on ? '0.55' : '0';
  const d0 = C.uDim.value;
  cancel('dim');
  tween(parseFloat(d), (k) => { C.uDim.value = lerp(d0, on ? 1 : 0, k); }, { ease: E.linear, tag: 'dim' });
}
function armHint() {
  clearTimeout(S.hintTimer);
  S.hintTimer = setTimeout(() => { if (S.stage === 'open') traceEl.classList.add('is-on'); }, T.hintIdle);
}
function hideHint() { traceEl.classList.remove('is-on'); }
function haptic(p) { try { if (navigator.vibrate && !S.reduced) navigator.vibrate(p); } catch (_) {} }

function glint(dir, delay = 0) {
  S.lastGlint = now() + delay;
  S.glintDir = dir;
  tween(T.glintDur, (k, raw) => {
    G.uGlintX.value = lerp(-dir * (HW_CUT + 0.06), dir * (HW_CUT + 0.06), raw);
    G.uGlint.value = Math.sin(Math.PI * raw);
  }, { ease: E.linear, delay, tag: 'glint' });
}

/* ── Select → open ─────────────────────────────────────────────────────── */
function goOpen() {
  if (S.stage !== 'select') return;
  S.stage = 'toOpen';
  S.dragging = false;
  root.classList.remove('is-grabbing');
  root.classList.add('is-open');
  root.style.cursor = '';
  introEl.style.opacity = '0';
  btn.classList.add('is-sr');
  haptic(8);
  const from = { s: S.frame.s, y: S.frame.y, yaw: S.yaw, pitch: S.pitch };
  const yawTo = 0;
  const to = F.open;
  tween(S.reduced ? 1 : T.toOpen, (k) => {
    S.frame.s = lerp(from.s, to.s, k);
    S.frame.y = lerp(from.y, to.y, k);
    S.yaw = lerp(from.yaw, yawTo, k);
    S.pitch = lerp(from.pitch, 0, k);
    S.reflect = 1 - k; S.idleW = 1 - k;
  }, { ease: E.outCubic }).then(() => {
    S.yaw = 0; S.yawTarget = 0; S.yawV = 0; S.pitchV = 0;
    stripRefl.visible = bodyRefl.visible = false;
    S.stage = 'open';
    placeTrace();
    tween(220, (k) => { G.uGuide.value = k; });
    glint(1, 320);
    armHint();
  });
}

/* ── The cut ───────────────────────────────────────────────────────────── */
function syncCut() {
  const c = S.cut;
  U.uCutMin.value = G.uMin.value = c.min;
  U.uCutMax.value = G.uMax.value = c.max;
  G.uTip.value = c.tip;
  const freeL = c.min <= -HW_CUT + 1e-4, freeR = c.max >= HW_CUT - 1e-4;
  if (!c.firstFree) c.firstFree = freeL ? -1 : freeR ? 1 : 0;
  U.uPeelSide.value = c.firstFree;
  if (c.firstFree === -1) {
    U.uPeelTip.value = c.max;
    U.uPeelLen.value = smooth(0, 0.45, (c.max + HW_CUT) / (2 * HW_CUT));
  } else if (c.firstFree === 1) {
    U.uPeelTip.value = c.min;
    U.uPeelLen.value = smooth(0, 0.45, (HW_CUT - c.min) / (2 * HW_CUT));
  }
}

// As in TCG Pocket, a cut only starts at either end of the seal. A press near
// an end, or off the pack beyond it, latches onto that end; a press in the
// middle does nothing.
function startCut(px) {
  const x = pxToCutX(px), zone = START_ZONE * 2 * HW_CUT;
  const side = x <= -HW_CUT + zone ? -1 : x >= HW_CUT - zone ? 1 : 0;
  if (!side) return false;
  S.stage = 'cutting';
  root.classList.add('is-cutting');
  cancel('retract'); cancel('peel'); cancel('glow'); cancel('glint');
  G.uGlint.value = 0;
  hideHint();
  clearTimeout(S.hintTimer);
  const c = S.cut, edge = side * HW_CUT;
  c.x0 = c.lastTick = edge;
  c.min = Math.min(edge, x); c.max = Math.max(edge, x); c.tip = x;
  c.firstFree = 0;
  U.uCutOn.value = 1;
  syncCut();
  setDim(true);
  const g0 = G.uGlow.value, p0 = U.uPeelAmt.value;
  tween(90, (k) => { G.uGlow.value = lerp(g0, 1, k); }, { tag: 'glow' });
  tween(160, (k) => { U.uPeelAmt.value = lerp(p0, 1, k); }, { tag: 'peel' });
  haptic(6);
  return true;
}

function moveCut(px) {
  const c = S.cut, x = pxToCutX(px);
  c.tip = x;
  if (x < c.min) c.min = x;
  if (x > c.max) c.max = x;
  if (Math.abs(x - c.lastTick) > 0.09) { haptic(4); c.lastTick = x; }
  syncCut();
  // the whole seal has to be traced: 85% resets in TCG Pocket
  if (c.min <= -HW_CUT + 1e-4 && c.max >= HW_CUT - 1e-4) complete();
}

function releaseCut() {
  S.stage = 'open';
  root.classList.remove('is-cutting');
  const c = S.cut, from = { min: c.min, max: c.max }, x0 = clamp(c.x0, c.min, c.max);
  const g0 = G.uGlow.value, p0 = U.uPeelAmt.value;
  cancel('glow'); cancel('peel');
  tween(T.retract, (k) => {
    c.min = lerp(from.min, x0, k);
    c.max = lerp(from.max, x0, k);
    c.tip = c.max > x0 + 1e-4 ? c.max : c.min;
    G.uGlow.value = g0 * (1 - k);
    syncCut();
  }, { ease: E.inQuad, tag: 'retract' }).then(() => { U.uCutOn.value = 0; });
  tween(T.relax, (k) => { U.uPeelAmt.value = p0 * (1 - k); }, { ease: E.outCubic, tag: 'peel' });
  setDim(false);
  armHint();
  S.lastGlint = now() + 900;
}

// Keyboard: trace it for them.
function autoTrace() {
  if (S.stage !== 'open') return;
  const e = cutEdgesPx(), a = e.xl - 10, b = e.xr + 10;
  startCut(a);
  tween(420, (k) => { if (S.stage === 'cutting') moveCut(lerp(a, b, k)); }, { ease: E.inOutCubic });
}

/* ── Opening ───────────────────────────────────────────────────────────── */
function positionStreak() {
  packGroup.updateMatrixWorld(true);
  const p = new THREE.Vector3(0, CUT_Y, 0).applyMatrix4(packGroup.matrixWorld);
  const vis = 2 * (CAM_Z - p.z) * Math.tan(FOV * Math.PI / 360);
  streak.position.set(0, p.y, p.z + 0.05);
  streak.scale.set(vis * camera.aspect * 1.3, 0.26 * PACK_W * S.frame.s, 1);
}

function detachStrip(dir) {
  scene.attach(stripPivot);
  const p0 = stripPivot.position.clone(), r0 = stripPivot.rotation.clone();
  const zEnd = p0.z - 1.6 * stripPivot.scale.x, u1 = upp(zEnd);
  const sp = toScreen(p0.x, p0.y, p0.z, null);
  const ex = sp.x + dir * (vw * 0.62 + 60), ey = sp.y - vh * 0.34;
  const p1 = new THREE.Vector3((ex - vw / 2) * u1, (vh / 2 - ey) * u1, zEnd);
  // thrown up and away the way the cut travelled, rolling and tumbling edge-on
  tween(T.fly, (k, raw) => {
    stripPivot.position.lerpVectors(p0, p1, k);
    stripPivot.rotation.z = r0.z - dir * 1.3 * k;
    stripPivot.rotation.x = r0.x - 1.5 * E.inOutCubic(raw);
    stripPivot.rotation.y = r0.y + dir * 0.45 * k;
  }, { ease: E.outCubic }).then(() => { stripPivot.visible = false; });
}

function complete() {
  if (S.stage !== 'cutting') return;
  S.stage = 'opening';
  root.classList.remove('is-cutting');
  clearTimeout(S.hintTimer);
  hideHint();
  cancel('peel'); cancel('glow'); cancel('retract'); cancel('glint');
  U.uPeelAmt.value = 1;
  U.uPeelLen.value = 1;
  haptic([18, 40, 12]);
  if (S.reduced) { quickHandoff(); return; }
  const dir = S.cut.firstFree === 1 ? -1 : 1;     // the strip flies the way the cut went
  setDim(false, 220);

  // the capsule burns out into the bloom...
  const g0 = G.uGlow.value;
  tween(110, (k) => { G.uGlow.value = g0 * (1 - k); }, { ease: E.linear });
  tween(160, (k) => { G.uGuide.value = 1 - k; }, { ease: E.linear });
  bloom.visible = true;
  tween(T.bloom, (k) => { B.uA.value = k; }, { ease: E.linear });
  tween(150, (k) => {
    B.uA.value = 1 - k;
    bloom.scale.set(1.9 * (1 + 0.6 * k), 0.8 * (1 - 0.65 * k), 1);
  }, { ease: E.outQuad, delay: T.bloom });
  // ...which flattens into a streak edge to edge across the screen
  streak.visible = true;
  positionStreak();
  tween(T.streak, (k, raw) => {
    St.uA.value = raw < 0.12 ? raw / 0.12 : 1 - smooth(0.35, 1, raw);
    streak.scale.y = lerp(0.26, 0.035, k) * PACK_W * S.frame.s;
  }, { ease: E.outCubic, delay: T.bloom });

  // the strip is thrown clear; the lip opens and catches the light
  tween(0, () => { detachStrip(dir); card.visible = true; }, { delay: T.detach });
  tween(260, (k) => { U.uMouth.value = k; U.uRim.value = k; }, { delay: T.detach });

  // a beat, then the pack drops away as the first card rises out of it
  tween(T.dropDur, (k) => { body.position.y = -1.3 * PACK_H * k; }, { ease: E.inCubic, delay: T.drop });
  tween(T.riseDur, (k) => { card.position.y = lerp(CARD_Y0, CARD_Y1, k); }, { ease: E.outCubic, delay: T.drop });
  tween(0, () => { bloom.visible = streak.visible = false; handoff(); },
        { delay: T.drop + T.riseDur + T.beat });
}

/* ── Hand-off to the carousel ──────────────────────────────────────────── */
function handoff() {
  const P = window.PackHandoff;
  if (!P) return;
  S.stage = 'handoff';
  const to = P.prepare(true);             // its front card face, hidden until we land
  scene.attach(card);
  const p0 = card.position.clone(), s0 = card.scale.x, rx0 = card.rotation.x;
  const u0 = upp(0);
  const s1 = (to.width * u0) / CARD_W;
  const p1 = new THREE.Vector3((to.x - vw / 2) * u0, (vh / 2 - to.y) * u0, 0);
  const rx1 = -(P.tiltX || 0) * Math.PI / 180;   // match the carousel's tilt
  P.reveal(T.handoff);
  envEl.style.transition = 'opacity ' + T.handoff + 'ms ease';
  envEl.style.opacity = '0';
  tween(T.handoff, (k) => {
    C.uA.value = 1 - k;
    card.position.lerpVectors(p0, p1, k);
    card.scale.setScalar(lerp(s0, s1, k));
    card.rotation.x = lerp(rx0, rx1, k);
  }, { ease: E.inOutCubic }).then(() => { P.finish(); dispose(); });
}

// Reduced motion, or no WebGL: straight to the carousel.
async function quickHandoff() {
  const P = window.PackHandoff;
  if (!P) return;
  S.stage = 'handoff';
  P.prepare(false);
  P.reveal(280);
  root.style.transition = 'opacity 280ms ease';
  root.style.opacity = '0';
  await wait(300);
  P.finish();
  root.style.opacity = '';
  root.style.transition = '';
  dispose();
}

function dispose() {
  S.stage = 'done';
  cancelAnimationFrame(S.raf);
  clearTimeout(S.hintTimer);
  if (!renderer) return;
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  Object.values(TEX).forEach((t) => t.dispose());
  renderer.dispose();
}

/* ── Input ─────────────────────────────────────────────────────────────── */
function capture(e) { try { root.setPointerCapture(e.pointerId); } catch (_) {} }
function hover(e) {
  if (S.stage !== 'select' && S.stage !== 'open') return;
  const cy = S.stage === 'select' ? F.select.cy : F.open.cy;
  S.hoverYawT = clamp((e.clientX - vw / 2) / vw, -0.5, 0.5) * 0.55;
  S.hoverPitchT = clamp((e.clientY - cy) / vh, -0.5, 0.5) * 0.30;
  if (S.stage === 'select') root.style.cursor = hitPack(e.clientX, e.clientY) ? 'pointer' : '';
}

function bindInput() {
  root.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || e.target.closest('button')) return;
    if (S.stage === 'select') {
      S.dragging = true;
      S.moved = 0;
      S.lastX = e.clientX; S.lastY = e.clientY;
      S.downT = S.lastT = now();
      S.dragYaw = unrubber(S.yaw);      // pick up from where it is, mid-spring included
      S.yawV = 0; S.pitchV = 0;
      root.classList.add('is-grabbing');
      capture(e);
    } else if (S.stage === 'open') {
      if (startCut(e.clientX)) capture(e);
    }
  });
  root.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' && !S.dragging && S.stage !== 'cutting') hover(e);
    if (S.stage === 'select' && S.dragging) {
      const t = now(), dx = e.clientX - S.lastX, dy = e.clientY - S.lastY;
      const dt = Math.max(8, t - S.lastT) / 1000;
      S.moved += Math.abs(dx) + Math.abs(dy);
      const prevYaw = S.yaw;
      S.dragYaw += dx * 0.0085;
      S.yaw = rubber(S.dragYaw);
      S.pitch = clamp(S.pitch + dy * 0.0045, -0.5, 0.5);
      S.yawV = lerp(S.yawV, (S.yaw - prevYaw) / dt, 0.4);
      S.pitchV = lerp(S.pitchV, (dy * 0.0045) / dt, 0.4);
      S.lastX = e.clientX; S.lastY = e.clientY; S.lastT = t;
    } else if (S.stage === 'cutting') {
      moveCut(e.clientX);
    }
  });
  const up = (e) => {
    if (S.stage === 'select' && S.dragging) {
      S.dragging = false;
      root.classList.remove('is-grabbing');
      if (S.moved < 10 && now() - S.downT < 450 && hitPack(e.clientX, e.clientY)) { goOpen(); return; }
      S.yawTarget = 0;                  // always springs back to face you
    } else if (S.stage === 'cutting') {
      releaseCut();
    }
  };
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);
  root.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') { S.hoverYawT = 0; S.hoverPitchT = 0; }
  });
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('click', () => {
    if (S.stage === 'select') goOpen();
    else if (S.stage === 'open') autoTrace();
  });
  addEventListener('resize', () => { if (S.stage !== 'done') layout(); });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { if (S.stage === 'select' || S.stage === 'boot') layout(); });
  }
}

/* ── Frame loop ────────────────────────────────────────────────────────── */
let last = now();
function frame(t) {
  if (S.stage === 'done') return;
  S.raf = requestAnimationFrame(frame);
  const dt = Math.min(0.033, Math.max(0, (t - last) / 1000));
  last = t;
  runTweens(t);

  // hover parallax and, on the select screen, the spin spring
  const hk = Math.min(1, dt * 6);
  S.hoverYaw += (S.hoverYawT - S.hoverYaw) * hk;
  S.hoverPitch += (S.hoverPitchT - S.hoverPitch) * hk;
  if ((S.stage === 'select' || S.stage === 'boot') && !S.dragging) {
    const k = 80, c = 11;   // underdamped a touch: it overshoots and settles, as in the game
    S.yawV += (k * (S.yawTarget + S.hoverYaw - S.yaw) - c * S.yawV) * dt;
    S.yaw += S.yawV * dt;
    S.pitchV += (k * (S.hoverPitch - S.pitch) - c * S.pitchV) * dt;
    S.pitch += S.pitchV * dt;
  }

  const sec = t / 1000, idle = S.reduced ? 0 : S.idleW;
  let py = S.frame.y;
  if (S.stage === 'select' || S.stage === 'boot' || S.stage === 'toOpen') {
    S.rx = S.pitch + Math.sin(sec * 1.1 + 1) * 0.03 * idle;
    S.ry = S.yaw + Math.sin(sec * 0.8) * 0.055 * idle;
    py += Math.sin(sec * 1.6) * 0.016 * PACK_H * S.frame.s * idle;
  } else if (S.stage === 'open' || S.stage === 'cutting') {
    S.rx = S.hoverPitch * 0.22;
    S.ry = S.hoverYaw * 0.22;
  }
  packGroup.scale.setScalar(S.frame.s);
  packGroup.position.set(0, py, 0);
  packGroup.rotation.set(S.rx, S.ry, 0);

  U.uSheen.value = S.ry * 0.25 + S.rx * 0.4 + sec * 0.015;
  stage.scale.setScalar(S.frame.s);
  stage.position.set(0, S.frame.y, 0);
  C.uYaw.value = S.ry;
  C.uLift.value = (py - S.frame.y) / (PACK_H * S.frame.s) + Math.max(0, -body.position.y) / PACK_H;
  U.uFloorY.value = S.floorY;
  U.uReflAlpha.value = 0.17 * S.reflect;

  if (S.stage === 'open' && t - S.lastGlint > T.glintEvery) glint(-S.glintDir);

  scene.updateMatrixWorld();
  if (stripRefl.visible) {
    stripRefl.matrix.copy(strip.matrixWorld); stripRefl.matrixWorldNeedsUpdate = true;
    bodyRefl.matrix.copy(body.matrixWorld); bodyRefl.matrixWorldNeedsUpdate = true;
  }
  renderer.render(scene, camera);
}

/* ── Build ─────────────────────────────────────────────────────────────── */
function build(art) {
  TEX.front = texture(art.packFront, false);
  TEX.back = texture(art.packBack, false);
  TEX.card = texture(art.cardImg, true);

  U = {
    tFront: { value: TEX.front }, tBack: { value: TEX.back },
    uCutY: { value: CUT_Y }, uCutV: { value: CUT_V }, uHW: { value: HW_CUT },
    uPeelSide: { value: 0 }, uPeelTip: { value: 0 }, uPeelLen: { value: 0 },
    uPeelAmt: { value: 0 }, uPeelMax: { value: 1.18 },   // ~68°, measured at the starting corner
    uCutMin: { value: 0 }, uCutMax: { value: 0 }, uCutOn: { value: 0 },
    uMouth: { value: 0 }, uRim: { value: 0 },
    uFloorY: { value: -10 }, uReflAlpha: { value: 0.3 },
    uLight: { value: new THREE.Vector3(-0.35, 0.55, 0.76).normalize() },
    uSheen: { value: 0 },
  };
  G = {
    uMin: { value: 0 }, uMax: { value: -1 }, uTip: { value: 0 }, uGlow: { value: 0 },
    uGuide: { value: 0 }, uGlintX: { value: -2 }, uGlint: { value: 0 }, uHW: { value: HW_CUT },
  };
  B = { uA: { value: 0 } };
  St = { uA: { value: 0 } };
  C = {
    uBg: { value: new THREE.Vector3(0.051, 0.039, 0.027) },     // --bg, #0d0a07
    uLit: { value: new THREE.Vector3(0.27, 0.23, 0.19) },
    uLightPos: { value: new THREE.Vector3(0, 3.6, 0.9) },
    uYaw: { value: 0 }, uLift: { value: 0 }, uShadow: { value: 0.85 },
    uDim: { value: 0 }, uA: { value: 1 },
  };

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FOV, vw / vh, 0.1, 60);
  camera.position.set(0, 0, CAM_Z);

  stage = new THREE.Group();
  scene.add(stage);
  const cove = new THREE.Mesh(buildCove(), new THREE.ShaderMaterial({
    uniforms: C, vertexShader: COVE_VS, fragmentShader: COVE_FS,
    depthWrite: false, depthTest: false,   // opaque, so it draws first, behind everything
  }));
  cove.position.y = -PACK_H / 2 - 0.055 * PACK_H;
  cove.renderOrder = -2;
  cove.frustumCulled = false;
  stage.add(cove);

  packGroup = new THREE.Group();
  scene.add(packGroup);

  body = new THREE.Mesh(buildSheets(CUT_V, 1, 100, 64), packMaterial(false, false));
  body.frustumCulled = false;
  packGroup.add(body);

  stripPivot = new THREE.Group();
  stripPivot.position.set(0, STRIP_CY, 0);
  packGroup.add(stripPivot);
  strip = new THREE.Mesh(buildSheets(0, CUT_V, 18, 64), packMaterial(true, false));
  strip.position.set(0, -STRIP_CY, 0);
  strip.frustumCulled = false;
  stripPivot.add(strip);

  const reflOf = (src, isStrip) => {
    const m = new THREE.Mesh(src.geometry, packMaterial(isStrip, true));
    m.matrixAutoUpdate = false;
    m.frustumCulled = false;
    m.renderOrder = -1;
    scene.add(m);
    return m;
  };
  stripRefl = reflOf(strip, true);
  bodyRefl = reflOf(body, false);
  stripRefl.visible = bodyRefl.visible = false;   // the cove's shadow grounds it instead

  card = new THREE.Mesh(
    new THREE.PlaneGeometry(CARD_W, CARD_H),
    new THREE.ShaderMaterial({
      uniforms: { tCard: { value: TEX.card }, uR: { value: new THREE.Vector2(0.045, 0.045) } },
      vertexShader: QUAD_VS, fragmentShader: CARD_FS,
    }));
  card.position.set(0, CARD_Y0, 0);
  card.renderOrder = 1;
  card.visible = false;
  packGroup.add(card);

  const ribbonGeo = buildRibbon(0.72, 0.14, 120);
  slitRibbon = new THREE.Mesh(ribbonGeo, new THREE.ShaderMaterial({
    uniforms: G, vertexShader: RIBBON_VS, fragmentShader: SLIT_FS,
    transparent: true, depthWrite: false, depthTest: false,
  }));
  slitRibbon.renderOrder = 2;
  packGroup.add(slitRibbon);
  glowRibbon = new THREE.Mesh(ribbonGeo, additive({ uniforms: G, vertexShader: RIBBON_VS, fragmentShader: GLOW_FS }));
  glowRibbon.renderOrder = 3;
  packGroup.add(glowRibbon);

  bloom = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    additive({ uniforms: B, vertexShader: QUAD_VS, fragmentShader: BLOOM_FS }));
  bloom.position.set(0, CUT_Y, BULGE + 0.03);
  bloom.scale.set(1.9, 0.8, 1);
  bloom.renderOrder = 4;
  bloom.visible = false;
  packGroup.add(bloom);

  streak = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    additive({ uniforms: St, vertexShader: QUAD_VS, fragmentShader: STREAK_FS }));
  streak.renderOrder = 5;
  streak.visible = false;
  scene.add(streak);

  layout();
  bindInput();

  // arrival: rises in from below and swings round to face you
  S.frame.s = F.select.s * 0.9;
  S.frame.y = F.select.y - 0.35;
  const from = { s: S.frame.s, y: S.frame.y };
  tween(S.reduced ? 1 : T.intro, (k) => {
    S.frame.s = lerp(from.s, F.select.s, k);
    S.frame.y = lerp(from.y, F.select.y, k);
  }, { ease: E.outCubic, delay: 120 }).then(() => { if (S.stage === 'boot') S.stage = 'select'; });
  if (S.reduced) S.yaw = 0;
  S.raf = requestAnimationFrame(frame);
}

function fallback() {
  canvas.hidden = true;
  fallbackImg.hidden = false;
  S.stage = 'select';
  btn.addEventListener('click', () => { if (S.stage === 'select') quickHandoff(); });
}

async function init() {
  if (!window.THREE) { fallback(); return; }
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (_) { fallback(); return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // the art goes out exactly as stored
  let art;
  try { art = await loadArt(); } catch (_) { renderer.dispose(); renderer = null; fallback(); return; }
  build(art);
}

init();
}());
