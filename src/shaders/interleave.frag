#version 300 es
// Interleaved rendering: screen pixel (x, y) is taken from texel (x / kx, y / ky) of the phase
// layer that shaded the lattice position (x mod kx, y mod ky).
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uPhases;
uniform ivec2 uK;
uniform int uPhaseOf[16];
out vec4 fragColor;
void main() {
  ivec2 x = ivec2(gl_FragCoord.xy);
  ivec2 m = x % uK;
  fragColor = texelFetch(uPhases, ivec3(x / uK, uPhaseOf[m.x + uK.x * m.y]), 0);
}
