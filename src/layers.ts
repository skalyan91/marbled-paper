// Per-layer drop data baked into a TEXTURE_2D_ARRAY slice (RGBA16F, TILE×TILE).
// Static structure (jitter, radius, colour, animation phases) is generated from a
// seed once; the animated position/radius is re-baked every frame on the CPU.

export const TILE = 128;
export const MAX_LAYERS = 8;

export interface LayerSpec {
  cellMm: number; // grid cell size in bath millimetres
  jitter: number; // max offset from cell centre, in cells (≤ 0.45)
  radius: number; // mean radius in cells (≤ 0.65)
  radiusSigma: number; // log-normal sigma
  colours: number[]; // palette indices; -1 = clear (dispersant only)
  fill: number; // probability a cell has a drop (spatter layers < 1)
  animAmp: number; // animation amplitude in cells
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
  };
  const rnd = mulberry32(spec.seed * 7919 + 17);
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
    }
  }
  return s;
}

export class LayerBank {
  gl: WebGL2RenderingContext;
  tex: WebGLTexture;
  statics: (LayerStatic | null)[] = [];
  keys: string[] = [];
  scratch = new Float32Array(TILE * TILE * 4);

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA16F, TILE, TILE, MAX_LAYERS);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
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

  /** Re-bake slice `slot` for time t (seconds). Static data cached by spec key. */
  bake(slot: number, spec: LayerSpec, t: number, animate: boolean) {
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
    const amp = animate ? spec.animAmp : 0;
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
      d[o + 2] = r0 * (1 + (animate ? 0.06 : 0) * Math.sin(s.w[p + 2] * t * 0.7 + s.ph[p + 2]));
      d[o + 3] = s.col[i];
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, slot, TILE, TILE, 1, gl.RGBA, gl.FLOAT, d);
  }
}
