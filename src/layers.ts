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
  // A single-colour layer's own share of a shared, sheet-wide column favouritism: a low-frequency sinusoid in the
  // sheet's own bath mm (not this layer's own randomly rotated grid, so every colour's layers read the same
  // columns), one period per `period` mm along direction `dirDeg`, this colour's own phase offset (so different
  // colours favour different columns). The sinusoid (0..1) is rescaled to [lo, hi] before it multiplies the drawn
  // radius: a DOMINANT colour's own lo/hi sit high (e.g. 0.6..1.4 — always at least present, sometimes bigger) so
  // it reads as continuous thick bands with only a shallow dip, never really thinning to nothing; an ACCENT
  // colour's sit low (e.g. 0.15..0.6 — mostly faint, briefly moderate) so it reads as an occasional thin band
  // between the dominant ones. Equal lo/hi for every colour (as a plain `gamma`-lift of a symmetric sinusoid gives:
  // every colour spends exactly half its own period above its own mean, so it merely gets a "turn" rather than
  // being reliably one or the other) wasn't decisive enough on its own (user, 2026-09-12, on a first pass at this
  // mechanism: dp 17's bands were "still showing too many thin bands, as opposed to thick bands of red and blue and
  // thin bands of green and cream" — a designed hierarchy of which colours are which, not just differing phases of
  // one shared shape). No compensating rescale here, deliberately: giving the dominant tier MORE than its fitted
  // average coverage and the accent tier LESS is the point, not a side effect to undo — restoring each colour's own
  // mean (an earlier version of this field did) put every column's total ink back where it started and mostly
  // cancelled the redistribution's own visual effect.
  colBias?: { dirDeg: number; period: number; phase: number; lo: number; hi: number };
  // 2026-09-14 (user): the desired colours are "dropped sequentially onto the bath using some sort of implement to
  // regulate the drop sizes" — not a scattered brush spatter, but a set of ROWS of dots (one row a stroke of the
  // implement), which is what actually gives a subsequent comb long, continuous bands to gather, rather than the
  // fundamentally scale-invariant problem a uniform stretch of an isotropic scatter can never fix: stretching a
  // random lattice elongates both a drop and its own gap to its neighbour by the same factor, so no amount of drag
  // closes a gap that was there proportionally before it. `rowPeriod` (cells; only rows 0, rowPeriod, 2·rowPeriod, …
  // of this layer's own local grid get any drops at all, the rest forced empty) makes the rows explicit at the
  // placement stage itself, in this layer's own local (rotated) grid — align `rot` with the row direction the get-
  // gel is about to pull along, so a row is already a proto-band before any comb touches it.
  rowPeriod?: number;
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
  // Column favouritism reads this layer's own grid cell in the sheet's shared bath mm (the same frame every
  // colour's own, independently placed and rotated, layer converts into), so a "column" lines up across colours
  // even though each one's own lattice sits at its own random offset and rotation (see LayerSpec.colBias).
  const cb = spec.colBias;
  const ocx = spec.origin?.[0] ?? 0, ocy = spec.origin?.[1] ?? 0;
  const rotC = Math.cos(spec.rot ?? 0), rotS = Math.sin(spec.rot ?? 0);
  const biasDirC = cb ? Math.cos((cb.dirDeg * Math.PI) / 180) : 0, biasDirS = cb ? Math.sin((cb.dirDeg * Math.PI) / 180) : 0;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = y * TILE + x;
      s.jx[i] = (rnd() * 2 - 1) * spec.jitter;
      s.jy[i] = (rnd() * 2 - 1) * spec.jitter;
      const present = rnd() < spec.fill && (spec.rowPeriod === undefined || y % spec.rowPeriod === 0);
      let rr: number;
      if (spec.shape !== undefined) {
        // shifted Weibull: r = floor + scale·(−ln U)^(1/k), scale set so the median equals spec.radius
        const fl = spec.floor ?? 0;
        const scale = Math.max(spec.radius - fl, 0.01) / Math.pow(Math.LN2, 1 / spec.shape);
        rr = fl + scale * Math.pow(-Math.log(Math.max(rnd(), 1e-9)), 1 / spec.shape);
      } else rr = spec.radius * Math.exp(spec.radiusSigma * gauss(rnd));
      if (cb) {
        const gx = x + 0.5 + s.jx[i], gy = y + 0.5 + s.jy[i];
        const mx = ocx + (rotC * gx - rotS * gy) * spec.cellMm, my = ocy + (rotS * gx + rotC * gy) * spec.cellMm;
        const proj = mx * biasDirC + my * biasDirS;
        const raw = 0.5 + 0.5 * Math.sin((2 * Math.PI * proj) / cb.period + cb.phase);
        const favour = cb.lo + (cb.hi - cb.lo) * raw;
        rr *= favour;
      }
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
  // Overlap relaxation runs in bake(), after gap-filling: gap-filling's own area-conservation rescale (see bake)
  // touches every radius in the layer and would otherwise put back-just-cleared same-colour neighbours in contact.
  return s;
}

/** Paint cannot land where paint already is. A drop falling beside another shoves it aside as it spreads, so two drops
 *  of one colour end up touching along a flattened wall — never as two circles with a waist between them, which is what
 *  a jittered lattice produces whenever two neighbours happen to jitter towards each other (the user, 2026-09-11:
 *  "peanut-like pairs of dots"). A few passes of mutual separation over the tile turn the placement into a hard-core
 *  process whose exclusion is the drops' own size: regular where the drops are big for their cell, free where they are
 *  small, which is what "regular but not too regular" comes to. Offsets stay inside the layer's jitter, so where the
 *  drops are too big to be separated at all (a ground-forming layer, radius above half a cell) they simply spread as
 *  evenly as the jitter allows and merge into the film they are meant to be. */
function relaxOverlaps(s: LayerStatic, spec: LayerSpec) {
  const J = spec.jitter;
  if (J <= 0) return;
  const at = (x: number, y: number) => ((y & (TILE - 1)) * TILE + (x & (TILE - 1)));
  for (let pass = 0; pass < 4; pass++) {
    let moved = 0;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const i = at(x, y);
        if (s.r[i] <= 0) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const j = at(x + dx, y + dy);
            if (s.r[j] <= 0 || j <= i) continue;   // each pair once
            const px = dx + s.jx[j] - s.jx[i], py = dy + s.jy[j] - s.jy[i];
            const d = Math.hypot(px, py);
            const want = s.r[i] + s.r[j];
            if (d >= want || d < 1e-6) continue;
            const push = Math.min((want - d) * 0.5, 0.25);   // half the overlap each, and never a wild jump
            const ux = px / d, uy = py / d;
            s.jx[i] = Math.max(-J, Math.min(J, s.jx[i] - ux * push));
            s.jy[i] = Math.max(-J, Math.min(J, s.jy[i] - uy * push));
            s.jx[j] = Math.max(-J, Math.min(J, s.jx[j] + ux * push));
            s.jy[j] = Math.max(-J, Math.min(J, s.jy[j] + uy * push));
            moved++;
          }
        }
      }
    }
    if (!moved) break;
  }
  // A same-colour trio (or denser knot) can leave a pair that position alone never clears: separating A from B
  // reopens A from C, so the loop above settles into an oscillation rather than converging (measured on dp 370's
  // light blue layer: ~1.8% of neighbour pairs stayed overlapping whether it ran 4 passes or 16, and by an
  // unchanged amount — not a slow convergence, a stuck one). Left alone, that overlap is shallow enough to read as
  // a waist between two circles rather than the flattened wall two colliding drops actually leave (peanut-shaped
  // dots, user, 2026-09-12). Position can't fix a knot placement never had room for, so the last few percent of
  // one's own radius settles it instead: shrink both drops just enough to clear, never past 70% of what they were,
  // which for the handful of drops it touches is well inside a colour's own size spread and invisible in aggregate.
  const r0 = s.r.slice();   // each drop's own radius before any shrink, as the floor's basis
  for (let pass = 0; pass < 8; pass++) {
    let shrunk = 0, sumOver = 0;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const i = at(x, y);
        if (s.r[i] <= 0) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const j = at(x + dx, y + dy);
            if (s.r[j] <= 0 || j <= i) continue;   // each pair once
            const px = dx + s.jx[j] - s.jx[i], py = dy + s.jy[j] - s.jy[i];
            const d = Math.hypot(px, py);
            const want = s.r[i] + s.r[j];
            if (d >= want) continue;
            const over = want - d;
            sumOver += over;
            const floorI = 0.7 * r0[i], floorJ = 0.7 * r0[j];
            const room = Math.max(0, s.r[i] - floorI) + Math.max(0, s.r[j] - floorJ);
            if (room < 1e-6) continue;                     // both already at the floor: leave the residue
            const cut = Math.min(over, room);
            s.r[i] = Math.max(floorI, s.r[i] - cut * (Math.max(0, s.r[i] - floorI) / room));
            s.r[j] = Math.max(floorJ, s.r[j] - cut * (Math.max(0, s.r[j] - floorJ) / room));
            shrunk++;
          }
        }
      }
    }
    if (sumOver < 1e-4) break;   // whatever remains is float noise at the d ≈ want boundary, not a real overlap
    if (!shrunk) break;
  }
  // Whatever is still overlapping past that (both drops already at their floor) is a knot too crowded for either
  // pairwise move to fully resolve: a small share of same-colour neighbours, denser since `turkishBase` started
  // drawing every Turkish-based sheet's spots ~14% larger for their cell (densityMul 1.3, added after the base
  // this session's peanut fixes were checked against) — that shift is real but affects every sheet's own fitted
  // coverage, not something to unwind here. Left as a partial overlap it is exactly the peanut waist (user,
  // 2026-09-13: "I'm still seeing peanuts... I don't remember seeing them in the first version of Turkish"); rather
  // than settle for a visible waist or reopen the whole collection's calibration, drop the SMALLER of the pair
  // outright — a stone base throws far more drops than any one comb pass draws out, so losing the rare one a knot
  // has no room for is invisible in the aggregate, where a lingering seam between two circles is not.
  // Clear/dispersant layers (gall water: colours = [-1], see Builder.sprinkle) are the wrong target for this: their
  // own jitter is large relative to their tiny radius by design (a fine, dense scatter, not a few big spots), so
  // "still overlapping after the floor" is normal there, not a knot. `spec.rMax` (0.8 for "small", set whenever
  // `sprinkleStats` computes a radius ≤ 0.3 cells — true of most of a sheet's actual pigment spots too, not just
  // gall water) is NOT the right signal to gate on: it disabled this pass for every colour layer on dp 370, not
  // just the one it was meant for. `colours[0] === -1` is what actually marks a dispersant/clear layer. Applying
  // this pass to the gall layer regardless ate 14780 of 16384 cells on first try (nearly the whole layer), erasing
  // the fine paper speckle it exists to draw.
  if (spec.colours[0] === -1) return;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = at(x, y);
      if (s.r[i] <= 0) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const j = at(x + dx, y + dy);
          if (s.r[j] <= 0 || j <= i) continue;   // each pair once
          const px = dx + s.jx[j] - s.jx[i], py = dy + s.jy[j] - s.jy[i];
          const d = Math.hypot(px, py);
          const want = s.r[i] + s.r[j];
          if (d >= want - 1e-3) continue;        // not floating-point noise
          if (s.r[i] <= s.r[j]) s.r[i] = 0; else s.r[j] = 0;
        }
      }
    }
  }
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
      // Run last, after any gap-fill: gap-fill's own per-cell discount and its area-conserving rescale (above)
      // touch every radius in the layer and would otherwise put back-just-separated same-colour neighbours in
      // contact (a rescale that grows the layer's radii overall can only ever push overlap back in, never out).
      relaxOverlaps(st, spec);
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
