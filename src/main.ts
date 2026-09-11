import fragSrc from "./shaders/marble.frag?raw";
import vertSrc from "./shaders/fullscreen.vert?raw";
import interleaveSrc from "./shaders/interleave.frag?raw";
import farSrc from "./shaders/far.frag?raw";
import { MAX_OPS as OPS_PER_CHAIN, FLOATS_PER_OP, packOps, OP } from "./ops";
import { LayerBank, MAX_LAYERS, type LayerSpec } from "./layers";
import { RECIPES, PALETTES, Builder, type Params, type Scene, type Palette } from "./recipes";
import { makeGui, DEBUG_MODES, palettesFor, bestRecipeFor, type Settings } from "./gui";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const errBox = document.getElementById("err") as HTMLPreElement;
const hud = document.getElementById("hud") as HTMLDivElement;

function fail(msg: string): never {
  errBox.style.display = "block";
  errBox.textContent = msg;
  throw new Error(msg);
}

// No preserveDrawingBuffer: it would copy the whole frame every frame (59 MB on a 5K monitor).
// Saving and measuring render whole and read back within the same task, so nothing is lost.
const glMaybe = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: false, powerPreference: "high-performance" });
if (!glMaybe) fail("WebGL2 is not available in this browser.");
const gl: WebGL2RenderingContext = glMaybe;

// ----------------------------------------------------------------- settings
// Physical pixel density: browsers do not expose it, so guess from DPR.
// Apple Retina laptops are 224–254 ppi (this 2560×1664 panel is 224); typical desktop panels ~110.
function guessPpi() {
  const dpr = window.devicePixelRatio || 1;
  if (dpr >= 2) return 224;
  if (dpr > 1) return 110 * dpr;
  return 110;
}
/** Sheet width in mm shown across the canvas at the current zoom. */
function sheetWidthMm() {
  const dpr = window.devicePixelRatio || 1;
  return (canvas.clientWidth * dpr / settings.ppi) * 25.4 / settings.zoom;
}
const url = new URL(location.href);
const settings: Settings = {
  pattern: url.searchParams.get("pattern") ?? RECIPES[0].name,
  palette: "",
  seed: Number(url.searchParams.get("seed") ?? 1234),
  viscosity: 0.35,
  gall: 1.0,
  density: 1.0,
  combScale: 1.0,
  combStrength: 1.0,
  curlStrength: 1.0,
  ppi: guessPpi(),
  zoom: 1.0,
  speed: 1.0,
  drift: 1.2,
  breath: 0.12,
  gapFill: 0.7,
  animate: true,
  scale: 1.0,
  neighbourhood: 2,
  antialias: true,
  interleave: 0,
  grain: 0.7,
  stretchLimit: 60.0,
  paperAge: 0.35,
  bleed: 0.12,
  edgeWobble: 0.3,
  edgeDark: 0.12,
  tooth: 0.6,
  granulation: 0.6,
  wear: 0.06,
  colourMatch: 1,
  hairMix: 1,
  hairWidth: 0.25,
  transferAmp: 1.0,
  debug: DEBUG_MODES[0],
  savePng: () => savePng(),
  randomSeed: () => { settings.seed = Math.floor(Math.random() * 9999) + 1; markDirty(); },
  randomAll: () => {
    // as if the user had picked them: pattern defaults and the sheet list first, then the sheet and seed
    const r = RECIPES[Math.floor(Math.random() * RECIPES.length)];
    selectPattern(r.name);
    const sheets = palettesFor(r.name);
    settings.palette = sheets[Math.floor(Math.random() * sheets.length)].short!;
    settings.seed = Math.floor(Math.random() * 9999) + 1;
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    markDirty();
  },
};
if (!RECIPES.some((r) => r.name === settings.pattern)) settings.pattern = RECIPES[0].name;
settings.palette = defaultSheet(settings.pattern);

// --------------------------------------------------------------- shaders
let program: WebGLProgram | null = null;
let uni: Record<string, WebGLUniformLocation | null> = {};

function compile(type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? "";
    const lines = src.split("\n").map((l, i) => `${String(i + 1).padStart(4)}: ${l}`);
    const m = /ERROR: \d+:(\d+)/.exec(log);
    const ln = m ? Number(m[1]) : 0;
    const ctx = lines.slice(Math.max(0, ln - 4), ln + 3).join("\n");
    fail(`Shader compile error:\n${log}\n\n${ctx}`);
  }
  return sh;
}

function buildProgram() {
  const src = fragSrc.replace("__NEIGH__", String(settings.neighbourhood));
  const vs = compile(gl.VERTEX_SHADER, vertSrc);
  const fs = compile(gl.FRAGMENT_SHADER, src);
  const pr = gl.createProgram()!;
  gl.attachShader(pr, vs);
  gl.attachShader(pr, fs);
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) fail("Link error: " + gl.getProgramInfoLog(pr));
  if (program) gl.deleteProgram(program);
  program = pr;
  gl.useProgram(pr);
  uni = {};
  for (const n of ["uResolution", "uPxPerMm", "uTime", "uOpCount", "uOpCount2", "uUnderMode", "uDebug", "uCells", "uNoise", "uRowShift", "uPaper", "uTransfer", "uTransfer2", "uDry", "uSamples", "uBleed", "uPaperTex", "uSurface", "uProbe", "uGroundUnder", "uLayerStyle", "uLayerStyle2", "uInterleave", "uSheetMean", "uSheetMul", "uCoated", "uFarField", "uFar"]) uni[n] = gl.getUniformLocation(pr, n);
  gl.uniformBlockBinding(pr, gl.getUniformBlockIndex(pr, "Ops"), 0);
  gl.uniformBlockBinding(pr, gl.getUniformBlockIndex(pr, "Palette"), 1);
  gl.uniform1i(uni.uCells, 0);
  gl.uniform1i(uni.uNoise, 1);
  gl.uniform1i(uni.uRowShift, 2);
  gl.uniform1i(uni.uFarField, 4);
  errBox.style.display = "none";
}

// ---------------------------------------------------- interleaved rendering
// The shader is the whole cost of a frame, so while the sheet moves each frame shades only
// one phase of a kx × ky pixel lattice (every kx-th column of every ky-th row) into a
// persistent buffer with one layer per phase, and a trivial pass composites the phases.
// The phases are visited in a dithered order, so at any moment the ages of neighbouring
// pixels are mixed rather than ramped: a moving edge reads as a little motion blur, not as
// a comb. The paint moves well under a pixel per frame. A still sheet, a control change, a
// measurement and a saved PNG are always rendered whole at one instant. k is chosen
// automatically (settings.interleave = 0) as the smallest step that keeps the shading
// within FRAME_BUDGET_MS; a laptop panel needs 2–3, a 5K monitor 8–16.
const FRAME_BUDGET_MS = 29; // ≥ 30 fps with a little margin for the composite and the bake
const LAYOUTS: Record<number, { kx: number; ky: number; order: [number, number][] }> = {
  1: { kx: 1, ky: 1, order: [[0, 0]] },
  2: { kx: 2, ky: 1, order: [[0, 0], [1, 0]] },
  3: { kx: 3, ky: 1, order: [[0, 0], [2, 0], [1, 0]] },
  4: { kx: 2, ky: 2, order: [[0, 0], [1, 1], [1, 0], [0, 1]] },
  6: { kx: 3, ky: 2, order: [[0, 0], [2, 1], [1, 0], [0, 1], [2, 0], [1, 1]] },
  8: { kx: 4, ky: 2, order: [[0, 0], [2, 0], [1, 1], [3, 1], [1, 0], [3, 0], [0, 1], [2, 1]] }, // Bayer 4×2
  12: { kx: 4, ky: 3, order: [[0, 0], [2, 2], [2, 0], [0, 2], [1, 1], [3, 1], [1, 0], [3, 2], [3, 0], [1, 2], [0, 1], [2, 1]] }, // Bayer 4×4, rows 0–2
  16: { kx: 4, ky: 4, order: [[0, 0], [2, 2], [2, 0], [0, 2], [1, 1], [3, 3], [3, 1], [1, 3], [1, 0], [3, 2], [3, 0], [1, 2], [0, 1], [2, 3], [2, 1], [0, 3]] }, // Bayer 4×4
};
const K_STEPS = [1, 2, 3, 4, 6, 8, 12, 16];
const MAX_INTERLEAVE = 16;
const compProgram = (() => {
  const vs = compile(gl.VERTEX_SHADER, vertSrc);
  const fs = compile(gl.FRAGMENT_SHADER, interleaveSrc);
  const pr = gl.createProgram()!;
  gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) fail("Link error: " + gl.getProgramInfoLog(pr));
  return pr;
})();
const compUni = { phases: gl.getUniformLocation(compProgram, "uPhases"), k: gl.getUniformLocation(compProgram, "uK"), phaseOf: gl.getUniformLocation(compProgram, "uPhaseOf") };
const phaseFb = gl.createFramebuffer()!;
let phaseTex: WebGLTexture | null = null;
let phaseW = 0, phaseH = 0, phaseLayers = 0;
let phasesValid = false;   // every layer holds a rendered phase for the current k
let phaseK = 1;            // interleave factor in use
let phaseIdx = 0;          // next phase (index into the layout's order) to render
let needFull = true;       // something other than time changed: render every pixel this frame
function ensurePhaseTex(k: number) {
  const { kx, ky } = LAYOUTS[k];
  const w = Math.ceil(canvas.width / kx), h = Math.ceil(canvas.height / ky);
  if (phaseTex && phaseW === w && phaseH === h && phaseLayers === k) return;
  if (phaseTex) gl.deleteTexture(phaseTex);
  phaseTex = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, phaseTex);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, w, h, k);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  phaseW = w; phaseH = h; phaseLayers = k; phasesValid = false;
}
// GPU time of the main pass, for choosing k: exact from timer queries where the browser has
// them, else the frame interval (an upper bound when the display's refresh is the limit).
const timerExt = gl.getExtension("EXT_disjoint_timer_query_webgl2") as { TIME_ELAPSED_EXT: number } | null;
const pendingQueries: { q: WebGLQuery; k: number }[] = [];
let fullCostMs = 0;        // smoothed estimate of the cost of shading every pixel, ms
let stableFrames = 0;
function noteCost(msPerPhase: number, k: number) {
  const full = msPerPhase * k;
  fullCostMs = fullCostMs > 0 ? fullCostMs + 0.15 * (full - fullCostMs) : full;
}
function pollQueries() {
  if (!timerExt) return;
  for (let i = pendingQueries.length - 1; i >= 0; i--) {
    const { q, k } = pendingQueries[i];
    if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
    if (!gl.getParameter(0x8FBB /* GPU_DISJOINT_EXT */)) noteCost((gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6, k);
    gl.deleteQuery(q);
    pendingQueries.splice(i, 1);
  }
}
/** Draw the main pass: phase `p` (index into the layout order) of `k`; k = 1 draws every pixel. */
function drawMain(k: number, p: number, timed = false) {
  const { kx, ky, order } = LAYOUTS[k];
  gl.uniform4i(uni.uInterleave, kx, ky, order[p][0], order[p][1]);
  gl.bindVertexArray(vao);
  const q = timed && timerExt && pendingQueries.length < 8 ? gl.createQuery() : null;
  if (q) gl.beginQuery(timerExt!.TIME_ELAPSED_EXT, q);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  if (q) { gl.endQuery(timerExt!.TIME_ELAPSED_EXT); pendingQueries.push({ q, k }); }
}
/** Render every pixel straight to the screen (still sheets, measurements, PNGs). */
function drawWhole() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  drawMain(1, 0);
}
function chooseK(dtMs: number) {
  if (settings.interleave > 0) return K_STEPS.includes(settings.interleave) ? settings.interleave : MAX_INTERLEAVE;
  if (!timerExt && phaseK > 0) noteCost(dtMs, phaseK);
  if (fullCostMs <= 0) return phaseK;
  const want = K_STEPS.find((k) => fullCostMs / k <= FRAME_BUDGET_MS) ?? MAX_INTERLEAVE;
  // hysteresis: only step down once the estimate has held for a while, and not from a noisy first reading
  if (want < phaseK) { if (++stableFrames < 20) return phaseK; stableFrames = 0; } else stableFrames = 0;
  return want;
}
/** Render the animated frame: one phase of the lattice (or all of them after a change), then composite. */
function drawInterleaved(k: number) {
  const { kx, ky, order } = LAYOUTS[k];
  ensurePhaseTex(k);
  gl.bindFramebuffer(gl.FRAMEBUFFER, phaseFb);
  gl.viewport(0, 0, phaseW, phaseH);
  const all = needFull || !phasesValid;
  for (let p = 0; p < k; p++) {
    if (!all && p !== phaseIdx) continue;
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, phaseTex, 0, p);
    drawMain(k, p, !all);
  }
  phaseIdx = all ? 0 : (phaseIdx + 1) % k;
  phasesValid = true;
  // composite: screen pixel (x, y) comes from the layer whose phase is (x mod kx, y mod ky)
  const phaseOf = new Int32Array(16);
  order.forEach(([px, py], p) => { phaseOf[px + kx * py] = p; });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(compProgram);
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, phaseTex);
  gl.uniform1i(compUni.phases, 3);
  gl.uniform2i(compUni.k, kx, ky);
  gl.uniform1iv(compUni.phaseOf, phaseOf);
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.useProgram(program);
}

// ------------------------------------------------------------ GPU buffers
const TOTAL_OPS = OPS_PER_CHAIN * 2;
const opsBuf = gl.createBuffer()!;
gl.bindBuffer(gl.UNIFORM_BUFFER, opsBuf);
gl.bufferData(gl.UNIFORM_BUFFER, TOTAL_OPS * FLOATS_PER_OP * 4, gl.DYNAMIC_DRAW);
gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, opsBuf);
const palBuf = gl.createBuffer()!;
gl.bindBuffer(gl.UNIFORM_BUFFER, palBuf);
gl.bufferData(gl.UNIFORM_BUFFER, 32 * 16, gl.DYNAMIC_DRAW);
gl.bindBufferBase(gl.UNIFORM_BUFFER, 1, palBuf);

const vao = gl.createVertexArray()!;
gl.bindVertexArray(vao);

const layers = new LayerBank(gl);

// ------------------------------------------------ the far field of a drop layer
// A drop pushes the film out of the disc it covers and goes on pushing, as r²/2d, for ever. The
// per-pixel trace can only find a drop in the handful of cells it looks at, so that push was cut
// off at a cell and a half: four or five radii for a fine shower, but under two for the large
// drops of a dominant colour, which do most of the pushing. Everything beyond the trace's own
// window is summed once a frame into a coarse grid per layer (src/shaders/far.frag) and sampled,
// with its Jacobian, where the layer acts; the trace keeps the exact map inside the window.
const FAR_N = 128;         // texels per side of one layer's field
const FAR_MIN_MM = 0.12;   // a layer whose push at the edge of the window is smaller than this is left alone
const FAR_MAX_STEP = 1.2;  // and one whose cell the grid cannot resolve at all (a very wide view)
const FAR_MARGIN_MM = 40;  // how far outside the sheet the trace may wander and still find its field
const FAR_R = 4.0;         // the sum is cut off here, in cells (FN = 5 in the shader guarantees 4.5)
const farFloat = !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
const farParams = new Float32Array(MAX_LAYERS * 4);   // per layer: grid coords of the field's corner, 1/extent, on
let farTex: WebGLTexture | null = null;
let farFb: WebGLFramebuffer | null = null;
let farProgram: WebGLProgram | null = null;
const farUni: Record<string, WebGLUniformLocation | null> = {};
if (farFloat) {
  farTex = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, farTex);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA16F, FAR_N, FAR_N, MAX_LAYERS);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  farFb = gl.createFramebuffer()!;
  const vs = compile(gl.VERTEX_SHADER, vertSrc);
  const fs = compile(gl.FRAGMENT_SHADER, farSrc);
  const pr = gl.createProgram()!;
  gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) fail("Link error: " + gl.getProgramInfoLog(pr));
  farProgram = pr;
  gl.useProgram(pr);
  for (const n of ["uCells", "uRowShift", "uSlot", "uOrigin", "uStep", "uParam", "uEcc"]) farUni[n] = gl.getUniformLocation(pr, n);
  gl.uniform1i(farUni.uCells, 0);
  gl.uniform1i(farUni.uRowShift, 2);
}
let farLast: number[] = [];
let farHalf = 0;   // the extent the fields were last baked over
let farTurn = 0;   // which layer's field is re-baked this frame (they are spread over the frames)
/** Bake the far field of every layer whose drops are large enough for the trace's window to cut it off.
 *  While the sheet moves only one layer is re-baked per frame: a drop travels 0.12 cells a second, so a
 *  field a few frames old is off by a thousandth of a cell, and the cost is one layer's worth a frame. */
function buildFarFields(specs: (LayerSpec | undefined)[], small: Uint8Array, ecc: Float32Array) {
  farParams.fill(0);
  if (farProgram && farTex) {
    const w0n = settings.neighbourhood >= 3 ? 1.5 : 0.9, w1n = settings.neighbourhood >= 3 ? 2.4 : 1.5;
    const halfDiag = 0.5 * Math.hypot(sheetWidthMm(), (sheetWidthMm() * canvas.height) / Math.max(1, canvas.width)) + FAR_MARGIN_MM;
    // a resize or a zoom moves every field, and the canvas alone does not force a full frame
    const fresh = Math.abs(halfDiag - farHalf) > 1e-3 * farHalf;
    farHalf = halfDiag;
    const skip = settings.animate && !needFull && !fresh;
    const turnOf = farLast[farTurn % Math.max(1, farLast.length)] ?? -1;
    const turn: number[] = [];
    let drawn = false;
    for (let i = 0; i < MAX_LAYERS; i++) {
      const sp = specs[i];
      if (!sp || !sp.origin) continue;
      const E = halfDiag / sp.cellMm;   // half-extent of the field, in cells
      // the push this layer loses at the edge of the trace's window, in mm, and how well the grid resolves its cell
      if ((sp.radius * sp.radius * sp.cellMm) / (2 * w1n) < FAR_MIN_MM || (2 * E) / FAR_N > FAR_MAX_STEP) continue;
      const c = Math.cos(sp.rot ?? 0), sn = Math.sin(sp.rot ?? 0);
      const gx = (-c * sp.origin[0] - sn * sp.origin[1]) / sp.cellMm;   // the centre of the sheet in this layer's grid
      const gy = (sn * sp.origin[0] - c * sp.origin[1]) / sp.cellMm;
      const step = (2 * E) / FAR_N;
      farParams.set([gx - E, gy - E, 0.5 / E, 1], i * 4);
      turn.push(i);
      if (skip && i !== turnOf) continue;   // its field is at most a frame or two old
      if (!drawn) {
        gl.useProgram(farProgram);
        gl.bindFramebuffer(gl.FRAMEBUFFER, farFb);
        gl.viewport(0, 0, FAR_N, FAR_N);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, layers.tex);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, layers.shiftTex);
        gl.bindVertexArray(vao);
        drawn = true;
      }
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, farTex, 0, i);
      gl.uniform1i(farUni.uSlot, i);
      gl.uniform2f(farUni.uOrigin, gx - E, gy - E);
      gl.uniform1f(farUni.uStep, step);
      // the regularisation follows the grid: a kernel narrower than a texel would be lost to the interpolation
      gl.uniform4f(farUni.uParam, Math.max(0.8, 1.7 * step), small[i] ? 1.0 : w0n, small[i] ? 1.5 : w1n, FAR_R);
      gl.uniform1f(farUni.uEcc, ecc[i]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (drawn) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    farLast = turn;
    farTurn = (farTurn + 1) % Math.max(1, turn.length);
  }
  gl.useProgram(program);
  gl.uniform4fv(uni.uFar, farParams);
}

// Noise texture: r white, g smooth 8-cell, b smooth 32-cell, a smooth 64-cell (all tileable)
function makeNoiseTexture() {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const lattice = (cells: number, seed: number) => {
    const v = new Float32Array(cells * cells);
    let s = seed;
    for (let i = 0; i < v.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; v[i] = s / 4294967296; }
    return (x: number, y: number) => {
      const fx = (x / N) * cells, fy = (y / N) * cells;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const g = (a: number, b: number) => v[((b % cells) + cells) % cells * cells + (((a % cells) + cells) % cells)];
      return (g(ix, iy) * (1 - sx) + g(ix + 1, iy) * sx) * (1 - sy) + (g(ix, iy + 1) * (1 - sx) + g(ix + 1, iy + 1) * sx) * sy;
    };
  };
  const n8 = lattice(8, 7), n8b = lattice(16, 99), n32 = lattice(32, 3), n64 = lattice(64, 11), n128 = lattice(128, 5);
  let s = 12345;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const o = (y * N + x) * 4;
    s = (s * 1664525 + 1013904223) >>> 0;
    data[o] = s >>> 24;
    data[o + 1] = Math.round(255 * Math.min(1, Math.max(0, 0.65 * n8(x, y) + 0.35 * n8b(x, y))));
    data[o + 2] = Math.round(255 * n32(x, y));
    data[o + 3] = Math.round(255 * Math.min(1, Math.max(0, 0.6 * n64(x, y) + 0.4 * n128(x, y))));
  }
  const t = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return t;
}
const noiseTex = makeNoiseTexture();

// --------------------------------------------------------------- scene
let dirty = true;
let animTime = 0;
let lastFrame = performance.now();
let paletteObj: Palette = PALETTES[0];
const opData = new Float32Array(TOTAL_OPS * FLOATS_PER_OP);

function markDirty() { dirty = true; needFull = true; }

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function currentParams(): Params {
  const aspect = canvas.height / Math.max(1, canvas.width);
  return {
    seed: settings.seed,
    viscosity: settings.viscosity,
    gall: settings.gall,
    density: settings.density,
    combScale: settings.combScale,
    combStrength: settings.combStrength,
    curlStrength: settings.curlStrength,
    sheetW: sheetWidthMm(),
    sheetH: sheetWidthMm() * aspect,
    time: animTime,
    animate: settings.animate,
    drift: settings.drift,
    breath: settings.breath,
    gapFill: settings.gapFill,
  };
}

function uploadScene(scene: Scene, palette: Palette) {
  // layers (top chain first, then under chain)
  const allLayers = [...scene.layers];
  let underOps = scene.under?.ops ?? [];
  if (scene.under) {
    const offset = allLayers.length;
    // re-slot under layers
    underOps = scene.under.ops.map((o) => (o.type === 1 ? { ...o, p: [o.p[0] + offset, ...o.p.slice(1)] } : o));
    allLayers.push(...scene.under.layers);
  }
  for (let i = 0; i < Math.min(allLayers.length, MAX_LAYERS); i++) layers.bake(i, allLayers[i], animTime);
  // per-layer shading constants (style bits, style parameter, ring amplitude), read by the shader per slot
  const layerStyle = new Float32Array(MAX_LAYERS * 4);
  const layerStyle2 = new Float32Array(MAX_LAYERS * 4).fill(1);
  const layerSmall = new Uint8Array(MAX_LAYERS);
  const layerEcc = new Float32Array(MAX_LAYERS);
  for (const o of [...scene.ops, ...underOps]) {
    if (o.type !== 1 || o.p[0] >= MAX_LAYERS) continue;
    layerStyle.set([o.p[2], o.p[9] ?? 1, o.p[10] ?? 0, o.p[12] ?? 1], o.p[0] * 4);   // .w: how ragged this colour's edge is, 1 = a typical one (FEATHER, measured on the scans)
    layerStyle2.set([o.p[13] ?? 1, 0, 0, 0], o.p[0] * 4);   // .x: how diffuse its edge is, 1 = a typical one (SOFTNESS)
    layerSmall[o.p[0]] = o.p[11] > 0.5 ? 1 : 0;             // the cheap 3×3 lookup, whose window differs
    layerEcc[o.p[0]] = o.p[14] ?? 0;
  }
  gl.uniform4fv(uni.uLayerStyle, layerStyle);
  gl.uniform4fv(uni.uLayerStyle2, layerStyle2);
  buildFarFields(allLayers, layerSmall, layerEcc);

  const top = packOps(scene.ops);
  const und = packOps(underOps);
  opData.fill(0);
  opData.set(top.data.subarray(0, top.count * FLOATS_PER_OP), 0);
  opData.set(und.data.subarray(0, und.count * FLOATS_PER_OP), top.count * FLOATS_PER_OP);
  gl.bindBuffer(gl.UNIFORM_BUFFER, opsBuf);
  gl.bufferSubData(gl.UNIFORM_BUFFER, 0, opData);
  gl.uniform1i(uni.uOpCount, top.count);
  gl.uniform1i(uni.uOpCount2, und.count);
  gl.uniform1i(uni.uUnderMode, scene.under ? scene.under.mode : 0);
  gl.uniform1i(uni.uGroundUnder, scene.under ? scene.under.groundFill : -1);

  // palette
  const pal = new Float32Array(32 * 4);
  palette.pigments.slice(0, 16).forEach((pg, i) => {
    const [r, g, b] = colourComp.get(i) ?? hexToRgb(pg.hex);
    pal.set([r, g, b, 1], i * 4);
    pal.set([pg.opacity ?? 1, pg.grain ?? 0.5, pg.metallic ?? 0, 0], 64 + i * 4);
  });
  gl.bindBuffer(gl.UNIFORM_BUFFER, palBuf);
  gl.bufferSubData(gl.UNIFORM_BUFFER, 0, pal);

  const [pr, pgc, pb] = hexToRgb(palette.paper);
  gl.uniform4f(uni.uPaper, pr, pgc, pb, settings.paperAge);
  // coverage-weighted mean colour of the sheet (equal weights where the sheet was not measured)
  const mean = [0, 0, 0], lmean = [0, 0, 0]; let wsum = 0;
  for (const i of [palette.background, ...palette.spots]) { const pg = palette.pigments[i]; if (!pg) continue; const w = pg.frac ?? 10; const rgb = colourComp.get(i) ?? hexToRgb(pg.hex); for (let k = 0; k < 3; k++) { mean[k] += rgb[k] * w; lmean[k] += Math.log(Math.max(rgb[k], 0.02)) * w; } wsum += w; }
  gl.uniform3f(uni.uSheetMean, mean[0] / Math.max(wsum, 1e-6), mean[1] / Math.max(wsum, 1e-6), mean[2] / Math.max(wsum, 1e-6));
  gl.uniform3f(uni.uSheetMul, Math.exp(lmean[0] / Math.max(wsum, 1e-6)), Math.exp(lmean[1] / Math.max(wsum, 1e-6)), Math.exp(lmean[2] / Math.max(wsum, 1e-6)));
  const t = scene.transfer;
  gl.uniform4f(uni.uTransfer, t.mode, t.amp * settings.transferAmp, (2 * Math.PI) / t.wavelength, (t.angle * Math.PI) / 180);
  gl.uniform4f(uni.uTransfer2, t.phase, t.wobble, scene.goldNet, scene.softPaper);
  gl.uniform4f(uni.uDry, settings.grain, settings.stretchLimit, scene.groundFill + 1, settings.seed);
  gl.uniform1f(uni.uCoated, scene.coated ? 1 : 0);
  gl.uniform1i(uni.uDebug, DEBUG_MODES.indexOf(settings.debug));
  gl.uniform1i(uni.uSamples, settings.antialias ? 1 : 0);
  gl.uniform4f(uni.uBleed, settings.bleed, settings.edgeWobble, settings.edgeDark, palette.laid ? 1 : 0);
  gl.uniform4f(uni.uPaperTex, 1.15, 26, settings.tooth, settings.granulation);
  gl.uniform4f(uni.uSurface, settings.wear, settings.hairMix, settings.hairWidth, 0);
}

let customScene: { scene: Scene; pal: Palette } | null = null;
// ------------------------------------------------ colour pre-compensation
// The paper's tooth, the granulation, the wear, the wet-edge tint and the film's own translucency all pull a rendered
// colour towards the paper and towards mid-grey, so a palette colour measured on a sheet comes out duller than it was
// measured (user: "precompensate for the loss of saturation from the paper texture"). Before drawing, each pigment's
// uploaded colour is corrected so that the *mean rendered colour of its undeformed drops* equals the measured hex:
// the layers are drawn without the combs and curls (a hair line's blend with its neighbours is the pattern, not the
// texture), the per-colour means are read back, and the difference is added to the uploaded colour, twice.
const colourComp = new Map<number, [number, number, number]>();
const calibLog: unknown[] = [];
let compKey = "";
function compKeyOf(scene: Scene, palette: Palette) {
  return [settings.pattern, palette.key, settings.tooth, settings.granulation, settings.wear, settings.grain, settings.paperAge, settings.bleed, settings.edgeDark, settings.gall, settings.stretchLimit, settings.colourMatch, scene.groundFill].join("|");
}
function calibrateColours(scene: Scene, palette: Palette) {
  colourComp.clear();
  const flat = { ...scene, ops: scene.ops.filter((o) => o.type === OP.SPRINKLE || o.type === OP.SHEAR) };
  const w = Math.min(canvas.width, 1200), hh = Math.min(canvas.height, 800);
  const x0 = Math.floor((canvas.width - w) / 2), y0 = Math.floor((canvas.height - hh) / 2);   // the centre of the canvas whatever its size (on a Retina canvas the corner sat in the vignette)
  const ids = new Uint8Array(w * hh * 4), fin = new Uint8Array(w * hh * 4);
  const prevDebug = settings.debug, prevInter = phaseK;
  const targets = palette.pigments.slice(0, 16).map((pg) => hexToRgb(pg.hex).map((v) => v * 255));   // hexToRgb is 0..1
  const comp = targets.map((t) => [...t] as [number, number, number]);
  const setComp = () => palette.pigments.slice(0, 16).forEach((_, i) => colourComp.set(i, comp[i].map((v) => v / 255) as [number, number, number]));
  for (let it = 0; it < 1; it++) {
    setComp();
    uploadScene(flat, palette);
    // The first calibration of a page ran before the frame loop had bound the layer textures, measured a picture of
    // nothing and pushed the ground colour to a bright pink until the next rebuild: bind here, and set the frame
    // uniforms the draw needs.
    bindTextures();
    gl.uniform2f(uni.uResolution, canvas.width, canvas.height);
    gl.uniform1f(uni.uPxPerMm, canvas.width / sheetWidthMm());
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform1i(uni.uDebug, 7); drawMain(1, 0); gl.readPixels(x0, y0, w, hh, gl.RGBA, gl.UNSIGNED_BYTE, ids);
    gl.uniform1i(uni.uDebug, 0); drawMain(1, 0); gl.readPixels(x0, y0, w, hh, gl.RGBA, gl.UNSIGNED_BYTE, fin);
    // Per colour, a histogram of each channel: the *median* pixel is matched to the palette colour, not the mean.
    // The palette colour is a mixture component's centre, i.e. the typical pixel of that colour on the scan; the mean
    // of a mottled film is pulled by its pale specks and dark pools, and matching it overshot (user: reds garish).
    const hist = new Map<number, Uint32Array>();
    for (let i = 0; i < w * hh; i++) {
      const x = i % w, y = (i - x) / w;
      if (x < w * 0.2 || x > w * 0.8 || y < hh * 0.2 || y > hh * 0.8) continue;   // inside the vignette
      const idx = Math.round((ids[i * 4] / 255) * 32) - 1;
      if (idx < 0 || idx >= 16) continue;
      let hst = hist.get(idx); if (!hst) { hst = new Uint32Array(3 * 256 + 1); hist.set(idx, hst); }
      hst[fin[i * 4]]++; hst[256 + fin[i * 4 + 1]]++; hst[512 + fin[i * 4 + 2]]++; hst[768]++;
    }
    const median = (hst: Uint32Array, k: number) => { const n = hst[768]; let c = 0; for (let v = 0; v < 256; v++) { c += hst[k * 256 + v]; if (c * 2 >= n) return v; } return 255; };
    const log: Record<string, unknown> = {};
    for (const [idx, hst] of hist) {
      if (hst[768] < 400) continue;
      const med = [median(hst, 0), median(hst, 1), median(hst, 2)];
      log[palette.pigments[idx].name] = { n: hst[768], median: med, comp: comp[idx].map(Math.round) };
      // A median far from the colour is a broken measurement (a stale mask), never a shading loss: leave that colour alone.
      if (Math.max(...med.map((v, k) => Math.abs(v - targets[idx][k]))) > 70) continue;
      for (let k = 0; k < 3; k++) comp[idx][k] = Math.max(0, Math.min(255, comp[idx][k] + settings.colourMatch * (targets[idx][k] - med[k])));
    }
    calibLog.push(log);
  }
  setComp();
  settings.debug = prevDebug; void prevInter;
  gl.uniform1i(uni.uDebug, DEBUG_MODES.indexOf(settings.debug));
}
function rebuildScene() {
  if (customScene) { uploadScene(customScene.scene, customScene.pal); return; }
  const recipe = RECIPES.find((r) => r.name === settings.pattern) ?? RECIPES[0];
  paletteObj = PALETTES.find((p) => p.short === settings.palette || p.name === settings.palette) ?? PALETTES.find((p) => p.key === recipe.palette) ?? PALETTES[0];
  const scene = recipe.build({ ...currentParams(), streaks: recipe.streaks, streakScale: recipe.streakScale }, paletteObj);
  const key = compKeyOf(scene, paletteObj);
  if (key !== compKey) { compKey = key; calibrateColours(scene, paletteObj); }
  uploadScene(scene, paletteObj);
  if (url.searchParams.get("pattern") !== settings.pattern || url.searchParams.get("seed") !== String(settings.seed)) {
    url.searchParams.set("pattern", settings.pattern);
    url.searchParams.set("seed", String(settings.seed));
    history.replaceState(null, "", url.toString());   // only on a change: browsers throttle this call
  }
}

let lastDpr = window.devicePixelRatio || 1;
let ppiTouched = false;
function resize() {
  const dpr = window.devicePixelRatio || 1;
  if (dpr !== lastDpr) {
    // window moved to another display, or the browser zoom changed: re-guess the pixel density
    lastDpr = dpr;
    if (!(ppiTouched || (settings as Settings & { ppiTouched?: boolean }).ppiTouched)) { settings.ppi = guessPpi(); gui.controllersRecursive().forEach((c) => c.updateDisplay()); }
    dirty = true;
  }
  const w = Math.round(canvas.clientWidth * dpr * settings.scale);
  const h = Math.round(canvas.clientHeight * dpr * settings.scale);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    dirty = true;
  }
}

// ----------------------------------------------------------------- loop
/** Build and upload the scene for the current time, set the frame uniforms and bind the textures. */
function bindTextures() {
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, layers.tex);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, noiseTex);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, layers.shiftTex);
  if (farTex) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D_ARRAY, farTex); }
}
function uploadFrame() {
  rebuildScene();
  gl.uniform2f(uni.uResolution, canvas.width, canvas.height);
  gl.uniform1f(uni.uPxPerMm, canvas.width / sheetWidthMm());
  gl.uniform1f(uni.uTime, animTime);
  bindTextures();
}
let fpsAcc = 0, fpsN = 0, fpsShown = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  resize();
  if (settings.animate) { animTime += dt * settings.speed; dirty = true; }
  pollQueries();
  if (dirty) {
    uploadFrame();
    dirty = false;
    const k = settings.animate ? chooseK(dt * 1000) : 1;
    if (k !== phaseK) { phaseK = k; phasesValid = false; }
    if (k === 1) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      drawMain(1, 0, true);
      phasesValid = false;
    } else drawInterleaved(k);
    needFull = false;
  }
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fpsShown = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  const il = settings.animate && phaseK > 1 ? ` · interleave ×${phaseK}` : "";
  hud.textContent = `${canvas.width}×${canvas.height} @ DPR ${(window.devicePixelRatio || 1).toFixed(2)} · ${settings.ppi} ppi · sheet ${sheetWidthMm().toFixed(0)} mm across · zoom ${settings.zoom} · ${fpsShown.toFixed(0)} fps${il} · ${settings.pattern} · seed ${settings.seed}`;
  requestAnimationFrame(frame);
}

function savePng() {
  drawWhole();   // every pixel at one instant, whatever the interleave
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `marbled-${settings.pattern.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${settings.seed}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, "image/png");
}

// ----------------------------------------------------------------- init
const BASE_DEFAULTS = { viscosity: 0.35, gall: 1, density: 1, combScale: 1, combStrength: 1, curlStrength: 1, transferAmp: 1, paperAge: 0.35, bleed: 0.12, edgeDark: 0.12, grain: 0.7, tooth: 0.6, granulation: 0.6, wear: 0.06, colourMatch: 1, hairMix: 1, hairWidth: 0.25, drift: 1.2, breath: 0.12, stretchLimit: 60, gapFill: 0.7 };
function applyDefaults(name: string) {
  const r = RECIPES.find((x) => x.name === name);
  if (!r) return;
  Object.assign(settings, BASE_DEFAULTS, r.defaults);
}
let lastPattern = "";
let guiVisible = true;
buildProgram();
applyDefaults(settings.pattern);
lastPattern = settings.pattern;
const gui = makeGui(settings, markDirty, () => {
  const r = RECIPES.find((x) => x.name === settings.pattern);
  if (r && !palettesFor(r.name).some((p) => p.short === settings.palette)) settings.palette = defaultSheet(r.name);
  if (r && lastPattern !== r.name) { applyDefaults(r.name); lastPattern = r.name; gui.controllersRecursive().forEach((c) => c.updateDisplay()); }
  buildProgram();
  markDirty();
});
/** The sheet a pattern opens on: the curated sheet its recipe was tuned against, else the first in the menu. */
function defaultSheet(name: string): string {
  const r = RECIPES.find((x) => x.name === name);
  const sheets = palettesFor(name);
  return (sheets.find((p) => r && p.key === r.palette) ?? sheets[0]).short!;
}
function selectPattern(name: string) {
  const r = RECIPES.find((x) => x.name === name);
  if (!r) return false;
  settings.pattern = r.name;
  settings.palette = defaultSheet(r.name);
  applyDefaults(r.name);
  lastPattern = r.name;
  (gui as unknown as { refreshPalettes: () => void }).refreshPalettes();
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  markDirty();
  return true;
}
// keyboard: space = pause, n/p = next/prev pattern, s = save, r = reseed, x = randomise everything
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === " ") { settings.animate = !settings.animate; markDirty(); }
  else if (e.key === "n" || e.key === "p") {
    const i = RECIPES.findIndex((r) => r.name === settings.pattern);
    const j = (i + (e.key === "n" ? 1 : RECIPES.length - 1)) % RECIPES.length;
    selectPattern(RECIPES[j].name);
  } else if (e.key === "s") savePng();
  else if (e.key === "r") settings.randomSeed();
  else if (e.key === "x") settings.randomAll();
});
// touch: swipe left/right = next/previous pattern, two-finger tap = pause
let swipe: { x: number; y: number; id: number } | null = null;
canvas.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") swipe = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
canvas.addEventListener("pointerup", (e) => {
  if (!swipe || e.pointerId !== swipe.id) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  swipe = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) {
    const i = RECIPES.findIndex((r) => r.name === settings.pattern);
    selectPattern(RECIPES[(i + (dx < 0 ? 1 : RECIPES.length - 1)) % RECIPES.length].name);
  }
});
canvas.addEventListener("touchstart", (e) => { if (e.touches.length === 2) { settings.animate = !settings.animate; gui.controllersRecursive().forEach((c) => c.updateDisplay()); markDirty(); } }, { passive: true });
requestAnimationFrame(frame);

interface FragStats { n: number; perCm2: number; d50: number; p90: number; giant: number; dA50: number; el: number }
/** Render the flat-id view once and count pixels per palette colour (paper = index -1). */
function measureCoverage(noRebuild = false): Record<string, number> {
  const prev = settings.debug;
  settings.debug = "flat ids";
  if (!noRebuild) rebuildScene();
  else gl.uniform1i(uni.uDebug, DEBUG_MODES.indexOf(settings.debug));
  drawWhole();
  const w = Math.min(canvas.width, 1024), hh = Math.min(canvas.height, 1024);
  const px = new Uint8Array(w * hh * 4);
  gl.readPixels(0, 0, w, hh, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const counts = new Map<number, number>();
  for (let i = 0; i < w * hh; i++) {
    const id = Math.round((px[i * 4] / 255) * 32) - 1;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  settings.debug = prev;
  markDirty();
  const total = w * hh;
  const out: Record<string, number> = {};
  for (const [id, n] of counts) out[id < 0 ? "paper" : (paletteObj.pigments[id]?.name ?? String(id))] = Math.round((1000 * n) / total) / 10;
  return out;
}

/** Exact per-colour coverage (%) of the currently uploaded scene: one probe render per colour. */
function measureExact(pal: Palette): Record<string, number> {
  const prev = settings.debug;
  const w = Math.min(canvas.width, 1024), hh = Math.min(canvas.height, 1024);
  const px = new Uint8Array(w * hh * 4);
  const out: Record<string, number> = {};
  gl.uniform1i(uni.uDebug, 8);
  const probes: [number, string][] = [[-1, "paper"], ...pal.pigments.map((pg, i) => [i, pg.name] as [number, string])];
  for (const [id, name] of probes) {
    gl.uniform1i(uni.uProbe, id);
    drawWhole();
    gl.readPixels(0, 0, w, hh, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0;
    for (let i = 0; i < w * hh; i++) sum += px[i * 4];
    out[name] = Math.round((1000 * sum) / (255 * w * hh)) / 10;
  }
  settings.debug = prev;
  gl.uniform1i(uni.uDebug, DEBUG_MODES.indexOf(settings.debug));
  return out;
}

/** The visible fragments of the currently uploaded scene, counted exactly as the scans' were: connected
 *  components of one colour in the flat-id view whose equivalent-circle diameter reaches `minMm`. Per colour the
 *  count per cm², the median, the 90th percentile and the area-weighted median of that diameter, in mm (half the
 *  colour's area lies in pieces smaller than the last, which is the size the eye reads), and `giant`, the largest
 *  single component's share of the colour's area, as the scans' analysis records it. `cov` is each colour's share
 *  of the pixels (the topmost colour per pixel, no anti-aliasing weight), paper included. */
function measureFragments(minMm = 1.2): { stats: Record<string, FragStats>; cov: Record<string, number> } {
  const prev = settings.debug;
  settings.debug = "flat ids";
  gl.uniform1i(uni.uDebug, DEBUG_MODES.indexOf(settings.debug));
  drawWhole();
  const w = canvas.width, h = canvas.height;          // the whole canvas: at the scans' own resolution a sheet is a
  const px = new Uint8Array(w * h * 4);               // small patch already, and every cm² of it counts
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  settings.debug = prev;
  gl.uniform1i(uni.uDebug, DEBUG_MODES.indexOf(settings.debug));
  markDirty();
  const n = w * h;
  const ids = new Int16Array(n);
  const pixels = new Map<number, number>();
  for (let i = 0; i < n; i++) { const id = Math.round((px[i * 4] / 255) * 32) - 1; ids[i] = id; pixels.set(id, (pixels.get(id) ?? 0) + 1); }
  const mm = sheetWidthMm() / canvas.width;
  const seen = new Uint8Array(n), stack = new Int32Array(n);
  const byCol = new Map<number, number[]>(), allCol = new Map<number, [number, number]>(), elCol = new Map<number, number[]>();
  const floorPx = (Math.PI / 4) * (minMm / mm) * (minMm / mm);
  for (let i = 0; i < n; i++) {
    if (ids[i] < 0 || seen[i]) continue;
    const c = ids[i];
    let area = 0, sp = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    stack[sp++] = i; seen[i] = 1;
    while (sp) {
      const j = stack[--sp]; area++;
      const x = j % w, y = (j - x) / w;
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      if (x > 0 && ids[j - 1] === c && !seen[j - 1]) { seen[j - 1] = 1; stack[sp++] = j - 1; }
      if (x < w - 1 && ids[j + 1] === c && !seen[j + 1]) { seen[j + 1] = 1; stack[sp++] = j + 1; }
      if (j >= w && ids[j - w] === c && !seen[j - w]) { seen[j - w] = 1; stack[sp++] = j - w; }
      if (j + w < n && ids[j + w] === c && !seen[j + w]) { seen[j + w] = 1; stack[sp++] = j + w; }
    }
    let all = allCol.get(c); if (!all) { all = [0, 0]; allCol.set(c, all); }      // the scan's `giant`: every component counts
    all[0] += area; all[1] = Math.max(all[1], area);
    if (area < floorPx) continue;
    let a = byCol.get(c); if (!a) { a = []; byCol.set(c, a); }
    a.push(2 * Math.sqrt((area * mm * mm) / Math.PI));
    // how far the piece is drawn out (major/minor axis of its second moments), as the scan analysis measures `el`:
    // on a combed sheet the fragments are streaks, and this says whether they are the scan's streaks
    const vx = sxx / area - (sx / area) * (sx / area), vy = syy / area - (sy / area) * (sy / area);
    const vc = sxy / area - (sx / area) * (sy / area), tr = vx + vy, dt = Math.sqrt(Math.max(0, (vx - vy) * (vx - vy) / 4 + vc * vc));
    const l1 = tr / 2 + dt, l2 = Math.max(1e-6, tr / 2 - dt);
    let e = elCol.get(c); if (!e) { e = []; elCol.set(c, e); }
    e.push(Math.sqrt(l1 / l2));
  }
  const areaCm2 = (n * mm * mm) / 100;
  const stats: Record<string, FragStats> = {}, cov: Record<string, number> = {};
  const nameOf = (id: number) => (id < 0 ? "paper" : paletteObj.pigments[id]?.name ?? String(id));
  for (const [id, k] of pixels) cov[nameOf(id)] = Math.round((1000 * k) / n) / 10;
  for (const [c, a] of byCol) {
    a.sort((x, y) => x - y);
    const q = (f: number) => a[Math.min(a.length - 1, Math.floor(f * a.length))];
    // the area-weighted median (half the colour's area lies in pieces smaller than this) is what the eye reads as
    // the size of the blobs, where the plain median counts every speck equally
    let tot = 0; for (const d of a) tot += d * d;
    let acc = 0, dA50 = a[a.length - 1];
    for (const d of a) { acc += d * d; if (acc >= tot / 2) { dA50 = d; break; } }
    const all = allCol.get(c) ?? [1, 0];
    const e = (elCol.get(c) ?? [1]).slice().sort((x, y) => x - y);
    stats[nameOf(c)] = { n: a.length, perCm2: a.length / areaCm2, d50: q(0.5), p90: q(0.9), giant: all[1] / Math.max(1, all[0]), dA50, el: e[e.length >> 1] };
  }
  return { stats, cov };
}

/** Fit a sheet to the scan's own drop statistics, not to its coverage alone. Each pigment carries three knobs —
 *  the spots per cm², the median spot diameter and the Weibull shape of the size distribution — and the scan gives
 *  the matching numbers, measured on it exactly as they are measured on the render here: the count per cm², the
 *  median and the 90th percentile of the visible fragments' diameter. Both sides therefore count fragments, which
 *  is what the eye counts too: the part of a drop a later colour covers belongs to neither. They are counted at the
 *  resolution the scan was measured at (`fragPpi`), because how many components a shower falls into depends on it:
 *  at 100 ppi this render of dp 80 shows 0.31 black fragments per cm², at the scan's own 7.4 px/mm 0.62.
 *
 *  The targets cannot all be met, and the fit says so rather than trading one away silently. A colour's measured
 *  area and its measured fragments are inconsistent on the scans themselves: over the collection the fragments
 *  account for a median 52 % of the area the mixture model gives the colour, because the mixture files the thin
 *  fringe between two colours, and the speckle inside a neighbour's mottle, as a third colour. So per colour, with
 *  ln n ≈ lnN, ln d ≈ lnD and ln C ≈ lnN + 2·lnD, one damped weighted-least-squares step is taken in (lnN, lnD)
 *  against three residuals:
 *    - coverage (`wCov`) is held, because it sets the sheet's colour balance: dropped, the ground film swallows the
 *      difference (dp 80's black would go from 11 % of the sheet to 39 %). A trust region keeps a step from ever
 *      pushing a colour's coverage further from the sheet's than it is, or than `covBand`, whichever is wider;
 *    - size (`wSize`) is the mean in log of two residuals, the median the scan measured and the area-weighted
 *      median its own fitted Weibull implies (half the colour's area in pieces smaller than it). The median alone
 *      leaves what reads as blotchy free: a render can carry the right median and the right p90 and still put half
 *      its area in the clusters beyond them;
 *    - the count is a bound, not an equality, and how hard a bound depends on the scan. Fewer fragments than the
 *      scan counted is always wrong (`wCount`), since merging and burial can only lose them. More is wrong only
 *      where the scan's own fragments account for its colour's area: the slack δ = ln(area claimed / area
 *      accounted for) is measured once per colour at the start, and the penalty for standing above the scan's
 *      count is `wCountOver`/(1 + δ²) — full where the colour IS its drops, nil where the mixture gave it an area
 *      its component analysis never resolved (dp 80's olive covers 4.9 % of the sheet in components totalling
 *      0.03 %), and no count can be read from that.
 *  The Weibull shape follows the p90/median ratio, as before. The ground fill is fitted to the sheet's bare-paper
 *  fraction throughout: no drop statistic constrains a film. A knob the render ignores (a recipe that lays a
 *  colour at a density of its own) is detected and frozen. The colours of a sheet share it — every drop covers the
 *  colours under it — so a step taken for one moves the others and a chase can overshoot: the run keeps the iterate
 *  that scored best on the objective above, not the last, and reports both scores, so a sheet that never improved
 *  on where it started keeps the values it came with. */
function fitRecipeSizes(name: string, targets: Record<string, { perCm2?: number; d50?: number; p90?: number }>, iters = 8, paletteKey?: string, o: { wCov?: number; wSize?: number; wCount?: number; wCountOver?: number; covBand?: number; ppi?: number; fragPpi?: number; damp?: number; minN?: number; sizeStat?: string } = {}) {
  const recipe = RECIPES.find((r) => r.name === name);
  if (!recipe) return null;
  const pal = PALETTES.find((p) => p.key === (paletteKey ?? recipe.palette));
  if (!pal || !targets) return null;
  paletteObj = pal;
  const wc0 = o.wCov ?? 1.5, wd = o.wSize ?? 1, wUnder = o.wCount ?? 1, wOver = o.wCountOver ?? 0.15;
  const band = Math.log(o.covBand ?? 1.25);            // the coverage may drift this far before it takes the fit over
  const damp = o.damp ?? 0.5, minN = o.minN ?? 8, maxStep = 0.35;
  const fracT: Record<string, number> = {};
  for (const pg of pal.pigments) if (pg.frac !== undefined) fracT[pg.name] = pg.frac;
  const savedPpi = settings.ppi, savedZoom = settings.zoom;
  settings.zoom = 1;
  // Fragments are counted at the resolution the scan was measured at (`fragPpi` = the scan's px/mm × 25.4, which
  // runs 58–391 ppi over the collection), because how many components a shower of drops falls into depends on it:
  // at 100 ppi this render of dp 80 counts 0.31 black fragments per cm², at the scan's own 7.4 px/mm 0.62 and at
  // 11 px/mm 0.95. Measured coarser than the scan, a render looks short of drops and the fit doubles its density.
  // The coverage is measured where it always was, over a wide sheet (heavy tails make a narrow view noisy).
  const fragPpi = o.fragPpi ?? 100;
  const covPpi = o.ppi ?? (["Combed", "Sprinkled", "Curled"].includes(recipe.group) ? 120 : 60);
  const build = (ppi: number) => { settings.ppi = ppi; uploadScene(recipe.build({ ...currentParams(), animate: false }, pal), pal); };
  const unlaid = new Set<string>();
  const log: unknown[] = [];
  let frags: Record<string, FragStats> = {}, exact: Record<string, number> = {}, cov: Record<string, number> = {};
  const step = (x: number) => Math.exp(Math.max(-maxStep, Math.min(maxStep, x)));
  // The size the eye reads is the area-weighted median — half the colour's area lies in pieces smaller than it —
  // not the plain median, which counts every speck equally: on dp 424 the render's yellow has a median fragment of
  // 2.7 mm and an area-weighted median of 5.4 mm. The scan's is not measured directly, but its shifted Weibull is
  // (median, p90 and the shape fitted on the scan), so it follows from the same distribution.
  const areaMedian = (d50: number, p90: number) => {
    const fl = 1.2, r = (p90 - fl) / Math.max(0.01, d50 - fl);
    if (!(r > 1.02) || d50 <= fl) return d50;
    const k = Math.max(0.3, Math.min(6, Math.log(Math.log(10) / Math.log(2)) / Math.log(r)));
    const sc = (d50 - fl) / Math.pow(Math.LN2, 1 / k);
    const M = 512; const ds: number[] = [];
    let tot = 0;
    for (let i = 0; i < M; i++) { const d = fl + sc * Math.pow(-Math.log((i + 0.5) / M), 1 / k); ds.push(d); tot += d * d; }
    ds.sort((x, y) => x - y);
    let acc = 0;
    for (const d of ds) { acc += d * d; if (acc >= tot / 2) return d; }
    return d50;
  };
  // The size residual is the mean of the two in log: the median the scan measured directly, and the area-weighted
  // median its fitted Weibull implies. Pinned at the median alone, a render can carry the right median and the
  // right p90 and still be blotchy, because its tail beyond the p90 is the drops that merged into clusters.
  const sizeRes = (t: { d50: number; p90?: number }, s: FragStats) => {
    const rd = Math.log(t.d50 / Math.max(0.2, s.d50));
    if (o.sizeStat === "d50" || !t.p90) return rd;
    const rA = Math.log(areaMedian(t.d50, t.p90) / Math.max(0.2, s.dA50));
    return o.sizeStat === "dA50" ? rA : 0.5 * (rd + rA);
  };
  // Not every knob reaches the sheet: a recipe may lay a colour at a density of its own (Placard's two or three huge
  // drops per sheet), and driving a knob the render ignores walks the other one off the sheet. A knob that moves by a
  // sixth without moving its statistic twice running is dead: it goes back to the value it came with and stays there.
  const init = new Map(pal.pigments.map((pg) => [pg.name, { perCm2: pg.perCm2, d50: pg.d50, wk: pg.wk }]));
  // How far the scan's own numbers hang together, per colour, measured once against the render's packing:
  // δ = ln(area the scan's coverage claims / area its own fragments account for). Where δ ≈ 0 the colour IS its
  // drops and a count above the scan's is a real excess, penalised. Where δ is large the mixture has filed thin
  // fringe and speckle inside its neighbours as this colour, so the components it counted are a small sample of a
  // population it never resolved, and its count cannot bound the render's from above.
  const slack: Record<string, number> = {};
  const overW = (n: string) => wOver / (1 + (slack[n] ?? 0) * (slack[n] ?? 0));
  const prev = new Map<string, { kn: number; kd: number; n: number; d: number }>();
  const dead: Record<string, string[]> = {};
  const strikes: Record<string, number> = {};
  const isDead = (n: string, k: string) => (dead[n] ?? []).includes(k);
  // The exact per-colour coverage costs one probe render per colour; the flat-id view costs one for the whole sheet
  // and comes with the fragments. So the exact coverage is measured once at the start and once at the end, and the
  // loop tracks it as the flat-id share times the ratio the two stood in at the start.
  const ratio: Record<string, number> = {};
  const covOf = (n: string) => Math.max(0.05, (cov[n] ?? 0) * (ratio[n] ?? 1));
  const snap = () => ({ pg: pal.pigments.map((p) => ({ perCm2: p.perCm2, d50: p.d50, wk: p.wk })), fill: pal.bg?.fill });
  const restore = (sn: ReturnType<typeof snap>) => { pal.pigments.forEach((p, i) => { p.perCm2 = sn.pg[i].perCm2; p.d50 = sn.pg[i].d50; p.wk = sn.pg[i].wk; }); if (pal.bg && sn.fill !== undefined) pal.bg.fill = sn.fill; };
  let best = { score: Infinity, it: -1, sn: snap() };
  const scores: number[] = [];
  for (let it = 0; it <= iters; it++) {
    build(fragPpi);
    frags = measureFragments().stats;
    build(covPpi);
    cov = measureCoverage(true);
    if (it === 0) {
      exact = measureExact(pal);
      for (const pg of pal.pigments) if ((exact[pg.name] ?? 0) < 0.05 && fracT[pg.name] !== undefined) unlaid.add(pg.name);
      for (const n of Object.keys(exact)) ratio[n] = (exact[n] ?? 0) / Math.max(0.05, cov[n] ?? 0);
    }
    // how far the sheet stands from the scan, in the fit's own terms: the argmin over the run is what is kept, since
    // the colours of a sheet share it (every drop covers the colours under it) and a chase can overshoot
    let score = 0;
    for (const pg of pal.pigments) {
      if (unlaid.has(pg.name)) continue;
      const t = targets[pg.name], s = frags[pg.name], target = fracT[pg.name];
      const rc = target === undefined ? 0 : Math.log(Math.max(0.2, target) / Math.max(0.2, covOf(pg.name)));
      score += wc0 * rc * rc;
      if (!pg.d50 || !t || !t.perCm2 || !t.d50 || !s || s.n < minN) continue;
      const rn = Math.log(t.perCm2 / Math.max(1e-3, s.perCm2)), rd = sizeRes(t as { d50: number; p90?: number }, s);
      if (it === 0) slack[pg.name] = Math.max(0, rc - rn - 2 * rd);
      score += wd * rd * rd + (rn > 0 ? wUnder : overW(pg.name)) * rn * rn;
    }
    if (pal.paperPct !== undefined) { const rp = Math.log(Math.max(0.5, pal.paperPct) / Math.max(0.5, covOf("paper"))); score += wc0 * rp * rp; }
    scores.push(Math.round(1000 * score) / 1000);
    if (score < best.score) best = { score, it, sn: snap() };
    log.push({ it, score: Math.round(1000 * score) / 1000, frags: Object.fromEntries(Object.entries(frags).map(([k, v]) => [k, [+v.perCm2.toFixed(2), +v.d50.toFixed(2), +v.p90.toFixed(2)]])), cov: Object.fromEntries(pal.pigments.map((p) => [p.name, +covOf(p.name).toFixed(1)])) });
    if (it === iters) break;
    for (const pg of pal.pigments) {                        // knobs that no longer reach the render
      const s = frags[pg.name], pv = prev.get(pg.name), b0 = init.get(pg.name);
      if (s) prev.set(pg.name, { kn: pg.perCm2 ?? 1, kd: pg.d50 ?? 1, n: s.perCm2, d: s.d50 });
      if (!s || !pv || !b0) continue;
      const chk = (knob: number, was: number, got: number, had: number, key: "perCm2" | "d50") => {
        const dk = Math.log(Math.max(1e-4, knob) / Math.max(1e-4, was));
        if (Math.abs(dk) < 0.16 || isDead(pg.name, key)) return;
        if (Math.abs(Math.log(Math.max(1e-4, got) / Math.max(1e-4, had))) > 0.1 * Math.abs(dk)) { strikes[pg.name + key] = 0; return; }
        if ((strikes[pg.name + key] = (strikes[pg.name + key] ?? 0) + 1) >= 2) { (dead[pg.name] ??= []).push(key); pg[key] = b0[key]; }
      };
      chk(pg.perCm2 ?? 1, pv.kn, s.perCm2, pv.n, "perCm2");
      chk(pg.d50 ?? 1, pv.kd, s.d50, pv.d, "d50");
    }
    for (const pg of pal.pigments) {
      if (unlaid.has(pg.name) || !pg.d50) continue;
      const t = targets[pg.name], s = frags[pg.name];
      const target = fracT[pg.name];
      const rc = target === undefined ? 0 : Math.log(Math.max(0.2, target) / Math.max(0.2, covOf(pg.name)));
      if (t && t.perCm2 && t.d50 && s && s.n >= minN) {
        const rn = Math.log(t.perCm2 / Math.max(1e-3, s.perCm2));       // > 0: fewer drops than the scan counted
        const rd = sizeRes(t as { d50: number; p90?: number }, s);
        const liveN = !isDead(pg.name, "perCm2"), liveD = !isDead(pg.name, "d50");
        const wn = rn > 0 ? wUnder : overW(pg.name);
        // Outside the band the coverage weight grows quadratically, so a knob the recipe overrides (Placard's few
        // huge drops carry their own density) cannot walk a colour off the sheet: the step becomes the old
        // coverage fit instead. Inside it, the statistics drive.
        const wc = wc0 * Math.max(1, (rc / band) * (rc / band));
        const a11 = wn + wc, a12 = 2 * wc, a22 = wd + 4 * wc;           // normal equations of the weighted step
        const b1 = wn * rn + wc * rc, b2 = wd * rd + 2 * wc * rc;
        const det = Math.max(1e-6, a11 * a22 - a12 * a12);
        // a dead knob is held at 0 rather than merely unweighted: left in the solve it would take the whole coverage
        // correction (and reach nothing), and the step in the live knob would chase the statistics alone
        let dN = liveN && liveD ? (b1 * a22 - a12 * b2) / det : liveN ? b1 / a11 : 0;
        let dD = liveN && liveD ? (a11 * b2 - a12 * b1) / det : liveD ? b2 / a22 : 0;
        // Trust region on the coverage: a step may never push a colour's coverage further from the sheet's than it
        // already is, or than the band, whichever is wider. It is the coverage that carries the sheet's colour
        // balance, and a target the recipe cannot express would otherwise walk the colour off the sheet.
        const pred = damp * (dN + 2 * dD), lim = Math.max(Math.abs(rc), band);
        if (Math.abs(rc - pred) > lim && Math.abs(pred) > 1e-6) {
          const sc = Math.max(0, Math.min(1, (rc - Math.sign(rc - pred) * lim) / pred));
          dN *= sc; dD *= sc;
        }
        const nMin = 0.25 * t.perCm2, nMax = 25 * t.perCm2;             // never a fog of drops for a colour the scan shows as a haze
        if (liveN) pg.perCm2 = Math.min(40, nMax, Math.max(0.01, nMin, Math.round(1000 * (pg.perCm2 ?? t.perCm2) * step(damp * dN)) / 1000));
        if (liveD) pg.d50 = Math.min(60, Math.max(0.3, Math.round(100 * pg.d50 * step(damp * dD)) / 100));
        const rT = t.p90 && t.d50 ? t.p90 / t.d50 : 0, rR = s.p90 / s.d50;    // Weibull: p90/p50 = 3.32^(1/k)
        if (rT > 1.02 && rR > 1.02 && liveD) pg.wk = Math.round(100 * Math.min(3, Math.max(0.45, (pg.wk ?? 1) * Math.pow(Math.log(rR) / Math.log(rT), 0.7)))) / 100;
      } else if (target !== undefined && !isDead(pg.name, "d50")) {
        // no fragment measurement to fit: a colour laid as a film, or one the later throws have all but buried.
        // Its median size still answers to the coverage, as it did before the statistics were fitted.
        pg.d50 = Math.min(60, Math.max(0.3, Math.round(100 * pg.d50 * Math.pow(Math.min(1.5, Math.max(0.67, Math.exp(0.5 * rc))), damp)) / 100));
      }
    }
    if (pal.bg && pal.paperPct !== undefined) {
      const ratioP = Math.pow(Math.min(1.4, Math.max(0.7, Math.sqrt(covOf("paper") / Math.max(0.5, pal.paperPct)))), damp);   // more paper than the sheet → fuller background
      pal.bg.fill = Math.round(100 * Math.min(1, (pal.bg.fill ?? 1) * ratioP)) / 100;
    }
  }
  restore(best.sn);                                   // the best iterate, not the last
  build(fragPpi);
  frags = measureFragments().stats;
  build(covPpi);
  cov = measureCoverage(true);
  exact = measureExact(pal);
  settings.ppi = savedPpi; settings.zoom = savedZoom;
  markDirty();
  // residuals: how far the render still stands from the scan, in log units (0 = met), and the coverage it cost
  const resid: Record<string, { n: number; d: number; dA: number; cov: number }> = {};
  for (const pg of pal.pigments) {
    const t = targets[pg.name], s = frags[pg.name];
    if (!pg.d50 || unlaid.has(pg.name) || !t || !t.perCm2 || !t.d50) continue;
    resid[pg.name] = {
      n: +Math.log((s?.perCm2 ?? 0.001) / t.perCm2).toFixed(2),
      d: +Math.log((s?.d50 ?? 0.2) / t.d50).toFixed(2),
      dA: +Math.log((s?.dA50 ?? 0.2) / areaMedian(t.d50, t.p90 ?? t.d50)).toFixed(2),
      cov: fracT[pg.name] === undefined ? 0 : +((exact[pg.name] ?? 0) - fracT[pg.name]).toFixed(1),
    };
  }
  return {
    name, palette: pal.key, unlaid: [...unlaid], bg: pal.bg, last: exact, frags, targets, resid, log, dead, scores, slack, best: { it: best.it, score: Math.round(1000 * best.score) / 1000, start: scores[0] },
    n: Object.fromEntries(pal.pigments.filter((p) => p.d50 && !unlaid.has(p.name)).map((p) => [p.name, p.perCm2])),
    d: Object.fromEntries(pal.pigments.filter((p) => p.d50 && !unlaid.has(p.name)).map((p) => [p.name, p.d50])),
    wk: Object.fromEntries(pal.pigments.filter((p) => p.d50 && !unlaid.has(p.name)).map((p) => [p.name, p.wk])),
  };
}

/** Fit a whole recipe (its default sheet) to the sheet's measured fractions by adjusting each
 *  colour's median spot size (all layers of that colour) and, on paper-showing sheets, the
 *  background fill. Measures exactly, over a wide sheet. */
function fitRecipe(name: string, iters = 8, paletteKey?: string) {
  const recipe = RECIPES.find((r) => r.name === name);
  if (!recipe) return null;
  const pal = PALETTES.find((p) => p.key === (paletteKey ?? recipe.palette));
  if (!pal) return null;
  paletteObj = pal;
  const targets: Record<string, number> = {};
  for (const pg of pal.pigments) if (pg.frac !== undefined) targets[pg.name] = pg.frac;
  const savedPpi = settings.ppi, savedZoom = settings.zoom;
  // a wide sheet for the stone patterns (thousands of drops); the combed ones are measured at twice the resolution,
  // since chords the tracer drops below its pixel never reach the count and the fine-lined colours came out short
  settings.ppi = ["Combed", "Sprinkled", "Curled"].includes(recipe.group) ? 120 : 60; settings.zoom = 1;
  const log: unknown[] = [];
  let frac: Record<string, number> = {};
  const unlaid = new Set<string>();
  for (let it = 0; it <= iters; it++) {
    const scene = recipe.build({ ...currentParams(), animate: false }, pal);
    uploadScene(scene, pal);
    frac = measureExact(pal);
    log.push({ it, frac });
    if (it === 0) for (const pg of pal.pigments) if ((frac[pg.name] ?? 0) === 0 && targets[pg.name] !== undefined) unlaid.add(pg.name);
    if (it === iters) break;
    const damp = 0.6;
    for (const pg of pal.pigments) {
      const target = targets[pg.name];
      if (target === undefined || !pg.d50 || unlaid.has(pg.name)) continue;
      const actual = Math.max(0.2, frac[pg.name] ?? 0.2);
      pg.d50 = Math.min(60, Math.max(0.3, Math.round(100 * pg.d50 * Math.pow(Math.min(1.5, Math.max(0.67, Math.sqrt(target / actual))), damp)) / 100));   // a colour hidden under later throws cannot grow without bound (g89: 925 mm)
    }
    if (pal.bg && pal.paperPct !== undefined) {
      const actual = Math.max(0.5, frac.paper ?? 0.5);
      const ratio = Math.pow(Math.min(1.4, Math.max(0.7, Math.sqrt(actual / pal.paperPct))), damp); // more paper than the sheet → fuller background
      pal.bg.fill = Math.round(100 * Math.min(1, (pal.bg.fill ?? 1) * ratio)) / 100;
    }
  }
  settings.ppi = savedPpi; settings.zoom = savedZoom;
  markDirty();
  return { name, palette: pal.key, d: Object.fromEntries(pal.pigments.filter((p) => p.d50 && !unlaid.has(p.name)).map((p) => [p.name, p.d50])), unlaid: [...unlaid], bg: pal.bg, last: frac, targets, paperPct: pal.paperPct, log };
}

// automation / debugging hooks
(window as unknown as { marble: unknown }).marble = {
  settings,
  markDirty,
  setPattern: selectPattern,
  get fps() { return fpsShown; },
  /** Render the current settings whole, synchronously, so the caller can read the canvas back in the same task. */
  render() { resize(); uploadFrame(); drawWhole(); dirty = false; },
  /** render cost diagnostics: estimated cost of shading every pixel, and the interleave in use */
  get perf() { return { fullCostMs: Math.round(fullCostMs), interleave: phaseK, timerQueries: !!timerExt, canvas: `${canvas.width}×${canvas.height}` }; },
  /** Fit spot sizes and background fill of a palette so the rendered stone base matches measured fractions (%). */
  fitPalette(key: string, targets?: Record<string, number>, iters = 6, opts: Record<string, unknown> = {}) {
    const pal = PALETTES.find((p) => p.key === key);
    if (!pal) return null;
    if (!targets) { targets = {}; for (const pg of pal.pigments) if (pg.frac !== undefined) targets[pg.name] = pg.frac; }
    paletteObj = pal;
    const log: unknown[] = [];
    let lastFrac: Record<string, number> = {};
    const savedPpi = settings.ppi, savedZoom = settings.zoom;
    settings.ppi = 60; settings.zoom = 1;          // measure over a wide sheet (~600 mm): thousands of drops, not ~100
    const hadBg = pal.bg !== undefined;
    for (let it = 0; it <= iters; it++) {
      const scene = new Builder({ ...currentParams(), animate: false }, pal).turkish(opts).scene();
      const prev = settings.debug;
      settings.debug = "flat ids";
      uploadScene(scene, pal);
      const frac = measureCoverage(true);
      settings.debug = prev;
      lastFrac = frac;
      log.push({ it, frac });
      if (it === iters) break;                 // report the parameters that produced the last measurement
      const damp = 0.6;                        // damped multiplicative updates (heavy-tailed sizes)
      for (const ci of pal.spots) {
        const pg = pal.pigments[ci];
        const target = targets[pg.name];
        if (target === undefined || !pg.d50) continue;
        const actual = Math.max(0.2, frac[pg.name] ?? 0.2);
        pg.d50 = Math.round(100 * pg.d50 * Math.pow(Math.min(1.5, Math.max(0.67, Math.sqrt(target / actual))), damp)) / 100;
      }
      const bgName = pal.pigments[pal.background].name;
      if (hadBg && targets[bgName] !== undefined) {   // only sheets with visible paper have a tunable background
        const actual = Math.max(0.5, frac[bgName] ?? 0.5);
        const ratio = Math.pow(Math.min(1.4, Math.max(0.7, Math.sqrt(targets[bgName] / actual))), damp);
        pal.bg = pal.bg ?? { fill: 1, r: 0.92 };
        pal.bg.r = Math.round(100 * Math.min(1.0, (pal.bg.r ?? 0.92) * ratio)) / 100;
        if (ratio < 1 || (pal.bg.r ?? 0) < 1.0) pal.bg.fill = Math.round(100 * Math.min(1, (pal.bg.fill ?? 1) * ratio)) / 100;
      }
    }
    void lastFrac;
    settings.ppi = savedPpi; settings.zoom = savedZoom;
    markDirty();
    return { key, spots: pal.spots.map((ci) => [pal.pigments[ci].name, pal.pigments[ci].d50]), bg: pal.bg, log };
  },
  /** recompile the fragment shader (after changing settings that are compiled in, e.g. the drop neighbourhood) */
  rebuildProgram: () => { buildProgram(); markDirty(); },
  measureCoverage: measureCoverage,
  measureExact: () => measureExact(paletteObj),
  measureFragments,
  fitRecipe,
  fitRecipeSizes,
  bestRecipeFor,
  Builder,
  PALETTES,
  showScene(scene: Scene | null, pal: Palette) { customScene = scene ? { scene, pal } : null; paletteObj = pal; markDirty(); },
  params: currentParams,
  calibrate() { compKey = ""; calibLog.length = 0; rebuildScene(); return { comp: Object.fromEntries(colourComp), log: calibLog }; },
  RECIPES,
  layers,
  /** Upload an arbitrary scene (built with marble.Builder) and measure its coverage. */
  measureScene(scene: Scene, pal: Palette) {
    paletteObj = pal;
    const prev = settings.debug;
    settings.debug = "flat ids";
    uploadScene(scene, pal);
    const r = measureCoverage(true);
    settings.debug = prev;
    return r;
  },
  get sheetWidthMm() { return sheetWidthMm(); },
};

// hot reload of shader sources
if (import.meta.hot) import.meta.hot.accept(() => location.reload());
