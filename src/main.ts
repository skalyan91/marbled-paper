import fragSrc from "./shaders/marble.frag?raw";
import vertSrc from "./shaders/fullscreen.vert?raw";
import { MAX_OPS as OPS_PER_CHAIN, FLOATS_PER_OP, packOps } from "./ops";
import { LayerBank, MAX_LAYERS } from "./layers";
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

const glMaybe = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
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
  gapFill: 0.7,
  animate: true,
  scale: 1.0,
  neighbourhood: 2,
  antialias: true,
  grain: 0.7,
  stretchLimit: 60.0,
  paperAge: 0.35,
  bleed: 0.12,
  edgeWobble: 0.6,
  edgeDark: 0.12,
  tooth: 0.6,
  granulation: 0.6,
  transferAmp: 1.0,
  debug: DEBUG_MODES[0],
  savePng: () => savePng(),
  randomSeed: () => { settings.seed = Math.floor(Math.random() * 9999) + 1; markDirty(); },
};
if (!RECIPES.some((r) => r.name === settings.pattern)) settings.pattern = RECIPES[0].name;
settings.palette = palettesFor(settings.pattern)[0].short!;

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
  for (const n of ["uResolution", "uPxPerMm", "uTime", "uOpCount", "uOpCount2", "uUnderMode", "uDebug", "uCells", "uNoise", "uPaper", "uTransfer", "uTransfer2", "uDry", "uSamples", "uBleed", "uPaperTex", "uProbe", "uGroundUnder"]) uni[n] = gl.getUniformLocation(pr, n);
  gl.uniformBlockBinding(pr, gl.getUniformBlockIndex(pr, "Ops"), 0);
  gl.uniformBlockBinding(pr, gl.getUniformBlockIndex(pr, "Palette"), 1);
  gl.uniform1i(uni.uCells, 0);
  gl.uniform1i(uni.uNoise, 1);
  errBox.style.display = "none";
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

function markDirty() { dirty = true; }

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
  for (let i = 0; i < Math.min(allLayers.length, MAX_LAYERS); i++) layers.bake(i, allLayers[i], animTime, settings.animate);

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
    const [r, g, b] = hexToRgb(pg.hex);
    pal.set([r, g, b, 1], i * 4);
    pal.set([pg.opacity ?? 1, pg.grain ?? 0.5, pg.metallic ?? 0, 0], 64 + i * 4);
  });
  gl.bindBuffer(gl.UNIFORM_BUFFER, palBuf);
  gl.bufferSubData(gl.UNIFORM_BUFFER, 0, pal);

  const [pr, pgc, pb] = hexToRgb(palette.paper);
  gl.uniform4f(uni.uPaper, pr, pgc, pb, settings.paperAge);
  const t = scene.transfer;
  gl.uniform4f(uni.uTransfer, t.mode, t.amp * settings.transferAmp, (2 * Math.PI) / t.wavelength, (t.angle * Math.PI) / 180);
  gl.uniform4f(uni.uTransfer2, t.phase, t.wobble, scene.goldNet, scene.softPaper);
  gl.uniform4f(uni.uDry, settings.grain, settings.stretchLimit, scene.groundFill + 1, settings.seed);
  gl.uniform1i(uni.uDebug, DEBUG_MODES.indexOf(settings.debug));
  gl.uniform1i(uni.uSamples, settings.antialias ? 1 : 0);
  gl.uniform4f(uni.uBleed, settings.bleed, settings.edgeWobble, settings.edgeDark, palette.laid ? 1 : 0);
  gl.uniform4f(uni.uPaperTex, 1.15, 26, settings.tooth, settings.granulation);
}

let customScene: { scene: Scene; pal: Palette } | null = null;
function rebuildScene() {
  if (customScene) { uploadScene(customScene.scene, customScene.pal); return; }
  const recipe = RECIPES.find((r) => r.name === settings.pattern) ?? RECIPES[0];
  paletteObj = PALETTES.find((p) => p.short === settings.palette || p.name === settings.palette) ?? PALETTES.find((p) => p.key === recipe.palette) ?? PALETTES[0];
  const scene = recipe.build(currentParams(), paletteObj);
  uploadScene(scene, paletteObj);
  url.searchParams.set("pattern", settings.pattern);
  url.searchParams.set("seed", String(settings.seed));
  history.replaceState(null, "", url.toString());
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
let fpsAcc = 0, fpsN = 0, fpsShown = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  resize();
  if (settings.animate) { animTime += dt * settings.speed; dirty = true; }
  if (dirty) {
    rebuildScene();
    dirty = false;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uni.uResolution, canvas.width, canvas.height);
    gl.uniform1f(uni.uPxPerMm, canvas.width / sheetWidthMm());
    gl.uniform1f(uni.uTime, animTime);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, layers.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, noiseTex);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fpsShown = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  hud.textContent = `${canvas.width}×${canvas.height} @ DPR ${(window.devicePixelRatio || 1).toFixed(2)} · ${settings.ppi} ppi · sheet ${sheetWidthMm().toFixed(0)} mm across · zoom ${settings.zoom} · ${fpsShown.toFixed(0)} fps · ${settings.pattern} · seed ${settings.seed}`;
  requestAnimationFrame(frame);
}

function savePng() {
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
const BASE_DEFAULTS = { viscosity: 0.35, gall: 1, density: 1, combScale: 1, combStrength: 1, curlStrength: 1, transferAmp: 1, paperAge: 0.35, bleed: 0.12, edgeDark: 0.12, grain: 0.7, tooth: 0.6, granulation: 0.6, drift: 1.2, stretchLimit: 60, gapFill: 0.7 };
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
  if (r && !palettesFor(r.name).some((p) => p.short === settings.palette)) settings.palette = palettesFor(r.name)[0].short!;
  if (r && lastPattern !== r.name) { applyDefaults(r.name); lastPattern = r.name; gui.controllersRecursive().forEach((c) => c.updateDisplay()); }
  buildProgram();
  markDirty();
});
function selectPattern(name: string) {
  const r = RECIPES.find((x) => x.name === name);
  if (!r) return false;
  settings.pattern = r.name;
  settings.palette = palettesFor(r.name)[0].short!;
  applyDefaults(r.name);
  lastPattern = r.name;
  (gui as unknown as { refreshPalettes: () => void }).refreshPalettes();
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  markDirty();
  return true;
}
// keyboard: space = pause, n/p = next/prev pattern, s = save, r = reseed
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === " ") { settings.animate = !settings.animate; markDirty(); }
  else if (e.key === "n" || e.key === "p") {
    const i = RECIPES.findIndex((r) => r.name === settings.pattern);
    const j = (i + (e.key === "n" ? 1 : RECIPES.length - 1)) % RECIPES.length;
    selectPattern(RECIPES[j].name);
  } else if (e.key === "s") savePng();
  else if (e.key === "r") settings.randomSeed();
});
requestAnimationFrame(frame);

/** Render the flat-id view once and count pixels per palette colour (paper = index -1). */
function measureCoverage(noRebuild = false): Record<string, number> {
  const prev = settings.debug;
  settings.debug = "flat ids";
  if (!noRebuild) rebuildScene();
  else gl.uniform1i(uni.uDebug, DEBUG_MODES.indexOf(settings.debug));
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
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
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, w, hh, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0;
    for (let i = 0; i < w * hh; i++) sum += px[i * 4];
    out[name] = Math.round((1000 * sum) / (255 * w * hh)) / 10;
  }
  settings.debug = prev;
  gl.uniform1i(uni.uDebug, DEBUG_MODES.indexOf(settings.debug));
  return out;
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
  settings.ppi = 60; settings.zoom = 1;
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
      pg.d50 = Math.round(100 * pg.d50 * Math.pow(Math.min(1.5, Math.max(0.67, Math.sqrt(target / actual))), damp)) / 100;
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
  measureCoverage: measureCoverage,
  measureExact: () => measureExact(paletteObj),
  fitRecipe,
  bestRecipeFor,
  Builder,
  PALETTES,
  showScene(scene: Scene | null, pal: Palette) { customScene = scene ? { scene, pal } : null; paletteObj = pal; markDirty(); },
  params: currentParams,
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
