#version 300 es
// Marbled paper: closed-form inverse homeomorphisms (after Lu, Jaffer et al.)
// + a paper/pigment drying model. Everything is evaluated per pixel; no state.
// A 2×2 Jacobian (bath mm per screen pixel) is carried through every inverse
// operator: it gives the film stretch for the drying model, the pixel-space
// distance to a drop outline for analytic anti-aliasing, and texture LODs.
precision highp float;
precision highp int;
precision highp sampler2DArray;

#define NEIGH __NEIGH__
#define MAX_OPS 48
#define TILE 128

uniform vec2 uResolution;
uniform float uPxPerMm;
uniform float uTime;
uniform int uOpCount;   // ops [0, uOpCount) : top pattern (already reversed)
uniform int uOpCount2;  // ops [uOpCount, uOpCount+uOpCount2) : under pattern
uniform int uUnderMode; // 0 none, 1 double marble, 2 overprint
uniform int uDebug;
uniform int uSamples;   // 0 = no edge anti-aliasing (debug), else on
uniform int uGroundUnder; // ground film colour of the under pattern (-1 none)
uniform int uProbe;     // debug 8: coverage of this palette colour (-1 = paper), weighted over the footprint pieces
uniform sampler2DArray uCells;
uniform sampler2D uNoise;
uniform sampler2D uRowShift;   // slide of each sprinkle layer, in cells: row 2·slot = per grid row along x, 2·slot+1 = per column along y
uniform vec4 uPaper;      // rgb, age
uniform vec4 uTransfer;   // mode, amp, k, angle (rad)
uniform vec4 uTransfer2;  // phase, wobble, goldNet, softPaper
uniform vec4 uDry;        // grain, stretchLimit, groundFill, seed
uniform vec4 uBleed;      // bleed mm, edge wobble, edge darkening, laid paper
uniform vec4 uPaperTex;   // laid pitch mm, chain pitch mm, tooth, granulation
uniform vec4 uSurface;    // wear (rubbed cover fibres), ...
uniform vec3 uSheetMean;   // coverage-weighted mean colour of the sheet: what the trace could not resolve inside a footprint shows as this
uniform ivec4 uInterleave; // (kx, ky, px, py): this pass shades the screen pixels x ≡ px (mod kx), y ≡ py (mod ky), one per texel of a target 1/kx × 1/ky the screen
uniform vec4 uLayerStyle[8]; // per drop layer: style bits, style param, ring amplitude (constants of the sprinkle op, looked up at shading time)

layout(std140) uniform Ops { vec4 op[MAX_OPS * 4]; };
layout(std140) uniform Palette { vec4 col[16]; vec4 pig[16]; };

out vec4 fragColor;

// ---------------------------------------------------------------- hashing
uint pcg(uint v) { v = v * 747796405u + 2891336453u; uint w = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u; return (w >> 22u) ^ w; }
float hash1(ivec2 c, int k) { return float(pcg(uint(c.x) * 1597334677u ^ uint(c.y) * 3812015801u ^ uint(k) * 2654435761u)) * (1.0 / 4294967296.0); }
vec2 hash2(ivec2 c, int k) { return vec2(hash1(c, k), hash1(c, k + 977)); }
vec4 hash4(ivec2 c, int k) { return vec4(hash1(c, k), hash1(c, k + 31), hash1(c, k + 67), hash1(c, k + 101)); }
// one hash, four 8-bit values: enough for shape wobble
vec4 hash4fast(ivec2 c, int k) { uint h = pcg(uint(c.x) * 1597334677u ^ uint(c.y) * 3812015801u ^ uint(k) * 2654435761u); return vec4(uvec4(h & 255u, (h >> 8u) & 255u, (h >> 16u) & 255u, (h >> 24u) & 255u)) * (1.0 / 255.0); }

// noise texture: r white, g smooth (8 cells), b medium (32 cells), a fine smooth (64 cells); repeats every 1 unit
// lod = log2(texels per pixel); the texture is 256 texels per unit
vec4 tnoise(vec2 p, float lod) { return textureLod(uNoise, p, lod); }
float lodFor(float lodMmPerPx, float cyclesPerMm) { return lodMmPerPx + log2(cyclesPerMm * 256.0); }

// Worley F1/F2 in an arbitrary 2D space (unit cells), returns (F1, F2)
vec2 worley(vec2 p, int seed) {
  ivec2 b = ivec2(floor(p));
  float f1 = 8.0, f2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 c = b + ivec2(i, j);
    vec2 q = vec2(c) + hash2(c, seed) - p;
    float d = dot(q, q);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return sqrt(vec2(f1, f2));
}

// ------------------------------------------------------------ hit record
// Kept small on purpose: MAXH of these live in the trace state, dynamically indexed, so every
// float here costs registers (or spills) for the whole shader. Per-layer constants (style,
// param, ring) are looked up from uLayerStyle at shading time instead of being carried.
struct Hit {
  bool hit;
  int layer;
  ivec2 cell;
  vec2 u;       // local coords inside drop, |u|<1
  int color;    // palette index, -1 clear
  vec2 S;       // bath coordinate (mm) at the moment of the hit
  float ePx;    // distance inside the drop outline, screen pixels
  mat2 J;       // d S / d pixel at the hit (mm per px)
};

Hit noHit(vec2 P) {
  Hit h;
  h.hit = false; h.layer = -1; h.cell = ivec2(0); h.u = vec2(0); h.color = -1; h.S = P; h.ePx = 0.0; h.J = mat2(1.0);
  return h;
}

// Trace state. The pixel is covered by up to MAXH "pieces" (hits with weights that sum to 1
// together with the uncovered remainder). In a wide footprint (stretched film) the pieces are
// claimed analytically along the stretch axis v: each drop takes the exact sub-interval of the
// footprint that lies inside its outline, and the trace point moves into what is left.
// MAXH sets the size of the dynamically indexed arrays below and so the register footprint of
// the whole shader: 8 → 4 was ~30 % faster on Apple GPUs with no visible change (0.05 % of the
// pixels of a Nonpareil sheet moved by more than 8/255); 2 is visibly different. Keep ≥ 3: the
// "weights" debug view reads slot 2.
#define MAXH 4
struct Trace {
  vec2 S;
  mat2 J;
  Hit hs[MAXH];
  float ws[MAXH];
  int nh;
  bool sweep;     // interval mode
  vec2 v;         // screen direction of the footprint interval (unit, px)
  float lo, hi;   // uncovered interval along v, px (footprint = [-0.5, 0.5])
  float tmid;     // interval position the trace point currently represents
  bool done;
  float fibre;    // paper fibre noise at this pixel, −1..1 (edge wobble)
  float lost;     // footprint weight of chords that found no slot (redistributed at the end)
};

// leading right singular vector of a 2×2 (direction in the input space along which |J x| is largest)
vec2 majorAxis(mat2 J) {
  float a = dot(J[0], J[0]), b = dot(J[0], J[1]), d = dot(J[1], J[1]);
  float tr = a + d, det = a * d - b * b;
  float l1 = 0.5 * tr + sqrt(max(0.25 * tr * tr - det, 0.0));
  return normalize(abs(b) > 1e-8 ? vec2(b, l1 - a) : (a >= d ? vec2(1.0, 0.0) : vec2(0.0, 1.0)));
}

// rank-1 update helper: J += s * outer(M, (N^T J))
mat2 rank1(mat2 J, vec2 M, vec2 N, float s) {
  return J + s * mat2(M * dot(N, J[0]), M * dot(N, J[1]));
}

// ------------------------------------------------------ inverse operators
#if NEIGH == 3
const float W0 = 1.5, W1 = 2.4;
#else
const float W0 = 0.9, W1 = 1.5;
#endif

// S in mm. a=(type,slot,cellMm,style) b=(ox,oy,cos,sin) c=(hashJit,wobble,param,ring)
// Candidates are visited in reverse row-major order of the absolute cell index: a consistent
// global time order for every pixel that keeps the loop uniform across a warp.
// (Within one colour layer the drop order is visually irrelevant: same-colour drops merge.)
// One candidate cell of a sprinkle layer (see invSprinkle). Windows w0/w1 in cells.
void candidate(inout Trace t, inout vec2 g, inout mat2 Jg, inout bool stop, ivec2 cc, vec2 sh, int slot, float cell, vec4 a, vec4 c, mat2 R, float bw, float w0, float w1) {
  vec4 tx = texelFetch(uCells, ivec3(cc & (TILE - 1), slot), 0);
  if (tx.z <= 0.0) return;
  vec2 C = vec2(cc) + 0.5 + tx.xy + sh;   // the drop's row or column has slid by sh cells
  vec2 q = g - C;
  float d = length(q);
  float r = tx.z;
  if (d >= w1) return;                      // outside the window: identity
  vec2 n = q / max(d, 1e-6);
  if (c.y > 0.0 && d < r * 1.6) {           // irregular outline on thin sizes
    vec4 hw = hash4fast(cc, slot + 300) * 2.0 - 1.0;
    float c2 = n.x * n.x - n.y * n.y, s2 = 2.0 * n.x * n.y;
    float c3 = n.x * (4.0 * n.x * n.x - 3.0), s3 = n.y * (3.0 - 4.0 * n.y * n.y);
    r *= 1.0 + c.y * (0.6 * (hw.x * c2 + hw.y * s2) + 0.4 * (hw.z * c3 + hw.w * s3));
  }
  float gradD = length(vec2(dot(n, Jg[0]), dot(n, Jg[1])));   // cells per pixel across the outline
  float ePx = (r - d) / max(gradD, 1e-6);
  bool inside = d < r;
  bool claimed = false;
  float wgt = 0.0;
  if (uSamples > 0 && !t.sweep && gradD >= 0.25 * r && abs(ePx) < 0.5 + bw) {
    // the footprint is wide compared with this drop: switch to interval mode
    t.sweep = true; t.v = majorAxis(Jg); t.lo = -0.5; t.hi = 0.5; t.tmid = 0.0;
    if (t.nh > 0) { t.lo = -0.5 + t.ws[0]; }   // a partial piece already claimed the near side
  }
  if (t.sweep) {
    // footprint segment g(t) = g + gv·(t − tmid): the drop claims the chord where the segment
    // crosses the disc, |q + gv·τ| < r, i.e. the roots of |gv|²τ² + 2(q·gv)τ + (|q|² − r²) = 0
    vec2 gv = Jg * t.v;                     // cells per px along the interval
    float A2 = dot(gv, gv), B2 = dot(q, gv), C2 = dot(q, q) - r * r;
    float disc = B2 * B2 - A2 * C2;
    float lo2 = t.lo, hi2 = t.hi;
    float ca = lo2, cb = lo2;
    if (A2 < 1e-12) { if (C2 < 0.0) { ca = lo2; cb = hi2; } }
    else if (disc > 0.0) {
      float sq2 = sqrt(disc);
      float t1 = t.tmid + (-B2 - sq2) / A2, t2 = t.tmid + (-B2 + sq2) / A2;
      ca = max(lo2, t1); cb = min(hi2, t2);
    }
    if (cb > ca) {
      if (cb - ca > 0.004) {                // even a hair-thin band gets its share of the pixel
        // The interval has no width across the footprint, so a streak running along it would be
        // either wholly in or wholly out and break into dashes as it wanders across the pixel row.
        // Weight the chord by the drop's coverage of the pixel's minor extent instead: the outline's
        // distance across, in pixels, blurred by the bleed as in narrow mode.
        vec2 gvu = gv / max(sqrt(A2), 1e-9);              // unit direction of the interval, in cells
        float dPerp = length(q - dot(q, gvu) * gvu);       // distance from the drop centre to the interval line
        vec2 gw = Jg * vec2(-t.v.y, t.v.x);                // cells per px across the footprint
        float gwp = length(gw - dot(gw, gvu) * gvu);       // its component across the interval
        float eW = (r - dPerp) / max(gwp, 1e-6);           // outline distance across, px (>0 inside)
        float alphaW = A2 < 1e-12 ? 1.0 : smoothstep(-bw, bw, eW + uBleed.y * bw * t.fibre);
        claimed = true; wgt = (cb - ca) * alphaW;
        t.lost += (cb - ca) * (1.0 - alphaW);            // what lies beside the streak: unresolved, shown as the sheet mean
      } else t.lost += cb - ca;                          // a chord too thin to trace: still paint, not bare ground
      // remainder: the larger of the two leftover pieces; the smaller is not traced further, so it too
      // is unresolved paint (folding it into the uncovered rest showed bare ground as a stipple wherever
      // a film is drawn out far below the pixel: the fans of a Feather)
      float left = ca - lo2, right = hi2 - cb;
      if (left >= right) { t.hi = ca; t.lost += max(right, 0.0); } else { t.lo = cb; t.lost += max(left, 0.0); }
    }
  } else {
    // narrow footprint: analytic edge coverage across the outline, blurred by the bleed
    float alpha = (uSamples > 0 && gradD < 0.25 * r) ? smoothstep(-bw, bw, ePx + uBleed.y * bw * t.fibre) : (inside ? 1.0 : 0.0);
    if (t.nh == 0 && alpha > 0.0) { claimed = true; wgt = alpha; }
    else if (t.nh > 0 && alpha > 0.0) { claimed = true; wgt = alpha * (1.0 - t.ws[0]); }   // the second piece keeps its own soft edge
  }
  if (claimed) {
    Hit h;
    h.hit = true; h.layer = slot; h.cell = cc; h.u = q / r; h.color = int(floor(tx.a + 0.5));
    h.S = t.S; h.ePx = ePx;
    h.J = transpose(R) * Jg * cell;
    // In interval mode a drawn-out film crosses the footprint many times; chords of the same
    // colour in the same layer are one piece (their paints have mingled below the pixel), so
    // the sweep can claim the whole interval exactly instead of a random subset of its chords.
    bool placed = false;
    if (t.sweep) for (int k = 0; k < MAXH; k++) {
      if (!placed && k < t.nh && t.hs[k].hit && t.hs[k].layer == slot && t.hs[k].color == h.color) { t.ws[k] += wgt; placed = true; }
    }
    if (!placed) { if (t.nh < MAXH) { t.hs[t.nh] = h; t.ws[t.nh] = wgt; t.nh++; } else t.lost += wgt; }
    if (t.sweep) {
      if (t.hi - t.lo < 0.004) { stop = true; t.done = true; return; }
      float nm = 0.5 * (t.lo + t.hi);
      g += (Jg * t.v) * (nm - t.tmid);      // move the trace point into the uncovered remainder
      t.tmid = nm;
      q = g - C; d = length(q); n = q / max(d, 1e-6);
      if (d < r) { d = r * 1.001; g = C + n * d; q = g - C; }   // numerically just outside
    } else {
      if (wgt >= 1.0 - 1e-4 || t.nh >= 3) { stop = true; t.done = true; return; }
      if (inside) {
        // the material just outside this outline came from the drop's centre before it landed
        g = C + n * 0.02;
        Jg *= 0.05;
        return;
      }
      // outside but within the bleed: displace normally to find what lies behind
    }
  }
  // windowed inverse drop displacement g' = C + phi(d) q, and its Jacobian
  float tt = clamp((d - w0) / (w1 - w0), 0.0, 1.0);
  float w = 1.0 - tt * tt * (3.0 - 2.0 * tt);
  float dw = -6.0 * tt * (1.0 - tt) / (w1 - w0);
  float sq = sqrt(max(d * d - r * r, 1e-8));
  float dn = d - w * (d - sq);
  float ddn = 1.0 - dw * (d - sq) - w * (1.0 - d / sq);
  float phi = dn / d;
  float phid = ddn - phi;                   // phi'(d) * d
  Jg = phi * Jg + phid * mat2(n * dot(n, Jg[0]), n * dot(n, Jg[1]));
  // keep the Jacobian finite: beyond ~1e5 cells per pixel the stretch is effectively infinite anyway
  float jn = max(length(Jg[0]), length(Jg[1]));
  if (!(jn < 1e5)) Jg *= (jn > 0.0 && jn < 1e30) ? 1e5 / jn : 0.0;
  g = C + q * phi;
}

void invSprinkle(inout Trace t, vec4 a, vec4 b, vec4 c, vec4 d4) {
  int slot = int(a.y + 0.5);
  float cell = a.z;
  mat2 R = mat2(b.z, -b.w, b.w, b.z);
  vec2 g = (R * (t.S - b.xy)) / cell;   // grid coordinates
  mat2 Jg = (R * t.J) / cell;           // d g / d pixel
  vec2 g0 = g;
  int baseX = int(floor(g.x)), baseY = int(floor(g.y));
  bool stop = false;
  float bw = max(0.5, uBleed.x * uPxPerMm);   // bleed width on the sheet, in pixels
  // two crossing streams: the drops of even grid rows slide along x (each row by its own amount),
  // those of odd rows slide along y (each column by its own amount); the candidate cells are found per stream
  int N = d4.x > 0.5 ? 1 : NEIGH;   // small-drop layer (r ≤ 0.8 cell): a 3×3 neighbourhood with a 1-cell window suffices
  float w0 = d4.x > 0.5 ? 0.6 : W0, w1 = d4.x > 0.5 ? 1.0 : W1;
  for (int oy = NEIGH; oy >= -NEIGH; oy--) {
    if (oy > N || oy < -N) continue;
    int cy = baseY + oy;
    if ((cy & 1) != 0) continue;
    float sh = texelFetch(uRowShift, ivec2(cy & (TILE - 1), 2 * slot), 0).r;
    int bx = int(floor(g0.x - sh));
    for (int ox = NEIGH; ox >= -NEIGH; ox--) {
      if (stop || ox > N || ox < -N) continue;
      candidate(t, g, Jg, stop, ivec2(bx + ox, cy), vec2(sh, 0.0), slot, cell, a, c, R, bw, w0, w1);
    }
  }
  for (int ox = NEIGH; ox >= -NEIGH; ox--) {
    if (ox > N || ox < -N) continue;
    int cx = baseX + ox;
    float sh = texelFetch(uRowShift, ivec2(cx & (TILE - 1), 2 * slot + 1), 0).r;
    int by = int(floor(g0.y - sh));
    for (int oy = NEIGH; oy >= -NEIGH; oy--) {
      if (stop || oy > N || oy < -N) continue;
      int cy = by + oy;
      if ((cy & 1) == 0) continue;
      candidate(t, g, Jg, stop, ivec2(cx, cy), vec2(0.0, sh), slot, cell, a, c, R, bw, w0, w1);
    }
  }
  if (!t.done) { t.S = b.xy + transpose(R) * (g * cell); t.J = transpose(R) * Jg * cell; }
}

// a=(type,theta,s,o) b=(z,L,kernel,...) c=(mean,...)
// Two regimes of a comb drawn through a viscous size, in the coordinate n across the stroke:
// - arc (kernel 0): the paint pushed ahead of each tine forms a front that bows between the
//   neighbouring tines and meets the next front in a cusp; the profile is a chain of arcs,
//   K = sqrt(1 − 4f² + ε) with f the position in the gap. Broad rounded tongues, cusped valleys,
//   the flanks drawn into hair lines (nonpareil, dp 82; the arches of a wide comb, dp 274).
//   A cusped bell (exponential) gives pointed tongues and straight-sided zigzags instead.
// - wake (kernel 1): widely set teeth pulled hard. Each tine carries a band of half-width L that
//   moves with it almost rigidly, and the drag falls off fast beyond it: K = 1 / (1 + (d/L)⁶).
//   Drawn across and back with halving, a line crossing the stroke is drawn into straight columns
//   of parallel lines along each tine's path (the quills) joined by sigmoids of opposite sense in
//   alternate gaps, crossing the gap at ~45° midway (Feather, dp 29). Slow tails (1/d) do not do
//   this: they make every line near-parallel to the stroke and the columns wavy. The nine nearest
//   tines are summed (the set changes at the mid-gap where the two ends contribute equally).
// The mean drag (c.x) is removed in both.
void invComb(inout Trace t, vec4 a, vec4 b, vec4 c) {
  vec2 M = vec2(cos(a.y), sin(a.y));
  vec2 N = vec2(-M.y, M.x);
  float s = a.z, L = b.y;
  float n = dot(t.S, N) - a.w;
  float sum = 0.0, dsum = 0.0;
  if (b.z < 0.5) {
    float f = fract(n / s + 0.5) - 0.5;          // −0.5..0.5 across the gap, 0 at the tine
    sum = sqrt(max(1.0 - 4.0 * f * f, 0.0) + 0.02);
    dsum = -4.0 * f / (2.0 * sum * s);
  } else {
    float kn = floor(n / s + 0.5);
    for (int j = -4; j <= 4; j++) {
      float u = (n - (kn + float(j)) * s) / L;
      float u2 = u * u, u4 = u2 * u2;
      float q = 1.0 / (1.0 + u4 * u2);
      sum += q;
      dsum -= 6.0 * u4 * u * q * q / L;
    }
  }
  t.S -= b.x * (sum - c.x) * M;
  t.J = rank1(t.J, M, N, -b.x * dsum);
}

// a=(type,theta,A,k) b=(phi,...)
void invShear(inout Trace t, vec4 a, vec4 b) {
  vec2 M = vec2(cos(a.y), sin(a.y));
  vec2 N = vec2(-M.y, M.x);
  float ph = a.w * dot(t.S, N) + b.x;
  t.S += a.z * sin(ph) * M;
  t.J = rank1(t.J, M, N, a.z * a.w * cos(ph));
}

void invVortexAt(inout vec2 S, inout mat2 J, vec2 C, float z, float L, float r, float core, float sgn, float w) {
  vec2 q = S - C;
  float d = length(q);
  float dm = max(d, core);
  float ex = exp(-max(0.0, d - r) / L);
  float ang = -sgn * w * z * ex / dm;
  float dang = ang * (-(d > r ? 1.0 / L : 0.0) - (d > core ? 1.0 / d : 0.0));
  float cs = cos(ang), sn = sin(ang);
  mat2 Rm = mat2(cs, sn, -sn, cs);
  vec2 rq = Rm * q;
  vec2 n = q / max(d, 1e-6);
  vec2 dRq = vec2(-rq.y, rq.x);
  J = Rm * J + mat2(dRq * (dang * dot(n, J[0])), dRq * (dang * dot(n, J[1])));
  S = C + rq;
}

// a=(type,cx,cy,z) b=(L,r,core,sign)
void invVortex(inout Trace t, vec4 a, vec4 b) { invVortexAt(t.S, t.J, a.yz, a.w, b.x, b.y, b.z, b.w, 1.0); }

// a=(type,cell,jitter,z) b=(L,r,core,alt) c=(ox,oy,cos,sin) d=(seed,...)
void invVortexGrid(inout Trace t, vec4 a, vec4 b, vec4 c, vec4 d) {
  float cell = a.y;
  mat2 R = mat2(c.z, -c.w, c.w, c.z);
  vec2 g = (R * (t.S - c.xy)) / cell;
  mat2 Jg = (R * t.J) / cell;
  ivec2 base = ivec2(floor(g));
  int seed = int(d.x);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 cc = base + ivec2(i, j);
    vec2 C = vec2(cc) + 0.5 + (hash2(cc, seed) - 0.5) * 2.0 * a.z;
    float sgn = b.w > 0.5 ? (((cc.x + cc.y) & 1) == 0 ? 1.0 : -1.0) : (hash1(cc, seed + 5) < 0.5 ? 1.0 : -1.0);
    float dd = length(g - C);
    float w = 1.0 - smoothstep(0.9, 1.45, dd);
    if (w > 0.0) invVortexAt(g, Jg, C, a.w / cell, b.x / cell, b.y / cell, b.z / cell, sgn, w);
  }
  t.S = c.xy + transpose(R) * (g * cell);
  t.J = transpose(R) * Jg * cell;
}

// Oseen short stroke (Jaffer 2017 eq. 14/15), run backwards; Jacobian left unchanged (approximate).
void invStroke(inout Trace t, vec4 a, vec4 b) {
  vec2 B = a.yz, E = vec2(a.w, b.x);
  float L = max(b.y, 0.5);
  vec2 D = E - B;
  float lam = length(D);
  vec2 N = D / max(lam, 1e-4);
  vec2 Np = vec2(-N.y, N.x);
  int n = int(clamp(ceil(lam / L), 1.0, 12.0));
  vec2 I = D / float(n);
  float ell = length(I);
  vec2 S = t.S;
  for (int i = 12; i >= 1; i--) {
    if (i > n) continue;
    vec2 bb = B + I * float(i - 1), ee = B + I * float(i);
    float xB = dot(N, S - bb), xE = dot(N, S - ee);
    float y = dot(Np, S - (bb + ee) * 0.5);
    float r = sqrt(xB * xB + y * y) + 1e-4, s = sqrt(xE * xE + y * y) + 1e-4;
    float er = exp(-r / L), es = exp(-s / L);
    float Fx = 0.5 * ((1.0 - y * y / (r * L)) * er + (1.0 - y * y / (s * L)) * es);
    float Fy = (y / (2.0 * L)) * (xB / r * er + xE / s * es);
    S -= ell * (Fx * N + Fy * Np);
  }
  t.S = S;
}

// a=(type,theta,factor)
void invStretch(inout Trace t, vec4 a) {
  vec2 M = vec2(cos(a.y), sin(a.y));
  float k = 1.0 / a.z - 1.0;
  t.S += M * dot(t.S, M) * k;
  t.J = rank1(t.J, M, M, k);
}

Trace trace(vec2 P, float mmPerPx, float fibre, int start, int count) {
  Trace t;
  t.S = P; t.J = mat2(mmPerPx); t.nh = 0; t.sweep = false; t.v = vec2(1.0, 0.0); t.lo = -0.5; t.hi = 0.5; t.tmid = 0.0; t.done = false; t.fibre = fibre; t.lost = 0.0;
  for (int k = 0; k < MAXH; k++) { t.hs[k] = noHit(P); t.ws[k] = 0.0; }
  for (int i = 0; i < MAX_OPS; i++) {
    if (i >= count || t.done) break;
    int o = (start + i) * 4;
    vec4 a = op[o], b = op[o + 1], c = op[o + 2], d = op[o + 3];
    int ty = int(a.x + 0.5);
    if (ty == 1) invSprinkle(t, a, b, c, d);
    else if (ty == 2) invComb(t, a, b, c);
    else if (ty == 3) invShear(t, a, b);
    else if (ty == 4) invVortex(t, a, b);
    else if (ty == 5) invVortexGrid(t, a, b, c, d);
    else if (ty == 6) invStroke(t, a, b);
    else if (ty == 7) invStretch(t, a);
  }
  // uncovered remainder of the footprint: whatever lies under the last frame (paper or ground film)
  float used = 0.0;
  for (int k = 0; k < MAXH; k++) used += t.ws[k];
  float rest = t.sweep ? max(t.hi - t.lo, 0.0) : max(1.0 - used, 0.0);
  if (t.nh == 0) rest = 1.0;
  if (rest > 0.01 && t.nh < MAXH) { Hit hr = noHit(P); hr.S = t.S; hr.J = t.J; t.hs[t.nh] = hr; t.ws[t.nh] = rest; t.nh++; }
  // normalise; what found no slot (a film drawn out into more chords than MAXH across the footprint) is kept
  // as a fraction, to be shown as the sheet's mean colour rather than as a random subset of the chords
  float tot = 0.0;
  for (int k = 0; k < MAXH; k++) tot += t.ws[k];
  for (int k = 0; k < MAXH; k++) t.ws[k] /= max(tot, 1e-6);
  t.lost = t.lost / max(t.lost + tot, 1e-6);
  return t;
}

// ------------------------------------------------------------- shading
// largest singular value of J (mm/px) times px/mm = film stretch since the drop landed
float stretchOf(mat2 J) {
  mat2 Jn = J * uPxPerMm;
  float F = dot(Jn[0], Jn[0]) + dot(Jn[1], Jn[1]);
  float det = Jn[0].x * Jn[1].y - Jn[0].y * Jn[1].x;
  float r = sqrt(max(0.5 * (F + sqrt(max(F * F - 4.0 * det * det, 0.0))), 1e-6));
  return (r < 1e6) ? r : 1e6;                  // non-finite → effectively infinite stretch
}
float lodOf(mat2 J) { float m = max(length(J[0]), length(J[1])); return log2((m < 1e6 && m > 0.0) ? max(m, 1e-6) : 1e6); }

// Paper surface: returns colour; writes fibre (−1..1, anisotropic streaks) and tooth (0..1, hollows = 0)
vec3 paperColor(vec2 P, float soft, float lodScr, out float fibre, out float tooth) {
  vec2 q = P * 0.02;
  float f1 = tnoise(q * vec2(0.7, 4.0), lodFor(lodScr, 0.08)).a, f2 = tnoise(q * vec2(4.0, 0.7) + 0.37, lodFor(lodScr, 0.08)).a;
  float fib = (f1 + f2) - 1.0;
  float fine = tnoise(P * 0.35, lodFor(lodScr, 0.35)).r - 0.5;
  float mid = tnoise(P * 0.09 + 0.3, lodFor(lodScr, 0.09)).a - 0.5;
  float low = tnoise(P * 0.004 + 0.11, lodFor(lodScr, 0.004)).g - 0.5;
  // surface relief at fixed physical scales, whatever the zoom: fibre flocs (0.4 mm), formation
  // mottle (1 and 0.5 mm) and fibre fuzz (0.2 and 0.1 mm). Measured on 400 ppi scans of 19th-c.
  // book covers, every colour carries this mottle; it is what makes the sheet read as paper.
  float floc = tnoise(P * 0.078 + 0.53, lodFor(lodScr, 0.078)).b - 0.5;
  float form = tnoise(P * 0.125 + 0.21, lodFor(lodScr, 0.125)).g - 0.5;
  float fuzz = tnoise(P * 0.078 + 0.77, lodFor(lodScr, 0.078)).a - 0.5;
  fibre = clamp(fib * 1.5 + fine * 0.8, -1.0, 1.0);
  tooth = clamp(0.5 + 1.2 * floc + 0.9 * form + 0.8 * fuzz + 0.35 * fib + 0.3 * fine + 0.3 * mid, 0.0, 1.0);
  vec3 c = uPaper.rgb * (1.0 + 0.08 * fib + 0.05 * fine + 0.04 * mid + 0.06 * floc + 0.05 * form + 0.04 * fuzz);
  // laid and chain lines of hand-made paper (visible where the sheet is thinner)
  if (uBleed.w > 0.5) {
    float laid = 0.5 + 0.5 * sin(6.2831853 * P.y / uPaperTex.x + 0.7 * fine);
    float chain = 1.0 - smoothstep(0.35, 0.9, abs(fract(P.x / uPaperTex.y + 0.5) - 0.5) * uPaperTex.y);
    float lodLaid = lodFor(lodScr, 1.0 / uPaperTex.x);
    float vis = clamp(1.0 - lodLaid * 0.7, 0.0, 1.0);   // fade when the pitch is under a pixel
    c *= 1.0 + vis * (0.035 * (laid - 0.5) + 0.03 * chain);
  }
  vec3 aged = c * vec3(0.90, 0.82, 0.68);
  c = mix(c, aged, uPaper.a * (0.35 + 0.65 * smoothstep(-0.2, 0.3, low)));
  if (soft > 0.5) c = mix(c, vec3(0.97, 0.96, 0.93), 0.6);
  return c;
}

// Style-dependent coverage / colour inside a drop. Returns coverage multiplier, modifies colour.
float styleCoverage(Hit h, inout vec3 colr, float lodMat, float sig) {
  float cov = 1.0;
  float fade = clamp(4.0 / sig, 0.0, 1.0);   // drop-frame textures vanish once the film is stretched
  float ul = length(h.u);
  vec4 ls = uLayerStyle[h.layer];
  int st = int(ls.x + 0.5);
  float p = ls.y, ring = ls.z;
  vec4 hr = hash4(h.cell, h.layer + 71);
  if ((st & 64) != 0 || ring > 0.0) { // RINGED: faint concentric pulses
    float amp = max(ring, 0.05) * 0.6 * fade;
    float wobble = 0.35 * (tnoise(h.u * 0.6 + hr.zw, 0.0).g - 0.5);
    colr *= 1.0 + amp * sin(ul * (9.0 + 4.0 * hr.x) + hr.y * 6.28 + wobble * 6.0) * (0.3 + 0.7 * ul);
  }
  if ((st & 2) != 0) { // HALO: clear annulus at rim, darker centre
    cov *= 1.0 - smoothstep(0.80, 0.86, ul) * (1.0 - smoothstep(0.96, 1.0, ul));
    colr *= 1.0 - 0.28 * p * (1.0 - smoothstep(0.0, 0.7, ul));
  }
  if ((st & 4) != 0) { // PARTRIDGE: speckled with clear cells
    vec2 w = worley(h.u * (9.0 + 3.0 * hr.z), h.layer + 11);
    cov *= mix(1.0, smoothstep(0.30 * p, 0.42 * p, w.x), fade);
    colr *= 1.0 + 0.25 * (tnoise(h.u * 1.7 + hr.xy, 3.0).r - 0.5);
  }
  if ((st & 8) != 0) { // SHOT: sparse eyes with a pale ring and dark centre
    vec2 w = worley(h.u * 3.5 + hr.xy * 4.0, h.layer + 23);
    float e = w.x;
    float ring = smoothstep(0.10, 0.13, e) * (1.0 - smoothstep(0.22, 0.26, e));
    cov *= 1.0 - 0.45 * ring;                      // the dispersant thins the ring, it does not clear it (dp 76: pale halos, ground only glimpsed)
    colr *= 1.0 + 0.35 * ring;                     // and the thinned film reads paler
    colr *= mix(0.35, 1.0, smoothstep(0.08, 0.12, e));
    colr *= 1.0 + 0.3 * (tnoise(h.u * 1.3 + hr.zw, 2.0).b - 0.5);
  }
  if ((st & 16) != 0) { // LACY: many small clear holes
    vec2 w = worley(h.u * (16.0 + 4.0 * hr.w), h.layer + 37);
    cov *= mix(1.0, smoothstep(0.24 * p, 0.34 * p, w.x), fade);
  }
  if ((st & 32) != 0) { // TIGER: soft dark pupil, pale iris, many fine low-contrast rays (UW dp 162/163/257)
    float th = atan(h.u.y, h.u.x);
    float nr = 40.0 + floor(hr.x * 24.0);
    float rays = 0.5 + 0.5 * sin(th * nr + hr.y * 6.28 + 2.0 * ul + 0.6 * (tnoise(h.u * 2.0 + hr.zw, 2.0).g - 0.5) * nr * 0.15);
    float iris = smoothstep(0.12, 0.30, ul);
    cov *= mix(1.0, 0.78 + 0.22 * rays, iris);                                   // rays thin the film slightly, never open it
    colr *= mix(0.22, 1.0, smoothstep(0.10, 0.26, ul));                          // the pupil: film piled dark at the centre
    colr *= 1.0 + 0.28 * smoothstep(0.14, 0.26, ul) * (1.0 - smoothstep(0.32, 0.7, ul)); // pale iris fading outward
    colr *= 1.0 + 0.10 * (rays - 0.5) * iris;
  }
  if ((st & 256) != 0) { // SOFT: wet-paper edge
    float n = tnoise(h.S * 0.03 + hr.xy, lodFor(lodMat, 0.03)).g - 0.5;
    cov *= 1.0 - smoothstep(0.55, 1.0, ul + 0.5 * p * n);
    colr = mix(colr, colr * 1.25 + 0.05, 0.35 * (1.0 - ul));
    colr *= 1.0 - 0.15 * smoothstep(0.6, 0.95, ul + 0.3 * n);
  }
  if ((st & 512) != 0) { // BROKEN: caustic fissures
    vec2 w = worley(h.S * 0.28 + hr.xy * 3.0, h.layer + 41);
    cov *= smoothstep(0.03, 0.10, w.y - w.x) * smoothstep(0.02, 0.08, w.x);
    colr *= 0.85 + 0.3 * tnoise(h.S * 0.08, lodFor(lodMat, 0.08)).b;
  }
  if ((st & 1024) != 0) { // GALLDOTS: a few small clear spots where gall broke the film
    vec2 w = worley(h.u * 2.6 + hr.zw * 3.0, h.layer + 53);
    float rr = 0.10 + 0.08 * hr.x;
    float keep = step(0.55, hash1(h.cell + ivec2(int(floor(h.u.x * 2.6 + hr.z * 3.0)), int(floor(h.u.y * 2.6 + hr.w * 3.0))), 9));
    cov *= 1.0 - keep * (1.0 - smoothstep(rr, rr + 0.05, w.x));
  }
  if ((st & 128) != 0) { // METALLIC: bronze sheen
    float sp = tnoise(h.S * 0.9, lodFor(lodMat, 0.9)).r;
    colr = mix(colr, colr * 1.7 + 0.1, smoothstep(0.55, 0.95, sp) * 0.7);
    colr *= 0.85 + 0.3 * tnoise(h.S * 0.15, lodFor(lodMat, 0.15)).a;
  }
  return cov;
}

// Transfer-stage density modulation (paper rocked / dragged as it is laid)
float transferShade(vec2 P, float lodScr) {
  int mode = int(uTransfer.x + 0.5);
  if (mode == 0) return 1.0;
  float amp = uTransfer.y, k = uTransfer.z, ang = uTransfer.w;
  float wob = uTransfer2.y;
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 nrm = vec2(-dir.y, dir.x);
  float n = dot(P, nrm);
  float wn = (tnoise(P * 0.012, lodFor(lodScr, 0.012)).g - 0.5) * 2.0;
  float shade = 1.0;
  if (mode == 1 || mode == 4) {
    float x = k * n + uTransfer2.x + wob * 5.0 * wn + wob * 0.6 * (tnoise(P * 0.05, lodFor(lodScr, 0.05)).b - 0.5);
    float b = fract(x / 6.2831853);
    float band = smoothstep(0.0, 0.45, b) * (1.0 - smoothstep(0.55, 0.85, b));
    shade = 1.0 - amp * 0.55 * band;
  } else if (mode == 2) {
    float x1 = k * n + uTransfer2.x + wob * 6.0 * wn;
    vec2 d2 = vec2(cos(ang - 1.22), sin(ang - 1.22));
    float n2 = dot(P, vec2(-d2.y, d2.x));
    float x2 = k * 1.25 * n2 + 1.0 + wob * 6.0 * (tnoise(P * 0.009 + 0.5, lodFor(lodScr, 0.009)).g - 0.5) * 2.0;
    float b1 = 0.5 + 0.5 * sin(x1), b2 = 0.5 + 0.5 * sin(x2);
    shade = 1.0 - amp * 0.45 * (b1 * b1 * 0.7 + b2 * b2 * 0.5);
  } else if (mode == 3 || mode == 6) {
    float m = dot(P, dir);
    float st = tnoise(vec2(n * k * 0.35, m * 0.01), lodFor(lodScr, k * 0.35)).b;
    float st2 = tnoise(vec2(n * k * 0.9 + 0.3, m * 0.004), lodFor(lodScr, k * 0.9)).a;
    shade = 1.0 - amp * (0.5 * smoothstep(0.35, 0.75, st) + 0.3 * smoothstep(0.4, 0.8, st2));
  } else if (mode == 5) {
    vec2 d2 = vec2(-dir.y, dir.x);
    float t1 = tnoise(vec2(dot(P, nrm) * k * 0.4, dot(P, dir) * 0.015), lodFor(lodScr, k * 0.4)).b;
    float t2 = tnoise(vec2(dot(P, dir) * k * 0.4 + 0.5, dot(P, d2) * 0.015), lodFor(lodScr, k * 0.4)).a;
    shade = 1.0 - amp * 0.45 * (smoothstep(0.45, 0.8, t1) + smoothstep(0.45, 0.8, t2));
  }
  return shade;
}

struct Shaded { vec3 rgb; float cov; float stretch; };

Shaded shadePattern(Hit h, vec2 P, vec3 paper, float lodScr, float tooth, int gf) {
  Shaded s;
  s.stretch = 1.0;
  s.cov = 0.0;
  s.rgb = paper;
  if (h.hit && h.color < 0) return s;           // clear (gall) spot: the film was pushed aside, paper shows
  if (!h.hit) {
    if (gf >= 0) {                              // ground film: the first colour, thrown over the whole bath
      s.rgb = col[gf].rgb * (0.96 + 0.08 * (tnoise(h.S * 0.05, lodFor(lodScr, 0.05)).g - 0.5));
      float gsig = stretchOf(h.J);
      float gfilm = pow(clamp(uDry.y / gsig, 0.0, 1.0), 0.35);
      s.cov = pig[gf].x * mix(0.75 + 0.25 * tooth, 1.0, gfilm * 0.6) * transferShade(P, lodScr);
      s.cov *= (1.0 - uPaperTex.z * 0.4 * (0.5 - tooth)) * (1.0 - uSurface.x * smoothstep(0.78, 0.92, tooth));   // same take-up and wear as a drop
      s.stretch = gsig;
    }
    return s;
  }
  vec3 base = col[h.color].rgb;
  vec4 pg = pig[h.color];
  float sig = stretchOf(h.J);
  float lodMat = lodOf(h.J);
  s.stretch = sig;
  float film = pow(clamp(uDry.y / sig, 0.0, 1.0), 0.35);
  // material-space grain, advected with the paint (only breaks the film where it is drawn very thin)
  float gA = tnoise(h.S * 0.45 + float(h.layer) * 0.13, lodFor(lodMat, 0.45)).r;
  float gB = tnoise(h.S * 0.12, lodFor(lodMat, 0.12)).a;
  float g = 0.6 * gA + 0.4 * gB;
  float grain = uDry.x * pg.y;
  float cov = pg.x * clamp(0.85 + 0.15 * film + (g - 0.5) * grain * (1.0 - film) * 0.6, 0.0, 1.0);
  // absorption into the sheet: the film takes unevenly on the fibre relief (stretch-independent)
  cov *= 1.0 - uPaperTex.z * 0.4 * (0.5 - tooth);
  // wear: on a handled cover the raised fibres rub bare, pale specks on every colour
  cov *= 1.0 - uSurface.x * smoothstep(0.78, 0.92, tooth);
  // granulation: heavy pigments settle in the hollows (darker), pale ones stay even
  base *= 1.0 - uPaperTex.w * pg.y * 0.25 * (tooth - 0.5);
  // pigment texture (slight value variation, stronger for earths)
  base *= 1.0 + (0.10 + 0.12 * pg.y) * (gB - 0.5);
  cov *= styleCoverage(h, base, lodMat, sig);
  cov *= transferShade(P, lodScr);
  // pigment piles up slightly at the gall front (drop outline)
  float rimPx = min(0.3 * uPxPerMm, 3.0);
  if (uTransfer2.w < 0.5) base *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, rimPx, h.ePx));
  s.rgb = base;
  s.cov = clamp(cov, 0.0, 1.0);
  return s;
}

vec3 compose(vec3 under, Shaded s, float alpha) {
  // paint over paper/under: mostly opaque, slightly multiplicative so the paper warmth shows in thin films
  vec3 painted = s.rgb * mix(vec3(1.0), under / max(max(under.r, under.g), max(under.b, 0.3)), 0.12);
  return mix(under, painted, s.cov * alpha);
}

// Full result of one op chain at P: the weighted pieces of the pixel footprint, with wet-edge
// mingling where two paints meet inside the footprint.
Shaded shadeChain(Trace t, vec2 P, vec3 paper, float lodScr, float tooth, int gf, out vec3 rgbOut) {
  Shaded ps[MAXH];
  for (int k = 0; k < MAXH; k++) {
    if (t.ws[k] <= 0.0) { ps[k].cov = 0.0; ps[k].rgb = paper; ps[k].stretch = 1.0; continue; }
    ps[k] = shadePattern(t.hs[k], P, paper, lodScr, tooth, gf);
  }
  for (int k = 0; k + 1 < MAXH; k++) {
    if (t.ws[k] <= 0.0 || t.ws[k + 1] <= 0.0) continue;
    float meet = 4.0 * t.ws[k] * t.ws[k + 1] * ps[k].cov * ps[k + 1].cov;
    vec3 mixed = sqrt(max(ps[k].rgb * ps[k + 1].rgb, 0.0));
    ps[k].rgb = mix(ps[k].rgb, mixed, 0.5 * meet) * (1.0 - uBleed.z * meet);
    ps[k + 1].rgb = mix(ps[k + 1].rgb, mixed, 0.5 * meet) * (1.0 - uBleed.z * meet);
  }
  Shaded s;
  s.cov = 0.0; s.rgb = vec3(0.0); s.stretch = ps[0].stretch;
  for (int k = 0; k < MAXH; k++) { float cw = t.ws[k] * ps[k].cov; s.cov += cw; s.rgb += ps[k].rgb * cw; }
  s.rgb = s.cov > 1e-4 ? s.rgb / s.cov : ps[0].rgb;
  // the unresolved share of the footprint: the paint drawn out below the pixel, averaged
  if (t.lost > 0.0) { s.rgb = mix(s.rgb, uSheetMean, t.lost); s.cov = mix(s.cov, 1.0, t.lost); }
  rgbOut = s.rgb;
  return s;
}

vec3 goldNet(vec2 P, vec3 c, float amp, float lodScr) {
  vec2 w1 = worley(P * 0.085 + 0.2, 901);
  vec2 w2 = worley(P * 0.21 + 0.7, 902);
  float e1 = 1.0 - smoothstep(0.04, 0.10, w1.y - w1.x);
  float e2 = 1.0 - smoothstep(0.03, 0.08, w2.y - w2.x);
  float net = clamp(e1 + 0.6 * e2, 0.0, 1.0) * amp;
  float sp = tnoise(P * 0.8, lodFor(lodScr, 0.8)).r;
  vec3 gold = mix(vec3(0.72, 0.56, 0.22), vec3(0.95, 0.82, 0.45), smoothstep(0.4, 0.9, sp));
  return mix(c, gold, net * 0.92);
}

void main() {
  vec2 fc = gl_FragCoord.xy;   // screen pixel centre
  if (uInterleave.x > 1 || uInterleave.y > 1) fc = (fc - 0.5) * vec2(uInterleave.xy) + vec2(uInterleave.zw) + 0.5;
  vec2 P = (fc - 0.5 * uResolution) / uPxPerMm;
  float mmPerPx = 1.0 / uPxPerMm;
  float soft = uTransfer2.w;
  float lodScr = log2(mmPerPx);
  float fibre, tooth;
  vec3 paper = paperColor(P, soft, lodScr, fibre, tooth);

  Trace t = trace(P, mmPerPx, fibre, 0, uOpCount);
  Hit h = t.hs[0];
  { float wb = t.ws[0]; for (int k = 1; k < MAXH; k++) if (t.ws[k] > wb) { wb = t.ws[k]; h = t.hs[k]; } }

  if (uDebug == 1) { fragColor = vec4(h.hit && h.color >= 0 ? hash4(h.cell, h.layer).rgb : vec3(0.1), 1.0); return; }
  if (uDebug == 7) { // flat palette colours for coverage measurement; paper/clear = black
    int gf = int(uDry.z + 0.5) - 1;
    vec3 fc = vec3(0.0);
    if (h.hit && h.color >= 0) fc = vec3(float(h.color + 1) / 32.0);
    else if (!h.hit && gf >= 0) fc = vec3(float(gf + 1) / 32.0);
    fragColor = vec4(fc, 1.0); return;
  }
  if (uDebug == 2) { vec2 gr = abs(fract(h.S / 10.0) - 0.5); float l = smoothstep(0.03, 0.0, min(gr.x, gr.y) - 0.45); fragColor = vec4(mix(vec3(0.15, 0.2, 0.3), vec3(1.0), l), 1.0); return; }
  if (uDebug == 3) { float st = log2(stretchOf(h.J)) / 4.0; fragColor = vec4(mix(vec3(0.05, 0.1, 0.4), vec3(1.0, 0.9, 0.2), clamp(st, 0.0, 1.0)) * (h.hit ? 1.0 : 0.2), 1.0); return; }
  if (uDebug == 5) { fragColor = vec4(paper, 1.0); return; }
  if (uDebug == 6) { fragColor = vec4(t.sweep ? vec3(1.0, 0.3, 0.2) : (t.nh > 1 ? vec3(0.2, 0.8, 0.3) : vec3(0.1)), 1.0); return; }
  if (uDebug == 8) { // exact area fraction of one colour: sum of piece weights (ground film counts for its colour)
    int gf = int(uDry.z + 0.5) - 1;
    float cov = 0.0, bare = 0.0;
    for (int k = 0; k < MAXH; k++) {
      Hit hk = t.hs[k];
      int ck = hk.hit ? hk.color : gf;          // -1 when clear or bare paper
      if (ck == uProbe) cov += t.ws[k];
      if (ck < 0) bare += t.ws[k];
    }
    if (uUnderMode != 0 && bare > 0.0) {         // double marble / overprint: the first sheet shows through bare parts of the second
      Trace tu = trace(P, mmPerPx, fibre, uOpCount, uOpCount2);
      float cu = 0.0;
      for (int k = 0; k < MAXH; k++) { Hit hk = tu.hs[k]; int ck = hk.hit ? hk.color : uGroundUnder; if (ck == uProbe) cu += tu.ws[k]; }
      cov += bare * cu;
      if (uProbe == -1) cov -= bare * (1.0 - cu) * 0.0;   // paper probe: bare-of-both counted via cu == paper weight
    }
    fragColor = vec4(vec3(cov), 1.0); return;
  }

  vec3 dummy;
  int gfTop = int(uDry.z + 0.5) - 1;
  Shaded top = shadeChain(t, P, paper, lodScr, tooth, gfTop, dummy);
  if (uDebug == 4) { fragColor = vec4(vec3(top.cov), 1.0); return; }
  if (uDebug == 9) { fragColor = vec4(t.ws[0], t.ws[1], t.ws[2], 1.0); return; }
  if (uDebug == 10) { Shaded p0 = shadePattern(t.hs[0], P, paper, lodScr, tooth, gfTop); fragColor = vec4(p0.cov, t.hs[0].hit ? 1.0 : 0.0, float(gfTop + 1) / 32.0, 1.0); return; }
  if (uDebug == 11) { float gsig = stretchOf(t.hs[0].J); float gfilm = pow(clamp(uDry.y / gsig, 0.0, 1.0), 0.35); fragColor = vec4(gfTop >= 0 ? pig[gfTop].x : 0.0, transferShade(P, lodScr), mix(0.75 + 0.25 * tooth, 1.0, gfilm * 0.6), 1.0); return; }

  vec3 under = paper;
  if (uUnderMode != 0) {
    Trace tu = trace(P, mmPerPx, fibre, uOpCount, uOpCount2);
    Shaded u = shadeChain(tu, P, paper, lodScr, tooth, uGroundUnder, dummy);
    under = compose(paper, u, 1.0);
  }
  vec3 c;
  if (uUnderMode == 2) c = mix(under, under * top.rgb * 1.2, top.cov * 0.9);
  else c = compose(under, top, 1.0);

  if (uTransfer2.z > 0.0) c = goldNet(P, c, uTransfer2.z, lodScr);

  // gentle vignette / sheet edge shading
  vec2 v = fc / uResolution;
  c *= 1.0 - 0.10 * pow(length(v - 0.5) * 1.3, 3.0);
  fragColor = vec4(c, 1.0);
}
