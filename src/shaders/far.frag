#version 300 es
// The far field of one drop layer, baked into a coarse grid once a frame.
//
// A drop of radius r landing at C pushes every point of the bath outward, P ↦ C + (P−C)·√(1 + r²/d²)
// (Jaffer, area-preserving); its far field falls off as r²/2d and never stops. The per-pixel trace can
// only find a drop in a few cells around the pixel, so that push was cut off at a cell and a half —
// less than two radii for the big drops of a dominant colour, which is where most of the pushing is
// done. Beyond a cell the sum over a layer's drops is smooth, so it is summed here instead, on a grid
// of about half a cell, and sampled with its Jacobian by the trace.
//
// Split (Ewald): the trace keeps the exact map where it can see the drop (weight w, 1 inside w0, 0
// beyond w1) and this pass carries the complement (1 − w) of a regularised kernel that agrees with
// r²/2d to O(1/d⁵) but is smooth at the origin, so the total push from a drop is exact near it and
// analytic far from it, with nothing left out in between.
precision highp float;
precision highp int;
precision highp sampler2DArray;

#define TILE 128
#define FN 5   // cells searched around the texel: the kernel is cut off at uParam.w ≤ FN − 0.5 − jitter

uniform sampler2DArray uCells;
uniform sampler2D uRowShift;
uniform int uSlot;        // layer
uniform vec2 uOrigin;     // grid coordinates of the corner of texel (0, 0)
uniform float uStep;      // grid cells per texel
uniform vec4 uParam;      // regularisation a (cells), w0, w1 (the trace's window, cells), cutoff R (cells)
uniform float uEcc;       // the ellipse this sheet's drops land as

// The displacement, in cells, and the deviatoric part of its Jacobian, which is symmetric: the trace is left out
// (Jyy = −Jxx), so that one texel holds the field and the trace reads it in a single fetch. Away from the drops
// this field is divergence-free, as an area-preserving push must be; the trace it does have belongs to the ramp
// where the lookup's own map takes over, and that map carries the area change itself.
layout(location = 0) out vec4 outA;

uint pcg(uint v) { v = v * 747796405u + 2891336453u; uint w = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u; return (w >> 22u) ^ w; }
vec4 hash4fast(ivec2 c, int k) { uint h = pcg(uint(c.x) * 1597334677u ^ uint(c.y) * 3812015801u ^ uint(k) * 2654435761u); return vec4(uvec4(h & 255u, (h >> 8u) & 255u, (h >> 16u) & 255u, (h >> 24u) & 255u)) * (1.0 / 255.0); }

void accum(inout vec2 U, inout vec3 J, vec2 g, ivec2 cc, vec2 sh) {
  float R = uParam.w;
  vec2 q0 = g - (vec2(cc) + 0.5 + sh);            // the cell's centre: its drop lies within a cell of it
  if (dot(q0, q0) > (R + 1.0) * (R + 1.0)) return;   // the corners of the square searched are outside the cutoff
  vec4 tx = texelFetch(uCells, ivec3(cc & (TILE - 1), uSlot), 0);
  if (tx.z <= 0.0) return;
  vec2 C = vec2(cc) + 0.5 + tx.xy + sh;
  vec2 q = g - C;
  float d = length(q);
  if (d >= R || d < 1e-4) return;
  vec2 n = q / d;
  float r = tx.z;
  vec4 hw = hash4fast(cc, uSlot + 300) * 2.0 - 1.0;
  float c2 = n.x * n.x - n.y * n.y, s2 = 2.0 * n.x * n.y;
  r *= 1.0 + max(uEcc * (hw.x * c2 + hw.y * s2), -0.85);
  // complement of the trace's own window, and the cutoff of this sum, both as smoothsteps
  float t0 = clamp((d - uParam.y) / (uParam.z - uParam.y), 0.0, 1.0);
  float w = 1.0 - t0 * t0 * (3.0 - 2.0 * t0);
  float dw = -6.0 * t0 * (1.0 - t0) / (uParam.z - uParam.y);
  float t1 = clamp(d - (R - 1.0), 0.0, 1.0);
  float wf = 1.0 - t1 * t1 * (3.0 - 2.0 * t1);
  float dwf = -6.0 * t1 * (1.0 - t1);
  float W = (1.0 - w) * wf, dW = -dw * wf + (1.0 - w) * dwf;
  // regularised far kernel s(d) = (r²/2)·d(d² + 2a²)/(d² + a²)² = r²/2d + O(1/d⁵), smooth at d = 0
  float a2 = uParam.x * uParam.x, d2 = d * d, den = d2 + a2;
  float c = 0.5 * r * r;
  float s = c * d * (d2 + 2.0 * a2) / (den * den);
  float sp = c * (2.0 * a2 * a2 - 3.0 * a2 * d2 - d2 * d2) / (den * den * den);
  float f = W * s, fp = dW * s + W * sp;
  U -= n * f;                                  // the inverse map pulls inward
  float al = -(fp - f / d), be = -f / d;       // ∂U/∂x = al·n nᵀ + be·I
  J += vec3(be + al * n.x * n.x, al * n.x * n.y, be + al * n.y * n.y);
}

void main() {
  vec2 g = uOrigin + gl_FragCoord.xy * uStep;
  int baseX = int(floor(g.x)), baseY = int(floor(g.y));
  vec2 U = vec2(0.0);
  vec3 J = vec3(0.0);
  // the two crossing streams of the animation, as the trace looks them up: even grid rows have slid
  // along x by their own amount, odd rows along y by their column's
  for (int oy = -FN; oy <= FN; oy++) {
    int cy = baseY + oy;
    if ((cy & 1) != 0) continue;
    float sh = texelFetch(uRowShift, ivec2(cy & (TILE - 1), 2 * uSlot), 0).r;
    int bx = int(floor(g.x - sh));
    for (int ox = -FN; ox <= FN; ox++) accum(U, J, g, ivec2(bx + ox, cy), vec2(sh, 0.0));
  }
  for (int ox = -FN; ox <= FN; ox++) {
    int cx = baseX + ox;
    float sh = texelFetch(uRowShift, ivec2(cx & (TILE - 1), 2 * uSlot + 1), 0).r;
    int by = int(floor(g.y - sh));
    for (int oy = -FN; oy <= FN; oy++) {
      int cy = by + oy;
      if ((cy & 1) == 0) continue;
      accum(U, J, g, ivec2(cx, cy), vec2(0.0, sh));
    }
  }
  outA = vec4(U, 0.5 * (J.x - J.z), J.y);
}
