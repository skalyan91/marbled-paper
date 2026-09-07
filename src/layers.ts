// Per-layer drop data baked into a TEXTURE_2D_ARRAY slice (RGBA16F, TILE×TILE).
// Static structure (jitter, radius, colour, animation phases) is generated from a
// seed once; the animated position/radius is re-baked every frame on the CPU.
//
// Animation: two crossing streams per layer. The drops of even grid rows slide along the
// grid's x axis, each row at its own steady speed (a slow shear flow); the drops of odd rows
// slide along y, each column at its own speed. Neighbouring drops therefore pass one another,
// the two streams weave through each other, and nothing ever returns to where it was; a small
// bounded wobble is added on top. The per-row and per-column shifts, in cells, are uploaded
// as a TILE × (2·MAX_LAYERS) float texture and the shader looks a drop up in the cell its
// row or column has slid to.
//
// Each drop also breathes: its radius follows a human breathing curve rather than a sine
// (after petasbytes' Breathing Blob, PyCon AU 2026). A breath is a raised-cosine inhale over
// about a third of the cycle and a raised-cosine exhale over the rest, then a short pause at
// the end of the exhale. Every drop has its own resting tempo (10–16 breaths a minute) and
// inhale fraction; every breath draws its own period (bounded, ~12 % spread) and depth
// (one-sided, 86–100 %); about once every 2½ minutes a drop sighs: twice the depth over one
// and a half periods, no pause. The per-breath draws are hashed from the cell and the breath
// index, so the motion is deterministic for a seed and only the current breath is kept as state.

export const TILE = 128;
export const MAX_LAYERS = 8;

export interface LayerSpec {
  cellMm: number; // grid cell size in bath millimetres
  jitter: number; // max offset from cell centre, in cells (≤ 0.45)
  radius: number; // mean radius in cells (≤ 0.65)
  radiusSigma: number; // log-normal sigma
  colours: number[]; // palette indices; -1 = clear (dispersant only)
  fill: number; // probability a cell has a drop (spatter layers < 1)
  animAmp: number; // wobble amplitude in cells
  breath?: number; // peak-to-trough radius change of a breath, as a fraction of the radius (default 0.12)
  slide?: number; // row-sliding speed multiplier (default 1; 0 = rows stay put)
  seed: number;
  rMax?: number; // radius clamp in cells (0.8 for small-drop layers traced with a 3×3 neighbourhood)
  // placement of the grid in bath mm (needed to compare layers)
  origin?: [number, number];
  rot?: number; // radians
  gapFill?: number; // 0..1: how much a throw landing on an earlier colour is held back (the marbler aims at gaps)
  isSpot?: boolean;
  shape?: number; // Weibull shape of the diameter above the floor; when set, replaces the log-normal
  floor?: number; // radius floor in cells (the 1.2 mm resolution floor of the measurements)
}

interface LayerStatic {
  jx: Float32Array;
  jy: Float32Array;
  r: Float32Array;
  col: Float32Array;
  ph: Float32Array; // 3 phases per cell
  w: Float32Array; // 3 angular speeds per cell
  flow: Float32Array[]; // steady velocity profiles (max |v| = 1): [0] per row along x, [1] per column along y
  swell: Float32Array[][]; // two bounded profiles (max 1) for rows and for columns
  swellW: number[][]; // their angular speeds (rad/s)
  swellPh: number[][]; // and phases
  // breathing: per-drop constants, and the state of the breath in progress (see bake)
  bPeriod: Float32Array; // resting period, s
  bInh: Float32Array; // inhale fraction of the motion
  bIdx: Int32Array; // index of the current breath (−1: not started)
  bStart: Float32Array; // when it started, s
  bDur: Float32Array; // its whole duration, pause included, s
  bPause: Float32Array; // its end pause, s
  bExc: Float32Array; // its depth relative to the nominal excursion (2 for a sigh)
}

const BREATH_CV = 0.12; // breath-to-breath spread of the period
const BREATH_DEPTH_VAR = 0.14; // one-sided spread of the depth
const BREATH_PAUSE = 0.25; // end-of-exhale pause, s (capped at half the period)
const SIGH_EVERY = 150; // mean seconds between sighs

function hash01(seed: number, i: number) {
  let x = (seed * 374761393 + i * 668265263) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Draw the period, pause and depth of breath `n` of drop `i` (deterministic in the cell and the index). */
function drawBreath(s: LayerStatic, seed: number, i: number, n: number) {
  const P = s.bPeriod[i];
  const k = (seed ^ Math.imul(i, 2654435761)) >>> 0;
  const sigh = hash01(k, n * 8 + 3) < P / SIGH_EVERY;
  if (sigh) { s.bDur[i] = 1.5 * P; s.bPause[i] = 0; s.bExc[i] = 2; return; }
  // bounded bell-shaped period factor: two uniforms (triangular, sd 0.408) scaled to the CV
  const f = 1 + (BREATH_CV / 0.408) * (hash01(k, n * 8) + hash01(k, n * 8 + 1) - 1);
  s.bDur[i] = P * f;
  s.bPause[i] = Math.min(BREATH_PAUSE, s.bDur[i] / 2);
  s.bExc[i] = 1 - BREATH_DEPTH_VAR * hash01(k, n * 8 + 2);
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rnd: () => number) {
  const u = Math.max(rnd(), 1e-9);
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function buildStatic(spec: LayerSpec): LayerStatic {
  const n = TILE * TILE;
  const s: LayerStatic = {
    jx: new Float32Array(n),
    jy: new Float32Array(n),
    r: new Float32Array(n),
    col: new Float32Array(n),
    ph: new Float32Array(n * 3),
    w: new Float32Array(n * 3),
    flow: [new Float32Array(TILE), new Float32Array(TILE)],
    swell: [[new Float32Array(TILE), new Float32Array(TILE)], [new Float32Array(TILE), new Float32Array(TILE)]],
    swellW: [[], []],
    swellPh: [[], []],
    bPeriod: new Float32Array(n),
    bInh: new Float32Array(n),
    bIdx: new Int32Array(n).fill(-1),
    bStart: new Float32Array(n),
    bDur: new Float32Array(n),
    bPause: new Float32Array(n),
    bExc: new Float32Array(n),
  };
  const rnd = mulberry32(spec.seed * 7919 + 17);
  // velocity profiles: sums of a few whole-tile harmonics (so they wrap) of short wavelength,
  // 3–11 cells, normalised to max |·| = 1. Every harmonic has zero mean, so over any patch of the
  // sheet as much paint moves one way as the other: the motion is shear everywhere, bulk flow nowhere.
  const profile = (out: Float32Array, modes: number) => {
    const ms: number[] = [], phs: number[] = [], as: number[] = [];
    for (let k = 0; k < modes; k++) { ms.push(12 + Math.floor(rnd() * 29)); phs.push(rnd() * Math.PI * 2); as.push(0.5 + rnd()); }
    let mx = 0;
    for (let j = 0; j < TILE; j++) {
      let v = 0;
      for (let k = 0; k < modes; k++) v += as[k] * Math.sin((2 * Math.PI * ms[k] * j) / TILE + phs[k]);
      out[j] = v; mx = Math.max(mx, Math.abs(v));
    }
    for (let j = 0; j < TILE; j++) out[j] /= mx;
  };
  for (let d = 0; d < 2; d++) {
    profile(s.flow[d], 3);
    for (let a = 0; a < 2; a++) { profile(s.swell[d][a], 2); s.swellW[d].push(0.025 + rnd() * 0.03); s.swellPh[d].push(rnd() * Math.PI * 2); }
  }
  const k = Math.max(1, spec.colours.length);
  // Balanced colour assignment: k×k blocks, each row of a block is a random
  // cyclic shift of a per-block random permutation → every colour once per row.
  const blocks = Math.ceil(TILE / k);
  const perms: number[][] = [];
  const shifts: number[][] = [];
  for (let b = 0; b < blocks * blocks; b++) {
    const p = spec.colours.map((_, i) => i);
    for (let i = k - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    perms.push(p);
    shifts.push(Array.from({ length: k }, () => Math.floor(rnd() * k)));
  }
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = y * TILE + x;
      s.jx[i] = (rnd() * 2 - 1) * spec.jitter;
      s.jy[i] = (rnd() * 2 - 1) * spec.jitter;
      const present = rnd() < spec.fill;
      let rr: number;
      if (spec.shape !== undefined) {
        // shifted Weibull: r = floor + scale·(−ln U)^(1/k), scale set so the median equals spec.radius
        const fl = spec.floor ?? 0;
        const scale = Math.max(spec.radius - fl, 0.01) / Math.pow(Math.LN2, 1 / spec.shape);
        rr = fl + scale * Math.pow(-Math.log(Math.max(rnd(), 1e-9)), 1 / spec.shape);
      } else rr = spec.radius * Math.exp(spec.radiusSigma * gauss(rnd));
      s.r[i] = present ? Math.min(spec.rMax ?? 1.0, rr) : 0;
      const bx = Math.floor(x / k), by = Math.floor(y / k);
      const bi = by * blocks + bx;
      const ci = perms[bi][(x % k + shifts[bi][y % k]) % k];
      s.col[i] = spec.colours[ci] ?? -1;
      for (let a = 0; a < 3; a++) {
        s.ph[i * 3 + a] = rnd() * Math.PI * 2;
        s.w[i * 3 + a] = 0.12 + rnd() * 0.25; // rad/s: 20–40 s periods, a slow swim
      }
      // breathing tempo and inhale fraction of this drop (hashed apart from the rnd stream, so the layouts of old seeds hold)
      s.bPeriod[i] = 60 / (10 + 6 * hash01(spec.seed, i * 2)); // 10–16 breaths a minute
      s.bInh[i] = 0.3 + 0.08 * hash01(spec.seed, i * 2 + 1); // inhale : exhale ≈ 1 : 2
    }
  }
  return s;
}

export class LayerBank {
  gl: WebGL2RenderingContext;
  tex: WebGLTexture;
  shiftTex: WebGLTexture; // per-row and per-column slide of each layer, in cells (TILE × 2·MAX_LAYERS, R32F)
  statics: (LayerStatic | null)[] = [];
  keys: string[] = [];
  scratch = new Float32Array(TILE * TILE * 4);
  shift = new Float32Array(TILE * 2);

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA16F, TILE, TILE, MAX_LAYERS);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this.shiftTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.shiftTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, TILE, 2 * MAX_LAYERS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  specs: LayerSpec[] = [];

  /** Is bath point (x, y) mm inside a drop of layer `k` (static geometry)? */
  private covered(k: number, x: number, y: number): boolean {
    const sp = this.specs[k], st = this.statics[k];
    if (!sp || !st || !sp.origin) return false;
    const c = Math.cos(sp.rot ?? 0), sn = Math.sin(sp.rot ?? 0);
    const dx = x - sp.origin[0], dy = y - sp.origin[1];
    const gx = (c * dx + sn * dy) / sp.cellMm, gy = (-sn * dx + c * dy) / sp.cellMm;
    const bx = Math.floor(gx), by = Math.floor(gy);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const cx = bx + ox, cy = by + oy;
      const i = ((cy & (TILE - 1)) * TILE) + (cx & (TILE - 1));
      const r = st.r[i];
      if (r <= 0) continue;
      const ex = cx + 0.5 + st.jx[i] - gx, ey = cy + 0.5 + st.jy[i] - gy;
      if (ex * ex + ey * ey < r * r * 0.8) return true;
    }
    return false;
  }

  /** Re-bake slice `slot` for time t (seconds). Static data cached by spec key.
   *  Pausing freezes t, so the sheet holds still rather than snapping back to its rest state. */
  bake(slot: number, spec: LayerSpec, t: number) {
    // gap filling depends on the earlier spot layers, so they are part of the cache key
    const key = JSON.stringify(spec) + "|" + this.keys.slice(0, slot).map((k) => k ?? "").join("|");
    this.specs[slot] = spec;
    if (this.keys[slot] !== key) {
      const st = buildStatic(spec);
      // gap filling: a later colour thrown onto an earlier one spreads less (the marbler aims at gaps)
      if (spec.isSpot && spec.origin && (spec.gapFill ?? 0) > 0 && spec.radius <= 0.45) {
        const c = Math.cos(spec.rot ?? 0), sn = Math.sin(spec.rot ?? 0);
        let areaBefore = 0;
        for (let i = 0; i < TILE * TILE; i++) areaBefore += st.r[i] * st.r[i];
        for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
          const i = y * TILE + x;
          if (st.r[i] <= 0) continue;
          const gx = x + 0.5 + st.jx[i], gy = y + 0.5 + st.jy[i];
          const mx = spec.origin[0] + (c * gx - sn * gy) * spec.cellMm, my = spec.origin[1] + (sn * gx + c * gy) * spec.cellMm;
          let hit = false;
          for (let k = 0; k < slot && !hit; k++) if (this.specs[k]?.isSpot && this.covered(k, mx, my)) hit = true;
          if (hit) st.r[i] *= 1 - 0.55 * (spec.gapFill ?? 0);
        }
        // conserve the layer's paint: what was held back over earlier colours spreads in the gaps
        let areaAfter = 0;
        for (let i = 0; i < TILE * TILE; i++) areaAfter += st.r[i] * st.r[i];
        const k = Math.sqrt(areaBefore / Math.max(areaAfter, 1e-9));
        for (let i = 0; i < TILE * TILE; i++) st.r[i] = Math.min(spec.rMax ?? 1.0, st.r[i] * k);
      }
      this.statics[slot] = st;
      this.keys[slot] = key;
    }
    const s = this.statics[slot]!;
    const d = this.scratch;
    const amp = spec.animAmp;
    const breath = spec.breath ?? 0.12;
    const rMax = spec.rMax ?? 1.0;
    const n = TILE * TILE;
    for (let i = 0; i < n; i++) {
      const r0 = s.r[i];
      const o = i * 4;
      if (r0 === 0) {
        d[o] = 0; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = s.col[i];
        continue;
      }
      const p = i * 3;
      d[o] = s.jx[i] + amp * Math.sin(s.w[p] * t + s.ph[p]);
      d[o + 1] = s.jy[i] + amp * Math.sin(s.w[p + 1] * t + s.ph[p + 1]);
      // breathing: advance to the breath containing t (the first bake, or time running backwards, starts afresh at a random phase)
      if (s.bIdx[i] < 0 || t < s.bStart[i]) {
        const idx = Math.floor(t / s.bPeriod[i]);
        s.bIdx[i] = idx;
        drawBreath(s, spec.seed, i, idx);
        s.bStart[i] = t - hash01((spec.seed ^ Math.imul(i, 2654435761)) >>> 0, idx * 8 + 4) * s.bDur[i];
      }
      while (t - s.bStart[i] >= s.bDur[i]) { s.bStart[i] += s.bDur[i]; s.bIdx[i]++; drawBreath(s, spec.seed, i, s.bIdx[i]); }
      // raised-cosine inhale over the fraction f of the motion, raised-cosine exhale over the rest, then the pause
      const ph = (t - s.bStart[i]) / (s.bDur[i] - s.bPause[i]);
      const f = s.bInh[i];
      let w = 0;
      if (ph < f) w = 0.5 * (1 - Math.cos((Math.PI * ph) / f));
      else if (ph < 1) w = 0.5 * (1 + Math.cos((Math.PI * (ph - f)) / (1 - f)));
      d[o + 2] = Math.min(rMax, r0 * (1 + breath * (w * s.bExc[i] - 0.5)));
      d[o + 3] = s.col[i];
    }
    // slide: steady shear flows (≈0.12 cell/s at the fastest row or column) plus two slow bounded swells each
    const V = 0.12 * (spec.slide ?? 1);
    const rs = this.shift;
    for (let dir = 0; dir < 2; dir++) {
      const sw0 = 0.6 * Math.sin(s.swellW[dir][0] * t + s.swellPh[dir][0]), sw1 = 0.6 * Math.sin(s.swellW[dir][1] * t + s.swellPh[dir][1]);
      const fl = s.flow[dir], w0 = s.swell[dir][0], w1 = s.swell[dir][1];
      for (let j = 0; j < TILE; j++) rs[dir * TILE + j] = V * t * fl[j] + (spec.slide ?? 1) * (sw0 * w0[j] + sw1 * w1[j]);
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, slot, TILE, TILE, 1, gl.RGBA, gl.FLOAT, d);
    gl.bindTexture(gl.TEXTURE_2D, this.shiftTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 2 * slot, TILE, 2, gl.RED, gl.FLOAT, rs);
  }
}
