import GUI from "lil-gui";
import { RECIPES, PALETTES, type Palette } from "./recipes";

export interface Settings {
  pattern: string;
  palette: string;
  seed: number;
  viscosity: number;
  gall: number;
  density: number;
  combScale: number;
  combStrength: number;
  curlStrength: number;
  ppi: number; // physical pixel density of the display
  zoom: number; // 1 = life size
  speed: number;
  drift: number;
  gapFill: number;
  animate: boolean;
  scale: number; // × devicePixelRatio
  neighbourhood: number; // 2 → 5×5, 3 → 7×7
  antialias: boolean;
  grain: number;
  stretchLimit: number;
  paperAge: number;
  bleed: number; // mm
  edgeWobble: number;
  edgeDark: number;
  tooth: number;
  granulation: number;
  wear: number; // rubbed cover fibres
  transferAmp: number;
  debug: string;
  savePng: () => void;
  randomSeed: () => void;
  randomAll: () => void; // random pattern, sheet and seed in one go
}

export const DEBUG_MODES = ["final", "hit id", "source coords", "stretch", "coverage", "paper only", "AA pieces", "flat ids", "probe", "weights", "piece0", "factors"];

/** Replace the native <select> popup of a lil-gui option controller with a panel-styled list.
 *  `thumbs`, if given, returns one thumbnail URL (or null) per option; the images are fetched by
 *  the viewer's browser from their source when the list opens, nothing is stored here. */
function customDropdown(ctrl: { $select: HTMLSelectElement; $widget: HTMLElement; $display: HTMLElement; setValue: (v: unknown) => void; _values: unknown[]; _names: string[] }, thumbs?: () => (string | null)[]) {
  const sel = ctrl.$select;
  sel.style.pointerEvents = "none";
  sel.tabIndex = -1;
  let list: HTMLDivElement | null = null;
  const close = () => { list?.remove(); list = null; document.removeEventListener("pointerdown", onDoc, true); };
  const onDoc = (e: PointerEvent) => { if (list && !list.contains(e.target as Node) && !ctrl.$widget.contains(e.target as Node)) close(); };
  ctrl.$widget.addEventListener("click", (e) => {
    e.preventDefault();
    if (list) { close(); return; }
    list = document.createElement("div");
    list.className = "marble-dropdown";
    const r = ctrl.$widget.getBoundingClientRect();
    list.style.left = `${r.left}px`; list.style.top = `${r.bottom + 2}px`; list.style.minWidth = `${r.width}px`;
    const urls = thumbs?.();
    ctrl._names.forEach((name, i) => {
      const item = document.createElement("div");
      item.className = "item" + (sel.selectedIndex === i ? " selected" : "");
      if (urls) {
        const url = urls[i];
        const box = document.createElement(url ? "img" : "span");
        box.className = "thumb";
        if (url && box instanceof HTMLImageElement) { box.src = url; box.alt = ""; box.loading = "lazy"; box.addEventListener("error", () => box.classList.add("missing")); }
        item.appendChild(box);
      }
      item.appendChild(document.createTextNode(name));
      item.addEventListener("click", () => { ctrl.setValue(ctrl._values[i]); close(); });
      list!.appendChild(item);
    });
    document.body.appendChild(list);
    const lr = list.getBoundingClientRect();
    if (lr.bottom > innerHeight) list.style.top = `${Math.max(4, r.top - lr.height - 2)}px`;
    if (lr.right > innerWidth) list.style.left = `${Math.max(4, innerWidth - lr.width - 4)}px`;
    document.addEventListener("pointerdown", onDoc, true);
  });
}

/** Narrow (phone) layout: the panel is a bottom sheet and starts closed. */
export const isPhone = () => matchMedia("(max-width: 640px)").matches;

/** Sheets for a pattern: the curated ones first, then every generated sheet of the collection whose
 *  leading catalogue pattern matches the recipe's terms (longest-term match wins between recipes). */
export function palettesFor(pattern: string) {
  const r = RECIPES.find((x) => x.name === pattern) ?? RECIPES[0];
  const curated = r.palettes.map((k) => PALETTES.find((p) => p.key === k)!).filter(Boolean);
  const gen = (PALETTES as (Palette & { lead?: string })[]).filter((p) => p.lead !== undefined && bestRecipeFor(p.lead) === r.name);
  // one entry per sheet, oldest first (century from the catalogue title, then catalogue number;
  // curated sheets without a catalogue number lead their century)
  // one entry per sheet: the same catalogue item may exist as a curated and a generated palette
  const seen = new Set<string>();
  const all = [...curated, ...gen].filter((p) => { const id = String(dpNumber(p) ?? p.key); return seen.has(id) ? false : (seen.add(id), true); });
  const century = (p: Palette) => { const m = /(\d+)(?:st|nd|rd|th)[-\s]c(?:\.|entury)/i.exec(p.name); return m ? +m[1] : 99; };
  const num = (p: Palette) => dpNumber(p) ?? -1;
  return all.sort((a, b) => century(a) - century(b) || num(a) - num(b));
}
/** UW Decorated Paper catalogue number of a sheet ("dp 370" → 370), or null for a sheet without one. */
export function dpNumber(p: Palette | undefined): number | null {
  if (!p) return null;
  const m = /\bdp\s*0*(\d+)/i.exec(p.source) ?? /\bdp\s*0*(\d+)/i.exec(p.name) ?? /^dp0*(\d+)$/i.exec(p.key);
  return m ? +m[1] : null;
}
/** A small button at the start of a controller's row, before its label (an action that belongs to that control). */
function inlineButton(ctrl: { $name: HTMLElement }, glyph: string, title: string, onClick: () => void) {
  const b = document.createElement("button");
  b.className = "marble-inline";
  b.textContent = glyph;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
  ctrl.$name.prepend(b);   // at the start of the row, so the buttons of different rows line up
  return b;
}

/** A small link at the start of a controller's row, opening in a new tab (a real anchor, so it is never popup-blocked). */
function inlineLink(ctrl: { $name: HTMLElement }, glyph: string, title: string) {
  const a = document.createElement("a");
  a.className = "marble-inline";
  a.textContent = glyph;
  a.title = title;
  a.setAttribute("aria-label", title);
  a.target = "_blank";
  a.rel = "noopener";
  a.addEventListener("click", (e) => e.stopPropagation());
  ctrl.$name.prepend(a);
  return a;
}

/** Item page of a sheet in the UW Decorated and Decorative Paper collection. */
export const sheetUrl = (dp: number) => `https://digitalcollections.lib.washington.edu/digital/collection/dp/id/${dp}`;
/** A tiny square thumbnail of a sheet, served by the collection's IIIF image server (40 px for 20 css px at 2×). */
export const thumbUrl = (dp: number) => `https://digitalcollections.lib.washington.edu/iiif/2/dp:${dp}/square/40,/0/default.jpg`;
export function bestRecipeFor(lead: string): string | null {
  let best: { name: string; len: number } | null = null;
  for (const rc of RECIPES) for (const t of rc.terms ?? []) if (lead.includes(t) && (!best || t.length > best.len)) best = { name: rc.name, len: t.length };
  return best?.name ?? null;
}

export function makeGui(s: Settings, onChange: () => void, onRebuild: () => void) {
  const gui = new GUI({ title: "Marbled paper" });
  const names = RECIPES.map((r) => r.name);
  const patternCtrl = gui.add(s, "pattern", names).name("Pattern");
  customDropdown(patternCtrl as unknown as Parameters<typeof customDropdown>[0]);
  // The palette dropdown lives in its own folder: lil-gui 0.20 replaces the options of a
  // controller in place, but older versions destroyed it and appended a new one to its parent,
  // so the reference is refreshed each time and the sheet link is moved back after the dropdown.
  const palFolder = gui.addFolder("Palette");
  const currentPalette = () => PALETTES.find((p) => p.short === s.palette || p.name === s.palette);
  const paletteChanged = () => { syncSheetLink(); onChange(); };
  const sheetThumbs = () => palettesFor(s.pattern).map((p) => { const dp = dpNumber(p); return dp === null ? null : thumbUrl(dp); });
  let paletteCtrl = palFolder.add(s, "palette", palettesFor(s.pattern).map((p) => p.short!)).name("Sheet").onChange(paletteChanged);
  customDropdown(paletteCtrl as unknown as Parameters<typeof customDropdown>[0], sheetThumbs);
  const LINK_TITLE = "View the original sheet in the UW catalogue";
  let sheetLink = inlineLink(paletteCtrl, "↗", LINK_TITLE);
  const syncSheetLink = () => {
    const dp = dpNumber(currentPalette());
    if (dp === null) { sheetLink.removeAttribute("href"); sheetLink.classList.add("disabled"); }
    else { sheetLink.href = sheetUrl(dp); sheetLink.classList.remove("disabled"); }
  };
  // main.ts refreshes every controller's display after a programmatic change: keep the link in step
  const origUpdate = paletteCtrl.updateDisplay.bind(paletteCtrl);
  paletteCtrl.updateDisplay = () => { origUpdate(); syncSheetLink(); return paletteCtrl; };
  syncSheetLink();
  const refreshPalettes = () => {
    const opts = palettesFor(s.pattern).map((p) => p.short!);
    if (!opts.includes(s.palette)) s.palette = opts[0];
    const next = paletteCtrl.options(opts);
    if (next !== paletteCtrl) {
      paletteCtrl = next.name("Sheet").onChange(paletteChanged);
      customDropdown(paletteCtrl as unknown as Parameters<typeof customDropdown>[0], sheetThumbs);
      sheetLink = inlineLink(paletteCtrl, "↗", LINK_TITLE);
    }
    syncSheetLink();
  };
  patternCtrl.onChange(() => { refreshPalettes(); onRebuild(); });
  const seedCtrl = gui.add(s, "seed", 1, 9999, 1).name("Seed").onChange(onChange).listen();
  inlineButton(seedCtrl, "⟳", "Random seed", () => s.randomSeed()).classList.add("big");
  (gui as GUI & { refreshPalettes: () => void }).refreshPalettes = refreshPalettes;
  gui.add(s, "randomAll").name("Randomise everything");

  const bath = gui.addFolder("Bath & size");
  bath.add(s, "viscosity", 0, 1, 0.01).name("Size thinness").onChange(onChange);
  bath.add(s, "gall", 0.6, 1.5, 0.01).name("Ox gall (spread)").onChange(onChange);
  bath.add(s, "density", 0.5, 2, 0.01).name("Drop density").onChange(onChange);
  bath.add(s, "gapFill", 0, 1, 0.01).name("Aim at gaps").onChange(onChange);

  const tools = gui.addFolder("Combs & curls");
  tools.add(s, "combScale", 0.5, 2, 0.01).name("Comb spacing ×").onChange(onChange);
  tools.add(s, "combStrength", 0.1, 2, 0.01).name("Comb pull ×").onChange(onChange);
  tools.add(s, "curlStrength", 0, 2.5, 0.01).name("Curl strength ×").onChange(onChange);
  tools.add(s, "transferAmp", 0, 2, 0.01).name("Transfer effect ×").onChange(onChange);

  const dry = gui.addFolder("Paper & drying");
  dry.add(s, "grain", 0, 2, 0.01).name("Pigment grain").onChange(onChange);
  dry.add(s, "stretchLimit", 5, 200, 1).name("Film stretch limit").onChange(onChange);
  dry.add(s, "paperAge", 0, 1, 0.01).name("Paper age").onChange(onChange);
  dry.add(s, "tooth", 0, 1, 0.01).name("Paper tooth").onChange(onChange);
  dry.add(s, "granulation", 0, 1, 0.01).name("Granulation").onChange(onChange);
  dry.add(s, "wear", 0, 1, 0.01).name("Wear (cover rubbing)").onChange(onChange);
  dry.add(s, "bleed", 0, 0.6, 0.01).name("Edge bleed (mm)").onChange(onChange);
  dry.add(s, "edgeWobble", 0, 1.5, 0.01).name("Edge feathering").onChange(onChange);
  dry.add(s, "edgeDark", 0, 0.4, 0.01).name("Edge darkening").onChange(onChange);

  const anim = gui.addFolder("Animation");
  anim.add(s, "animate").name("Animate").onChange(onChange);
  anim.add(s, "speed", 0, 3, 0.01).name("Speed").onChange(onChange);
  anim.add(s, "drift", 0, 4, 0.01).name("Drift (mm)").onChange(onChange);

  const phys = gui.addFolder("Physical scale");
  phys.add(s, "ppi", 72, 300, 1).name("Screen pixels / inch").onChange(() => { (s as Settings & { ppiTouched?: boolean }).ppiTouched = true; onChange(); });
  phys.add(s, "zoom", 0.25, 4, 0.01).name("Zoom (1 = life size)").onChange(onChange);

  const perf = gui.addFolder("Render");
  perf.add(s, "scale", 0.25, 1, 0.05).name("Resolution × DPR").onChange(onChange);
  customDropdown(perf.add(s, "neighbourhood", { "5×5 (fast)": 2, "7×7 (exact)": 3 }).name("Drop neighbourhood").onChange(onRebuild) as unknown as Parameters<typeof customDropdown>[0]);
  perf.add(s, "antialias").name("Edge anti-aliasing").onChange(onChange);
  customDropdown(perf.add(s, "debug", DEBUG_MODES).name("View").onChange(onChange) as unknown as Parameters<typeof customDropdown>[0]);
  perf.add(s, "savePng").name("Save PNG");
  perf.close();
  if (isPhone()) { gui.close(); [bath, tools, dry, anim, phys].forEach((f) => f.close()); }
  return gui;
}
