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
#define MAX_OPS 72
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
uniform float uCoated;    // 1: the ground film is a coating on the paper (pseudo-marbles): thin or soft paint shows it, not bare paper
uniform vec4 uBleed;      // bleed mm, edge wobble, edge darkening, laid paper
uniform vec4 uPaperTex;   // laid pitch mm, chain pitch mm, tooth, granulation
uniform vec4 uSurface;    // wear (rubbed cover fibres), hairline mingling strength, mingling width (mm), -
uniform vec3 uSheetMean;   // coverage-weighted mean colour of the sheet: what the trace could not resolve inside a footprint shows as this
uniform vec3 uSheetMul;    // the same as a pigment mixture (coverage-weighted geometric mean): what hair-fine unresolved films read as
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
        float alphaW = A2 < 1e-12 ? 1.0 : smoothstep(-bw, bw, eW + uBleed.y * 0.35 * uPxPerMm * t.fibre);   // the outline displaced along the grain, ±0.3 mm × feathering
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
    ePx += uBleed.y * 0.35 * uPxPerMm * t.fibre;   // ±0.35 mm × the control (0.6 by default): the scans' outlines deviate 0.14–0.25 mm rms from a 0.15 mm smoothing   // the outline follows the paper's grain (see paperColor): the displaced distance is the one the rim shading sees too
    float alpha = (uSamples > 0 && gradD < 0.25 * r) ? smoothstep(-bw, bw, ePx) : (inside ? 1.0 : 0.0);
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
//   neighbouring tines and meets the next front in a cusp: a chain of tongues, each a
//   semi-elliptical head on a plateau that rides with the tine, cusped at the mid-gap (nonpareil,
//   dp 82; the arches of a wide comb, dp 191, 274). A chain of semicircles alone gives straight,
//   converging flanks once the tongues are taller than wide; a cusped bell (exponential) gives
//   pointed tongues and straight-sided zigzags; |cos|^q heads are parabolic, too pointed.
// - wake (kernel 1): widely set teeth pulled hard. The wake of a tine has nearly no width: the
//   drag is the Stokes far field of a rod drawn through a viscous fluid, logarithmic in the
//   distance, K = −½ ln(1 + (d/L)²) with a core L of half a millimetre. Its slope falls as 1/d,
//   so a line crossing the stroke runs nearly straight across most of the gap and bends only in
//   the last millimetres into the tine's path, along which the lines accumulate (the quill);
//   drawn across and back with halving, the sigmoids alternate in sense between gaps and cross
//   the gap at 65–70° midway (dp 29). A 1/d drag bends the lines into leaf-shaped eyes instead.
//   The nine nearest tines are summed (the set changes at the mid-gap where the two ends
//   contribute equally, so the sum is continuous); the mean is removed.
// The mean drag (c.x) is removed in both.
void invComb(inout Trace t, vec4 a, vec4 b, vec4 c, vec4 d) {
  vec2 M = vec2(cos(a.y), sin(a.y));
  vec2 N = vec2(-M.y, M.x);
  float s = a.z, L = b.y;
  // a comb drawn along a sinusoidal path: every tine sits at offset + b.w·sin(c.y·(M·S) + c.z) across the stroke, so the
  // wave is part of the kernel and two tine sets keep exactly the phase difference they were given, whatever the pull
  // (conjugating a straight comb by shears keyed to the stroke coordinate let the pull itself shift the phase)
  float phw = c.y * dot(t.S, M) + c.z;
  // wave shape: sinusoid, or (d.x > 0) a triangle wave of the same amplitude and period (Peacock: the two rows of
  // straight zigzag lines cross into diamonds)
  float wv, dwv;
  if (d.x > 0.5) {
    // a triangle with slightly rounded vertices (asin(k·sin)/asin(k), k = 0.97): the sides are straight to within 3 %,
    // and the slope, hence the direction of drag, turns continuously at each vertex; a sharp vertex flipped the drag
    // direction on a line across the sheet and cut the pattern there (user: "horizontal discontinuities")
    float kk = 0.97, nrm = 1.0 / asin(kk);
    float sn = sin(phw), cs = cos(phw);
    wv = nrm * asin(kk * sn);
    dwv = nrm * kk * cs * inversesqrt(max(1.0 - kk * kk * sn * sn, 1e-4));
  }
  else { wv = sin(phw); dwv = cos(phw); }
  float n = dot(t.S, N) - a.w - b.w * wv;
  float slope = b.w * c.y * dwv;               // d(tine offset)/d(stroke coordinate)
  vec2 gN = N - slope * M;
  vec2 D = normalize(M + slope * N);           // a tine drags along the tangent of its path, not along the stroke axis
  float sum = 0.0, dsum = 0.0;
  if (b.z < 0.5) {
    // tongue profile (1 − h)·(1 − |2f|^p) + h·sqrt(1 − 4f²), f = offset from the nearest tine in spacings, h = d.y the
    // head weight (0.7 spacings of tongue length, Builder.combAt), p = c.w the plateau power: a semi-elliptical head
    // (dp 82: half the width 0.06 s behind the tip, 0.8 by 0.28 s, full width by 0.7 s), then near-parallel flanks (the
    // paint inside a tongue rides almost rigidly with its tine) and a cusp zone of a tenth of the pitch at the mid-gap
    // where all the stretching sits, hair-thin (dp 82, 172, 393). Same formula as the Builder's `arc`.
    float f = n / s; f -= floor(f + 0.5);         // -0.5 .. 0.5
    float u = abs(2.0 * f);
    float h = d.y;
    float up = pow(max(u, 1e-4), c.w - 1.0);
    float P = 1.0 - up * u;
    float dP = -c.w * up * sign(f) * 2.0 / s;
    float E = sqrt(max(1.0 - u * u, 0.0));
    float dE = -4.0 * f / (max(E, 0.02) * s);
    sum = (1.0 - h) * P + h * E;
    dsum = (1.0 - h) * dP + h * dE;
  } else {
    float kn = floor(n / s + 0.5);
    for (int j = -4; j <= 4; j++) {
      float u = (n - (kn + float(j)) * s) / L;
      float w = 1.0 + u * u;
      sum -= 0.5 * log(w);
      dsum -= u / (w * L);
    }
  }
  t.S -= b.x * (sum - c.x) * D;
  t.J = rank1(t.J, D, gN, -b.x * dsum);
}

// a=(type,theta,A,k) b=(phi, noise amp mm, mm per noise unit, seed offset)
// A displacement along M that depends only on N·S is exactly invertible whatever the function; the noise term
// (three octaves of the tileable noise texture, non-repeating over a sheet) jogs drawn bands irregularly.
void invShear(inout Trace t, vec4 a, vec4 b) {
  vec2 M = vec2(cos(a.y), sin(a.y));
  vec2 N = vec2(-M.y, M.x);
  float n = dot(t.S, N);
  float ph = a.w * n + b.x;
  float disp = a.z * sin(ph);
  float slope = a.z * a.w * cos(ph);
  if (b.y > 0.0) {
    float u = n / b.z;
    vec2 q = vec2(u, b.w);
    float e = 0.002;
    vec4 n0 = tnoise(q, 0.0), nA = tnoise(q + vec2(e, 0.0), 0.0), nB = tnoise(q - vec2(e, 0.0), 0.0);
    float f0 = (n0.g - 0.5) * 2.0 + (n0.b - 0.5) + (n0.a - 0.5) * 0.5;
    float fA = (nA.g - 0.5) * 2.0 + (nA.b - 0.5) + (nA.a - 0.5) * 0.5;
    float fB = (nB.g - 0.5) * 2.0 + (nB.b - 0.5) + (nB.a - 0.5) * 0.5;
    disp += b.y * f0;
    slope += b.y * (fA - fB) / (2.0 * e * b.z);
  }
  t.S += disp * M;
  t.J = rank1(t.J, M, N, slope);
}

void invVortexAt(inout vec2 S, inout mat2 J, vec2 C, float z, float L, float r, float core, float sgn, float w) {
  vec2 q = S - C;
  float d = length(q);
  float ang, dang;
  if (r < 0.0) {
    // A stylus twirl in a viscous film. Inside the stylus path (radius R = -r) the record is kinematic: z radians of
    // rotation in the core (a rigidly turned disc of radius `core`) ramping evenly out to the path, the even pitch every
    // measured curl shows (dp 16/20/21/23/96–98/102/156/272). Outside the path the film is dragged round by viscosity
    // alone: a rotating disc in a Stokes film turns the fluid outside as (R/d)² (the 2-D rotlet), and the drag against
    // the bath floor damps it over the length L, which grows with the size's viscosity. A thin size leaves the
    // surroundings nearly still; a thick one carries the twist well beyond the path.
    float R = -r, wdt = max(R - core, 1e-3);
    if (d <= R) {
      float t = clamp((R - d) / wdt, 0.0, 1.0);
      float sm = t * t * (3.0 - 2.0 * t);
      ang = -sgn * w * z * sm;
      dang = sgn * w * z * 6.0 * t * (1.0 - t) / wdt;
    } else {
      float q = R / d, ex = exp(-(d - R) / max(L, 1e-3));
      float tail = q * q * ex;
      ang = -sgn * w * z * 0.6 * tail;                        // the film at the path turns with the stylus only in part: it slips
      dang = -sgn * w * z * 0.6 * tail * (-2.0 / d - 1.0 / max(L, 1e-3));
    }
  } else {
    float dm = max(d, core);
    float ex = exp(-max(0.0, d - r) / L);
    ang = -sgn * w * z * ex / dm;
    dang = ang * (-(d > r ? 1.0 / L : 0.0) - (d > core ? 1.0 / d : 0.0));
  }
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
    // the ramp mode (r < 0) takes z as an angle, which must not be scaled with the cell; the 1/d mode takes mm·rad
    if (w > 0.0) invVortexAt(g, Jg, C, b.y < 0.0 ? a.w : a.w / cell, b.x / cell, b.y / cell, b.z / cell, sgn, w);
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
    else if (ty == 2) invComb(t, a, b, c, d);
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
vec3 paperColor(vec2 P, float soft, float lodScr, out float fibre, out float tooth, out float grain) {
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
  // The grain a paint edge follows: on the 400–600 dpi scans (dp 80, 97, 102) every outline is ragged at 0.1–0.4 mm,
  // the paint having crept along the fibres it met, with a streaky anisotropy along the fibre direction; nothing of the
  // 3–70 mm wander the old term carried, which was invisible at the bleed's scale. Fixed physical scales (0.12 and 0.35 mm).
  // Sampled so that the texture's *texels* are the fibre features (the red channel is white noise per texel; a repeat
  // of 256 texels over 25 mm puts one texel at 0.1 mm), which the mip chain then averages correctly at any zoom. The
  // earlier sampling at 3–16 cycles per mm mapped the repeat to 0.06–0.3 mm and read a near-constant 4-texel mip.
  float g0 = tnoise(P * vec2(0.025, 0.055) + 0.29, lodFor(lodScr, 0.055)).r - 0.5;   // 0.1 mm fuzz, streaked 2:1
  float g1 = tnoise(P * vec2(0.012, 0.02) + 0.13, lodFor(lodScr, 0.02)).r - 0.5;     // 0.2–0.35 mm
  float g2 = tnoise(P * vec2(0.006, 0.01) + 0.61, lodFor(lodScr, 0.01)).r - 0.5;     // 0.4–0.7 mm
  fibre = clamp(g0 * 1.0 + g1 * 1.6 + g2 * 1.2, -1.0, 1.0);   // the edge's displacement: fibre fuzz and streaks together, so the fringe is ragged, not lumpy
  // The take-up of a film into the fibre mat: the paint is absorbed unevenly, thicker in the hollows and where the
  // fibres are dense, so the reflectance of every colour is speckled at the fibres' own scale. On the 400–600 dpi
  // scans the log-reflectance inside a film has an rms of 0.09–0.10 below 0.2 mm and 0.04–0.07 per octave from 0.2
  // to 1.6 mm, 0.15–0.21 in all (dp 97, 102). Zero mean, so the median colour the calibration matches is unchanged.
  grain = 0.55 * g0 + 0.5 * g1 + 0.3 * g2 + 0.3 * floc + 0.25 * form;   // weights set so a 600 ppi render of dp 102 gives the scan's band rms (0.1 mm ~0.07, 0.2–1.6 mm ~0.04 per octave)
  tooth = clamp(0.5 + 1.2 * floc + 0.9 * form + 0.8 * fuzz + 0.35 * fib + 0.3 * fine + 0.3 * mid + 0.35 * g1 + 0.25 * g2, 0.0, 1.0);   // and the fibre-scale grain: the film's take-up is stippled at 0.1–0.3 mm on the scans, not only mottled at 0.5–1 mm
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
  if ((st & 2048) != 0) cov *= 1.0 - smoothstep(p - 0.05, p + 0.05, ul);   // EYE: the core's soft edge
  if ((st & 4) != 0) { // PARTRIDGE: a turpentine-cut colour, speckled with paper openings
    // The openings have a fixed physical scale whatever the drop's size (dp 65: median 0.3 mm, ~1.4 per mm², plus a
    // sparser 1–2 mm class; the same in 4 mm satellites and 30 mm drops), so they are evaluated in material mm, and a
    // 1–2 mm rim of near-solid film is left at the drop's edge.
    vec2 w = worley(h.S * 1.25 + hr.xy * 7.0, h.layer + 11);   // ~1.5 openings per mm², 0.3 mm across
    vec2 w2 = worley(h.S * 0.45 + hr.zw * 5.0, h.layer + 12);   // ~0.2 per mm², ~1 mm across: these carry most of the open area
    float open1 = 1.0 - smoothstep(0.15 * p, 0.22 * p, w.x);
    float open2 = 1.0 - smoothstep(0.20 * p, 0.30 * p, w2.x);
    float rim = smoothstep(0.6 * uPxPerMm, 1.8 * uPxPerMm, h.ePx);
    cov *= 1.0 - fade * rim * max(open1, 0.8 * open2);
    colr *= 1.0 + 0.25 * (tnoise(h.S * 0.25 + hr.xy, 3.0).r - 0.5);
  }
  if ((st & 8) != 0) { // SHOT: a gall-and-oil disc with a fuzzy rim (its eyes are drawn in shadePattern, over the film)
    cov *= 1.0 - 0.45 * smoothstep(0.8, 1.0, ul) * fade;
    colr *= 1.0 + 0.25 * (tnoise(h.S * 0.35 + hr.zw * 3.0, lodFor(lodMat, 0.35)).b - 0.5);   // the film lies unevenly
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
    float st0 = 0.55 - 0.35 * clamp(p - 1.0, 0.0, 1.0);   // p > 1: a wash on wet paper (Morris), fading from a quarter of the radius out
    cov *= 1.0 - smoothstep(st0, 1.0, ul + 0.5 * p * n);
    cov *= mix(1.0, 0.55, clamp(p - 1.0, 0.0, 1.0));   // a wash is dilute: the paper shows through it (dp 280)
    // A wash on wet paper (p > 1) dries paler in the middle with a darker backrun at its edge; ink on coated paper
    // (p <= 1: tourniquet, croisé, coulé) is a solid splotch with a soft edge and nothing else (dp 387: solid black,
    // never rings).
    float wash = clamp(p - 1.0, 0.0, 1.0);
    colr = mix(colr, colr * 1.25 + 0.05, 0.35 * (1.0 - ul) * wash);
    colr *= 1.0 - 0.15 * smoothstep(0.6, 0.95, ul + 0.3 * n) * wash;
  }
  if ((st & 512) != 0) { // BROKEN: caustic fissures
    vec2 w = worley(h.S * 0.28 + hr.xy * 3.0, h.layer + 41);
    cov *= smoothstep(0.03, 0.10, w.y - w.x) * smoothstep(0.02, 0.08, w.x);
    colr *= 0.85 + 0.3 * tnoise(h.S * 0.08, lodFor(lodMat, 0.08)).b;
  }
  if ((st & 1024) != 0) { // GALLDOTS: a few clear spots where gall broke the film (dp 352: 5–10 per drop, 0.1–0.25 of its radius)
    vec2 w = worley(h.u * 1.8 + hr.zw * 3.0, h.layer + 53);
    float rr = (0.12 + 0.12 * hr.x) * p;
    float keep = step(0.5, hash1(h.cell + ivec2(int(floor(h.u.x * 1.8 + hr.z * 3.0)), int(floor(h.u.y * 1.8 + hr.w * 3.0))), 9));
    cov *= 1.0 - keep * (1.0 - smoothstep(rr, rr + 0.04, w.x));
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

Shaded shadePattern(Hit h, vec2 P, vec3 paper, float lodScr, float tooth, float grain, int gf) {
  Shaded s;
  s.stretch = 1.0;
  s.cov = 0.0;
  s.rgb = paper;
  if (h.hit && h.color < 0) return s;           // clear (gall) spot: the film was pushed aside, paper shows
  // EYE: outside the core the dispersant cleared every film to the paper (Schrottel's cream halos)
  if (h.hit && (int(uLayerStyle[h.layer].x + 0.5) & 2048) != 0 && length(h.u) > uLayerStyle[h.layer].y + 0.05) { s.rgb = mix(paper, s.rgb, 0.0); return s; }
  if (!h.hit) {
    if (gf >= 0) {                              // ground film: the first colour, thrown over the whole bath
      s.rgb = col[gf].rgb * (0.96 + 0.08 * (tnoise(h.S * 0.05, lodFor(lodScr, 0.05)).g - 0.5));
      float gsig = stretchOf(h.J);
      float gfilm = pow(clamp(uDry.y / gsig, 0.0, 1.0), 0.35);
      // A thrown film is opaque: on the scans the paper shows only in gaps, never through the colour (dp 370's red
      // rendered 8 L lighter and 20 chroma duller than the sheet with 4–14 % paper mixed in). The fibre relief
      // modulates the film's density (darker where it pools), and only the wear rubs it bare.
      s.cov = pig[gf].x * mix(0.96 + 0.04 * tooth, 1.0, gfilm * 0.6) * transferShade(P, lodScr);
      s.cov *= (1.0 - uPaperTex.z * 0.08 * (0.5 - tooth)) * (1.0 - uSurface.x * smoothstep(0.78, 0.92, tooth));
      s.rgb *= 1.0 - uPaperTex.z * 0.18 * (tooth - 0.5);
      s.rgb *= exp(uPaperTex.z * 1.6 * grain);   // absorbed unevenly into the fibres: film thickness varies at the fibres' scale (Beer–Lambert)
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
  float pgrain = uDry.x * pg.y;   // pigment grain (the Pigment grain control × the pigment's own)
  float cov = pg.x * clamp(0.95 + 0.05 * film + (g - 0.5) * pgrain * (1.0 - film) * 0.3, 0.0, 1.0);
  // absorption into the sheet: the film takes unevenly on the fibre relief (stretch-independent). Mostly a density
  // modulation (darker where it pools), only a little bare paper: see the ground film above.
  cov *= 1.0 - uPaperTex.z * 0.08 * (0.5 - tooth);
  base *= 1.0 - uPaperTex.z * 0.18 * (tooth - 0.5);
  // wear: on a handled cover the raised fibres rub bare, pale specks on every colour
  cov *= 1.0 - uSurface.x * smoothstep(0.78, 0.92, tooth);
  // granulation: heavy pigments settle in the hollows (darker), pale ones stay even
  base *= 1.0 - uPaperTex.w * pg.y * 0.25 * (tooth - 0.5);
  base *= exp(uPaperTex.z * 1.6 * grain);   // absorbed unevenly into the fibres (see paperColor): every colour speckled at 0.1–1 mm
  // pigment texture (slight value variation, stronger for earths)
  base *= 1.0 + (0.10 + 0.12 * pg.y) * (gB - 0.5);
  cov *= styleCoverage(h, base, lodMat, sig);
  if ((int(uLayerStyle[h.layer].x + 0.5) & 8) != 0) {
    // SHOT eyes: the reaction of the gall-and-oil with the film beneath pocks the disc with dark cores in paper halos.
    // Features of the disc (drawn in its material space, they move with it) and confined to it: none on the black
    // channels between discs (dp 76). Two Poisson lattices in mm: fine, ~3 per cm² of 0.6–1 mm cores in 1.5–2 mm halos,
    // and a sparse hierarchy of larger ones (0.15 per cm², cores 1.5–4 mm in halos to 9 mm).
    vec4 hr2 = hash4(h.cell, h.layer + 71);
    vec2 wf = worley(h.S * 0.33 + hr2.xy * 7.0, h.layer + 23);           // 3 mm cells
    vec2 wc = worley(h.S * 0.085 + hr2.zw * 5.0, h.layer + 29);          // 12 mm cells
    ivec2 cc = ivec2(floor(h.S * 0.085 + hr2.zw * 5.0));
    float keep = step(0.55, hash1(cc, h.layer + 31));                    // 45 % of the coarse cells carry a big eye
    float szf = 0.08 + 0.05 * hash1(ivec2(floor(h.S * 0.33 + hr2.xy * 7.0)), h.layer + 37);   // core radius 0.24–0.4 mm
    float szc = (0.07 + 0.1 * hash1(cc, h.layer + 41)) * keep;           // core radius 0.8–2 mm
    float df = wf.x, dc = wc.x;
    float coreF = 1.0 - smoothstep(szf, szf + 0.03, df), haloF = 1.0 - smoothstep(szf + 0.1, szf + 0.16, df);
    float coreC = keep * (1.0 - smoothstep(szc, szc + 0.02, dc)), haloC = keep * (1.0 - smoothstep(szc + 0.09, szc + 0.15, dc));
    float rim = 1.0 - smoothstep(0.82, 0.95, length(h.u));               // no eye straddles the disc's rim
    float core = max(coreF, coreC) * rim, halo = max(haloF, haloC) * rim;
    vec3 dark = gf >= 0 ? col[gf].rgb : vec3(0.08);
    base = mix(base, paper * 0.97, halo);
    base = mix(base, dark * (0.85 + 0.3 * hash1(cc, h.layer + 43)), core);
    cov = max(cov, max(core, halo) * pg.x);
  }
  cov *= transferShade(P, lodScr);
  // pigment piles up slightly at the gall front (drop outline)
  float rimPx = min(0.3 * uPxPerMm, 3.0);
  if (uTransfer2.w < 0.5) base *= 1.0 - 0.06 * (1.0 - smoothstep(0.0, rimPx, h.ePx));
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
Shaded shadeChain(Trace t, vec2 P, vec3 paper, float lodScr, float tooth, float grain, int gf, out vec3 rgbOut) {
  Shaded ps[MAXH];
  for (int k = 0; k < MAXH; k++) {
    if (t.ws[k] <= 0.0) { ps[k].cov = 0.0; ps[k].rgb = paper; ps[k].stretch = 1.0; continue; }
    ps[k] = shadePattern(t.hs[k], P, paper, lodScr, tooth, grain, gf);
  }
  for (int k = 0; k + 1 < MAXH; k++) {
    if (t.ws[k] <= 0.0 || t.ws[k + 1] <= 0.0) continue;
    if (t.hs[k].layer == t.hs[k + 1].layer && t.hs[k].color == t.hs[k + 1].color) continue;   // the same wet paint: drops merge without a seam
    float meet = 2.0 * t.ws[k] * t.ws[k + 1] * ps[k].cov * ps[k + 1].cov;   // halved: marbling colours barely mingle where they meet, and the old blend pinked every red beside a cream (dp 75, 82)
    vec3 mixed = sqrt(max(ps[k].rgb * ps[k + 1].rgb, 0.0));
    ps[k].rgb = mix(ps[k].rgb, mixed, 0.5 * meet) * (1.0 - uBleed.z * meet);
    ps[k + 1].rgb = mix(ps[k + 1].rgb, mixed, 0.5 * meet) * (1.0 - uBleed.z * meet);
  }
  Shaded s;
  s.cov = 0.0; s.rgb = vec3(0.0); s.stretch = ps[0].stretch;
  // Hair-fine films bleed into one another on the paper. A band drawn out narrower than the size's wicking width
  // (~the edge bleed) no longer lies beside its neighbours as a separate film: the pigments interleave and overlap
  // within the fibres, and the eye sees light that has passed through both, a pigment mixture (darker and duller
  // than the optical average, as the quill zones of a Feather and the cusps of a Nonpareil read on the scans).
  // Each chord's width on the sheet is its share of the footprint times the pixel's size; chords below the
  // mingling width mix multiplicatively (geometric mean, Beer–Lambert) with everything else in the footprint.
  float mmPerPx = 1.0 / uPxPerMm;
  float mingleMm = max(uSurface.z, 0.02);
  vec3 mulAcc = vec3(0.0); float wFine = 0.0;
  for (int k = 0; k < MAXH; k++) {
    float cw = t.ws[k] * ps[k].cov; if (cw <= 0.0) continue;
    s.cov += cw; s.rgb += ps[k].rgb * cw;
    mulAcc += cw * log(max(ps[k].rgb, vec3(0.02)));
    float chordMm = (t.sweep ? t.ws[k] : 1.0) * mmPerPx;
    wFine += cw * (1.0 - smoothstep(0.5 * mingleMm, 1.5 * mingleMm, chordMm));
  }
  vec3 add = s.cov > 1e-4 ? s.rgb / s.cov : ps[0].rgb;
  vec3 mul = s.cov > 1e-4 ? exp(mulAcc / s.cov) : ps[0].rgb;
  float fine = s.cov > 1e-4 ? wFine / s.cov : 0.0;
  s.rgb = mix(add, mul, fine * uSurface.y);
  // the unresolved share of the footprint: films drawn out below what the tracer keeps, always hair-fine, so they
  // read as the sheet's pigment mixture
  if (t.lost > 0.0) { s.rgb = mix(s.rgb, mix(uSheetMean, uSheetMul, uSurface.y), t.lost); s.cov = mix(s.cov, 1.0, t.lost); }
  rgbOut = s.rgb;
  return s;
}

vec3 goldNet(vec2 P, vec3 c, float amp, float lodScr) {
  // One coarse net (dp 139/273: cells 15–30 mm, veins 1–2 mm wide, no finer mesh inside them), lightly wandering.
  vec2 w1 = worley(P * 0.045 + 0.2, 901);
  float e1 = 1.0 - smoothstep(0.025, 0.06, w1.y - w1.x);
  float net = e1 * amp;
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
  float fibre, tooth, grain;
  vec3 paper = paperColor(P, soft, lodScr, fibre, tooth, grain);

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
      // The openings a dispersant style cuts in a drop (partridge speckle, Stormont lace, Schrottel halos, soft rims)
      // are bare paper to the sheet analysis, so they count as paper here too, not as the drop's colour.
      float sc = 1.0;
      if (hk.hit && hk.color >= 0) {
        vec3 dc = vec3(0.5);
        sc = clamp(styleCoverage(hk, dc, lodOf(hk.J), stretchOf(hk.J)), 0.0, 1.0);
        if ((int(uLayerStyle[hk.layer].x + 0.5) & 2048) != 0 && length(hk.u) > uLayerStyle[hk.layer].y + 0.05) sc = 0.0;
      }
      if (ck == uProbe) cov += t.ws[k] * sc;
      if (ck < 0) bare += t.ws[k];
      else if (uCoated > 0.5 && gf >= 0) { if (uProbe == gf) cov += t.ws[k] * (1.0 - sc); }   // an opening on coated paper shows the coating
      else if (uProbe == -1) cov += t.ws[k] * (1.0 - sc);
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
  Shaded top = shadeChain(t, P, paper, lodScr, tooth, grain, gfTop, dummy);
  if (uDebug == 4) { fragColor = vec4(vec3(top.cov), 1.0); return; }
  if (uDebug == 9) { fragColor = vec4(t.ws[0], t.ws[1], t.ws[2], 1.0); return; }
  if (uDebug == 10) { Shaded p0 = shadePattern(t.hs[0], P, paper, lodScr, tooth, grain, gfTop); fragColor = vec4(p0.cov, t.hs[0].hit ? 1.0 : 0.0, float(gfTop + 1) / 32.0, 1.0); return; }
  if (uDebug == 11) { float gsig = stretchOf(t.hs[0].J); float gfilm = pow(clamp(uDry.y / gsig, 0.0, 1.0), 0.35); fragColor = vec4(gfTop >= 0 ? pig[gfTop].x : 0.0, transferShade(P, lodScr), mix(0.75 + 0.25 * tooth, 1.0, gfilm * 0.6), 1.0); return; }

  vec3 under = paper;
  if (uCoated > 0.5 && gfTop >= 0) under = mix(paper, col[gfTop].rgb * (0.96 + 0.08 * (tnoise(P * 0.05, lodFor(lodScr, 0.05)).g - 0.5)), pig[gfTop].x);
  if (uUnderMode != 0) {
    Trace tu = trace(P, mmPerPx, fibre, uOpCount, uOpCount2);
    Shaded u = shadeChain(tu, P, paper, lodScr, tooth, grain, uGroundUnder, dummy);
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
