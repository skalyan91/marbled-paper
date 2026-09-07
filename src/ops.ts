// Op encoding shared with the fragment shader (see marble.frag).
// Each op is 4 vec4 = 16 floats. Ops are authored in FORWARD (chronological)
// order in recipes.ts and uploaded REVERSED, because the shader applies inverses.

export const OP = {
  NONE: 0,
  SPRINKLE: 1, // drop layer, per-cell data in a texture slice
  COMB: 2, // infinite train of parallel tines
  SHEAR: 3, // sinusoidal shear (wavy combs, transfer wiggles, drift)
  VORTEX: 4, // single Jaffer vortex (stylus swirl)
  VORTEX_GRID: 5, // jittered grid of vortices (French curl)
  STROKE: 6, // Oseen short stroke (approximate inverse)
  STRETCH: 7, // anisotropic scale (paper dragged while laying)
} as const;

export const MAX_OPS = 24;
export const FLOATS_PER_OP = 16;

export interface Op {
  type: number;
  p: number[]; // up to 15 floats (p0.yzw, p1, p2, p3)
}

// Drop styles (bit flags stored in the SPRINKLE op)
export const STYLE = {
  NONE: 0,
  CLEAR: 1, // dispersant only: reveals bare size / paper
  HALO: 2, // oil ring: clear annulus at rim (Shell)
  PARTRIDGE: 4, // speckled with clear cells (Gloster)
  SHOT: 8, // clear ring drop revealing dark ground (Schrottel)
  LACY: 16, // paint only on cell walls (Stormont)
  TIGER: 32, // radiating rays, dark centre (Tiger eye)
  RINGED: 64, // faint concentric pulses inside stone drops
  METALLIC: 128, // bronze/gold ink
  SOFT: 256, // wet-paper soft edge (Morris)
  BROKEN: 512, // caustic fracture (Romantic)
  GALLDOTS: 1024, // sparse small clear "gall spots" inside later colours
} as const;

export function packOps(forwardOps: Op[]): { data: Float32Array; count: number } {
  const ops = forwardOps.slice(0, MAX_OPS).reverse();
  const data = new Float32Array(MAX_OPS * FLOATS_PER_OP);
  ops.forEach((o, i) => {
    const b = i * FLOATS_PER_OP;
    data[b] = o.type;
    for (let k = 0; k < 15; k++) data[b + 1 + k] = o.p[k] ?? 0;
  });
  return { data, count: ops.length };
}
