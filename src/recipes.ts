import { MAX_OPS, OP, STYLE, type Op } from "./ops";
import type { LayerSpec } from "./layers";

// ---------------------------------------------------------------------------
// Palettes (sampled from 19th-c. trade papers in the UW Decorated Paper
// collection). colours[0] is the GROUND (laid last, most gall); veins are the
// earlier colours in laying order. Index of white/gold given explicitly.
// ---------------------------------------------------------------------------
export interface PigmentDef {
  name: string;
  hex: string;
  opacity?: number; // 1 = opaque earth, <1 = translucent lake
  grain?: number; // 0..1 granularity
  metallic?: number;
  // measured on the source sheet (connected components per colour, equivalent-circle diameter):
  perCm2?: number; // spots per cm² with d > 1 mm
  d50?: number; // median diameter, mm
  sig?: number; // log-normal spread of the diameter
  frac?: number; // measured area fraction on the sheet, % (fit target)
  el?: number; // measured median elongation (major/minor axis) of the spots on the sheet
  wk?: number; // Weibull shape of the spot-diameter distribution above the 1.2 mm floor (fitted on the sheet)
}
export interface Palette {
  key: string;
  name: string;
  source: string; // UW Decorated Paper item the combination is taken from
  /** short dropdown label: the name without the colour list */
  short?: string;
  paper: string;
  pigments: PigmentDef[];
  background: number; // thrown first and generously: becomes the connective network
  spots: number[]; // later colours in laying order (dark → light, as on the 17th/18th-c. sheets)
  white: number;
  gold?: number;
  laid?: boolean; // hand-made laid paper (pre-1800 sheets)
  special?: number; // the dispersant / speckled colour of the sheet (Gloster, Shell, Schrottel)
  paperPct?: number; // measured bare-paper fraction on the sheet, %
  pack?: { jitter?: number; sigma?: number }; // spot packing: tighter jitter / narrower size spread for dense mosaics
  bg?: { fill?: number; r?: number }; // how generously the background was thrown
  /** dominant streak orientation measured on the scan at two scales, [fine deg, fine coherence, coarse deg, coarse
   *  coherence]: degrees (0 = across the sheet, 90 = down it) and coherence 0..1. Fine = tongues and lines, coarse = bands. */
  streak?: [number, number, number, number];
  /** the combing's orientation read off the sheet ("h" across, "v" down), overriding `streak` */
  orient?: "h" | "v";
}

const P = (name: string, hex: string, o = 1, g = 0.5, m = 0): PigmentDef => ({ name, hex, opacity: o, grain: g, metallic: m });
/** pigment with measured spot statistics */
const S = (name: string, hex: string, perCm2: number, d50: number, sig: number, o = 1, g = 0.5): PigmentDef => ({ name, hex, opacity: o, grain: g, metallic: 0, perCm2, d50, sig });
/** pigment with measured statistics and area fraction (%) on the sheet */
const F = (name: string, hex: string, frac: number, perCm2: number, d50: number, sig: number, o = 0.95, g = 0.5): PigmentDef => ({ name, hex, opacity: o, grain: g, metallic: 0, perCm2, d50, sig, frac });
const B = (name: string, hex: string, frac: number, o = 0.96, g = 0.5): PigmentDef => ({ name, hex, opacity: o, grain: g, metallic: 0, frac });
/** attach the measured spot elongation to a pigment */
const E = (pg: PigmentDef, el: number): PigmentDef => ({ ...pg, el });
/** attach the fitted Weibull shape of the spot sizes */
const K = (pg: PigmentDef, wk: number): PigmentDef => ({ ...pg, wk });
const WHITE = P("white", "#EEE7D7", 0.97, 0.3);

// Every palette is one attested sheet. Greens and teals never share a sheet in the collection.
const PALETTES_RAW: Palette[] = [
  { key: "turkish17", name: "17th-c. Turkish: red, dark blue, dark green, blue, light blue, yellow", source: "dp 370", streak: [32.9, 0.017, 60.8, 0.004], paper: "#E2D2B2",
    pigments: [K(E(F("red", "#942E38", 30.8, 0.1, 2.03, 0.6, 0.96, 0.55), 2.79), 0.6), K(E(F("dark blue", "#2C3A55", 16, 0.3, 5, 0.9, 1, 0.4), 2.13), 0.88), K(E(F("dark green", "#2F4838", 16, 0.3, 5, 0.9, 1, 0.4), 2.13), 0.88), K(E(F("blue", "#485F8F", 5.9, 0.19, 2.74, 0.8, 0.92, 0.55), 2.61), 0.82), K(E(F("light blue", "#A6B2A9", 19.0, 0.27, 4.71, 0.9, 0.97, 0.55), 1.34), 1.04), K(E(F("yellow", "#D38E43", 4.5, 0.18, 3.58, 0.65, 1, 0.6), 2.72), 1.22), WHITE],
    background: 0, spots: [1, 2, 3, 5, 4], pack: { jitter: 0.26, sigma: 0.45 }, paperPct: 7.7, white: 6, laid: true }, // catalogue: "red, dark, medium and light blues, dark green and yellow"
  { key: "frenchcurl19", name: "19th-c. French curl on Turkish: maroon, cream, blue, olive", source: "dp 20", streak: [99.6, 0.061, 110.3, 0.034], paper: "#E6D8BC",
    pigments: [K(E(F("maroon", "#983D4A", 32.6, 1.51, 1.99, 0.6, 0.96, 0.55), 2.94), 0.76), K(E(F("indigo", "#39416E", 11.3, 1.54, 2.49, 0.46, 0.9, 0.55), 1.88), 1.01), K(E(F("olive", "#9D9574", 6.3, 0.75, 2.08, 0.5, 0.9, 0.6), 2.2), 0.99), K(E(F("cream", "#EFC9BB", 46.6, 3.76, 2.29, 0.56, 1, 0.4), 2.27), 0.86), WHITE, K(F("bronze", "#C69268", 0.2, 0.03, 1.4, 0.6, 0.9, 0.7), 0.85)],
    background: 0, spots: [1, 2, 3], paperPct: 2.9, white: 4, gold: 5 },
  { key: "spotcombed18", name: "18th-c. Spot combed: red, dark blue, olive, yellow", source: "dp 94", streak: [29.2, 0.333, 31.2, 0.288], paper: "#E4D3B0",
    pigments: [B("red", "#B15146", 18.3, 0.95, 0.5), F("dark blue", "#2A3546", 19.1, 0.8, 2.94, 0.8, 0.95, 0.45), F("olive", "#746647", 42.9, 1.2, 2.26, 0.77, 0.92, 0.6), F("yellow", "#D19D29", 17.4, 0.5, 2.49, 0.8, 1, 0.6), WHITE],
    background: 0, spots: [1, 2, 3], pack: { jitter: 0.26, sigma: 0.45 }, bg: { fill: 0.6, r: 0.6 }, paperPct: 2.3, white: 4, laid: true },
  { key: "placard18", name: "18th-c. Placard: red, dark blue, slate, ochre", source: "dp 97", streak: [70.3, 0.045, 64.6, 0.041], paper: "#E3D3B4",
    pigments: [K(E(F("red", "#C24542", 30.0, 0.2, 2.49, 0.6, 0.95, 0.5), 4.0), 0.63), K(F("dark blue", "#55434A", 2.8, 0.18, 1.73, 0.8, 0.95, 0.5), 0.6), K(E(F("slate", "#6A726D", 34.2, 0.11, 8.29, 1.0, 0.95, 0.55), 3.37), 0.87), F("ochre", "#DAA852", 5.9, 0.4, 2.33, 0.8, 1, 0.6), WHITE],
    background: 0, spots: [1, 2, 3], pack: { jitter: 0.26, sigma: 0.45 }, bg: { fill: 0.81, r: 0.56 }, paperPct: 27.1, white: 4, laid: true },
  { key: "serpentine19", name: "19th-c. Serpentine on Turkish: red, olive, blue, orange, cream", source: "dp 396", streak: [69.6, 0.15, 66.0, 0.128], paper: "#E4D3B0",
    pigments: [B("red", "#C73841", 51.0, 0.95, 0.5), F("indigo", "#684E8B", 9.6, 1.2, 1.76, 0.5, 0.9, 0.55), F("olive", "#997C57", 9.8, 1.7, 1.42, 0.54, 0.92, 0.6), F("orange", "#E87E64", 12.2, 3.1, 0.52, 0.38, 0.95, 0.5), F("cream", "#FDB492", 16.2, 2.0, 1.19, 0.45, 1, 0.4), WHITE],
    background: 0, spots: [1, 2, 3, 4], paperPct: 1.2, white: 5 },
  { key: "spanish19", name: "19th-c. Spanish on Turkish: crimson, yellow, teal, umber", source: "dp 165", streak: [103.8, 0.062, 60.0, 0.035], paper: "#DCCBAA",
    pigments: [K(E(F("crimson", "#B35245", 6.1, 0.2, 0.94, 0.6, 0.95, 0.5), 3.14), 0.79), K(E(F("yellow", "#B68E37", 7.0, 0.24, 2.81, 0.75, 1, 0.6), 3.89), 0.82), K(E(F("dark teal", "#394237", 23.3, 0.24, 4.43, 0.9, 0.96, 0.5), 2.79), 0.75), K(E(F("umber", "#69412E", 29.0, 0.39, 4.31, 1.0, 0.96, 0.6), 2.38), 0.6), WHITE],
    background: 0, spots: [1, 2, 3], bg: { fill: 0.4, r: 0.46 }, paperPct: 34.6, white: 4 },
  { key: "nonpareil19", name: "19th-c. Nonpareil: red, black, blue, ochre, cream", source: "dp 82", streak: [83.7, 0.113, 85.3, 0.438], paper: "#E9DDC2",
    pigments: [B("red", "#841710", 23.3, 0.96, 0.5), F("black", "#4C3932", 28.7, 1.4, 2.6, 0.66, 1, 0.4), F("blue", "#194A7A", 11.1, 0.9, 1.59, 0.58, 0.92, 0.55), F("ochre", "#D48F46", 4.8, 1.2, 0.97, 0.64, 1, 0.6), F("cream", "#D6C187", 16.8, 2.0, 1.24, 0.5, 1, 0.4), WHITE, K(E(F("bronze", "#B07F57", 14.8, 0.46, 3.26, 0.6, 0.9, 0.7), 1.8), 0.88)],
    background: 0, spots: [1, 2, 3, 4], paperPct: 0.5, white: 5, gold: 6 },
  { key: "peacock19", name: "19th-c. Peacock: periwinkle, crimson, gold, green, cream", source: "dp 144", streak: [81.3, 0.201, 78.6, 0.15], paper: "#E3D3B4",
    pigments: [B("maroon", "#945D68", 10.5, 0.96, 0.55), F("grey", "#787BA1", 48.2, 4.1, 3.31, 0.4, 0.95, 0.6), F("green", "#788157", 6.5, 2.1, 1.16, 0.69, 0.92, 0.6), F("crimson", "#901125", 5.7, 0.5, 1.57, 0.61, 0.95, 0.5), F("gold", "#C19133", 8.1, 0.7, 1.7, 0.61, 1, 0.6), F("pink-white", "#ADA08E", 21.0, 2.3, 1.31, 0.59, 1, 0.4), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5], paperPct: 0.0, white: 6 },
  { key: "gloster19", name: "19th-c. Gloster: maroon, black, ochre, blue", source: "dp 65", streak: [86.1, 0.055, 90.3, 0.086], paper: "#E4D6BA",
    pigments: [K(E(F("maroon", "#5C071A", 35.1, 0.93, 36.09, 0.6, 0.96, 0.55), 3.5), 0.69), K(E(F("black", "#432A41", 20.2, 1.86, 2.99, 0.44, 1, 0.4), 4.87), 0.82), K(E(F("ochre", "#C88957", 5.7, 0.6, 1.91, 0.45, 1, 0.6), 4.62), 0.9), K(E(F("blue", "#44518D", 34.9, 1.25, 0.15, 0.6, 0.92, 0.6), 1.79), 0.75), WHITE],
    background: 0, spots: [1, 2, 3], paperPct: 4.0, white: 4 },
  { key: "gloster18", name: "18th-c. Gloster: dark teal, pink-red, tan", source: "dp 330", streak: [100.5, 0.067, 94.2, 0.073], paper: "#DCC9A6",
    pigments: [{ ...P("dark teal", "#22403F", 0.96, 0.5, 1), frac: 60.9 }, K(E(F("pink-red", "#9C513E", 13.6, 0.53, 2.26, 0.8, 0.95, 0.5), 2.46), 0.72), K(E(F("tan", "#A88363", 23.9, 1.38, 2.23, 0.8, 0.97, 0.6), 2.0), 0.8), WHITE],
    background: 0, spots: [1, 2], paperPct: 1.6, white: 3, laid: true },
  { key: "schrottel19", name: "19th-c. Schrottel: black, crimson, yellow, grey", source: "dp 76", streak: [48.2, 0.015, 80.3, 0.011], paper: "#E2D3B6",
    pigments: [{ ...P("black", "#1B1816", 1, 0.45, 1), frac: 19.1 }, K(E(F("crimson", "#6F161A", 10.7, 0.7, 3.47, 0.7, 0.95, 0.5), 2.44), 0.85), K(E(F("yellow", "#B79A2D", 7.6, 0.4, 3.04, 0.7, 1, 0.6), 2.69), 0.87), K(E(F("grey", "#686554", 54.6, 1.68, 6.57, 0.7, 0.95, 0.65), 1.57), 0.75), WHITE],
    background: 0, spots: [1, 2, 3], paperPct: 8.0, white: 4 },
  { key: "antique19", name: "19th-c. Antique straight: red, blue, ochre, black, white", source: "dp 131", streak: [86.9, 0.538, 86.7, 0.436], paper: "#E7DABD",
    pigments: [B("red", "#991D21", 31.4, 0.96, 0.5), F("black", "#32283A", 16.0, 1.4, 2.3, 0.66, 1, 0.4), F("blue", "#112265", 6.5, 0.9, 1.53, 0.58, 0.92, 0.55), F("maroon", "#89413C", 22.3, 0.8, 2.23, 0.6, 0.96, 0.55), F("ochre", "#BF762E", 13.0, 1.2, 1.47, 0.64, 1, 0.6), F("white", "#D9BAA2", 9.5, 2.3, 1.32, 0.44, 0.97, 0.3)],
    background: 0, spots: [1, 2, 3, 4], paperPct: 1.3, white: 5 },
  { key: "shell19", name: "19th-c. Shell: dark teal, crimson, cream, umber", source: "dp 88", streak: [28.9, 0.004, 5.7, 0.023], paper: "#E3D2AF",
    pigments: [K(E(F("dark teal", "#2F2920", 20.8, 1.22, 0.71, 0.6, 0.95, 0.5), 2.21), 0.72), K(E(F("crimson", "#913434", 5.3, 0.61, 3.45, 0.5, 0.95, 0.5), 2.71), 1.05), K(E(F("cream", "#C99B6F", 4.9, 0.5, 2.66, 0.5, 1, 0.4), 2.35), 0.91), K(E(F("umber", "#724323", 68.8, 0.76, 5.2, 0.6, 0.97, 0.6), 1.6), 0.66), WHITE],
    background: 0, spots: [1, 2, 3], paperPct: 0.1, white: 4 },
  { key: "italian19", name: "19th-c. Italian: black and crimson veins", source: "dp 74", streak: [60.8, 0.03, 73.3, 0.079], paper: "#EADFC8",
    pigments: [K(E(F("black", "#342D23", 17.0, 1.09, 2.38, 0.6, 1, 0.4), 2.23), 0.87), K(E(F("crimson", "#BB4D53", 14.6, 0.76, 4.21, 0.64, 0.95, 0.5), 1.94), 0.87), WHITE],
    background: 0, spots: [1], paperPct: 68.4, white: 2 },
  { key: "spanishred19", name: "19th-c. Spanish moiré: red alone", source: "dp 152", streak: [52.2, 0.369, 50.1, 0.568], paper: "#E9D6BE",
    pigments: [{ ...P("red", "#B8282E", 0.95, 0.5, 1), frac: 93.3 }, WHITE],
    background: 0, spots: [], paperPct: 6.7, white: 1 },
  { key: "extra19", name: "19th-c. Extra: dark teal, blue, cream", source: "dp 120", streak: [58.7, 0.298, 54.2, 0.234], paper: "#E6DCC8",
    pigments: [K(E(F("dark teal", "#0A4247", 85.0, 0.13, 4.2, 0.6, 0.96, 0.5), 2.64), 0.6), K(E(F("blue", "#002364", 8.8, 0.42, 2.56, 0.67, 0.9, 0.55), 2.65), 0.87), K(E(F("cream", "#A0BEB0", 6.1, 0.39, 1.89, 0.63, 1, 0.4), 2.61), 0.87), WHITE],
    background: 0, spots: [1, 2], paperPct: 0.1, white: 3 },
  { key: "frenchcurl19b", name: "19th-c. French curl: slate, orange, red, cream", source: "dp 23", streak: [88.4, 0.167, 89.2, 0.555], paper: "#DFD2B4",
    pigments: [{ ...P("slate", "#4C6A6E", 0.95, 0.55, 1), frac: 29.6 }, K(E(F("red", "#8C3826", 4.5, 0.3, 3.01, 0.7, 0.95, 0.5), 2.33), 0.83), K(E(F("orange", "#C28852", 11.7, 0.5, 3.21, 0.8, 0.95, 0.5), 2.35), 0.9), F("cream", "#FFF9FB", 50.4, 1.5, 3.73, 0.7, 1, 0.4), WHITE],
    background: 0, spots: [1, 2, 3], paperPct: 3.8, white: 4 },
  // ---- curated from the extraction contact sheets (roles by eye; hexes, densities, sizes measured)
  { key: "dp172", name: "19th-c. Bouquet (dp 172): maroon, purple, slate, red-brown, pink", source: "dp 172", streak: [97.7, 0.182, 98.6, 0.066], paper: "#E4D4B8",
    pigments: [B("maroon", "#670007", 37.0, 0.96, 0.5), F("purple", "#651F57", 10.2, 0.65, 2.6, 0.58, 0.95, 0.5), F("slate", "#644036", 18.8, 0.63, 2.8, 0.68, 0.95, 0.5), F("red-brown", "#95403A", 18.8, 0.68, 2.17, 0.33, 0.95, 0.5), F("pink", "#C98977", 15.2, 1.58, 1.38, 0.51, 0.95, 0.5), WHITE],
    background: 0, spots: [1, 2, 3, 4], paperPct: 0.0, white: 5 },
  { key: "dp164", name: "19th-c. Serpentine (dp 164): maroon, black, purple, umber, orange, pink", source: "dp 164", streak: [172.0, 0.302, 177.7, 0.253], paper: "#E4D4B8",
    pigments: [B("maroon", "#530002", 59.9, 0.96, 0.5), F("black", "#24060B", 6.5, 0.83, 0.44, 0.48, 0.95, 0.5), F("purple", "#6C3B71", 7.7, 0.89, 1.35, 0.52, 0.95, 0.5), F("umber", "#833137", 12.6, 2.0, 1.13, 0.3, 0.95, 0.5), F("orange", "#B44E13", 3.8, 0.48, 1.28, 0.53, 0.95, 0.5), F("pink", "#D89A97", 9.4, 1.15, 1.16, 0.49, 0.95, 0.5), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5], paperPct: 0.0, white: 6 },
  { key: "dp156", name: "19th-c. French curl on Fountain (dp 156): red, black, teal, maroon, grey-blue, pink, yellow", source: "dp 156", streak: [164.7, 0.166, 167.4, 0.115], paper: "#E4D4B8",
    pigments: [B("red", "#79000E", 25.6, 0.96, 0.5), F("black", "#453D42", 14.4, 0.86, 2.98, 0.62, 0.95, 0.5), F("dark teal", "#244D5F", 15.4, 0.69, 2.4, 0.76, 0.95, 0.5), F("maroon", "#70282F", 13.4, 1.56, 1.39, 0.37, 0.95, 0.5), F("grey-blue", "#677E98", 18.8, 0.62, 2.61, 0.88, 0.95, 0.5), F("pink", "#A7725B", 5.9, 0.35, 1.63, 0.32, 0.95, 0.5), F("yellow", "#B49397", 3.4, 0.47, 1.02, 0.61, 0.95, 0.5), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5, 6], paperPct: 3.1, white: 7 },
  { key: "dp21", name: "19th-c. French curl on Nonpareil (dp 21): faded tan, maroon, grey, violet, yellow, cream", source: "dp 21", streak: [109.4, 0.051, 92.4, 0.32], paper: "#E8DDD0",
    pigments: [B("tan", "#C79E9E", 15.2, 0.96, 0.5), F("maroon", "#A33C46", 9.3, 1.64, 1.25, 0.28, 0.95, 0.5), F("grey", "#81717C", 8.7, 0.88, 1.66, 0.36, 0.95, 0.5), F("violet", "#8A81C9", 11.2, 1.64, 1.27, 0.38, 0.95, 0.5), F("yellow", "#BF9465", 7.7, 1.42, 1.03, 0.36, 0.95, 0.5), F("cream", "#DCC5C0", 16.9, 0.61, 1.82, 0.22, 0.95, 0.5), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5], bg: { fill: 0.4, r: 0.53 }, paperPct: 31.0, white: 6 },
  { key: "dp125", name: "19th-c. Antique straight (dp 125): red, indigo, maroon, grey, tan, yellow, white", source: "dp 125", streak: [174.8, 0.597, 172.0, 0.572], paper: "#E5D3B8",
    pigments: [B("red", "#A1151E", 31.3, 0.96, 0.5), F("indigo", "#1E3462", 20.7, 1.75, 2.1, 0.62, 0.95, 0.5), F("maroon", "#7C2F3B", 18.5, 1.0, 1.75, 0.43, 0.95, 0.5), F("dark grey", "#574C61", 9.4, 1.18, 1.35, 0.36, 0.95, 0.5), F("tan", "#B97358", 8.0, 0.17, 2.16, 0.39, 0.95, 0.5), F("yellow", "#D5A343", 6.6, 0.43, 1.59, 0.68, 0.95, 0.5), F("white", "#F0CDB9", 5.1, 1.32, 1.45, 0.43, 0.97, 0.3)],
    background: 0, spots: [1, 2, 3, 4, 5], paperPct: 0.4, white: 6 },
  { key: "dp61", name: "19th-c. Shell on Zebra (dp 61): umber, dark olive, coral, tan", source: "dp 61", streak: [86.1, 0.364, 86.6, 0.292], paper: "#E6D8C0",
    pigments: [B("umber", "#AA6B57", 62.6, 0.96, 0.5), F("dark olive", "#66452F", 9.8, 1.2, 1.63, 0.44, 0.95, 0.5), F("coral", "#CE6F5F", 16.4, 1.98, 1.29, 0.56, 0.95, 0.5), F("tan", "#DA8F68", 8.8, 2.51, 0.87, 0.47, 0.95, 0.5), F("white", "#EEE7D7", 3, 0.5, 1.45, 0.6, 0.97, 0.3)],
    background: 0, spots: [1, 2, 3], paperPct: 0.0, white: 4, special: 3 },
  { key: "dp330", name: "18th-c. Gloster (dp 330): dark olive, pink-red, speckled tan, peach", source: "dp 330", streak: [100.5, 0.067, 94.2, 0.073], paper: "#DCC9A6",
    pigments: [K(E(F("dark olive", "#4A3F2E", 49.4, 0.71, 2.14, 0.6, 0.96, 0.5), 2.11), 0.65), K(E(F("pink-red", "#904E3B", 11.9, 0.61, 2.17, 0.64, 0.95, 0.5), 2.61), 0.74), K(E(F("tan", "#8F785C", 28.6, 1.29, 2.11, 0.61, 0.95, 0.5), 2.06), 0.74), K(E(F("peach", "#D5916C", 9.5, 0.41, 2.04, 0.62, 0.95, 0.5), 2.72), 0.67), WHITE],
    background: 0, spots: [1, 2, 3], paperPct: 0.6, white: 4, special: 2, laid: true },
  { key: "dp71", name: "19th-c. Gloster (dp 71): slate, black, umber, red, yellow, speckled grey", source: "dp 71", streak: [1.9, 0.12, 3.9, 0.174], paper: "#D6D4C8",
    pigments: [K(E(F("slate", "#44585F", 20.2, 1.24, 1.73, 0.6, 0.96, 0.5), 3.25), 0.7), K(E(F("black", "#232528", 14.0, 0.54, 4.92, 0.62, 0.95, 0.5), 4.4), 0.69), K(E(F("umber", "#845946", 16.5, 1.42, 3.83, 0.41, 0.95, 0.5), 5.23), 0.76), K(E(F("red", "#AD3437", 14.4, 0.37, 2.61, 0.82, 0.95, 0.5), 3.22), 0.7), K(E(F("yellow", "#C5A244", 11.8, 0.23, 5.3, 0.94, 0.95, 0.5), 3.73), 0.86), K(E(F("grey", "#A5ADAA", 19.8, 1.52, 0.42, 0.5, 0.95, 0.5), 1.86), 0.77), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5], bg: { fill: 1, r: 1 }, paperPct: 3.2, white: 6, special: 5 },
  { key: "dp91", name: "19th-c. Gloster (dp 91): dark grey, black, red-brown, ochre, speckled grey, yellow", source: "dp 91", streak: [71.7, 0.107, 59.0, 0.155], paper: "#C9C4A2",
    pigments: [K(E(F("dark grey", "#585F50", 26.9, 0.51, 1.98, 0.6, 0.96, 0.5), 4.83), 0.66), K(E(F("black", "#3A3B38", 23.1, 2.6, 1.74, 0.45, 0.95, 0.5), 1.87), 0.81), K(E(F("red-brown", "#A64E36", 4.2, 0.21, 3.14, 0.71, 0.95, 0.5), 5.28), 1.03), K(E(F("ochre", "#8E6D4A", 5.5, 0.56, 1.69, 0.41, 0.95, 0.5), 6.39), 0.83), K(E(F("grey", "#9B997B", 33.2, 5.41, 1.7, 0.5, 0.95, 0.5), 2.05), 0.85), K(E(F("yellow", "#C7B965", 6.3, 0.31, 1.83, 0.7, 0.95, 0.5), 5.52), 0.66), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5], bg: { fill: 0.79, r: 0.69 }, paperPct: 0.8, white: 6, special: 4 },
  { key: "dp105", name: "19th-c. Schrottel (dp 105): yellow-tan, black, dark brown, olive, ochre", source: "dp 105", streak: [176.6, 0.045, 164.2, 0.028], paper: "#E8DCC2",
    pigments: [K(E(F("yellow-tan", "#D8B870", 65.6, 2.07, 2.47, 0.6, 0.96, 0.5), 1.52), 0.77), K(E(F("black", "#252C3B", 3.5, 0.78, 1.68, 0.26, 0.95, 0.5), 1.98), 1.08), K(F("dark brown", "#3C2602", 8.6, 1.02, 1.52, 0.24, 0.95, 0.5), 1.0), F("olive", "#7D6A3A", 6.9, 0.5, 2.78, 0.4, 0.95, 0.5), K(E(F("ochre", "#AF9251", 15.2, 0.92, 12.02, 0.5, 0.95, 0.5), 1.47), 0.81), WHITE],
    background: 0, spots: [1, 2, 3, 4], paperPct: 0.2, white: 5, special: 4 },
  { key: "dp111", name: "19th-c. Shell (dp 111): blue, grey-blue cells, pink", source: "dp 111", streak: [1.7, 0.01, 79.5, 0.015], paper: "#C9E0DC",
    pigments: [K(E(F("blue", "#16639A", 68.5, 2.1, 2.46, 0.6, 0.96, 0.5), 1.71), 0.72), K(E(F("grey-blue", "#62A1BE", 20.9, 2.67, 1.62, 0.4, 0.95, 0.5), 2.07), 0.86), K(E(F("pink", "#95929F", 6.8, 0.77, 2.04, 0.43, 0.95, 0.5), 2.36), 0.78), WHITE],
    background: 0, spots: [1, 2], paperPct: 3.8, white: 3, special: 1 },
  { key: "dp118", name: "19th-c. Shell (dp 118): grey-green, dark grey, blue, cream cells", source: "dp 118", streak: [175.9, 0.094, 161.9, 0.087], paper: "#E4E4CC",
    pigments: [K(E(F("grey-green", "#6A7A6C", 44.8, 2.05, 2.3, 0.6, 0.96, 0.5), 1.89), 0.76), K(E(F("dark grey", "#404F4B", 30.4, 2.06, 2.26, 0.6, 0.95, 0.5), 1.97), 0.86), K(E(F("blue", "#3E6C92", 2.6, 0.19, 2.66, 0.61, 0.95, 0.5), 4.67), 0.86), K(E(F("cream", "#AFBAA4", 17.3, 1.91, 1.78, 0.41, 0.95, 0.5), 2.68), 0.87), WHITE],
    background: 0, spots: [1, 2, 3], paperPct: 4.9, white: 4, special: 3 },
  { key: "dp13", name: "19th-c. Shell on Stormont (dp 13): lacy orange, black, grey, brown, tan", source: "dp 13", streak: [162.1, 0.076, 169.4, 0.05], paper: "#E8CDB0",
    pigments: [K(E(F("orange", "#C66244", 65.5, 0.49, 6.8, 0.6, 0.96, 0.5), 1.91), 0.74), K(E(F("black", "#1D1C27", 9.7, 0.52, 4.92, 0.71, 0.95, 0.5), 2.14), 0.71), K(F("grey", "#6B5B56", 5.8, 0.29, 4.49, 0.3, 0.95, 0.5), 0.99), K(F("brown", "#B48065", 3.3, 0.09, 4.69, 0.31, 0.95, 0.5), 0.94), K(E(F("tan", "#E69570", 11.4, 1.15, 3.05, 0.33, 0.95, 0.5), 2.59), 0.87), WHITE],
    background: 0, spots: [1, 2, 3, 4], paperPct: 4.3, white: 5 },
  { key: "dp62", name: "19th-c. Shell on Stormont (dp 62): lacy dark grey, black, ochre, grey, yellow", source: "dp 62", streak: [80.9, 0.015, 67.9, 0.041], paper: "#DCD3B6",
    pigments: [K(E(F("dark grey", "#695956", 37.9, 3.53, 1.8, 0.6, 0.96, 0.5), 2.01), 0.81), K(E(F("black", "#382B2C", 19.9, 2.51, 1.99, 0.47, 0.95, 0.5), 1.55), 1.01), K(F("ochre", "#AC985F", 8.4, 1.05, 1.54, 0.21, 0.95, 0.5), 1.05), K(E(F("grey", "#988A80", 21.6, 2.43, 1.65, 0.29, 0.95, 0.5), 2.63), 0.95), K(E(F("yellow", "#CCA51A", 8.6, 0.56, 2.34, 0.6, 0.95, 0.5), 2.55), 0.81), WHITE],
    background: 0, spots: [1, 2, 3, 4], paperPct: 3.7, white: 5 },
  { key: "dp352", name: "19th-c. Dahlia (dp 352): black, red, yellow, cream streaks; teal gall drops", source: "dp 352", streak: [17.1, 0.225, 24.4, 0.162], paper: "#E4D4B8",
    pigments: [B("black", "#3B3429", 32.9, 0.96, 0.5), F("red", "#7B3622", 21.9, 1.2, 3.1, 0.7, 0.95, 0.5), F("yellow", "#A06E33", 6.1, 1.0, 1.46, 0.7, 1, 0.6), F("cream", "#A99368", 2.4, 1.4, 0.81, 0.6, 1, 0.4), F("teal", "#31565A", 25.2, 0.12, 9.29, 0.45, 0.95, 0.5), F("grey-blue", "#7B866F", 11.6, 0.8, 2.24, 0.6, 0.97, 0.5), WHITE],
    background: 0, spots: [1, 2, 3], paperPct: 0.0, white: 6, special: 4 },
  { key: "dp322", name: "19th-c. Spanish on Turkish with shell veins (dp 322): umber, black-teal, dark teal, tan cells, olive-grey", source: "dp 322", streak: [131.9, 0.24, 129.8, 0.691], paper: "#E0CDAE",
    pigments: [K(E(F("umber", "#79351F", 45.0, 1.26, 7.43, 0.6, 0.96, 0.5), 2.51), 1.02), K(E(F("black-teal", "#0E3435", 15.5, 0.88, 2.56, 0.44, 0.95, 0.5), 2.44), 0.9), K(E(F("dark teal", "#525547", 9.3, 0.88, 1.39, 0.41, 0.95, 0.5), 2.23), 0.92), K(E(F("tan", "#9F5E3E", 25.3, 0.89, 4.73, 0.65, 0.95, 0.5), 3.68), 1.29), K(F("olive-grey", "#8E856D", 4.2, 0.23, 1.41, 0.29, 0.95, 0.5), 1.25), WHITE],
    background: 0, spots: [1, 2, 3, 4], paperPct: 0.7, white: 5, special: 3 },
  { key: "dp246", name: "19th-c. Spanish on Italian (dp 246): peach ground, black, olive, red, yellow veins", source: "dp 246", streak: [152.3, 0.071, 15.7, 0.1], paper: "#E8D6BC",
    pigments: [K(E(F("peach", "#E0965B", 76.0, 0.37, 6.59, 0.6, 0.96, 0.5), 1.9), 0.8), K(E(F("black", "#0B0903", 6.1, 0.66, 2.21, 0.55, 0.95, 0.5), 2.83), 0.89), K(F("olive", "#956840", 7.6, 0.67, 5.16, 0.24, 0.95, 0.5), 0.94), K(E(F("red", "#A92A2D", 4.8, 0.53, 4.38, 0.54, 0.95, 0.5), 2.98), 0.94), K(E(F("yellow", "#EDB22C", 3.3, 0.45, 5.72, 0.46, 0.95, 0.5), 3.54), 0.98), WHITE],
    background: 0, spots: [1, 2, 3, 4], paperPct: 2.1, white: 5 },
  { key: "dp143", name: "19th-c. Spanish on Italian (dp 143): ochre, black, umber, olive, yellow", source: "dp 143", streak: [59.4, 0.084, 47.2, 0.326], paper: "#E8DABD",
    pigments: [K(E(F("ochre", "#BD9843", 31.7, 0.61, 3.53, 0.6, 0.96, 0.5), 2.96), 0.6), K(E(F("black", "#250F00", 1.9, 0.26, 2.42, 0.41, 0.95, 0.5), 5.02), 1.03), K(E(F("umber", "#801D07", 2.9, 0.47, 1.85, 0.4, 0.95, 0.5), 3.02), 1.0), K(E(F("olive", "#A97827", 9.8, 0.84, 1.85, 0.42, 0.95, 0.5), 2.68), 0.76), K(E(F("yellow", "#D4AD55", 53.7, 0.65, 1.77, 0.6, 0.95, 0.5), 1.92), 0.6), WHITE],
    background: 0, spots: [1, 2, 3, 4], paperPct: 0.0, white: 5, special: 4 },
  { key: "dp295", name: "19th-c. Italian with Spanish (dp 295): orange, black, umber, red, yellow, pale orange", source: "dp 295", streak: [176.2, 0.212, 151.2, 0.383], paper: "#E8D6BC",
    pigments: [K(F("orange", "#DB8156", 6.1, 0.07, 1.62, 0.6, 0.96, 0.5), 0.93), K(E(F("black", "#372418", 2.7, 0.25, 1.74, 0.56, 0.95, 0.5), 5.01), 0.9), K(F("umber", "#A55E3B", 3.4, 0.2, 1.53, 0.2, 0.95, 0.5), 1.08), K(E(F("red", "#B73835", 2.6, 0.4, 1.95, 0.41, 0.95, 0.5), 4.4), 1.0), K(E(F("yellow", "#F19128", 4.0, 0.55, 1.6, 0.49, 0.95, 0.5), 2.77), 0.87), K(E(F("pale orange", "#E2895D", 81.2, 0.16, 3.47, 0.6, 0.95, 0.5), 1.86), 0.6), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5], paperPct: 0.1, white: 6, special: 5 },
  { key: "dp137", name: "19th-c. Shell on Turkish (dp 137): crimson alone with pink cells", source: "dp 137", streak: [179.4, 0.191, 172.9, 0.224], paper: "#E8D6C0",
    pigments: [K(E(F("crimson", "#740013", 90.2, 0.22, 4.09, 0.6, 0.96, 0.5), 1.97), 0.6), K(E(F("red", "#A02F42", 4.3, 0.16, 1.69, 0.36, 0.95, 0.5), 2.47), 0.81), K(E(F("pink", "#E19289", 5.5, 0.25, 2.79, 0.67, 0.95, 0.5), 3.43), 0.77), WHITE],
    background: 0, spots: [1, 2], paperPct: 0.0, white: 3, special: 2 },
  { key: "dp384", name: "19th-c. Spanish moiré (dp 384): green, dark green, umber, olive-brown, olive, yellow", source: "dp 384", streak: [93.3, 0.106, 120.5, 0.212], paper: "#E4D4B8",
    pigments: [B("green", "#5A682D", 63.7, 0.96, 0.5), E(F("dark green", "#364A2B", 4.1, 0.87, 2.01, 0.69, 0.95, 0.5), 2.54), E(F("umber", "#722B19", 5.3, 0.41, 2.61, 0.65, 0.95, 0.5), 3.25), E(F("olive-brown", "#725726", 10.6, 1.34, 1.98, 0.49, 0.95, 0.5), 2.97), E(F("olive", "#807025", 14.1, 0.93, 6.04, 0.66, 0.95, 0.5), 2.64), E(F("yellow", "#C59A5D", 2.2, 0.32, 1.58, 0.47, 0.95, 0.5), 2.69), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5], paperPct: 0.0, white: 6 },
  { key: "dp150", name: "19th-c. Spanish moiré (dp 150): maroon, dark crimson, red, pink", source: "dp 150", streak: [46.6, 0.316, 48.9, 0.433], paper: "#E9D6BE",
    pigments: [B("maroon", "#A71E38", 40.1, 0.96, 0.5), E(F("dark crimson", "#8F001F", 53.4, 1.48, 3.48, 0.67, 0.95, 0.5), 6.64), F("red", "#B74C5A", 2.5, 0.16, 1.94, 0.33, 0.95, 0.5), E(F("pink", "#D48D91", 4.0, 0.41, 2.71, 0.54, 0.95, 0.5), 3.51), WHITE],
    background: 0, spots: [1, 2, 3], paperPct: 0.0, white: 4 },
  { key: "dp353", name: "19th-c. Polnisch (dp 353): yellow-tan, black, olive, red, brown, grey, yellow", source: "dp 353", streak: [161.1, 0.05, 158.3, 0.106], paper: "#E4D4B8",
    pigments: [B("yellow-tan", "#BEAF75", 21.4, 0.96, 0.5), F("black", "#292C21", 11.9, 0.52, 3.46, 0.74, 0.95, 0.5), F("olive", "#745D38", 17.2, 1.27, 2.12, 0.46, 0.95, 0.5), F("red", "#B9372F", 7.8, 0.39, 2.24, 0.7, 0.95, 0.5), F("brown", "#97583C", 18.6, 1.33, 1.98, 0.48, 0.95, 0.5), F("grey", "#787D6C", 14.4, 0.48, 2.02, 0.72, 0.95, 0.5), F("yellow", "#C6A82C", 8.6, 0.29, 2.1, 0.75, 0.95, 0.5), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5, 6], paperPct: 0.0, white: 7 },
  { key: "dp60", name: "19th-c. Fantasy (dp 60): dark green, olive-green, pale olive", source: "dp 60", streak: [76.8, 0.068, 78.4, 0.093], paper: "#E6DCC8",
    pigments: [K(E(F("dark green", "#2B5F32", 57.3, 1.02, 1.89, 0.6, 0.96, 0.5), 3.07), 0.62), K(E(F("olive-green", "#6D8B5A", 19.9, 1.26, 2.6, 0.33, 0.95, 0.5), 2.13), 0.88), K(E(F("pale olive", "#9CA876", 22.8, 2.25, 1.62, 0.48, 0.95, 0.5), 3.22), 0.76), WHITE],
    background: 0, spots: [1, 2], paperPct: 0.0, white: 3 },
  { key: "dp203", name: "19th-c. Romantic (dp 203): coral, dark brown, umber, brown, tan, peach", source: "dp 203", streak: [19.2, 0.03, 176.1, 0.012], paper: "#E4D4B8",
    pigments: [K(E(F("coral", "#FA8873", 42.3, 0.73, 1.97, 0.6, 0.96, 0.5), 2.35), 0.6), K(E(F("dark brown", "#4E2D25", 8.0, 0.94, 2.39, 0.53, 0.95, 0.5), 2.95), 0.92), K(E(F("umber", "#78281E", 9.9, 0.84, 2.26, 0.48, 0.95, 0.5), 2.28), 0.91), K(E(F("brown", "#B9523D", 28.5, 5.59, 1.62, 0.33, 0.95, 0.5), 2.15), 0.97), K(F("tan", "#BC6B58", 3.1, 0.05, 4.22, 0.2, 0.95, 0.5), 0.82), K(E(F("peach", "#F7BD81", 8.1, 0.21, 1.55, 0.58, 0.95, 0.5), 1.78), 0.6), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5], paperPct: 0.1, white: 6 },
  { key: "dp16", name: "19th-c. French curl on Romantic (dp 16): grey, black, slate, red, ochre-grey", source: "dp 16", streak: [79.9, 0.043, 88.4, 0.069], paper: "#D8CFB2",
    pigments: [B("grey", "#595C51", 22.6, 0.96, 0.5), F("black", "#2E2D22", 13.8, 1.0, 5.81, 0.4, 0.95, 0.5), F("slate", "#3D3E3C", 8.5, 0.98, 2.8, 0.36, 0.95, 0.5), F("red", "#AF6668", 17.5, 1.98, 2.01, 0.51, 0.95, 0.5), F("ochre-grey", "#979178", 26.2, 0.5, 3.77, 0.5, 0.95, 0.5), WHITE],
    background: 0, spots: [1, 2, 3, 4], bg: { fill: 0.78, r: 0.73 }, paperPct: 11.3, white: 5 },
  { key: "dp280", name: "19th-c. Morris (dp 280): grey-blue and violet on white", source: "dp 280", streak: [152.6, 0.045, 108.5, 0.069], paper: "#EDEADF",
    pigments: [F("grey-blue", "#BCC2BC", 72.7, 0.25, 10.93, 0.6, 0.96, 0.5), K(E(F("violet", "#929AB1", 6.4, 0.13, 3.04, 0.8, 0.95, 0.5), 2.19), 0.78), WHITE],
    background: 0, spots: [1], bg: { fill: 0.56, r: 0.62 }, paperPct: 20.9, white: 2 },
  { key: "dp63", name: "19th-c. Italian on Turkish, double marble (dp 63): yellow-tan, olive veins", source: "dp 63", streak: [17.3, 0.088, 6.1, 0.09], paper: "#E8DCC2",
    pigments: [K(E(F("yellow-tan", "#CFAD6C", 80.5, 4.59, 2.9, 0.6, 0.96, 0.5), 1.62), 0.77), K(E(F("olive", "#8F7C40", 19.5, 1.88, 1.25, 0.46, 0.95, 0.5), 1.8), 0.83), WHITE],
    background: 0, spots: [1], paperPct: 0.0, white: 2 },
  { key: "dp138", name: "19th-c. Gold vein on Spanish moiré (dp 138): crimson, red, pink, gold", source: "dp 138", streak: [130.4, 0.033, 89.7, 0.05], paper: "#E4D4B8",
    pigments: [B("crimson", "#790010", 42.9, 0.96, 0.5), F("red", "#A32937", 30.6, 2.57, 2.36, 0.59, 0.95, 0.5), F("pink", "#BF7F64", 10.5, 0.54, 2.64, 0.63, 0.95, 0.5), { ...F("gold", "#BCA04E", 12.4, 0.6, 3.29, 0.6, 0.9, 0.7), metallic: 1 }, WHITE],
    background: 0, spots: [1, 2], paperPct: 3.6, white: 4, gold: 3 },
  { key: "dp198", name: "19th-c. Papier croisé (dp 198): black, dark red-brown, red-brown, brown-orange", source: "dp 198", streak: [4.8, 0.069, 7.3, 0.075], paper: "#E4D4B8",
    pigments: [K(E(F("black", "#251B15", 37.9, 2.55, 1.61, 0.6, 0.96, 0.5), 1.93), 0.75), K(E(F("dark red-brown", "#5A2C23", 30.5, 3.48, 2.31, 0.22, 0.95, 0.5), 2.02), 0.9), K(E(F("red-brown", "#8B3A2F", 26.2, 3.0, 1.65, 0.35, 0.95, 0.5), 2.03), 0.78), K(E(F("brown-orange", "#A33F33", 5.2, 0.73, 1.54, 0.42, 0.95, 0.5), 1.87), 0.89), WHITE],
    background: 0, spots: [1, 2, 3], paperPct: 0.1, white: 4 },
  { key: "dp375", name: "19th-c. Papier tourniquet (dp 375): black-brown, dark brown, dark green, olive-green", source: "dp 375", streak: [54.0, 0.041, 56.2, 0.053], paper: "#E4D4B8",
    pigments: [K(F("black-brown", "#282017", 67.6, 0.04, 1.95, 0.6, 0.96, 0.5), 0.6), K(E(F("dark brown", "#493423", 18.6, 1.31, 2.5, 0.67, 0.95, 0.5), 1.56), 0.98), K(E(F("dark green", "#393B1C", 8.9, 1.4, 1.5, 0.26, 0.95, 0.5), 2.26), 0.9), K(E(F("olive-green", "#5A6633", 4.9, 0.87, 1.49, 0.4, 0.95, 0.5), 1.93), 0.95), WHITE],
    background: 0, spots: [1, 2, 3], paperPct: 0.0, white: 4 },
  { key: "dp326", name: "18th-c. Papier coulé (dp 326): dark brown, umber-red, brown", source: "dp 326", streak: [87.0, 0.076, 96.9, 0.094], paper: "#E2D2B2",
    pigments: [K(F("dark brown", "#4B2422", 90.0, 0.08, 1.46, 0.6, 0.96, 0.5), 0.6), K(E(F("umber-red", "#6C2C29", 5.4, 0.83, 1.61, 0.48, 0.95, 0.5), 2.12), 0.87), K(E(F("brown", "#87574A", 4.4, 0.64, 1.32, 0.31, 0.95, 0.5), 1.53), 0.78), WHITE],
    background: 0, spots: [1, 2], paperPct: 0.2, white: 3, laid: true },
  { key: "dp274", name: "19th-c. French curl on Wide comb (dp 274): red, indigo, maroon, orange-brown, cream", source: "dp 274", streak: [95.2, 0.085, 83.3, 0.27], paper: "#E4D4B8",
    pigments: [B("red", "#8A0217", 49.3, 0.96, 0.5), F("indigo", "#291F5A", 8.8, 0.59, 2.27, 0.54, 0.95, 0.5), F("maroon", "#7E3238", 26.8, 2.13, 2.31, 0.45, 0.95, 0.5), F("orange-brown", "#A85725", 4.8, 0.77, 1.12, 0.49, 0.95, 0.5), F("cream", "#CA9C8B", 10.3, 1.09, 1.27, 0.52, 0.95, 0.5), WHITE],
    background: 0, spots: [1, 2, 3, 4], paperPct: 0.0, white: 5 },
  { key: "dp393", name: "19th-c. Double comb (dp 393): red, indigo, dark teal, maroon, orange, cream", source: "dp 393", streak: [177.0, 0.296, 67.5, 0.025], paper: "#E4D4B8",
    pigments: [B("red", "#AD3149", 21.7, 0.96, 0.5), F("indigo", "#3E3C70", 8.1, 0.98, 2.48, 0.53, 0.95, 0.5), F("dark teal", "#374144", 5.9, 0.91, 1.65, 0.49, 0.95, 0.5), F("maroon", "#7E4F5A", 35.9, 2.57, 2.91, 0.43, 0.95, 0.5), F("orange", "#BA6154", 11.8, 0.98, 1.6, 0.54, 0.95, 0.5), F("cream", "#DAA995", 16.6, 1.66, 1.32, 0.46, 0.95, 0.5), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5], paperPct: 0.0, white: 6 },
  { key: "dp75", name: "19th-c. Double comb waved (dp 75): crimson, red, grey-blue, tan, orange, pale pink", source: "dp 75", streak: [73.2, 0.214, 59.4, 0.074], paper: "#E4D4B8",
    pigments: [B("crimson", "#7E000A", 61.4, 0.96, 0.5), F("red", "#922C2D", 11.8, 0.35, 0.68, 0.17, 0.95, 0.5), F("grey-blue", "#806773", 7.3, 0.45, 1.51, 0.59, 0.95, 0.5), F("tan", "#CD6A5D", 7.0, 0.5, 0.86, 0.21, 0.95, 0.5), F("orange", "#EF9755", 5.7, 0.63, 1.41, 0.5, 0.95, 0.5), F("pale pink", "#FFC6B2", 6.8, 1.12, 1.1, 0.44, 0.95, 0.5), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5], paperPct: 0.0, white: 6 },
  { key: "dp87", name: "19th-c. Gloster on Serpentine (dp 87): red, indigo, dark grey, maroon, speckled grey, ochre", source: "dp 87", streak: [104.6, 0.121, 95.5, 0.126], paper: "#D9CBC6",
    pigments: [B("red", "#801323", 35.6, 0.96, 0.5), F("indigo", "#37405B", 16.3, 0.7, 2.87, 0.72, 0.95, 0.5), F("dark grey", "#3E3D3A", 8.5, 0.62, 2.16, 0.69, 0.95, 0.5), F("maroon", "#6D2F33", 14.2, 1.65, 0.43, 0.4, 0.95, 0.5), F("grey", "#948D90", 15.7, 0.83, 2.4, 0.5, 0.95, 0.5), F("ochre", "#AC714A", 8.6, 0.41, 0.69, 0.68, 0.95, 0.5), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5], paperPct: 1.1, white: 6, special: 4 },
  { key: "guyot20", name: "20th-c. Guyot Shell: orange, green, cream", source: "dp 524", streak: [83.4, 0.038, 63.8, 0.093], paper: "#EEE7D8",
    pigments: [P("orange", "#E0602A", 0.96, 0.5), S("green", "#3F8E62", 0.6, 4.0, 0.8, 0.95, 0.55), S("cream", "#EAD9B8", 0.5, 6.0, 0.8, 1, 0.4), WHITE],
    background: 0, spots: [1, 2], white: 3 },
];

import { GENERATED } from "./palettes.generated";
// A generated (re-measured) palette with the same key replaces the hand-written one.
export const PALETTES: Palette[] = [...PALETTES_RAW.filter((p) => !GENERATED.some((g) => g.key === p.key)), ...GENERATED].map((p) => ({ ...p, short: p.name.replace(/:.*$/, "").replace(/\s*\(dp \d+(?: \(\+\d+\))?\)$/, "") + " · " + p.source }));

// ---------------------------------------------------------------------------
// Parameters coming from the GUI
// ---------------------------------------------------------------------------
export interface Params {
  seed: number;
  viscosity: number; // 0 thick starch/carrageenan .. 1 thin, watery
  gall: number; // 0.6 .. 1.5, spread factor of drops
  density: number; // 0.5 .. 2, more = smaller cells
  combScale: number; // multiplies comb spacings
  combStrength: number; // multiplies comb displacement
  curlStrength: number;
  sheetW: number; // mm
  sheetH: number; // mm
  time: number; // animation seconds
  animate: boolean;
  drift: number; // mm
  breath: number; // peak-to-trough radius change of a breathing drop, fraction of its radius
  gapFill: number;
  streaks?: "h" | "v"; // orientation of the recipe's own streaks as authored (set from Recipe.streaks by the harness)
  streakScale?: "fine" | "coarse"; // which scale of the sheet's measurement that refers to (Recipe.streakScale) // 0..1 the marbler aims later colours at gaps
}

export interface Transfer {
  mode: number; // 0 none, 1 spanish, 2 moiré, 3 drag, 4 wiggle, 5 twill, 6 trickle
  amp: number;
  wavelength: number;
  angle: number; // degrees
  phase: number;
  wobble: number;
}

export interface Scene {
  ops: Op[];
  layers: LayerSpec[];
  transfer: Transfer;
  groundFill: number; // palette index painted where nothing hit (paste papers), -1 = paper
  under?: { ops: Op[]; layers: LayerSpec[]; mode: number; groundFill: number }; // 1 double marble, 2 overprint
  goldNet: number; // 0 none, else amplitude of lithographed gold vein network
  softPaper: number; // 1 = wet-paper (Morris) look
}

// ---------------------------------------------------------------------------
// Op builders. Coordinates: bath millimetres, origin at sheet centre, y up.
// Angles: direction of tine MOTION in degrees (0 = +x, 90 = +y).
// ---------------------------------------------------------------------------
const rad = (d: number) => (d * Math.PI) / 180;

function hash01(seed: number, i: number) {
  let x = (seed * 374761393 + i * 668265263) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Comb options: `ripple` is the tine-to-mid-gap differential in spacings, `L` the tine's wake width (mm, wake kernel),
 *  `kernel` "arc" (a chain of fronts between the tines: tongues and arches) or "wake" (widely set teeth pulled hard: asymptotic barbs). */
export interface CombOpts { offset?: number; ripple?: number; L?: number; strength?: number; kernel?: "arc" | "wake";
  /** the comb drawn along a sinusoid across the stroke: amplitude and wavelength in mm, phase in radians */
  wave?: { amp: number; wavelength: number; phase?: number; shape?: "sine" | "triangle" };
  /** hard-pull profile |cos πf|^0.3 · (1 - |2f|^p) instead of |cos|^0.6: rounded head, near-parallel flanks (the tongue interior
   *  rides rigidly), a cusp zone of a tenth of the pitch (p ≈ 12) where all the stretch sits; p ≈ 6 for a softer cusp */
  plateau?: number }

export class Builder {
  ops: Op[] = [];
  layers: LayerSpec[] = [];
  n = 0;
  groundFill = -1; // palette index of a ground film covering the whole bath (first colour thrown generously)
  /** while set, the combs are laid still: no tine drift or wavy-path phase, so a drawn sheet's quills and bands
   *  never move. The colours under them still slide, wobble and breathe (they flow along the fixed comb paths),
   *  and so does whatever is thrown afterwards (Feather, Antique straight, Zebra). */
  still = false;
  /** comb axis for this sheet: 90 when the scan's streaks run the other way from the recipe as authored.
   *  The same pattern was combed across some sheets and down others (Double comb: dp 75 down, dp 393 across). */
  axis = 0;
  constructor(public p: Params, public pal: Palette) {
    // a sheet may carry an explicit orientation of its combing (`orient`), read off the sheet, which overrides the
    // structure-tensor measurement (dp 174: a horizontal Bouquet whose tensor is ambiguous at both scales)
    const st = pal.orient ? [pal.orient === "h" ? 0 : 90, 1, pal.orient === "h" ? 0 : 90, 1] : pal.streak;
    const deg = st ? (p.streakScale === "coarse" ? st[2] : st[0]) : 0, coh = st ? (p.streakScale === "coarse" ? st[3] : st[1]) : 0;
    if (p.streaks && st && coh >= 0.08) {
      const want = p.streaks === "h" ? 0 : 90;
      let d = Math.abs(deg - want) % 180;
      if (d > 90) d = 180 - d;
      if (d > 45) this.axis = 90;
    }
  }

  private rnd(i: number) { return hash01(this.p.seed + 1, this.n * 131 + i + 17); }

  /** Sprinkle a layer. cellMm and radius (cells) are nominal; density/gall scale them. */
  sprinkle(colours: number[], o: { cell: number; r?: number; sigma?: number; jitter?: number; fill?: number; style?: number; styleParam?: number; wobble?: number; gallMul?: number; anim?: number; ring?: number; small?: boolean; gapFill?: number; shape?: number; floorMm?: number }) {
    const slot = this.layers.length;
    if (slot >= 8) return this;
    const p = this.p;
    const cell = (o.cell / p.density) ;
    const r = Math.min(0.66, (o.r ?? 0.5) * (o.gallMul ?? 1) * (0.55 + 0.45 * p.gall));
    const spec: LayerSpec = {
      cellMm: cell,
      jitter: o.jitter ?? 0.46,
      radius: r,
      radiusSigma: o.sigma ?? 0.22,
      colours,
      fill: o.fill ?? 1,
      animAmp: (o.anim ?? 1) * 0.1,
      breath: p.breath,
      seed: p.seed * 97 + slot * 13 + 1,
      rMax: o.small ? 0.8 : 1.0,
      shape: o.shape,
      floor: o.floorMm !== undefined ? o.floorMm / 2 / cell : undefined,
    };
    const ang = this.rnd(1) * Math.PI * 2;
    spec.origin = [(this.rnd(2) - 0.5) * cell, (this.rnd(3) - 0.5) * cell];
    spec.rot = ang;
    spec.isSpot = !!o.small && colours[0] >= 0;
    spec.gapFill = o.gapFill ?? (spec.isSpot ? p.gapFill : 0);
    this.layers.push(spec);
    const style = o.style ?? 0;
    const wobble = (o.wobble ?? 1) * (0.06 + 0.14 * p.viscosity);
    this.ops.push({
      type: OP.SPRINKLE,
      p: [slot, cell, style,
        spec.origin[0], spec.origin[1], Math.cos(ang), Math.sin(ang),
        0.12, wobble, o.styleParam ?? 1, o.ring ?? (style & STYLE.RINGED ? 0.08 : 0),
        o.small ? 1 : 0, 0, 0, 0],
    });
    this.n++;
    return this;
  }

  /** measured statistics of a palette pigment (defaults for unmeasured ones) */
  statsOf(ci: number, dflt: { perCm2: number; d50: number; sig?: number; wk?: number } = { perCm2: 1.2, d50: 2.2 }) {
    const pg = this.pal.pigments[ci];
    return { perCm2: pg?.perCm2 ?? dflt.perCm2, d50: pg?.d50 ?? dflt.d50, sig: pg?.sig ?? dflt.sig ?? 0.6, wk: pg?.wk ?? dflt.wk };
  }

  /** Sprinkle by measured statistics: spots per cm², median diameter (mm), log-normal spread. */
  sprinkleStats(colour: number, st: { perCm2: number; d50: number; sig: number; wk?: number }, o: { style?: number; styleParam?: number; anim?: number; densityMul?: number; sizeMul?: number; wobble?: number; jitter?: number } = {}) {
    const dens = st.perCm2 * (o.densityMul ?? 1);
    const cellMm = 10 / Math.sqrt(Math.max(0.006, dens));   // down to one drop per 1.7 dm² (Placard's few huge drops); 0.05 crowded them onto a 45 mm lattice and buried the first colours
    const r = (st.d50 * 1.35 * (o.sizeMul ?? 1)) / 2 / cellMm; // ×1.35: scan components are fragmented by later colours; clamped ≤ 0.8 cell in the bake
    const pk = this.pal.pack ?? {};
    const rr = r / (0.55 + 0.45 * this.p.gall);
    return this.sprinkle([colour], { cell: cellMm * this.p.density, r: rr, sigma: Math.min(st.sig, pk.sigma ?? 9), fill: 1, jitter: o.jitter ?? pk.jitter ?? 0.46, style: o.style, styleParam: o.styleParam, wobble: o.wobble, anim: o.anim ?? 1, small: rr <= 0.3, shape: st.wk ?? 1.1, floorMm: 1.2 });
  }

  /** Straight comb: tines spaced `spacing` mm along the perpendicular, moving in `dirDeg`.
   *  `ripple` is the tine-to-mid-gap differential displacement in units of the spacing
   *  (measured ≈1–1.5 on the UW nonpareil sheets); the uniform part of the drag is dropped. */
  comb(dirDeg: number, spacing: number, o: CombOpts = {}) {
    return this.combAt(dirDeg + this.axis, spacing, o);
  }

  /** As comb, in the sheet's own frame (no axis correction): for the conjugated combs. */
  private combAt(dirDeg: number, spacing: number, o: CombOpts = {}) {
    const p = this.p;
    const s = spacing * p.combScale;
    const L = (o.L ?? s * (0.22 + 0.33 * p.viscosity));
    const wake = o.kernel === "wake";
    // train sum as evaluated in the shader, for normalisation: a chain of arcs, or (1 + (d/L)²)^-1/2 per tine over the nine nearest tines
    const K = (u: number) => -0.5 * Math.log(1 + u * u);
    const pl = o.plateau ?? 0;
    const arc = (f: number) => { if (pl > 0) { const g = f - Math.round(f); return Math.pow(Math.max(Math.abs(Math.cos(Math.PI * g)), 1e-3), 0.3) * (1 - Math.pow(Math.abs(2 * g), pl)); } return Math.pow(Math.max(Math.abs(Math.cos(Math.PI * f)), 1e-3), 0.6); };
    const sum = (f: number) => { if (!wake) return arc(f); const k = Math.round(f); let t = 0; for (let j = -4; j <= 4; j++) t += K(((f - k - j) * s) / L); return t; };
    let mean = 0; for (let i = 0; i < 64; i++) mean += sum((i + 0.5) / 64); mean /= 64;
    const ripple = (o.ripple ?? 1.2) * (o.strength ?? 1) * p.combStrength;
    const z = (ripple * s) / Math.max(1e-3, sum(0) - sum(0.5));
    const drift = p.animate && !this.still ? 0.12 * s * Math.sin(0.11 * p.time + this.n) : 0;
    const w = o.wave;
    this.ops.push({ type: OP.COMB, p: [rad(dirDeg), s, (o.offset ?? 0) * p.combScale + drift, z, L, wake ? 1 : 0, w ? w.amp * p.combScale : 0, mean, w ? (2 * Math.PI) / (w.wavelength * p.combScale) : 0, w?.phase ?? 0, pl, w?.shape === "triangle" ? 1 : 0] });
    this.n++;
    return this;
  }

  /** Irregular sideways displacement of bands drawn along `bandDeg`, as the bath surface drifts between passes:
   *  two seeded sinusoidal shears across the bands, ~2–5 mm over 25–45 mm and a slower one (dp 284). Exactly
   *  invertible, unlike a wandering comb path, which folds the map once the drag outruns the wander. */
  jog(bandDeg: number, amp = 3) {
    // a noise shear across the bands: three octaves of the tileable noise (features ~50, 12 and 6 mm at 400 mm
    // per noise unit), seeded per comb, so the jog never repeats over a sheet
    this.ops.push({ type: OP.SHEAR, p: [rad(bandDeg + this.axis - 90), 0, 1, 0, amp * this.p.combStrength, 400, this.rnd(21)] });   // follows the comb axis
    this.n++;
    return this;
  }

  /** Two passes: down then back up, second pass offset by half a spacing ("halving"). */
  comb2(dirDeg: number, spacing: number, o: CombOpts = {}) {
    this.comb(dirDeg, spacing, { ...o });
    this.comb(dirDeg + 180, spacing, { ...o, offset: spacing / 2, strength: (o.strength ?? 1) * 0.85 });
    return this;
  }

  shear(dirDeg: number, amp: number, wavelength: number, phase = 0) {
    this.ops.push({ type: OP.SHEAR, p: [rad(dirDeg), amp, (2 * Math.PI) / wavelength, phase] });
    this.n++;
    return this;
  }

  /** A comb drawn along a sinusoidal path across the stroke (Serpentine, Bouquet, Peacock, Icarus). The path is part of
   *  the comb kernel (see invComb), so a second row of teeth half a spacing over and in opposite phase stays exactly half
   *  a period from the first however hard the comb is pulled. With the wave's amplitude equal to half the separation of
   *  adjacent lines (spacing/4) neighbouring lines touch once a wavelength and the sheet is quilted into closed cells. */
  wavyComb(dirDeg: number, spacing: number, amp: number, wavelength: number, o: CombOpts & { alternate?: boolean; shape?: "sine" | "triangle" } = {}) {
    const p = this.p;
    const phase = p.animate && !this.still ? 0.06 * p.time : 0;
    const dir = dirDeg + this.axis;
    const base = { strength: o.strength, ripple: o.ripple, L: o.L, kernel: o.kernel, plateau: o.plateau };
    this.combAt(dir, spacing, { ...base, wave: { amp, wavelength, phase, shape: o.shape } });
    if (o.alternate) this.combAt(dir, spacing, { ...base, offset: spacing / 2, wave: { amp: -amp, wavelength, phase, shape: o.shape } });
    return this;
  }

  vortex(cx: number, cy: number, z: number, L: number, r = 0, core = 2, sign = 1) {
    this.ops.push({ type: OP.VORTEX, p: [cx, cy, z, L, r, core, sign] });
    this.n++;
    return this;
  }

  /** Jittered grid of alternating vortices (French curl). */
  vortexGrid(cell: number, o: { z?: number; L?: number; r?: number; core?: number; jitter?: number; alt?: number } = {}) {
    const p = this.p;
    const ang = this.rnd(4) * 0.5 - 0.25;
    const c = cell * p.combScale;
    const z = (o.z ?? c * 1.1) * p.curlStrength;
    const t = p.animate ? p.time : 0;
    this.ops.push({
      type: OP.VORTEX_GRID,
      p: [c, o.jitter ?? 0.25, z, o.L ?? c * 0.22, o.r ?? c * 0.05, o.core ?? c * 0.06, o.alt ?? 1,
        (this.rnd(5) - 0.5) * c + 0.05 * c * Math.sin(0.09 * t), (this.rnd(6) - 0.5) * c + 0.05 * c * Math.cos(0.07 * t),
        Math.cos(ang), Math.sin(ang), this.p.seed + this.n, 0, 0, 0],
    });
    this.n++;
    return this;
  }

  stroke(bx: number, by: number, ex: number, ey: number, L: number) {
    this.ops.push({ type: OP.STROKE, p: [bx, by, ex, ey, L] });
    this.n++;
    return this;
  }

  stretch(dirDeg: number, factor: number) {
    this.ops.push({ type: OP.STRETCH, p: [rad(dirDeg), factor] });
    this.n++;
    return this;
  }

  /** Residual motion of the bath between throws: a few random shears of 10–35 mm wavelength.
   *  Applied between layers, so colours thrown earlier accumulate more deformation. */
  swirl(strain: number) {
    const p = this.p;
    if (strain <= 0) return this;
    const t = p.animate ? p.time : 0;
    // two shears at random angles; peak strain of a sinusoidal shear is A·2π/λ, mean |strain| 2/π of that
    for (let i = 0; i < 2; i++) {
      const ang = this.rnd(20 + i) * 180;
      const wl = 12 + 24 * this.rnd(30 + i);
      const amp = (strain / 2) * (Math.PI / 2) * wl / (2 * Math.PI) * (0.7 + 0.6 * this.rnd(40 + i));
      this.shear(ang, amp, wl, this.rnd(50 + i) * 6.28 + 0.03 * t);
    }
    this.n++;
    return this;
  }

  /** Slow large-scale drift: three long-wavelength shears with drifting phases. */
  drift() {
    const p = this.p;
    if (!p.animate || p.drift <= 0) return this;
    const t = p.time;
    this.shear(0, p.drift, 90 * p.combScale, 0.07 * t);
    this.shear(60, p.drift * 0.8, 130 * p.combScale, 0.05 * t + 1);
    this.shear(120, p.drift * 0.6, 170 * p.combScale, 0.09 * t + 2);
    return this;
  }

  // ---- composite bases -----------------------------------------------------
  /** Turkish / stone base, laid as on the 17th–18th-c. sheets: the background colour thrown
   *  first and generously (it keeps 25–45 % of the area), then the spot colours in laying order
   *  with their measured size distributions, then gall water as small clear spots. */
  turkish(o: { spots?: number; cell?: number; bgCell?: number; bgR?: number; bgFill?: number; lastStyle?: number; lastParam?: number; ringed?: boolean; fill?: number; gallDots?: boolean; skipBackground?: boolean; sizeMul?: number; densityMul?: number; swirl?: number; gold?: boolean; ground?: number; exclude?: number[]; shape?: number } = {}) {
    const pal = this.pal;
    const cell = o.cell ?? 12;
    const groundIdx = o.ground ?? pal.background;
    if (!o.skipBackground) {
      const fill = o.bgFill ?? (o.ground !== undefined ? 1 : (pal.bg?.fill ?? 1));
      // A generously thrown first colour covers the bath: model it as a continuous ground film.
      // (Drops of ~1 cell radius would lose mass to the neighbourhood window and open false gaps.)
      if (fill >= 0.95 && o.bgR === undefined) this.groundFill = groundIdx;
      else this.sprinkle([groundIdx], { cell: o.bgCell ?? cell * 0.8, r: o.bgR ?? pal.bg?.r ?? 0.5, sigma: 0.15, jitter: 0.3, fill, style: o.ringed ? STYLE.RINGED : 0, anim: 0.8 });
    }
    // Bronze/gold ink, where the sheet has a measurable amount, is the first colour thrown (UW: it
    // ends up as the vein colour). Recipes that throw it themselves pass gold: false.
    if (o.gold !== false && pal.gold !== undefined && !pal.spots.includes(pal.gold)) {
      const g = pal.pigments[pal.gold];
      if ((g.frac ?? 0) >= 1 && g.d50) this.sprinkleStats(pal.gold, this.statsOf(pal.gold, { perCm2: 0.6, d50: 2, wk: 0.9 }), { style: STYLE.METALLIC, sizeMul: o.sizeMul, densityMul: o.densityMul });
    }
    const ns = Math.min(o.spots ?? pal.spots.length, pal.spots.length);
    for (let i = 0; i < ns; i++) {
      const c = pal.spots[i];
      if (o.exclude?.includes(c)) continue;   // thrown later, after the combing
      const pg = pal.pigments[c];
      const last = pal.special !== undefined ? c === pal.special : i === ns - 1;
      let style = (o.ringed ? STYLE.RINGED : 0);
      if (last && o.lastStyle) style |= o.lastStyle;
      const st = { perCm2: pg.perCm2 ?? 1.2, d50: pg.d50 ?? 2.2, sig: pg.sig ?? 0.6, wk: o.shape ?? pg.wk };
      this.sprinkleStats(c, st, { style, styleParam: last ? o.lastParam : undefined, sizeMul: o.sizeMul, densityMul: o.densityMul });
      // Residual bath motion after this throw. The shear strain each colour must end up with
      // comes from its measured spot elongation on the sheet (default: the mean schedule of the
      // non-combed sheets, 2.7 for the first colour falling to 2.4 for the last); the swirl
      // applied after layer i is the strain difference between layer i and layer i+1.
      if (o.swirl !== 0) {
        const f = ns > 1 ? i / (ns - 1) : 1;
        const elOf = (k: number) => { const q = pal.pigments[pal.spots[k]]; const ff = ns > 1 ? k / (ns - 1) : 1; return q.el ?? (2.7 - 0.35 * ff); };
        const strain = (el: number) => Math.max(0, Math.sqrt(el) - 1 / Math.sqrt(el) - 0.55); // simple-shear strain beyond the ~1.3 baseline from drop pushing
        const gNow = strain(elOf(i));
        const gNext = i === ns - 1 ? 0.35 * gNow : strain(elOf(i + 1));
        const dg = Math.max(0, gNow - gNext) * (o.swirl ?? 1);
        void f;
        if (dg > 0.02) this.swirl(dg);
      }
    }
    // Gall water sprinkled last: small clear spots that open the film. A separate layer,
    // so it moves independently of the colours beneath.
    if (o.gallDots !== false) this.sprinkle([-1], { cell: 4.5, r: 0.16, sigma: 0.45, fill: 0.22, jitter: 0.45, style: STYLE.CLEAR, anim: 1.4, small: true });
    return this;
  }

  scene(extra: Partial<Scene> = {}): Scene {
    // The shader's op chain is finite; a recipe that overflows it loses its *last* passes silently (the wavy combs of
    // Serpentine, Bouquet and Peacock went missing this way at 24 ops), so shout.
    if (this.ops.length > MAX_OPS) console.warn(`recipe has ${this.ops.length} ops; the shader keeps the first ${MAX_OPS}`);
    return {
      ops: this.ops,
      layers: this.layers,
      transfer: { mode: 0, amp: 0, wavelength: 6, angle: 35, phase: 0, wobble: 0.3 },
      groundFill: this.groundFill,
      goldNet: 0,
      softPaper: 0,
      ...extra,
    };
  }
}

// ---------------------------------------------------------------------------
// Recipes — one per pattern on the UW "patterns" page.
// ---------------------------------------------------------------------------
/** Per-preset defaults for the tunable parameters, chosen to match the reference sheet. */
export interface PresetDefaults {
  viscosity?: number; gall?: number; density?: number; combScale?: number; combStrength?: number;
  curlStrength?: number; transferAmp?: number; paperAge?: number; bleed?: number; edgeDark?: number;
  grain?: number; tooth?: number; granulation?: number; wear?: number; drift?: number; stretchLimit?: number;
}
const D18: PresetDefaults = { viscosity: 0.25, paperAge: 0.55, bleed: 0.16, tooth: 0.7, granulation: 0.7 }; // 17th/18th-c. sheets: starchy size, laid paper, aged
const D19: PresetDefaults = { viscosity: 0.35, paperAge: 0.35, bleed: 0.12, tooth: 0.55, granulation: 0.55 }; // 19th-c. trade papers
const D20: PresetDefaults = { viscosity: 0.45, paperAge: 0.1, bleed: 0.08, tooth: 0.4, granulation: 0.4 }; // modern carrageenan size, wove paper
// Combed sheets read as clean bands of colour: the paper's tooth, granulation and cover wear sit at 0.2–1 mm, the
// same scale as the small tongues and cusps, and with the full stone-sheet amounts they turn the fine structure to
// mud (user, dp 172: "fix the colours of Bouquet"). Kept light on every recipe built on tongues.
const COMBED_LOOK: PresetDefaults = { tooth: 0.3, granulation: 0.3, wear: 0.05, grain: 0.5 };

export interface Recipe {
  name: string;
  group: string;
  palette: string; // key of the default palette
  palettes: string[]; // attested palettes for this pattern (first = default)
  terms?: string[]; // catalogue pattern terms: generated sheets whose leading pattern matches attach here
  note: string;
  defaults: PresetDefaults;
  /** orientation of the dominant streaks as the recipe is authored ("h" across the sheet, "v" down it); combs
   *  are turned through 90° on a sheet whose measured streaks run the other way (Palette.streak) */
  streaks?: "h" | "v";
  /** the scale of the scan measurement `streaks` refers to: "fine" (tongues, lines; the default) or "coarse" (bands).
   *  On a nonpareil the two are perpendicular, and the bands are the robust feature. */
  streakScale?: "fine" | "coarse";
  build: (p: Params, pal: Palette) => Scene;
}

// Combed sheets: the stone underneath had spots several times larger than the fragments the
// combed scans show (bands of 1–2 mm remain after the get-gel), hence sizeMul / densityMul.
const COMBED = { sizeMul: 2.4, densityMul: 0.3, gallDots: false };
/** The plain Turkish (Stone) sheet, thrown exactly as the "Turkish (Stone)" recipe throws it. Every pattern the
 *  catalogue describes as made "on a Turkish base" starts from this same call, so that its spots, rings, gall dots
 *  and residual swirl agree with a plain Turkish sheet in the same palette before the comb or the transfer acts. */
const turkishBase = (b: Builder, stretch = 1, extra: Parameters<Builder["turkish"]>[0] = {}) =>
  // `stretch`: the sheet's drop statistics were measured on the combed sheet, where every drop is a band `stretch`
  // times narrower than it was thrown (a get-gel drawn twice ≈ 6, a single gentle comb ≈ 2.4); the throw is inflated
  // back to the size of the wet drop and thinned so that the coverage the fitter matches stays in reach.
  b.turkish({ cell: 18, ringed: true, sizeMul: stretch, densityMul: stretch > 1 ? 2.5 / stretch ** 2 : 1, ...extra });
// Relative luminance of a palette hex (for "the darkest colour is the ground" rules).
const luma = (h: string) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
// Colours that took part in the sheet (ground and spots), by index.
const laidColours = (pal: Palette) => [pal.background, ...pal.spots];
// The darkest colour of substantial coverage (≥ 5% of the sheet when any qualifies): a 3% dark blue speck colour is not a ground.
const darkestGround = (pal: Palette, cands: number[]) => { const big = cands.filter((c) => (pal.pigments[c].frac ?? 0) >= 5); const pool = big.length ? big : cands; return pool.reduce((a, c) => (luma(pal.pigments[c].hex) < luma(pal.pigments[a].hex) ? c : a), pool[0]); };
// Give a colour measured only as a ground the default size statistics, so the fitter can drive it as a spot layer.
const ensureStats = (pal: Palette, c: number, d50 = 8, perCm2 = 0.5) => { const q = pal.pigments[c]; if (!q.d50) { q.d50 = d50; q.perCm2 = q.perCm2 ?? perCm2; q.wk = q.wk ?? 0.8; } };
// A sheet whose measured colours already include a thrown white ("white paint") gets no extra white sprinkle.
const hasWhiteSpot = (pal: Palette) => pal.spots.some((c) => pal.pigments[c].name.startsWith("white"));
/** Colours whose spots stayed round on the sheet (measured elongation < 2.2): thrown after the combing, on top of it. */
const roundColours = (pal: Palette) => pal.spots.filter((c) => (pal.pigments[c].el ?? 9) < 2.2);
/** Feather base (dp 229): a stone base of small spots is drawn into hair lines by a fine comb; then a
 *  comb with widely set teeth is drawn across the lines and back, the second pass halving the first,
 *  and pulled hard: with the 1/d drag of a tine the lines become hyperbolae, swooping into each
 *  tine's path (the quill) and running along it, alternately one way and the other between the
 *  periodic quills. Antique straight adds a shower of fine dots; Zebra is the same wide comb on a
 *  plain stone base. */
const featherBase = (b: Builder, exclude: number[], spacing = 55) => {
  b.still = true;   // the drawn base never moves; only what is thrown after it animates
  // The measured spot sizes are the fragments left after the drawing; the spots thrown were several times
  // larger, of one size (shape 2.5: the fragments' heavy tails would let a few giants cover the sheet).
  b.turkish({ cell: 14, sizeMul: 6, densityMul: 0.25, gallDots: false, swirl: 0, exclude, shape: 2.5 });
  // An 8 mm comb pulled hard: every spot drawn into a continuous band (no tongue ends anywhere on dp 29). Its
  // 2 mm core caps the strain near 4, so the bands stay ~2 mm wide; with a 0.3 mm core (strain ~25) they were
  // hair lines the anti-aliasing averaged grey.
  b.comb(-90, 8, { ripple: 2, L: 2, kernel: "wake" });
  // Wide comb across and back, halving, drawn the length of the bath. The wake has nearly no width: the drag
  // is logarithmic in the distance to each tine's path, so the lines run nearly straight across the gap and
  // bend only in the last millimetres into the quill, sigmoids of opposite sense in alternate gaps (dp 29:
  // quills ~55 mm apart; its orientation histogram peaks at ~75° and ~110°, i.e. 65–70° from the stroke).
  // The core stays at half a millimetre: the lines must meet the quill in cusps, which a wider core rounds off.
  // Within a millimetre or two of each quill the bands are sheared fine and average dark, as on the scan; the
  // line width elsewhere is set by the base and the first comb. A ripple of 1.5 spacings gives the scan's ~70°
  // crossing (measured against its orientation histogram).
  b.comb2(0, spacing, { ripple: 1.5, L: 0.5, kernel: "wake" });
  b.still = false;
  return b;
};
/** Zebra base (dp 15, 386): a stone base of the band colours, then a comb with widely set teeth drawn down and
 *  back up, halving, with the wake kernel: bold bands 3–6 mm wide swooping into the tine paths. The colours in
 *  `round` are held back for the throws that follow. On sheets where the mixture model labelled the most abundant
 *  pale colour the ground, that colour is the large final drops instead and the ground film under the bands is the
 *  darkest colour; the pale colour's index is returned for the caller to throw. The base never animates. */
const zebraBase = (b: Builder, round: number[], o: { spacing?: number; sizeMul?: number; densityMul?: number } = {}) => {
  const pal = b.pal;
  b.still = true;
  const pale = round.length ? undefined : pal.background;
  const ground = pale === undefined ? undefined : pal.spots.reduce((a, c) => (luma(pal.pigments[c].hex) < luma(pal.pigments[a].hex) ? c : a), pal.spots[0]);
  b.turkish({ cell: 16, sizeMul: o.sizeMul ?? 6, densityMul: o.densityMul ?? 0.2, gallDots: false, swirl: 0, exclude: round, shape: 2.5, ground });
  b.comb2(-90, o.spacing ?? 18, { ripple: 1.8, L: 1.5, kernel: "wake" });
  b.jog(90, 2);
  b.still = false;
  return pale;
};
/** Nonpareil base: a stone base, the get-gel (a wide comb drawn twice, halving), then a fine comb drawn once
 *  across it. `fine` is the fine comb's spacing: ~4 mm on dp 82; the double combs sit on a coarser nonpareil
 *  (arches 8–10 mm apart, dp 393 and 75), with spots to match. */
const nonpareilBase = (b: Builder, fine = 4, o: { dir?: number; ripple?: number; bold?: number; plateau?: number; beforeFine?: (b: Builder) => void; skipFine?: boolean } = {}) => {
  const coarse = fine / 4;
  const dir = o.dir ?? -90;   // direction the fine comb moves; the get-gel is drawn at right angles to it
  const bold = o.bold ?? 1;   // fewer, larger drops at the same coverage: bands `bold` times wider after the get-gel
  // Spots several times the measured fragments, of one size and sparse (a fourteenth of the measured density), so
  // that drawn out by the get-gel they are bands 5–10 mm wide and each scallop of the fine comb holds one colour
  // (dp 82). Every sheet on this base was refitted with these sizes.
  b.turkish({ cell: 16 * Math.sqrt(coarse), sizeMul: 6 * Math.sqrt(coarse) * bold, densityMul: 0.07 / (bold * bold), gallDots: false, shape: 2.5 });
  // get-gel: a wide comb drawn twice, halving, with the wake kernel and a 5 mm core: each band moves almost rigidly,
  // drawn long yet still wide. The arc profile here either shears the bands to threads (hard pull) or shows its own
  // arches (gentle pull).
  b.comb2(dir + 90, 22 * Math.sqrt(coarse), { ripple: 2.2, L: 5, kernel: "wake" });
  b.jog(dir + 90);   // the bands jog sideways irregularly before the fine comb; the scallops stay regular (dp 284)
  o.beforeFine?.(b);  // a pass on the get-gel bands before the fine comb cuts them
  if (o.skipFine) return b;  // the caller draws its own last comb (Double comb waved: along a wave)
  b.comb(dir, fine, { ripple: o.ripple ?? 2.2, plateau: o.plateau }); // fine comb drawn once across the bands: scallops along every band edge, taller than wide (dp 82: ~4.5 mm tongues)
  return b;
};

export const RECIPES: Recipe[] = [
  { name: "Turkish (Stone)", group: "Stone", palette: "turkish17", palettes: ["turkish17", "spotcombed18", "placard18", "dp322", "serpentine19", "frenchcurl19"], terms: ["turkish", "spot", "stone", "agate"], defaults: { ...D18 }, note: "Colours thrown in turn; earlier ones constrict into veins.",
    build: (p, pal) => turkishBase(new Builder(p, pal)).drift().scene() },

  { name: "Italian (hair vein)", group: "Stone", palette: "italian19", palettes: ["italian19", "dp63", "dp246"], terms: ["italian", "vein"], defaults: { ...D19, viscosity: 0.55, gall: 1.2 }, note: "Few colours, then fine dispersant drops squeeze them into hair veins.",
    build: (p, pal) => { const b = new Builder(p, pal); b.turkish({ cell: 14, gallDots: false });
      // The dispersant drops open paper equal to their own area (r = 0.48 cell → ~66% of a cell at full fill after overlap).
      // On sheets with no bare paper (Italian veins over a ground) the last throw is the ground colour itself, dispersant-laden.
      const clear = (pal.paperPct ?? 0) > 5; const bgFrac = pal.pigments[pal.background].frac ?? 50;
      const fill = Math.min(1, (clear ? pal.paperPct! : bgFrac) / 66);
      b.sprinkle([clear ? -1 : pal.background], { cell: 4.5, r: 0.48, sigma: 0.25, fill, style: clear ? STYLE.CLEAR : 0, gallMul: 1.1 }); return b.drift().scene(); } },

  { name: "Gold vein", group: "Stone", palette: "dp138", palettes: ["dp138", "nonpareil19"], terms: ["gold vein"], defaults: { ...D19 }, note: "Bronze ink thrown first; it ends up as the vein colour.",
    build: (p, pal) => { const b = new Builder(p, pal); const g = pal.gold ?? pal.spots[0];
      b.sprinkleStats(g, b.statsOf(g, { perCm2: 0.6, d50: 6, wk: 0.9 }), { style: STYLE.METALLIC });
      b.turkish({ cell: 14, ringed: true, gold: false }); return b.drift().scene(); } },
  { name: "Nonpareil", streaks: "h", streakScale: "coarse", /* the get-gel bands as authored run across; the bands are the robust measurement (dp 284: tongues incoherent, bands 0.8) */ group: "Combed", palette: "nonpareil19", palettes: ["nonpareil19", "dp21", "antique19"], terms: ["nonpareil", "get gel", "getgel", "old dutch"], defaults: { ...D19, ...COMBED_LOOK, viscosity: 0.3 }, note: "Get-gel (wide comb twice) then a 2–3 mm comb drawn once.",
    build: (p, pal) => nonpareilBase(new Builder(p, pal)).drift().scene() },

  { name: "Feather", streaks: "h", group: "Combed", palette: "g229", palettes: ["g229", "g237", "g238", "g29"], terms: ["feather", "chevron"], defaults: { ...D19, viscosity: 0.8, stretchLimit: 1e5, drift: 0 }, note: "A fine comb draws every colour into hair lines; a comb with widely set teeth drawn across them and back, halving, and pulled hard draws the lines into hyperbolae: barbs swooping into the periodic quills and running along them (dp 229).",
    build: (p, pal) => { const b = new Builder(p, pal); const round = roundColours(pal); featherBase(b, round);
      for (const c of round) b.sprinkleStats(c, b.statsOf(c), { anim: 0.6 });
      return b.drift().scene(); } },
  { name: "Icarus", streaks: "v", group: "Combed", palette: "g216", palettes: ["g216", "g217", "g219", "g220", "g221", "g222"], terms: ["icarus", "whirl"], defaults: { ...D19, ...COMBED_LOOK, viscosity: 0.3 }, note: "Fine nonpareil, then a deep comb drawn down the sheet along a slow arc: nested wing-like crescents (dp 216).",
    build: (p, pal) => { const b = nonpareilBase(new Builder(p, pal)); b.wavyComb(-90, 14, 22, 260, { alternate: false, ripple: 2.5, L: 1, kernel: "wake" }); /* one deep wide-kernel comb drawn down a slow arc: nested crescents ~14 mm apart, all bowing one way (dp 216) */ return b.drift().scene(); } },
  { name: "Cathedral", streaks: "v", group: "Combed", palette: "g218", palettes: ["g218", "g224", "g234", "g242", "g243", "g244"], terms: ["cathedral"], defaults: { ...D19, ...COMBED_LOOK, viscosity: 0.3 }, note: "Nonpareil, then one wide comb with strong pull drawn up the sheet: tall pointed arches (dp 218).",
    build: (p, pal) => { const b = nonpareilBase(new Builder(p, pal)); b.comb(-90, 55, { ripple: 3.5, L: 1.5, kernel: "wake" }); return b.drift().scene(); } },
  { name: "Wide comb (Arch)", streaks: "v", group: "Combed", palette: "dp274", palettes: ["dp274", "nonpareil19"], terms: ["wide comb", "arch"], defaults: { ...D19, ...COMBED_LOOK, viscosity: 0.3 }, note: "Narrow comb twice horizontally, then a wider comb vertically once.",
    build: (p, pal) => { const b = new Builder(p, pal); turkishBase(b, 6); b.comb2(0, 8, { ripple: 2.5 }); b.comb(-90, 22, { ripple: 1.2 }); return b.drift().scene(); } },

  { name: "Double comb", group: "Combed", palette: "dp393", palettes: ["dp393"], terms: ["double comb", "doubled comb", "double nonpareil"], defaults: { ...D19, ...COMBED_LOOK, viscosity: 0.3 }, note: "A standard Nonpareil, then a comb with one set of teeth set wider drawn once more through the bath: the arched lines broken into separate arched columns (Wolfe; dp 393, 471).",
    build: (p, pal) => {
      // Authored in dp 393's own frame (no per-sheet rotation, which cannot tell left from right): the get-gel drawn down
      // the sheet leaves vertical bands; the fine comb (4.5 mm rows) and the doubling comb both move LEFT across them, so
      // every tongue, small and large, points left. Both are pulled hard: the small tongues run two to three rows long.
      const b = nonpareilBase(new Builder(p, pal), 4.5, { dir: 180, ripple: 2.5, plateau: 12 });
      // The doubling comb: teeth ~26 mm apart (22–28 on the sheet), drawn once the same way as the fine comb and pulled
      // hard, with the same arc profile: big rounded heads at the wide tine paths pointing with the small ones and running
      // past a column width, and the cusps between the columns drawn out into the 3–5 mm hair-line rows of dp 393.
      b.comb(180, 26, { ripple: 1.5, plateau: 6 });
      return b.drift().scene(); } },
  { name: "Double comb waved", streaks: "v", group: "Combed", palette: "dp75", palettes: ["dp75"], terms: ["double comb waved", "waved double comb", "double comb wave"], defaults: { ...D19, ...COMBED_LOOK, viscosity: 0.3 }, note: "A standard Nonpareil, then a comb with one set of teeth set wider drawn once more through the bath in a wavy line (Wolfe; Miura's Wave; dp 75, 471).",
    build: (p, pal) => { /* dp 75 (10 mm grid on the scan): 10 mm tongues 25–35 mm long with 3–5 mm bands, leaning 30–60° with their ranks, the lean
         reversing every half wave. Tongues that lean with the wave were cut by the comb that was drawn along it: the last comb is
         the 10 mm one, drawn down the sheet along a wave of ±15 mm over ~95 mm and pulled hard, over a nonpareil of a finer comb
         (Wolfe: a nonpareil, then a comb with wider teeth drawn once more in a wavy line). dp 471 (Guyot) is finer, ~5 mm tongues. */
      const b = nonpareilBase(new Builder(p, pal), 2.5, { bold: 3, ripple: 2.2, plateau: 12 }); // a fine nonpareil of 2.5 mm: four subdivisions inside every 10 mm tongue (dp 75), on get-gel bands 3–5 mm
      b.wavyComb(-90, 10, 15, 95, { alternate: false, ripple: 3, plateau: 12 });
      return b.drift().scene(); } },

  { name: "Bouquet", streaks: "v", group: "Combed", palette: "dp172", palettes: ["dp172"], terms: ["bouquet", "fern"], defaults: { ...D19, ...COMBED_LOOK, viscosity: 0.3 }, note: "Nonpareil base, then a comb with two rows of teeth drawn down the sheet in a loose wave: each nonpareil column fans out into a small bouquet (Miura; dp 172).",
    build: (p, pal) => {
      const b = nonpareilBase(new Builder(p, pal), 4, { ripple: 3, bold: 2, plateau: 12 }); // get-gel across, 4 mm fine comb down, pulled hard so the small tongues show inside the fans; bands 3–5 mm wide on dp 172, bolder than dp 82: columns of tongues (dp 172: 5.7–6.3 mm tongue period inside the cups, spread 1.43×)
      // Two interleaved tine sets 74 mm apart (adjacent lines 37 mm), in opposite phase, with the wave's amplitude half the
      // separation of adjacent lines (18.5 mm): neighbouring lines touch once a wavelength, so the sheet is quilted into
      // closed cells, each nonpareil column fanning out into a bouquet and pinching to a stem; the cells of adjacent
      // column pairs stagger half a wavelength (lattice (74, 0), (37, 63) on dp 172). Arc kernel: the nonpareil rows bend
      // into rounded concentric arcs inside each cell.
      b.wavyComb(-90, 74, 18.5, 74, { alternate: true, ripple: 0.45, plateau: 6 }); // period ≈ 4 × amplitude (dp 174): the cells come out squarish // plateau: the tongues ride into the fan whole; the stretch sits in the stems (dp 172)
      return b.drift().scene(); } },

  { name: "Peacock", streaks: "v", group: "Combed", palette: "peacock19", palettes: ["peacock19"], terms: ["peacock", "augen"], defaults: { ...D19, ...COMBED_LOOK, viscosity: 0.3 }, note: "Turkish, a one-row comb drawn down and back then across and back, halving, then a two-row comb drawn down in a loose wave: eyes outlined by hair lines with the stone spots inside (Miura; dp 144).",
    build: (p, pal) => {
      const b = new Builder(p, pal); turkishBase(b, 2.4); // the spots survive as 3–6 mm blobs inside the eyes (dp 144)
      if (!hasWhiteSpot(pal) && (pal.pigments[pal.white].frac ?? 0) > 2) b.sprinkleStats(pal.white, b.statsOf(pal.white, { perCm2: 0.5, d50: 4, wk: 1 }), { sizeMul: 2.4, densityMul: 0.43 }); // the cream blobs (dp 144: ~10 %)
      // Miura: one-row comb drawn down and back up, halving, then the same across and back. Gentle: the spots are only
      // lobed and elongated ~2:1 with S-tails (mid-gap strain π × 0.3 ≈ 1), never drawn into bands.
      b.comb2(-90, 25, { ripple: 0.3 });
      b.comb2(0, 25, { ripple: 0.3 });
      // Two-row comb down the sheet: sets 44 mm apart (adjacent lines 22 mm) in opposite phase, the wave's amplitude half
      // the separation of adjacent lines (11 mm), so neighbouring lines touch once a wavelength and quilt the sheet into
      // closed eyes ~44 mm wide at the widest, in staggered rows (dp 144: 43.8 mm across, 54–57 mm rows, 114 mm red
      // period). The arc profile draws the paint along each path into the hair lines that outline the eye, while the
      // rounded middle of the gap only bends, so the blobs inside survive (a log wake shears the whole gap and shreds them).
      b.wavyComb(-90, 44, 11, 112, { alternate: true, ripple: 0.5, plateau: 6, shape: "triangle" }); // triangular waves a half period apart: the two rows of straight zigzag lines cross into diamonds ~44 mm wide and 56 mm tall (dp 144); no fine comb, the base is Turkish (user)
      return b.drift().scene(); } },

  { name: "Serpentine", streaks: "h", group: "Combed", palette: "dp164", palettes: ["dp164", "serpentine19", "dp87"], terms: ["serpentine", "waved", "wave"], defaults: { ...D19, ...COMBED_LOOK, viscosity: 0.3 }, note: "Turkish, a one-row comb drawn down and back then across and back, halving, then a slightly wider comb drawn once down the sheet in wavy lines like a snake's track (Miura; dp 69, 164).",
    build: (p, pal) => { const b = new Builder(p, pal); turkishBase(b, 7, { densityMul: 0.4 }); // ~0.15 drops per cm² of every colour, ~10 mm each (the fitter sets the size for the coverage): bands 3–5 mm, the whites the widest, every hairpin carrying every colour, no single-colour fields // bands 1–6 mm on the sheet from a get-gel drawn twice and a waved comb: drops thrown ~10–20 mm and many of them, so every hairpin of dp 69 carries every colour (the plain 2.5/stretch² density left one ochre drop per palm)
      // Lengths below are from dp 69 scaled to its catalogued 15 cm width (the scan is ~455 dpi, not 300).
      b.comb2(-90, 16, { ripple: 0.3 }); // get-gel down and back up: 8 mm vertical bands, the hairline stacks inside every later band; it survives only faintly on dp 69, so a gentler pull than the second
      b.comb2(0, 16, { ripple: 1.0, plateau: 6 }); // get-gel across, halving: the small nested tongues (16 mm, solid interiors) that every hairpin of dp 69 carries; a moderate pull keeps the bands 2–6 mm (white 3–6 mm on the sheet)
      b.jog(0, 2); // the bands wander a little before the last comb (no two hairpins on dp 69 are alike)
      // One wide comb drawn down the sheet along the snake's track: ~21 mm tines, hairpins with parabolic heads and cusped
      // valleys (arc profile). The swing is the pattern: dp 164 shows ±0.9 spacings over 2.5 spacings of wavelength, dp 69
      // less; a pull much over one spacing drew the bands into straight chevrons that hid the wave altogether.
      b.wavyComb(-90, 21, 14, 50, { ripple: 0.9, plateau: 6 }); // plateau profile: the bands ride the S-curves whole instead of shearing to hair
      return b.drift().scene(); } },

  { name: "French curl on Fountain", streaks: "h", group: "Curled", palette: "dp156", palettes: ["dp156"], terms: ["fountain", "french curl on fountain", "springbrunnen", "snail on fountain"], defaults: { ...D19, ...COMBED_LOOK, curlStrength: 1 }, note: "Turkish, then a comb with one set of teeth drawn back and forth across the bath: nested tongues of colour read as jets of spray (Miura's Fountain). Both UW sheets then have stylus swirls drawn ~200 mm apart (Snail on Fountain; dp 156, 272).",
    build: (p, pal) => {
      const b = new Builder(p, pal); turkishBase(b, 5); // one colour fills a whole row for 15–25 mm: drops ~13–15 mm (dp 156, 272)
      // Fountain: a one-row comb, 12 mm tines (row period 12.2 mm on dp 156, 10–12 mm on dp 272), drawn across and back. Passes
      // along one axis add, so only the net shear shows: rounded tongues 25–35 mm long (≈ 2.5 spacings) all pointing one way,
      // cusped bundles of hair lines between the rows; nothing wavy.
      b.comb(0, 10, { ripple: 2.5 }); // 12.2 mm at the agent's 300 dpi assumption; dp 156 is catalogued 20 cm wide (~370 dpi)
      // White dots thrown after the comb: round, 2–4 mm, ~0.2 per cm² (dp 272), wound only by the swirls.
      if (!hasWhiteSpot(pal)) b.sprinkleStats(pal.white, b.statsOf(pal.white, { perCm2: 0.06, d50: 2.5, wk: 0.9 }), { anim: 0.6 }); // sparingly: a few dots per palm on dp 156
      // French curl: swirls 190–220 mm apart on a staggered lattice, the wound disc ~90 mm across, the rows still bent 20–40°
      // at 80–90 mm from the centre; the sense varies from sheet to sheet (dp 156 both the same way, dp 272 alternating).
      b.vortexGrid(180, { z: 1.2 * 6.2832 * 9, r: 30, core: 9, L: 10 + 40 * p.viscosity, jitter: 0.15, alt: 0 }); // dp 156/272 (crop at 10 mm grid): about a turn within 20 mm of the centre, half a turn at 30, a slight deflection at 55; the rows are dragged round, not wound into rings // dp 156/272: curls 160–200 mm apart in one column, wound region 100–120 mm across, 2–2.5 turns of even 10–20 mm pitch from 55 mm in to a 9 mm core, all the same sense
      return b.drift().scene(); } },

  { name: "French curl on Turkish", group: "Curled", palette: "frenchcurl19", palettes: ["frenchcurl19", "frenchcurl19b", "dp16", "placard18"], terms: ["french curl", "curl", "snail"], defaults: { ...D19, curlStrength: 1 }, note: "Stone base swirled with a stylus at regular intervals.",
    build: (p, pal) => { const b = new Builder(p, pal); turkishBase(b); b.vortexGrid(150, { z: 0.3 * 6.2832, r: -55, core: 25, L: 10 + 50 * p.viscosity, jitter: 0.2, alt: 0 }); /* dp 20: the stylus went round a circle ~55 mm in radius; the spots inside stay intact, the ones under its path (30–55 mm) are drawn into tangential streaks (strain ~5, about 0.4 turn of relative rotation across the ring), and the surroundings are dragged round less and less with distance. Not a spiral: drag, not swirl. Curls 135–175 mm apart */ return b.drift().scene(); } },

  { name: "French curl on Nonpareil", group: "Curled", palette: "dp21", palettes: ["dp21", "frenchcurl19b"], terms: ["french curl on nonpareil"], defaults: { ...D19, ...COMBED_LOOK, curlStrength: 1 }, note: "Nonpareil base, then swirled.",
    build: (p, pal) => { const b = nonpareilBase(new Builder(p, pal)); b.vortexGrid(105, { z: 1.0 * 6.2832 * 8, r: 25, core: 8, L: 8 + 30 * p.viscosity, alt: 0 }); /* dp 21: about one turn at an 8 mm core, the winding falling off as 1/d (the rows deflected, not wound, beyond ~25 mm), wound regions 70–80 mm across, ~100 mm apart, all the same sense */ return b.drift().scene(); } },

  { name: "Placard (Drawn stone)", group: "Curled", palette: "placard18", palettes: ["placard18"], terms: ["placard", "drawn stone", "mixed"], defaults: { ...D18, curlStrength: 1, tooth: 0.45, granulation: 0.35, wear: 0.06 }, note: "Red thrown generously, gall on it, a handful of huge slate, blue and ochre drops, gall again, then a stylus drawn freely across the bath in sweeps and hooks: Schleicher's Drawn stone (dp 96–98, 102).",
    build: (p, pal) => {
      const b = new Builder(p, pal);
      const h = (i: number) => hash01(p.seed, 900 + i);
      // 1. Red ground as a continuous film (the sheets' red is unbroken between the drops; the bare paper is the spots
      //    thrown into it, not gaps in the throw), no bath swirl, no fine dots (dp 97: a third of the sheet stays red).
      b.turkish({ spots: 0, swirl: 0, gallDots: false, bgFill: 1 });
      // 2. Gall on the red, in two populations (dp 97 at 600 dpi): large ovals 6–15 mm, about one per 4 cm², and fine
      //    dots 2–4 mm, 1.5 per cm². Both are bare paper.
      b.sprinkleStats(-1, { perCm2: 0.12, d50: 7, sig: 0.5, wk: 1.2 }, { style: STYLE.CLEAR, anim: 1 });
      b.sprinkleStats(-1, { perCm2: 0.6, d50: 2.2, sig: 0.5, wk: 1.3 }, { style: STYLE.CLEAR, anim: 1.2 });
      // 3. A handful of huge drops. The mixture model of dp 97 gives slate ("green" in the catalogue's words, 33 %), blue
      //    (3 %) and yellow-ochre (6 %), plus two tans that are the red film drawn thin by the stylus, not colours thrown:
      //    those (a lighter variant of the ground's hue) are left out. Largest coverage first, the ochre last: it always
      //    lies on the slate or blue (dp 97, 98). Two to four drops per sheet of each (0.02 per cm²), 30–50 mm across;
      //    the sizes are the palette's, which the coverage fitter drives.
      const rgbOf = (c: number) => [1, 3, 5].map((i) => parseInt(pal.pigments[c].hex.slice(i, i + 2), 16));
      const hueOf = (c: number) => { const [r, g, bb] = rgbOf(c); return (Math.atan2(Math.sqrt(3) * (g - bb), 2 * r - g - bb) * 180) / Math.PI; };
      const dh = (x: number, y: number) => Math.abs((((x - y) % 360) + 540) % 360 - 180);
      const gnd = pal.background;
      const thinned = (c: number) => dh(hueOf(c), hueOf(gnd)) < 30 && luma(pal.pigments[c].hex) > luma(pal.pigments[gnd].hex) + 0.08;
      const yellowish = (c: number) => dh(hueOf(c), 60) < 40 && luma(pal.pigments[c].hex) > 0.45;
      const bigs = pal.spots.filter((c) => !thinned(c)).sort((x, y) => (yellowish(x) ? 1 : 0) - (yellowish(y) ? 1 : 0) || (pal.pigments[y].frac ?? 0) - (pal.pigments[x].frac ?? 0)).slice(0, 3);
      bigs.forEach((c) => { ensureStats(pal, c, 20, 0.02); b.sprinkleStats(c, { ...b.statsOf(c), perCm2: 0.02, sig: 0.3, wk: 1 }, { anim: 0.4, jitter: 0.45 }); });
      // 4. Gall last: fine clear spots inside the drops, 2 per cm², d50 2.5 mm, a few to 8 mm.
      b.sprinkleStats(-1, { perCm2: 0.8, d50: 2.5, sig: 0.6, wk: 1.3 }, { style: STYLE.CLEAR, anim: 1.2 });
      // 5. The stylus. Five free sweeps 40–90 mm long with a wake 6–9 mm wide draw the drops into 50–60 mm teardrops (the
      //    "light combing" of the catalogue is the bundles of filaments beside each sweep).
      const L = 8 + 8 * p.viscosity;
      for (let i = 0; i < 7; i++) {
        const x = (h(7 * i) - 0.5) * p.sheetW, y = (h(7 * i + 1) - 0.5) * p.sheetH;
        const a = ((-75 + (h(7 * i + 2) - 0.5) * 80) * Math.PI) / 180 + (p.animate ? 0.08 * Math.sin(0.1 * p.time + i) : 0), len = 50 + 60 * h(7 * i + 3);
        b.stroke(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, L);
      }
      //    Its curls are hooks (dp 97 at 600 dpi): the same sweep bent through half to three-quarters of a turn on a radius
      //    of 12–20 mm, the paint dragged along the arc with the sweep's wake, not a disc wound into rings. One to three
      //    per sheet, 65–95 mm apart, all turning the same way. An arc is a chain of short strokes.
      const n = 1 + Math.floor(h(50) * 2), sgn = h(51) < 0.5 ? 1 : -1;   // one or two per sheet width (three overflowed the op chain)
      for (let i = 0; i < n; i++) {
        const cx = (h(70 + i) - 0.5) * p.sheetW * 0.7, cy = (h(80 + i) - 0.5) * p.sheetH * 0.8;
        const R = (15 + 10 * h(90 + i)) * p.curlStrength, a0 = h(100 + i) * 2 * Math.PI, sweep = sgn * Math.PI * (1.1 + 0.6 * h(110 + i));
        const segs = Math.max(3, Math.ceil(Math.abs(sweep) / (Math.PI / 4)));
        for (let k = 0; k < segs; k++) {
          const t0 = a0 + (sweep * k) / segs, t1 = a0 + (sweep * (k + 1)) / segs;
          b.stroke(cx + R * Math.cos(t0), cy + R * Math.sin(t0), cx + R * Math.cos(t1), cy + R * Math.sin(t1), L * 1.4);
        }
      }
      return b.drift().scene(); } },

  { name: "Antique straight", streaks: "h", group: "Sprinkled", palette: "antique19", palettes: ["antique19", "dp125"], terms: ["antique straight", "antique"], defaults: { ...D19, viscosity: 0.3, stretchLimit: 1e5, drift: 0 }, note: "A Feather pattern completed, then a shower of fine dots, usually white, over the whole bath (Wolfe; dp 125, 131).",
    build: (p, pal) => { const b = new Builder(p, pal); const round = roundColours(pal); featherBase(b, round);
      for (const c of round) b.sprinkleStats(c, b.statsOf(c), { anim: 0.6 });   // the shower of fine dots
      if (!round.length && !hasWhiteSpot(pal)) b.sprinkleStats(pal.white, b.statsOf(pal.white, { perCm2: 2.3, d50: 1.6, wk: 0.9 }), { anim: 0.6 });
      return b.drift().scene(); } },

  { name: "Zebra", streaks: "v", group: "Sprinkled", palette: "dp61", palettes: ["dp61", "antique19"], terms: ["zebra"], defaults: { ...D19, stretchLimit: 1e5, drift: 0 }, note: "Turkish base; a comb with one set of teeth drawn through twice, down and back up with the second pass halving the first, pulls the colours into long flowing bands (gezogener Achat); then one or more colours sprinkled or splashed on as large drops that sit on the bands (Wolfe and Miura; dp 15, 386).",
    build: (p, pal) => { const b = new Builder(p, pal); const round = roundColours(pal);
      const pale = zebraBase(b, round);
      // The large final drops. On dp 15 and 386 they are the sheet's most abundant pale colour, which the mixture
      // model labelled the ground: it is thrown again last as large even drops that sit on the bands.
      for (const c of round) b.sprinkleStats(c, b.statsOf(c), { anim: 0.7 });
      if (pale !== undefined) b.sprinkleStats(pale, { perCm2: 0.05, d50: 19, sig: 0.3, wk: 2.5 }, { anim: 0.7 });   // ~a quarter of the sheet, 12–25 mm (dp 15: 26 %)
      return b.drift().scene(); } },

  { name: "Gloster (Partridge eye)", streaks: "v", group: "Dispersant", palette: "gloster19", palettes: ["gloster19", "dp71", "dp91", "dp330", "dp87"], terms: ["gloster", "gloucester", "partridge"], defaults: { ...D19, stretchLimit: 1e5, drift: 0 }, note: "A Zebra: Turkish base, a comb with widely set teeth drawn down and back up, halving, into long flowing bands; then one colour mixed with turpentine thrown as large drops that sit on the bands, the dispersant opening very fine paper spots inside them (Miura; dp 65, 71, 91).",
    build: (p, pal) => { const b = new Builder(p, pal);
      // The turpentine colour: `special` where the analysis found the holes, else the last spot (gloster19: the pale blue,
      // the one colour whose spots stayed round on dp 65).
      const sp = pal.special ?? pal.spots[pal.spots.length - 1];
      // the analysis usually also files the drop with its speckle as a paler variant of the same hue: that is not a colour
      // to throw (dp 65: "blue 2", the navy drops seen with their paper openings at scan resolution)
      const rgbOf = (c: number) => [1, 3, 5].map((i) => parseInt(pal.pigments[c].hex.slice(i, i + 2), 16));
      const hue = (c: number) => { const [r, g, bb] = rgbOf(c); return (Math.atan2(Math.sqrt(3) * (g - bb), 2 * r - g - bb) * 180) / Math.PI; };
      const paleTwin = pal.spots.filter((c) => c !== sp && Math.abs((((hue(c) - hue(sp)) % 360) + 540) % 360 - 180) < 35 && luma(pal.pigments[c].hex) > luma(pal.pigments[sp].hex) + 0.12);
      const round = roundColours(pal).filter((c) => c !== sp && !paleTwin.includes(c));
      // Zebra base, still: ground film and the other colours as few large drops, drawn twice by a wide comb into long
      // bands with quill bundles ~30 mm apart (dp 15 and dp 65 alike; dp 65's lines are half as wide, which the fitted
      // sizes carry).
      const pale = zebraBase(b, [sp, ...round, ...paleTwin], { spacing: 30, sizeMul: 2, densityMul: 0.8 }); // small dense spots: the comb draws them into the 0.3–1.5 mm hair lines on the maroon ground of dp 65, not into Zebra's broad bands
      for (const c of round) b.sprinkleStats(c, b.statsOf(c), { anim: 0.7 });
      if (pale !== undefined) b.sprinkleStats(pale, { perCm2: 0.05, d50: 19, sig: 0.3, wk: 2.5 }, { anim: 0.7 });
      // The turpentine colour last, as Zebra's large drops: dp 65 0.25 per cm², equivalent diameter median 6 mm, area-
      // weighted 23, max 32 (dp 71: 0.09 per cm², median 11, max 62). Not the palette's fragment statistics, which merge
      // the base share of the colour with the speckle. styleParam 1 ≈ 35 % openings (measured 30–36 %).
      b.sprinkleStats(sp, { perCm2: 0.25, d50: 11, sig: 0.6, wk: 1.4 }, { style: STYLE.PARTRIDGE, styleParam: 1, anim: 0.7 });
      return b.drift().scene(); } },

  { name: "Schrottel", group: "Dispersant", palette: "schrottel19", palettes: ["schrottel19", "dp105"], terms: ["schrottel", "scrotel", "schrot"], defaults: { ...D19 }, note: "Turkish on a black ground, then an ox-gall-and-oil mixture thrown: grey discs on a jittered lattice that merge into loose agglomerations, and a shower of shot-like dark eyes in paper halos, a few large, most tiny (Miura; dp 76).",
    build: (p, pal) => { const b = new Builder(p, pal);
      const all = laidColours(pal);
      const shot = pal.special ?? all.reduce((a, c) => ((pal.pigments[c].frac ?? 0) > (pal.pigments[a].frac ?? 0) ? c : a), all[0]);
      const rest = all.filter((c) => c !== shot);
      const ground = rest.length ? darkestGround(pal, rest) : pal.background;
      const paper = pal.paperPct ?? 0;
      // Black ground as a film; red and yellow as plain Turkish spots: they end up as 0.5–3 mm veins in the black channels.
      b.turkish({ cell: 14, spots: 0, ground, gallDots: false, bgFill: paper > 3 ? Math.max(0.2, 1 - paper / 100) : undefined, bgR: paper > 3 ? 0.62 : undefined });
      for (const c of rest) if (c !== ground) { ensureStats(pal, c, 3, 1); b.sprinkleStats(c, b.statsOf(c)); }
      // The shot mixture: plain rounded discs on a jittered ~15 mm lattice (dp 76: 0.43 per cm², nearest-neighbour CV 0.29,
      // Clark–Evans 1.4), median 8.5 mm, p90 16 mm, up to 30 mm. Where the jitter brings neighbours together they merge into
      // loose agglomerations of 2–6 discs; elsewhere 1–4 mm of black shows. No rim halo, no eyes of their own.
      b.sprinkleStats(shot, { perCm2: 0.43, d50: 8.2, sig: 0.5, wk: 1.8 }, { jitter: 0.46, anim: 0.8 });
      // The eyes are the gall-and-oil shower itself, Poisson at every size (Clark–Evans ≈ 1.0): heavy-tailed cores (median
      // 0.5 mm, 1 % over 1.9 mm, max 4.5 mm) in a paper halo of outer diameter 0.55 mm + 2 × core. Two thinned lattices:
      // fine (2.5 per cm², halos 1.1–5 mm) and coarse (0.08 per cm² of cores ≥ 1.5 mm with 4–9 mm halos). The Christaller
      // look is the size hierarchy, not regular spacing of the big ones.
      b.sprinkle([ground], { cell: 3.3, r: 0.235, fill: 0.28, jitter: 0.5, shape: 1.0, floorMm: 1.1, style: STYLE.EYE, styleParam: 0.42, small: true, gapFill: 0, anim: 1.2 });
      b.sprinkle([ground], { cell: 24, r: 0.094, fill: 0.22, jitter: 0.5, shape: 1.2, floorMm: 3.5, style: STYLE.EYE, styleParam: 0.42, gapFill: 0, anim: 1.0 });
      return b.drift().scene(); } },

  { name: "Shell", group: "Dispersant", palette: "shell19", palettes: ["shell19", "dp111", "dp118", "dp137", "dp61", "guyot20"], terms: ["shell", "oil"], defaults: { ...D19 }, note: "Final dominant colour mixed with oil: white outline, darker centre.",
    build: (p, pal) => { const b = new Builder(p, pal); b.turkish({ cell: 15, lastStyle: STYLE.HALO | STYLE.RINGED, lastParam: 1, fill: 0.85 }); return b.drift().scene(); } },

  { name: "Stormont", group: "Dispersant", palette: "dp13", palettes: ["dp13", "dp62"], terms: ["stormont"], defaults: { ...D19, gall: 1.15 }, note: "Turpentine in the last colour: lacy holes throughout.",
    build: (p, pal) => { const b = new Builder(p, pal);
      // The turpentine colour is the lacy one (measured hole fraction → `special`), otherwise the dominant network colour.
      const lacy = pal.special ?? pal.background; const pg = pal.pigments[lacy];
      if (!pg.d50) { pg.d50 = 12; pg.perCm2 = pg.perCm2 ?? 0.25; pg.wk = pg.wk ?? 0.7; } // give the fitter a handle on its size
      if (lacy === pal.background) b.turkish({ skipBackground: true, gallDots: false });
      else { b.turkish({ gallDots: false, spots: 0 }); for (const c of pal.spots) if (c !== lacy) b.sprinkleStats(c, b.statsOf(c), {}); }
      b.sprinkleStats(lacy, b.statsOf(lacy, { perCm2: 0.25, d50: 12, wk: 0.7 }), { style: STYLE.LACY, styleParam: 1 }); // thrown last over most of the bath
      return b.drift().scene(); } },
  { name: "Tiger (Sun spot)", group: "Dispersant", palette: "g162", palettes: ["g162", "g163", "schrottel19"], terms: ["tiger", "sun spot"], defaults: { ...D19 }, note: "Two or three colours, then black with kreolin/potash: eyes with radiating rays.",
    build: (p, pal) => { const b = new Builder(p, pal);
      // The ground is the darkest colour (the catalogue's "black"), whatever the sheet analysis called the ground; the
      // eyes are the dominant remaining colour and its shades, thrown last with the tiger mixture; the rest are plain spots.
      const all = laidColours(pal);
      const ground = darkestGround(pal, all);
      const rest = all.filter((c) => c !== ground);
      const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const eye = rest.reduce((a, c) => ((pal.pigments[c].frac ?? 0) > (pal.pigments[a].frac ?? 0) ? c : a), rest[0]);
      const near = (c: number) => Math.hypot(...rgb(pal.pigments[c].hex).map((v, i) => v - rgb(pal.pigments[eye].hex)[i])) < 70;
      b.turkish({ cell: 16, spots: 0, ground, gallDots: false });
      const eyes = rest.filter((c) => c === eye || near(c)), plain = rest.filter((c) => !eyes.includes(c));
      for (const c of plain) { ensureStats(pal, c, 3, 1); b.sprinkleStats(c, b.statsOf(c)); }
      for (const c of eyes) { ensureStats(pal, c, 8, 0.5); b.sprinkleStats(c, b.statsOf(c, { perCm2: 0.5, d50: 8 }), { style: STYLE.TIGER, styleParam: 1 }); }
      return b.drift().scene(); } },

  { name: "Dahlia", streaks: "v", group: "Dispersant", palette: "dp352", palettes: ["dp352"], terms: ["dahlia"], defaults: { ...D19, stretchLimit: 1e5, drift: 0 }, note: "A Zebra base; then a colour mixed with ox gall thrown on: large drops that push the bands aside, gall opening pale spots inside them; then a second colour swirled on through a sieve and a third lightly sprinkled (Miura; dp 352).",
    build: (p, pal) => { const b = new Builder(p, pal);
      // The dahlias are the big round drops (least elongated, largest coverage); paler round drops thrown after them sit on top.
      const round = roundColours(pal);
      const teal = pal.special ?? (round.length ? round.reduce((a, c) => ((pal.pigments[c].frac ?? 0) > (pal.pigments[a].frac ?? 0) ? c : a), round[0]) : pal.spots[pal.spots.length - 1]);
      const pale = zebraBase(b, round.length ? round : [teal]);
      // the dahlias: gall-heavy drops thrown onto the combed bath push the bands aside; gall opens pale spots inside them.
      // A moderate size spread with satellites round the large drops, lumpy outlines and a wide jitter so that
      // neighbours overlap and merge into lobed clusters (dp 352).
      b.sprinkleStats(teal, { ...b.statsOf(teal), wk: 1.1, sig: 0.3 }, { style: STYLE.GALLDOTS, styleParam: 1, anim: 0.8, wobble: 2.5, jitter: 0.6 });
      for (const gb of round) if (gb !== teal) b.sprinkleStats(gb, b.statsOf(gb)); // pale blobs swirled on through the sieve
      if (pale !== undefined) b.sprinkleStats(pale, { perCm2: 0.05, d50: 19, sig: 0.3, wk: 2.5 }, { anim: 0.7 });
      if (!hasWhiteSpot(pal)) b.sprinkleStats(pal.white, b.statsOf(pal.white, { perCm2: 0.8, d50: 1.2, wk: 1.0 }), { anim: 1.2 });   // the light sprinkle
      return b.drift().scene(); } },
  { name: "Spanish", group: "Transfer", palette: "spanish19", palettes: ["spanish19", "dp322", "dp246", "dp143", "dp295"], terms: ["spanish"], defaults: { ...D19, transferAmp: 1 }, note: "Turkish; the paper is rocked as it is laid: diagonal shaded ripples.",
    build: (p, pal) => { const b = new Builder(p, pal); turkishBase(b); b.drift(); b.shear(35, 0.9, 5.5, 0);
      return b.scene({ transfer: { mode: 1, amp: 0.6, wavelength: 5.5, angle: 35, phase: 0, wobble: 0.35 } }); } },

  { name: "Spanish moiré", group: "Transfer", palette: "spanishred19", palettes: ["spanishred19", "dp150", "dp384"], terms: ["spanish moir", "moir"], defaults: { ...D19, transferAmp: 1 }, note: "Paper folded and laid with side-to-side movement: curvilinear ripple sets.",
    build: (p, pal) => { const b = new Builder(p, pal); turkishBase(b); b.drift(); b.shear(30, 0.8, 7, 0); b.shear(-40, 0.6, 9, 1);
      return b.scene({ transfer: { mode: 2, amp: 0.55, wavelength: 7, angle: 30, phase: 0, wobble: 0.9 } }); } },

  { name: "Extra (Drag)", group: "Transfer", palette: "extra19", palettes: ["extra19"], terms: ["extra", "drag"], defaults: { ...D19 }, note: "Turkish; the paper is dragged forward as it is laid: elongated spots.",
    build: (p, pal) => { const b = new Builder(p, pal); turkishBase(b); b.drift(); b.stretch(70, 1.7);
      return b.scene({ transfer: { mode: 3, amp: 0.35, wavelength: 3, angle: 70, phase: 0, wobble: 0.5 } }); } },

  { name: "Polnisch", group: "Transfer", palette: "dp353", palettes: ["dp353"], terms: ["polnisch", "polish"], defaults: { ...D19 }, note: "Colours raked into long straight lines; paper laid with small back-and-forth movements.",
    build: (p, pal) => { const b = new Builder(p, pal); b.turkish({ cell: 12, ...COMBED }); b.comb(-90, 7, { ripple: 3 }); b.drift(); b.shear(0, 0.5, 2.6, 0);
      return b.scene({ transfer: { mode: 4, amp: 0.45, wavelength: 2.6, angle: 0, phase: 0, wobble: 0.2 } }); } },

  { name: "Fantasy", group: "Free", palette: "dp60", palettes: ["dp60", "guyot20"], terms: ["fantasy", "fancy", "comb"], defaults: { ...D20, viscosity: 0.8 }, note: "Thin size; a stylus draws the colours into free shapes (Oseen short strokes).",
    build: (p, pal) => { const b = new Builder(p, pal); b.turkish({ cell: 18, ringed: true });
      for (let i = 0; i < 10; i++) { const x = (hash01(p.seed, i * 5) - 0.5) * p.sheetW, y = (hash01(p.seed, i * 5 + 1) - 0.5) * p.sheetH; const a = hash01(p.seed, i * 5 + 2) * Math.PI * 2 + (p.animate ? 0.1 * Math.sin(0.1 * p.time + i) : 0); const len = 18 + 26 * hash01(p.seed, i * 5 + 3);
        b.stroke(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 5 + 8 * p.viscosity); }
      return b.drift().scene(); } },

  { name: "Romantic (Broken)", group: "Free", palette: "dp203", palettes: ["dp203", "dp16"], terms: ["romantic", "broken", "gravel"], defaults: { ...D18 }, note: "Caustic vein colours under a ground that breaks up chemically.",
    build: (p, pal) => { const b = new Builder(p, pal); b.turkish({ cell: 16, lastStyle: STYLE.BROKEN, lastParam: 1, fill: 0.85 }); return b.drift().scene(); } },

  { name: "Morris (wet paper)", group: "Free", palette: "dp280", palettes: ["dp280"], terms: ["morris"], defaults: { ...D20, viscosity: 0.9, bleed: 0.4, edgeDark: 0.05 }, note: "Colours dropped on wetted paper: soft watercolour edges, no size.",
    build: (p, pal) => { const b = new Builder(p, pal);
      for (const c of [pal.background, ...pal.spots]) b.sprinkleStats(c, b.statsOf(c, { perCm2: 0.3, d50: 12, wk: 0.8 }), { style: STYLE.SOFT, styleParam: 1 });
      return b.drift().scene({ softPaper: 1 }); } },
  { name: "Double marble (Italian on Turkish)", group: "Layered", palette: "dp63", palettes: ["dp63", "italian19"], terms: ["double marble", "amercian"], defaults: { ...D19, viscosity: 0.5 }, note: "Two marblings on one sheet; the first shows through the second's bare gaps.",
    build: (p, pal) => { const u = new Builder({ ...p, seed: p.seed + 101 }, pal); u.turkish({ cell: 16, ringed: true }); u.drift();
      const b = new Builder(p, pal); b.sprinkle([pal.spots[0]], { cell: 16, r: 0.45, fill: 0.6 }); b.sprinkle([-1], { cell: 4.5, r: 0.5, fill: 0.95, style: STYLE.CLEAR }); b.drift();
      return b.scene({ under: { ops: u.ops, layers: u.layers, mode: 1, groundFill: u.groundFill } }); } },

  { name: "Gold vein overprinted on Spanish moiré", group: "Layered", palette: "dp138", palettes: ["dp138"], terms: ["gold vein overprinted on spanish", "gold vein overprinted", "gold vein overpinted"], defaults: { ...D19 }, note: "Marbled sheet with a lithographed gold vein network printed on top.",
    build: (p, pal) => { const b = new Builder(p, pal); turkishBase(b); b.drift(); b.shear(30, 0.8, 7, 0); b.shear(-40, 0.6, 9, 1);
      return b.scene({ transfer: { mode: 2, amp: 0.5, wavelength: 7, angle: 30, phase: 0, wobble: 0.9 }, goldNet: 1 }); } },

  { name: "Italian overprinted on Turkish", group: "Layered", palette: "dp63", palettes: ["dp63", "italian19"], terms: ["italian overprinted"], defaults: { ...D19, viscosity: 0.5 }, note: "Turkish sheet with an Italian vein pattern printed over it.",
    build: (p, pal) => { const u = new Builder({ ...p, seed: p.seed + 55 }, pal); u.turkish({ cell: 16, ringed: true }); u.drift();
      const b = new Builder(p, pal); b.sprinkle([pal.spots[0]], { cell: 18, r: 0.45, fill: 0.6 }); b.sprinkle([-1], { cell: 4.5, r: 0.5, fill: 0.95, style: STYLE.CLEAR }); b.drift();
      return b.scene({ under: { ops: u.ops, layers: u.layers, mode: 2, groundFill: u.groundFill } }); } },

  { name: "Papier croisé (Twilled)", group: "Pseudo", palette: "dp198", palettes: ["dp198"], terms: ["crois", "twill"], defaults: { ...D19, bleed: 0.25 }, note: "Paste colour on paper, lifted and shifted while wet: twill twists.",
    build: (p, pal) => { const b = new Builder(p, pal);
      for (const c of pal.spots) b.sprinkleStats(c, b.statsOf(c, { perCm2: 1.5, d50: 3 }), { style: STYLE.SOFT, styleParam: 0.5 });
      b.drift(); b.shear(45, 1.2, 4, 0); b.shear(-45, 1.2, 4, 1);
      return b.scene({ groundFill: pal.background, transfer: { mode: 5, amp: 0.5, wavelength: 4, angle: 45, phase: 0, wobble: 0.4 } }); } },
  { name: "Papier tourniquet", group: "Pseudo", palette: "dp375", palettes: ["dp375"], terms: ["tourniquet"], defaults: { ...D19, bleed: 0.2 }, note: "Coated paper sprinkled with marbling brushes: dispersed ink spots.",
    build: (p, pal) => { const b = new Builder(p, pal);
      for (const c of pal.spots) b.sprinkleStats(c, b.statsOf(c, { perCm2: 2, d50: 2.5 }), { style: STYLE.SOFT, styleParam: 1.2 });
      return b.drift().scene({ groundFill: pal.background }); } },
  { name: "Papier coulé (Trickle)", group: "Pseudo", palette: "dp326", palettes: ["dp326"], terms: ["coul", "trickle"], defaults: { ...D18, bleed: 0.25 }, note: "Thin paste, diluted colour sprinkled, board tilted: everything runs one way.",
    build: (p, pal) => { const b = new Builder(p, pal);
      for (const c of pal.spots) b.sprinkleStats(c, b.statsOf(c, { perCm2: 1.5, d50: 2.5 }), { style: STYLE.SOFT, styleParam: 0.8 });
      b.drift(); b.stretch(-80, 2.6);
      return b.scene({ groundFill: pal.background, transfer: { mode: 6, amp: 0.5, wavelength: 2.2, angle: -80, phase: 0, wobble: 0.6 } }); } },
  { name: "Gold vein overprinted on Turkish", group: "Layered", palette: "dp138", palettes: ["dp138", "nonpareil19"], terms: ["gold vein overprinted on turkish"], defaults: { ...D19 }, note: "Turkish sheet with a lithographed gold vein network.",
    build: (p, pal) => { const b = new Builder(p, pal); b.turkish({ cell: 14, ringed: true }); return b.drift().scene({ goldNet: 1 }); } },
];
