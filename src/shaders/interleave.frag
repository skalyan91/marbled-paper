#version 300 es
// Column interleaving: screen column x is taken from texel x / k of phase layer x mod k.
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uPhases;
uniform int uK;
out vec4 fragColor;
void main() {
  ivec2 x = ivec2(gl_FragCoord.xy);
  fragColor = texelFetch(uPhases, ivec3(x.x / uK, x.y, x.x % uK), 0);
}
