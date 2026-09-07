import { OP, STYLE, type Op } from "./ops";
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
  /** dominant streak orientation measured on the scan: degrees (0 = across the sheet, 90 = down it) and coherence 0..1 */
  streak?: [number, number];
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
  { key: "turkish17", name: "17th-c. Turkish: red, dark blue, dark green, blue, light blue, yellow", source: "dp 370", streak: [32.9, 0.017], paper: "#E2D2B2",
    pigments: [K(E(F("red", "#942E38", 30.8, 0.1, 2.03, 0.6, 0.96, 0.55), 2.79), 0.6), K(E(F("dark blue", "#2C3A55", 16, 0.3, 5, 0.9, 1, 0.4), 2.13), 0.88), K(E(F("dark green", "#2F4838", 16, 0.3, 5, 0.9, 1, 0.4), 2.13), 0.88), K(E(F("blue", "#485F8F", 5.9, 0.19, 2.74, 0.8, 0.92, 0.55), 2.61), 0.82), K(E(F("light blue", "#A6B2A9", 19.0, 0.27, 4.71, 0.9, 0.97, 0.55), 1.34), 1.04), K(E(F("yellow", "#D38E43", 4.5, 0.18, 3.58, 0.65, 1, 0.6), 2.72), 1.22), WHITE],
    background: 0, spots: [1, 2, 3, 5, 4], pack: { jitter: 0.26, sigma: 0.45 }, paperPct: 7.7, white: 6, laid: true }, // catalogue: "red, dark, medium and light blues, dark green and yellow"
  { key: "frenchcurl19", name: "19th-c. French curl on Turkish: maroon, cream, blue, olive", source: "dp 20", streak: [99.6, 0.061], paper: "#E6D8BC",
    pigments: [K(E(F("maroon", "#983D4A", 32.6, 1.51, 1.99, 0.6, 0.96, 0.55), 2.94), 0.76), K(E(F("indigo", "#39416E", 11.3, 1.54, 2.49, 0.46, 0.9, 0.55), 1.88), 1.01), K(E(F("olive", "#9D9574", 6.3, 0.75, 2.08, 0.5, 0.9, 0.6), 2.2), 0.99), K(E(F("cream", "#EFC9BB", 46.6, 3.76, 2.29, 0.56, 1, 0.4), 2.27), 0.86), WHITE, K(F("bronze", "#C69268", 0.2, 0.03, 1.4, 0.6, 0.9, 0.7), 0.85)],
    background: 0, spots: [1, 2, 3], paperPct: 2.9, white: 4, gold: 5 },
  { key: "spotcombed18", name: "18th-c. Spot combed: red, dark blue, olive, yellow", source: "dp 94", streak: [29.2, 0.333], paper: "#E4D3B0",
    pigments: [B("red", "#B15146", 18.3, 0.95, 0.5), F("dark blue", "#2A3546", 19.1, 0.8, 2.94, 0.8, 0.95, 0.45), F("olive", "#746647", 42.9, 1.2, 2.26, 0.77, 0.92, 0.6), F("yellow", "#D19D29", 17.4, 0.5, 2.49, 0.8, 1, 0.6), WHITE],
    background: 0, spots: [1, 2, 3], pack: { jitter: 0.26, sigma: 0.45 }, bg: { fill: 0.6, r: 0.6 }, paperPct: 2.3, white: 4, laid: true },
  { key: "placard18", name: "18th-c. Placard: red, dark blue, slate, ochre", source: "dp 97", streak: [70.3, 0.045], paper: "#E3D3B4",
    pigments: [K(E(F("red", "#C24542", 30.0, 0.2, 2.49, 0.6, 0.95, 0.5), 4.0), 0.63), K(F("dark blue", "#55434A", 2.8, 0.18, 1.73, 0.8, 0.95, 0.5), 0.6), K(E(F("slate", "#6A726D", 34.2, 0.11, 8.29, 1.0, 0.95, 0.55), 3.37), 0.87), F("ochre", "#DAA852", 5.9, 0.4, 2.33, 0.8, 1, 0.6), WHITE],
    background: 0, spots: [1, 2, 3], pack: { jitter: 0.26, sigma: 0.45 }, bg: { fill: 0.81, r: 0.56 }, paperPct: 27.1, white: 4, laid: true },
  { key: "serpentine19", name: "19th-c. Serpentine on Turkish: red, olive, blue, orange, cream", source: "dp 396", streak: [69.6, 0.15], paper: "#E4D3B0",
    pigments: [B("red", "#C73841", 51.0, 0.95, 0.5), F("indigo", "#684E8B", 9.6, 1.2, 1.76, 0.5, 0.9, 0.55), F("olive", "#997C57", 9.8, 1.7, 1.42, 0.54, 0.92, 0.6), F("orange", "#E87E64", 12.2, 3.1, 1.19, 0.38, 0.95, 0.5), F("cream", "#FDB492", 16.2, 2.0, 1.19, 0.45, 1, 0.4), WHITE],
    background: 0, spots: [1, 2, 3, 4], paperPct: 1.2, white: 5 },
  { key: "spanish19", name: "19th-c. Spanish on Turkish: crimson, yellow, teal, umber", source: "dp 165", streak: [103.8, 0.062], paper: "#DCCBAA",
    pigments: [K(E(F("crimson", "#B35245", 6.1, 0.2, 0.94, 0.6, 0.95, 0.5), 3.14), 0.79), K(E(F("yellow", "#B68E37", 7.0, 0.24, 2.81, 0.75, 1, 0.6), 3.89), 0.82), K(E(F("dark teal", "#394237", 23.3, 0.24, 4.43, 0.9, 0.96, 0.5), 2.79), 0.75), K(E(F("umber", "#69412E", 29.0, 0.39, 2.87, 1.0, 0.96, 0.6), 2.38), 0.6), WHITE],
    background: 0, spots: [1, 2, 3], bg: { fill: 0.4, r: 0.46 }, paperPct: 34.6, white: 4 },
  { key: "nonpareil19", name: "19th-c. Nonpareil: red, black, blue, ochre, cream", source: "dp 82", streak: [83.7, 0.113], paper: "#E9DDC2",
    pigments: [B("red", "#841710", 23.3, 0.96, 0.5), F("black", "#4C3932", 28.7, 1.4, 2.6, 0.66, 1, 0.4), F("blue", "#194A7A", 11.1, 0.9, 1.59, 0.58, 0.92, 0.55), F("ochre", "#D48F46", 4.8, 1.2, 0.97, 0.64, 1, 0.6), F("cream", "#D6C187", 16.8, 2.0, 1.24, 0.5, 1, 0.4), WHITE, K(E(F("bronze", "#B07F57", 14.8, 0.46, 3.26, 0.6, 0.9, 0.7), 1.8), 0.88)],
    background: 0, spots: [1, 2, 3, 4], paperPct: 0.5, white: 5, gold: 6 },
  { key: "peacock19", name: "19th-c. Peacock: periwinkle, crimson, gold, green, cream", source: "dp 144", streak: [81.3, 0.201], paper: "#E3D3B4",
    pigments: [B("maroon", "#945D68", 10.5, 0.96, 0.55), F("grey", "#787BA1", 48.2, 4.1, 3.31, 0.4, 0.95, 0.6), F("green", "#788157", 6.5, 2.1, 0.95, 0.69, 0.92, 0.6), F("crimson", "#901125", 5.7, 0.5, 1.57, 0.61, 0.95, 0.5), F("gold", "#C19133", 8.1, 0.7, 1.7, 0.61, 1, 0.6), F("pink-white", "#ADA08E", 21.0, 2.3, 1.31, 0.59, 1, 0.4), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5], paperPct: 0.0, white: 6 },
  { key: "gloster19", name: "19th-c. Gloster: maroon, black, ochre, blue", source: "dp 65", streak: [86.1, 0.055], paper: "#E4D6BA",
    pigments: [K(E(F("maroon", "#5C071A", 35.1, 0.93, 2.16, 0.6, 0.96, 0.55), 3.5), 0.69), K(E(F("black", "#432A41", 20.2, 1.86, 2.57, 0.44, 1, 0.4), 4.87), 0.82), K(E(F("ochre", "#C88957", 5.7, 0.6, 1.91, 0.45, 1, 0.6), 4.62), 0.9), K(E(F("blue", "#44518D", 34.9, 1.25, 1.84, 0.6, 0.92, 0.6), 1.79), 0.75), WHITE],
    background: 0, spots: [1, 2, 3], paperPct: 4.0, white: 4 },
  { key: "gloster18", name: "18th-c. Gloster: dark teal, pink-red, tan", source: "dp 330", streak: [100.5, 0.067], paper: "#DCC9A6",
    pigments: [{ ...P("dark teal", "#22403F", 0.96, 0.5, 1), frac: 60.9 }, K(E(F("pink-red", "#9C513E", 13.6, 0.53, 2.26, 0.8, 0.95, 0.5), 2.46), 0.72), K(E(F("tan", "#A88363", 23.9, 1.38, 2.23, 0.8, 0.97, 0.6), 2.0), 0.8), WHITE],
    background: 0, spots: [1, 2], paperPct: 1.6, white: 3, laid: true },
  { key: "schrottel19", name: "19th-c. Schrottel: black, crimson, yellow, grey", source: "dp 76", streak: [48.2, 0.015], paper: "#E2D3B6",
    pigments: [{ ...P("black", "#1B1816", 1, 0.45, 1), frac: 19.1 }, K(E(F("crimson", "#6F161A", 10.7, 0.7, 3.47, 0.7, 0.95, 0.5), 2.44), 0.85), K(E(F("yellow", "#B79A2D", 7.6, 0.4, 2.78, 0.7, 1, 0.6), 2.69), 0.87), K(E(F("grey", "#686554", 54.6, 1.68, 2.25, 0.7, 0.95, 0.65), 1.57), 0.75), WHITE],
    background: 0, spots: [1, 2, 3], paperPct: 8.0, white: 4 },
  { key: "antique19", name: "19th-c. Antique straight: red, blue, ochre, black, white", source: "dp 131", streak: [86.9, 0.538], paper: "#E7DABD",
    pigments: [B("red", "#991D21", 31.4, 0.96, 0.5), F("black", "#32283A", 16.0, 1.4, 2.3, 0.66, 1, 0.4), F("blue", "#112265", 6.5, 0.9, 1.53, 0.58, 0.92, 0.55), F("maroon", "#89413C", 22.3, 0.8, 2.23, 0.6, 0.96, 0.55), F("ochre", "#BF762E", 13.0, 1.2, 1.47, 0.64, 1, 0.6), F("white", "#D9BAA2", 9.5, 2.3, 1.32, 0.44, 0.97, 0.3)],
    background: 0, spots: [1, 2, 3, 4], paperPct: 1.3, white: 5 },
  { key: "shell19", name: "19th-c. Shell: dark teal, crimson, cream, umber", source: "dp 88", streak: [28.9, 0.004], paper: "#E3D2AF",
    pigments: [K(E(F("dark teal", "#2F2920", 20.8, 1.22, 0.71, 0.6, 0.95, 0.5), 2.21), 0.72), K(E(F("crimson", "#913434", 5.3, 0.61, 3.45, 0.5, 0.95, 0.5), 2.71), 1.05), K(E(F("cream", "#C99B6F", 4.9, 0.5, 2.66, 0.5, 1, 0.4), 2.35), 0.91), K(E(F("umber", "#724323", 68.8, 0.76, 5.2, 0.6, 0.97, 0.6), 1.6), 0.66), WHITE],
    background: 0, spots: [1, 2, 3], paperPct: 0.1, white: 4 },
  { key: "italian19", name: "19th-c. Italian: black and crimson veins", source: "dp 74", streak: [60.8, 0.03], paper: "#EADFC8",
    pigments: [K(E(F("black", "#342D23", 17.0, 1.09, 2.38, 0.6, 1, 0.4), 2.23), 0.87), K(E(F("crimson", "#BB4D53", 14.6, 0.76, 4.21, 0.64, 0.95, 0.5), 1.94), 0.87), WHITE],
    background: 0, spots: [1], paperPct: 68.4, white: 2 },
  { key: "spanishred19", name: "19th-c. Spanish moiré: red alone", source: "dp 152", streak: [52.2, 0.369], paper: "#E9D6BE",
    pigments: [{ ...P("red", "#B8282E", 0.95, 0.5, 1), frac: 93.3 }, WHITE],
    background: 0, spots: [], paperPct: 6.7, white: 1 },
  { key: "extra19", name: "19th-c. Extra: dark teal, blue, cream", source: "dp 120", streak: [58.7, 0.298], paper: "#E6DCC8",
    pigments: [K(E(F("dark teal", "#0A4247", 85.0, 0.13, 3.71, 0.6, 0.96, 0.5), 2.64), 0.6), K(E(F("blue", "#002364", 8.8, 0.42, 2.56, 0.67, 0.9, 0.55), 2.65), 0.87), K(E(F("cream", "#A0BEB0", 6.1, 0.39, 1.89, 0.63, 1, 0.4), 2.61), 0.87), WHITE],
    background: 0, spots: [1, 2], paperPct: 0.1, white: 3 },
  { key: "frenchcurl19b", name: "19th-c. French curl: slate, orange, red, cream", source: "dp 23", streak: [88.4, 0.167], paper: "#DFD2B4",
    pigments: [{ ...P("slate", "#4C6A6E", 0.95, 0.55, 1), frac: 29.6 }, K(E(F("red", "#8C3826", 4.5, 0.3, 2.39, 0.7, 0.95, 0.5), 2.33), 0.83), K(E(F("orange", "#C28852", 11.7, 0.5, 2.94, 0.8, 0.95, 0.5), 2.35), 0.9), F("cream", "#FFF9FB", 50.4, 1.5, 2.5, 0.7, 1, 0.4), WHITE],
    background: 0, spots: [1, 2, 3], paperPct: 3.8, white: 4 },
  // ---- curated from the extraction contact sheets (roles by eye; hexes, densities, sizes measured)
  { key: "dp172", name: "19th-c. Bouquet (dp 172): maroon, purple, slate, red-brown, pink", source: "dp 172", streak: [97.7, 0.182], paper: "#E4D4B8",
    pigments: [B("maroon", "#670007", 37.0, 0.96, 0.5), F("purple", "#651F57", 10.2, 0.65, 2.6, 0.58, 0.95, 0.5), F("slate", "#644036", 18.8, 0.63, 2.8, 0.68, 0.95, 0.5), F("red-brown", "#95403A", 18.8, 0.68, 2.17, 0.33, 0.95, 0.5), F("pink", "#C98977", 15.2, 1.58, 1.38, 0.51, 0.95, 0.5), WHITE],
    background: 0, spots: [1, 2, 3, 4], paperPct: 0.0, white: 5 },
  { key: "dp164", name: "19th-c. Serpentine (dp 164): maroon, black, purple, umber, orange, pink", source: "dp 164", streak: [172.0, 0.302], paper: "#E4D4B8",
    pigments: [B("maroon", "#530002", 59.9, 0.96, 0.5), F("black", "#24060B", 6.5, 0.83, 1.58, 0.48, 0.95, 0.5), F("purple", "#6C3B71", 7.7, 0.89, 1.35, 0.52, 0.95, 0.5), F("umber", "#833137", 12.6, 2.0, 1.13, 0.3, 0.95, 0.5), F("orange", "#B44E13", 3.8, 0.48, 1.28, 0.53, 0.95, 0.5), F("pink", "#D89A97", 9.4, 1.15, 1.16, 0.49, 0.95, 0.5), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5], paperPct: 0.0, white: 6 },
  { key: "dp156", name: "19th-c. French curl on Fountain (dp 156): red, black, teal, maroon, grey-blue, pink, yellow", source: "dp 156", streak: [164.7, 0.166], paper: "#E4D4B8",
    pigments: [B("red", "#79000E", 25.6, 0.96, 0.5), F("black", "#453D42", 14.4, 0.86, 2.98, 0.62, 0.95, 0.5), F("dark teal", "#244D5F", 15.4, 0.69, 2.4, 0.76, 0.95, 0.5), F("maroon", "#70282F", 13.4, 1.56, 1.39, 0.37, 0.95, 0.5), F("grey-blue", "#677E98", 18.8, 0.62, 2.61, 0.88, 0.95, 0.5), F("pink", "#A7725B", 5.9, 0.35, 1.63, 0.32, 0.95, 0.5), F("yellow", "#B49397", 3.4, 0.47, 1.02, 0.61, 0.95, 0.5), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5, 6], paperPct: 3.1, white: 7 },
  { key: "dp21", name: "19th-c. French curl on Nonpareil (dp 21): faded tan, maroon, grey, violet, yellow, cream", source: "dp 21", streak: [109.4, 0.051], paper: "#E8DDD0",
    pigments: [B("tan", "#C79E9E", 15.2, 0.96, 0.5), F("maroon", "#A33C46", 9.3, 1.64, 1.25, 0.28, 0.95, 0.5), F("grey", "#81717C", 8.7, 0.88, 1.58, 0.36, 0.95, 0.5), F("violet", "#8A81C9", 11.2, 1.64, 1.27, 0.38, 0.95, 0.5), F("yellow", "#BF9465", 7.7, 1.42, 1.03, 0.36, 0.95, 0.5), F("cream", "#DCC5C0", 16.9, 0.61, 1.82, 0.22, 0.95, 0.5), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5], bg: { fill: 0.4, r: 0.53 }, paperPct: 31.0, white: 6 },
  { key: "dp125", name: "19th-c. Antique straight (dp 125): red, indigo, maroon, grey, tan, yellow, white", source: "dp 125", streak: [174.8, 0.597], paper: "#E5D3B8",
    pigments: [B("red", "#A1151E", 31.3, 0.96, 0.5), F("indigo", "#1E3462", 20.7, 1.75, 2.1, 0.62, 0.95, 0.5), F("maroon", "#7C2F3B", 18.5, 1.0, 1.75, 0.43, 0.95, 0.5), F("dark grey", "#574C61", 9.4, 1.18, 1.35, 0.36, 0.95, 0.5), F("tan", "#B97358", 8.0, 0.17, 2.16, 0.39, 0.95, 0.5), F("yellow", "#D5A343", 6.6, 0.43, 1.59, 0.68, 0.95, 0.5), F("white", "#F0CDB9", 5.1, 1.32, 1.45, 0.43, 0.97, 0.3)],
    background: 0, spots: [1, 2, 3, 4, 5], paperPct: 0.4, white: 6 },
  { key: "dp61", name: "19th-c. Shell on Zebra (dp 61): umber, dark olive, coral, tan", source: "dp 61", streak: [86.1, 0.364], paper: "#E6D8C0",
    pigments: [B("umber", "#AA6B57", 62.6, 0.96, 0.5), F("dark olive", "#66452F", 9.8, 1.2, 1.63, 0.44, 0.95, 0.5), F("coral", "#CE6F5F", 16.4, 1.98, 1.29, 0.56, 0.95, 0.5), F("tan", "#DA8F68", 8.8, 2.51, 0.87, 0.47, 0.95, 0.5), F("white", "#EEE7D7", 3, 0.5, 1.45, 0.6, 0.97, 0.3)],
    background: 0, spots: [1, 2, 3], paperPct: 0.0, white: 4, special: 3 },
  { key: "dp330", name: "18th-c. Gloster (dp 330): dark olive, pink-red, speckled tan, peach", source: "dp 330", streak: [100.5, 0.067], paper: "#DCC9A6",
    pigments: [K(E(F("dark olive", "#4A3F2E", 49.4, 0.71, 2.14, 0.6, 0.96, 0.5), 2.11), 0.65), K(E(F("pink-red", "#904E3B", 11.9, 0.61, 2.17, 0.64, 0.95, 0.5), 2.61), 0.74), K(E(F("tan", "#8F785C", 28.6, 1.29, 2.11, 0.61, 0.95, 0.5), 2.06), 0.74), K(E(F("peach", "#D5916C", 9.5, 0.41, 2.04, 0.62, 0.95, 0.5), 2.72), 0.67), WHITE],
    background: 0, spots: [1, 2, 3], paperPct: 0.6, white: 4, special: 2, laid: true },
  { key: "dp71", name: "19th-c. Gloster (dp 71): slate, black, umber, red, yellow, speckled grey", source: "dp 71", streak: [1.9, 0.12], paper: "#D6D4C8",
    pigments: [K(E(F("slate", "#44585F", 20.2, 1.24, 1.73, 0.6, 0.96, 0.5), 3.25), 0.7), K(E(F("black", "#232528", 14.0, 0.54, 1.95, 0.62, 0.95, 0.5), 4.4), 0.69), K(E(F("umber", "#845946", 16.5, 1.42, 1.71, 0.41, 0.95, 0.5), 5.23), 0.76), K(E(F("red", "#AD3437", 14.4, 0.37, 2.61, 0.82, 0.95, 0.5), 3.22), 0.7), K(E(F("yellow", "#C5A244", 11.8, 0.23, 4.54, 0.94, 0.95, 0.5), 3.73), 0.86), K(E(F("grey", "#A5ADAA", 19.8, 1.52, 1.98, 0.5, 0.95, 0.5), 1.86), 0.77), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5], bg: { fill: 1, r: 1 }, paperPct: 3.2, white: 6, special: 5 },
  { key: "dp91", name: "19th-c. Gloster (dp 91): dark grey, black, red-brown, ochre, speckled grey, yellow", source: "dp 91", streak: [71.7, 0.107], paper: "#C9C4A2",
    pigments: [K(E(F("dark grey", "#585F50", 26.9, 0.51, 1.98, 0.6, 0.96, 0.5), 4.83), 0.66), K(E(F("black", "#3A3B38", 23.1, 2.6, 1.74, 0.45, 0.95, 0.5), 1.87), 0.81), K(E(F("red-brown", "#A64E36", 4.2, 0.21, 3.14, 0.71, 0.95, 0.5), 5.28), 1.03), K(E(F("ochre", "#8E6D4A", 5.5, 0.56, 1.69, 0.41, 0.95, 0.5), 6.39), 0.83), K(E(F("grey", "#9B997B", 33.2, 5.41, 1.7, 0.5, 0.95, 0.5), 2.05), 0.85), K(E(F("yellow", "#C7B965", 6.3, 0.31, 1.86, 0.7, 0.95, 0.5), 5.52), 0.66), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5], bg: { fill: 0.79, r: 0.69 }, paperPct: 0.8, white: 6, special: 4 },
  { key: "dp105", name: "19th-c. Schrottel (dp 105): yellow-tan, black, dark brown, olive, ochre", source: "dp 105", streak: [176.6, 0.045], paper: "#E8DCC2",
    pigments: [K(E(F("yellow-tan", "#D8B870", 65.6, 2.07, 2.47, 0.6, 0.96, 0.5), 1.52), 0.77), K(E(F("black", "#252C3B", 3.5, 0.78, 1.68, 0.26, 0.95, 0.5), 1.98), 1.08), K(F("dark brown", "#3C2602", 8.6, 1.02, 1.52, 0.24, 0.95, 0.5), 1.0), F("olive", "#7D6A3A", 6.9, 0.5, 2.78, 0.4, 0.95, 0.5), K(E(F("ochre", "#AF9251", 15.2, 0.92, 1.65, 0.5, 0.95, 0.5), 1.47), 0.81), WHITE],
    background: 0, spots: [1, 2, 3, 4], paperPct: 0.2, white: 5, special: 4 },
  { key: "dp111", name: "19th-c. Shell (dp 111): blue, grey-blue cells, pink", source: "dp 111", streak: [1.7, 0.01], paper: "#C9E0DC",
    pigments: [K(E(F("blue", "#16639A", 68.5, 2.1, 2.46, 0.6, 0.96, 0.5), 1.71), 0.72), K(E(F("grey-blue", "#62A1BE", 20.9, 2.67, 1.62, 0.4, 0.95, 0.5), 2.07), 0.86), K(E(F("pink", "#95929F", 6.8, 0.77, 2.04, 0.43, 0.95, 0.5), 2.36), 0.78), WHITE],
    background: 0, spots: [1, 2], paperPct: 3.8, white: 3, special: 1 },
  { key: "dp118", name: "19th-c. Shell (dp 118): grey-green, dark grey, blue, cream cells", source: "dp 118", streak: [175.9, 0.094], paper: "#E4E4CC",
    pigments: [K(E(F("grey-green", "#6A7A6C", 44.8, 2.05, 2.3, 0.6, 0.96, 0.5), 1.89), 0.76), K(E(F("dark grey", "#404F4B", 30.4, 2.06, 2.26, 0.6, 0.95, 0.5), 1.97), 0.86), K(E(F("blue", "#3E6C92", 2.6, 0.19, 2.66, 0.61, 0.95, 0.5), 4.67), 0.86), K(E(F("cream", "#AFBAA4", 17.3, 1.91, 1.78, 0.41, 0.95, 0.5), 2.68), 0.87), WHITE],
    background: 0, spots: [1, 2, 3], paperPct: 4.9, white: 4, special: 3 },
  { key: "dp13", name: "19th-c. Shell on Stormont (dp 13): lacy orange, black, grey, brown, tan", source: "dp 13", streak: [162.1, 0.076], paper: "#E8CDB0",
    pigments: [K(E(F("orange", "#C66244", 65.5, 0.49, 6.8, 0.6, 0.96, 0.5), 1.91), 0.74), K(E(F("black", "#1D1C27", 9.7, 0.52, 4.92, 0.71, 0.95, 0.5), 2.14), 0.71), K(F("grey", "#6B5B56", 5.8, 0.29, 4.49, 0.3, 0.95, 0.5), 0.99), K(F("brown", "#B48065", 3.3, 0.09, 4.69, 0.31, 0.95, 0.5), 0.94), K(E(F("tan", "#E69570", 11.4, 1.15, 3.05, 0.33, 0.95, 0.5), 2.59), 0.87), WHITE],
    background: 0, spots: [1, 2, 3, 4], paperPct: 4.3, white: 5 },
  { key: "dp62", name: "19th-c. Shell on Stormont (dp 62): lacy dark grey, black, ochre, grey, yellow", source: "dp 62", streak: [80.9, 0.015], paper: "#DCD3B6",
    pigments: [K(E(F("dark grey", "#695956", 37.9, 3.53, 1.8, 0.6, 0.96, 0.5), 2.01), 0.81), K(E(F("black", "#382B2C", 19.9, 2.51, 1.99, 0.47, 0.95, 0.5), 1.55), 1.01), K(F("ochre", "#AC985F", 8.4, 1.05, 1.54, 0.21, 0.95, 0.5), 1.05), K(E(F("grey", "#988A80", 21.6, 2.43, 1.65, 0.29, 0.95, 0.5), 2.63), 0.95), K(E(F("yellow", "#CCA51A", 8.6, 0.56, 2.34, 0.6, 0.95, 0.5), 2.55), 0.81), WHITE],
    background: 0, spots: [1, 2, 3, 4], paperPct: 3.7, white: 5 },
  { key: "dp352", name: "19th-c. Dahlia (dp 352): black, red, yellow, cream streaks; teal gall drops", source: "dp 352", streak: [17.1, 0.225], paper: "#E4D4B8",
    pigments: [B("black", "#3B3429", 32.9, 0.96, 0.5), F("red", "#7B3622", 21.9, 1.2, 3.1, 0.7, 0.95, 0.5), F("yellow", "#A06E33", 6.1, 1.0, 1.46, 0.7, 1, 0.6), F("cream", "#A99368", 2.4, 1.4, 0.81, 0.6, 1, 0.4), F("teal", "#31565A", 25.2, 0.12, 9.29, 0.45, 0.95, 0.5), F("grey-blue", "#7B866F", 11.6, 0.8, 2.24, 0.6, 0.97, 0.5), WHITE],
    background: 0, spots: [1, 2, 3], paperPct: 0.0, white: 6, special: 4 },
  { key: "dp322", name: "19th-c. Spanish on Turkish with shell veins (dp 322): umber, black-teal, dark teal, tan cells, olive-grey", source: "dp 322", streak: [131.9, 0.24], paper: "#E0CDAE",
    pigments: [K(E(F("umber", "#79351F", 45.0, 1.26, 4.37, 0.6, 0.96, 0.5), 2.51), 1.02), K(E(F("black-teal", "#0E3435", 15.5, 0.88, 2.56, 0.44, 0.95, 0.5), 2.44), 0.9), K(E(F("dark teal", "#525547", 9.3, 0.88, 1.39, 0.41, 0.95, 0.5), 2.23), 0.92), K(E(F("tan", "#9F5E3E", 25.3, 0.89, 4.73, 0.65, 0.95, 0.5), 3.68), 1.29), K(F("olive-grey", "#8E856D", 4.2, 0.23, 1.41, 0.29, 0.95, 0.5), 1.25), WHITE],
    background: 0, spots: [1, 2, 3, 4], paperPct: 0.7, white: 5, special: 3 },
  { key: "dp246", name: "19th-c. Spanish on Italian (dp 246): peach ground, black, olive, red, yellow veins", source: "dp 246", streak: [152.3, 0.071], paper: "#E8D6BC",
    pigments: [K(E(F("peach", "#E0965B", 76.0, 0.37, 6.59, 0.6, 0.96, 0.5), 1.9), 0.8), K(E(F("black", "#0B0903", 6.1, 0.66, 2.21, 0.55, 0.95, 0.5), 2.83), 0.89), K(F("olive", "#956840", 7.6, 0.67, 1.49, 0.24, 0.95, 0.5), 0.94), K(E(F("red", "#A92A2D", 4.8, 0.53, 2.33, 0.54, 0.95, 0.5), 2.98), 0.94), K(E(F("yellow", "#EDB22C", 3.3, 0.45, 2.07, 0.46, 0.95, 0.5), 3.54), 0.98), WHITE],
    background: 0, spots: [1, 2, 3, 4], paperPct: 2.1, white: 5 },
  { key: "dp143", name: "19th-c. Spanish on Italian (dp 143): ochre, black, umber, olive, yellow", source: "dp 143", streak: [59.4, 0.084], paper: "#E8DABD",
    pigments: [K(E(F("ochre", "#BD9843", 31.7, 0.61, 2.02, 0.6, 0.96, 0.5), 2.96), 0.6), K(E(F("black", "#250F00", 1.9, 0.26, 1.86, 0.41, 0.95, 0.5), 5.02), 1.03), K(E(F("umber", "#801D07", 2.9, 0.47, 1.85, 0.4, 0.95, 0.5), 3.02), 1.0), K(E(F("olive", "#A97827", 9.8, 0.84, 1.85, 0.42, 0.95, 0.5), 2.68), 0.76), K(E(F("yellow", "#D4AD55", 53.7, 0.65, 1.77, 0.6, 0.95, 0.5), 1.92), 0.6), WHITE],
    background: 0, spots: [1, 2, 3, 4], paperPct: 0.0, white: 5, special: 4 },
  { key: "dp295", name: "19th-c. Italian with Spanish (dp 295): orange, black, umber, red, yellow, pale orange", source: "dp 295", streak: [176.2, 0.212], paper: "#E8D6BC",
    pigments: [K(F("orange", "#DB8156", 6.1, 0.07, 1.62, 0.6, 0.96, 0.5), 0.93), K(E(F("black", "#372418", 2.7, 0.25, 2.18, 0.56, 0.95, 0.5), 5.01), 0.9), K(F("umber", "#A55E3B", 3.4, 0.2, 1.53, 0.2, 0.95, 0.5), 1.08), K(E(F("red", "#B73835", 2.6, 0.4, 1.84, 0.41, 0.95, 0.5), 4.4), 1.0), K(E(F("yellow", "#F19128", 4.0, 0.55, 2.02, 0.49, 0.95, 0.5), 2.77), 0.87), K(E(F("pale orange", "#E2895D", 81.2, 0.16, 3.47, 0.6, 0.95, 0.5), 1.86), 0.6), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5], paperPct: 0.1, white: 6, special: 5 },
  { key: "dp137", name: "19th-c. Shell on Turkish (dp 137): crimson alone with pink cells", source: "dp 137", streak: [179.4, 0.191], paper: "#E8D6C0",
    pigments: [K(E(F("crimson", "#740013", 90.2, 0.22, 4.09, 0.6, 0.96, 0.5), 1.97), 0.6), K(E(F("red", "#A02F42", 4.3, 0.16, 1.69, 0.36, 0.95, 0.5), 2.47), 0.81), K(E(F("pink", "#E19289", 5.5, 0.25, 2.79, 0.67, 0.95, 0.5), 3.43), 0.77), WHITE],
    background: 0, spots: [1, 2], paperPct: 0.0, white: 3, special: 2 },
  { key: "dp384", name: "19th-c. Spanish moiré (dp 384): green, dark green, umber, olive-brown, olive, yellow", source: "dp 384", streak: [93.3, 0.106], paper: "#E4D4B8",
    pigments: [B("green", "#5A682D", 63.7, 0.96, 0.5), E(F("dark green", "#364A2B", 4.1, 0.87, 3.62, 0.69, 0.95, 0.5), 2.54), E(F("umber", "#722B19", 5.3, 0.41, 2.61, 0.65, 0.95, 0.5), 3.25), E(F("olive-brown", "#725726", 10.6, 1.34, 1.98, 0.49, 0.95, 0.5), 2.97), E(F("olive", "#807025", 14.1, 0.93, 2.46, 0.66, 0.95, 0.5), 2.64), E(F("yellow", "#C59A5D", 2.2, 0.32, 1.58, 0.47, 0.95, 0.5), 2.69), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5], paperPct: 0.0, white: 6 },
  { key: "dp150", name: "19th-c. Spanish moiré (dp 150): maroon, dark crimson, red, pink", source: "dp 150", streak: [46.6, 0.316], paper: "#E9D6BE",
    pigments: [B("maroon", "#A71E38", 40.1, 0.96, 0.5), E(F("dark crimson", "#8F001F", 53.4, 1.48, 3.48, 0.67, 0.95, 0.5), 6.64), F("red", "#B74C5A", 2.5, 0.16, 2.92, 0.33, 0.95, 0.5), E(F("pink", "#D48D91", 4.0, 0.41, 1.89, 0.54, 0.95, 0.5), 3.51), WHITE],
    background: 0, spots: [1, 2, 3], paperPct: 0.0, white: 4 },
  { key: "dp353", name: "19th-c. Polnisch (dp 353): yellow-tan, black, olive, red, brown, grey, yellow", source: "dp 353", streak: [161.1, 0.05], paper: "#E4D4B8",
    pigments: [B("yellow-tan", "#BEAF75", 21.4, 0.96, 0.5), F("black", "#292C21", 11.9, 0.52, 3.46, 0.74, 0.95, 0.5), F("olive", "#745D38", 17.2, 1.27, 2.12, 0.46, 0.95, 0.5), F("red", "#B9372F", 7.8, 0.39, 2.24, 0.7, 0.95, 0.5), F("brown", "#97583C", 18.6, 1.33, 1.98, 0.48, 0.95, 0.5), F("grey", "#787D6C", 14.4, 0.48, 2.02, 0.72, 0.95, 0.5), F("yellow", "#C6A82C", 8.6, 0.29, 2.1, 0.75, 0.95, 0.5), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5, 6], paperPct: 0.0, white: 7 },
  { key: "dp60", name: "19th-c. Fantasy (dp 60): dark green, olive-green, pale olive", source: "dp 60", streak: [76.8, 0.068], paper: "#E6DCC8",
    pigments: [K(E(F("dark green", "#2B5F32", 57.3, 1.02, 1.89, 0.6, 0.96, 0.5), 3.07), 0.62), K(E(F("olive-green", "#6D8B5A", 19.9, 1.26, 2.6, 0.33, 0.95, 0.5), 2.13), 0.88), K(E(F("pale olive", "#9CA876", 22.8, 2.25, 1.62, 0.48, 0.95, 0.5), 3.22), 0.76), WHITE],
    background: 0, spots: [1, 2], paperPct: 0.0, white: 3 },
  { key: "dp203", name: "19th-c. Romantic (dp 203): coral, dark brown, umber, brown, tan, peach", source: "dp 203", streak: [19.2, 0.03], paper: "#E4D4B8",
    pigments: [K(E(F("coral", "#FA8873", 42.3, 0.73, 1.97, 0.6, 0.96, 0.5), 2.35), 0.6), K(E(F("dark brown", "#4E2D25", 8.0, 0.94, 2.39, 0.53, 0.95, 0.5), 2.95), 0.92), K(E(F("umber", "#78281E", 9.9, 0.84, 2.26, 0.48, 0.95, 0.5), 2.28), 0.91), K(E(F("brown", "#B9523D", 28.5, 5.59, 1.62, 0.33, 0.95, 0.5), 2.15), 0.97), K(F("tan", "#BC6B58", 3.1, 0.05, 4.22, 0.2, 0.95, 0.5), 0.82), K(E(F("peach", "#F7BD81", 8.1, 0.21, 1.55, 0.58, 0.95, 0.5), 1.78), 0.6), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5], paperPct: 0.1, white: 6 },
  { key: "dp16", name: "19th-c. French curl on Romantic (dp 16): grey, black, slate, red, ochre-grey", source: "dp 16", streak: [79.9, 0.043], paper: "#D8CFB2",
    pigments: [B("grey", "#595C51", 22.6, 0.96, 0.5), F("black", "#2E2D22", 13.8, 1.0, 2.88, 0.4, 0.95, 0.5), F("slate", "#3D3E3C", 8.5, 0.98, 2.8, 0.36, 0.95, 0.5), F("red", "#AF6668", 17.5, 1.98, 2.01, 0.51, 0.95, 0.5), F("ochre-grey", "#979178", 26.2, 0.5, 3.77, 0.5, 0.95, 0.5), WHITE],
    background: 0, spots: [1, 2, 3, 4], bg: { fill: 0.78, r: 0.73 }, paperPct: 11.3, white: 5 },
  { key: "dp280", name: "19th-c. Morris (dp 280): grey-blue and violet on white", source: "dp 280", streak: [152.6, 0.045], paper: "#EDEADF",
    pigments: [F("grey-blue", "#BCC2BC", 72.7, 0.25, 10.93, 0.6, 0.96, 0.5), K(E(F("violet", "#929AB1", 6.4, 0.13, 3.04, 0.8, 0.95, 0.5), 2.19), 0.78), WHITE],
    background: 0, spots: [1], bg: { fill: 0.56, r: 0.62 }, paperPct: 20.9, white: 2 },
  { key: "dp63", name: "19th-c. Italian on Turkish, double marble (dp 63): yellow-tan, olive veins", source: "dp 63", streak: [17.3, 0.088], paper: "#E8DCC2",
    pigments: [K(E(F("yellow-tan", "#CFAD6C", 80.5, 4.59, 2.9, 0.6, 0.96, 0.5), 1.62), 0.77), K(E(F("olive", "#8F7C40", 19.5, 1.88, 1.25, 0.46, 0.95, 0.5), 1.8), 0.83), WHITE],
    background: 0, spots: [1], paperPct: 0.0, white: 2 },
  { key: "dp138", name: "19th-c. Gold vein on Spanish moiré (dp 138): crimson, red, pink, gold", source: "dp 138", streak: [130.4, 0.033], paper: "#E4D4B8",
    pigments: [B("crimson", "#790010", 42.9, 0.96, 0.5), F("red", "#A32937", 30.6, 2.57, 2.36, 0.59, 0.95, 0.5), F("pink", "#BF7F64", 10.5, 0.54, 2.64, 0.63, 0.95, 0.5), { ...F("gold", "#BCA04E", 12.4, 0.6, 3.29, 0.6, 0.9, 0.7), metallic: 1 }, WHITE],
    background: 0, spots: [1, 2], paperPct: 3.6, white: 4, gold: 3 },
  { key: "dp198", name: "19th-c. Papier croisé (dp 198): black, dark red-brown, red-brown, brown-orange", source: "dp 198", streak: [4.8, 0.069], paper: "#E4D4B8",
    pigments: [K(E(F("black", "#251B15", 37.9, 2.55, 1.61, 0.6, 0.96, 0.5), 1.93), 0.75), K(E(F("dark red-brown", "#5A2C23", 30.5, 3.48, 2.31, 0.22, 0.95, 0.5), 2.02), 0.9), K(E(F("red-brown", "#8B3A2F", 26.2, 3.0, 1.65, 0.35, 0.95, 0.5), 2.03), 0.78), K(E(F("brown-orange", "#A33F33", 5.2, 0.73, 1.54, 0.42, 0.95, 0.5), 1.87), 0.89), WHITE],
    background: 0, spots: [1, 2, 3], paperPct: 0.1, white: 4 },
  { key: "dp375", name: "19th-c. Papier tourniquet (dp 375): black-brown, dark brown, dark green, olive-green", source: "dp 375", streak: [54.0, 0.041], paper: "#E4D4B8",
    pigments: [K(F("black-brown", "#282017", 67.6, 0.04, 1.95, 0.6, 0.96, 0.5), 0.6), K(E(F("dark brown", "#493423", 18.6, 1.31, 2.5, 0.67, 0.95, 0.5), 1.56), 0.98), K(E(F("dark green", "#393B1C", 8.9, 1.4, 1.5, 0.26, 0.95, 0.5), 2.26), 0.9), K(E(F("olive-green", "#5A6633", 4.9, 0.87, 1.49, 0.4, 0.95, 0.5), 1.93), 0.95), WHITE],
    background: 0, spots: [1, 2, 3], paperPct: 0.0, white: 4 },
  { key: "dp326", name: "18th-c. Papier coulé (dp 326): dark brown, umber-red, brown", source: "dp 326", streak: [87.0, 0.076], paper: "#E2D2B2",
    pigments: [K(F("dark brown", "#4B2422", 90.0, 0.08, 1.46, 0.6, 0.96, 0.5), 0.6), K(E(F("umber-red", "#6C2C29", 5.4, 0.83, 1.61, 0.48, 0.95, 0.5), 2.12), 0.87), K(E(F("brown", "#87574A", 4.4, 0.64, 1.32, 0.31, 0.95, 0.5), 1.53), 0.78), WHITE],
    background: 0, spots: [1, 2], paperPct: 0.2, white: 3, laid: true },
  { key: "dp274", name: "19th-c. French curl on Wide comb (dp 274): red, indigo, maroon, orange-brown, cream", source: "dp 274", streak: [95.2, 0.085], paper: "#E4D4B8",
    pigments: [B("red", "#8A0217", 49.3, 0.96, 0.5), F("indigo", "#291F5A", 8.8, 0.59, 2.27, 0.54, 0.95, 0.5), F("maroon", "#7E3238", 26.8, 2.13, 1.6, 0.45, 0.95, 0.5), F("orange-brown", "#A85725", 4.8, 0.77, 1.12, 0.49, 0.95, 0.5), F("cream", "#CA9C8B", 10.3, 1.09, 1.27, 0.52, 0.95, 0.5), WHITE],
    background: 0, spots: [1, 2, 3, 4], paperPct: 0.0, white: 5 },
  { key: "dp393", name: "19th-c. Double comb (dp 393): red, indigo, dark teal, maroon, orange, cream", source: "dp 393", streak: [177.0, 0.296], paper: "#E4D4B8",
    pigments: [B("red", "#AD3149", 21.7, 0.96, 0.5), F("indigo", "#3E3C70", 8.1, 0.98, 2.48, 0.53, 0.95, 0.5), F("dark teal", "#374144", 5.9, 0.91, 1.65, 0.49, 0.95, 0.5), F("maroon", "#7E4F5A", 35.9, 2.57, 2.13, 0.43, 0.95, 0.5), F("orange", "#BA6154", 11.8, 0.98, 1.6, 0.54, 0.95, 0.5), F("cream", "#DAA995", 16.6, 1.66, 1.32, 0.46, 0.95, 0.5), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5], paperPct: 0.0, white: 6 },
  { key: "dp75", name: "19th-c. Double comb waved (dp 75): crimson, red, grey-blue, tan, orange, pale pink", source: "dp 75", streak: [73.2, 0.214], paper: "#E4D4B8",
    pigments: [B("crimson", "#7E000A", 61.4, 0.96, 0.5), F("red", "#922C2D", 11.8, 0.35, 3.27, 0.17, 0.95, 0.5), F("grey-blue", "#806773", 7.3, 0.45, 1.51, 0.59, 0.95, 0.5), F("tan", "#CD6A5D", 7.0, 0.5, 1.63, 0.21, 0.95, 0.5), F("orange", "#EF9755", 5.7, 0.63, 1.41, 0.5, 0.95, 0.5), F("pale pink", "#FFC6B2", 6.8, 1.12, 1.1, 0.44, 0.95, 0.5), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5], paperPct: 0.0, white: 6 },
  { key: "dp87", name: "19th-c. Gloster on Serpentine (dp 87): red, indigo, dark grey, maroon, speckled grey, ochre", source: "dp 87", streak: [104.6, 0.121], paper: "#D9CBC6",
    pigments: [B("red", "#801323", 35.6, 0.96, 0.5), F("indigo", "#37405B", 16.3, 0.7, 2.87, 0.72, 0.95, 0.5), F("dark grey", "#3E3D3A", 8.5, 0.62, 2.16, 0.69, 0.95, 0.5), F("maroon", "#6D2F33", 14.2, 1.65, 1.33, 0.4, 0.95, 0.5), F("grey", "#948D90", 15.7, 0.83, 2.4, 0.5, 0.95, 0.5), F("ochre", "#AC714A", 8.6, 0.41, 1.44, 0.68, 0.95, 0.5), WHITE],
    background: 0, spots: [1, 2, 3, 4, 5], paperPct: 1.1, white: 6, special: 4 },
  { key: "guyot20", name: "20th-c. Guyot Shell: orange, green, cream", source: "dp 524", streak: [83.4, 0.038], paper: "#EEE7D8",
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
  streaks?: "h" | "v"; // orientation of the recipe's own streaks as authored (set from Recipe.streaks by the harness) // 0..1 the marbler aims later colours at gaps
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
export interface CombOpts { offset?: number; ripple?: number; L?: number; strength?: number; kernel?: "arc" | "wake" }

export class Builder {
  ops: Op[] = [];
  layers: LayerSpec[] = [];
  n = 0;
  groundFill = -1; // palette index of a ground film covering the whole bath (first colour thrown generously)
  /** while set, layers and combs are laid still: no sliding, wobble, breathing or tine drift. A drawn sheet's
   *  quills never move; only the dots or drops thrown after the combing animate (Feather, Antique straight, Zebra). */
  still = false;
  /** comb axis for this sheet: 90 when the scan's streaks run the other way from the recipe as authored.
   *  The same pattern was combed across some sheets and down others (Double comb: dp 75 down, dp 393 across). */
  axis = 0;
  constructor(public p: Params, public pal: Palette) {
    if (p.streaks && pal.streak && pal.streak[1] >= 0.08) {
      const want = p.streaks === "h" ? 0 : 90;
      let d = Math.abs(pal.streak[0] - want) % 180;
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
      animAmp: this.still ? 0 : (o.anim ?? 1) * 0.1,
      breath: this.still ? 0 : p.breath,
      slide: this.still ? 0 : undefined,
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
  sprinkleStats(colour: number, st: { perCm2: number; d50: number; sig: number; wk?: number }, o: { style?: number; styleParam?: number; anim?: number; densityMul?: number; sizeMul?: number } = {}) {
    const dens = st.perCm2 * (o.densityMul ?? 1);
    const cellMm = 10 / Math.sqrt(Math.max(0.05, dens));
    const r = (st.d50 * 1.35 * (o.sizeMul ?? 1)) / 2 / cellMm; // ×1.35: scan components are fragmented by later colours; clamped ≤ 0.8 cell in the bake
    const pk = this.pal.pack ?? {};
    const rr = r / (0.55 + 0.45 * this.p.gall);
    return this.sprinkle([colour], { cell: cellMm * this.p.density, r: rr, sigma: Math.min(st.sig, pk.sigma ?? 9), fill: 1, jitter: pk.jitter ?? 0.46, style: o.style, styleParam: o.styleParam, anim: o.anim ?? 1, small: rr <= 0.3, shape: st.wk ?? 1.1, floorMm: 1.2 });
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
    const arc = (f: number) => { const g = f - Math.round(f); return Math.sqrt(Math.max(1 - 4 * g * g, 0) + 0.02); };
    const sum = (f: number) => { if (!wake) return arc(f); const k = Math.round(f); let t = 0; for (let j = -4; j <= 4; j++) t += K(((f - k - j) * s) / L); return t; };
    let mean = 0; for (let i = 0; i < 64; i++) mean += sum((i + 0.5) / 64); mean /= 64;
    const ripple = (o.ripple ?? 1.2) * (o.strength ?? 1) * p.combStrength;
    const z = (ripple * s) / Math.max(1e-3, sum(0) - sum(0.5));
    const drift = p.animate && !this.still ? 0.12 * s * Math.sin(0.11 * p.time + this.n) : 0;
    this.ops.push({ type: OP.COMB, p: [rad(dirDeg), s, (o.offset ?? 0) * p.combScale + drift, z, L, wake ? 1 : 0, 0, mean] });
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

  /** Wavy comb: straight comb conjugated by a sinusoidal shear (exact).
   *  alternate=true interleaves a second tine set offset half a spacing along the comb and
   *  half a wavelength along the stroke, so adjacent tines wave in opposite phase and the
   *  fans stagger (Peacock, Bouquet). The conjugations collapse to +A, −2A, +A. */
  wavyComb(dirDeg: number, spacing: number, amp: number, wavelength: number, o: CombOpts & { alternate?: boolean } = {}) {
    const p = this.p;
    const phase = p.animate && !this.still ? 0.06 * p.time : 0;
    const dir = dirDeg + this.axis;
    const shearDir = dir + 90; // shear along the tine-spacing axis, varying along the stroke
    this.shear(shearDir, amp, wavelength, phase);
    this.combAt(dir, spacing, { strength: o.strength, ripple: o.ripple, L: o.L, kernel: o.kernel });
    if (o.alternate) {
      this.shear(shearDir, -2 * amp, wavelength, phase);
      this.combAt(dir, spacing, { offset: spacing / 2, strength: o.strength, ripple: o.ripple, L: o.L, kernel: o.kernel });
      this.shear(shearDir, amp, wavelength, phase);
    } else {
      this.shear(shearDir, -amp, wavelength, phase);
    }
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
  turkish(o: { spots?: number; cell?: number; bgCell?: number; bgR?: number; bgFill?: number; lastStyle?: number; lastParam?: number; ringed?: boolean; fill?: number; gallDots?: boolean; skipBackground?: boolean; sizeMul?: number; densityMul?: number; swirl?: number; gold?: boolean; ground?: number; exclude?: number[] } = {}) {
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
      const st = { perCm2: pg.perCm2 ?? 1.2, d50: pg.d50 ?? 2.2, sig: pg.sig ?? 0.6, wk: pg.wk };
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
  grain?: number; tooth?: number; granulation?: number; drift?: number; stretchLimit?: number;
}
const D18: PresetDefaults = { viscosity: 0.25, paperAge: 0.55, bleed: 0.16, tooth: 0.7, granulation: 0.7 }; // 17th/18th-c. sheets: starchy size, laid paper, aged
const D19: PresetDefaults = { viscosity: 0.35, paperAge: 0.35, bleed: 0.12, tooth: 0.55, granulation: 0.55 }; // 19th-c. trade papers
const D20: PresetDefaults = { viscosity: 0.45, paperAge: 0.1, bleed: 0.08, tooth: 0.4, granulation: 0.4 }; // modern carrageenan size, wove paper

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
  build: (p: Params, pal: Palette) => Scene;
}

// Combed sheets: the stone underneath had spots several times larger than the fragments the
// combed scans show (bands of 1–2 mm remain after the get-gel), hence sizeMul / densityMul.
const COMBED = { sizeMul: 2.4, densityMul: 0.3, gallDots: false };
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
  // larger (as for every combed sheet). No residual swirl: the combs supply all the elongation.
  b.turkish({ cell: 9, sizeMul: 3, densityMul: 0.5, gallDots: false, swirl: 0, exclude });
  b.comb(-90, 6, { ripple: 5, L: 0.3, kernel: "wake" });   // a 6 mm comb pulled hard: every spot drawn into a continuous band (no tongue ends anywhere on dp 29), 1–5 mm wide
  // Wide comb across and back, halving, drawn the length of the bath. The wake has nearly no width: the drag
  // is logarithmic in the distance to each tine's path, so the lines run nearly straight across the gap and
  // bend only in the last millimetres into the quill, sigmoids of opposite sense in alternate gaps (dp 29:
  // quills ~55 mm apart; its orientation histogram peaks at ~75° and ~110°, i.e. 65–70° from the stroke).
  // With a 0.5 mm core, a ripple of 1.5 spacings gives that angle (z ≈ 23 mm: ~57 mm of drag at 1 mm); measured
  // against the scan's orientation histogram, 1.3 left the crossing ~7° too oblique.
  b.comb2(0, spacing, { ripple: 1.5, L: 0.5, kernel: "wake" });
  b.still = false;
  return b;
};
const nonpareilBase = (b: Builder) => {
  b.turkish({ cell: 14, ...COMBED });
  b.comb2(0, 22, { ripple: 2.2 }); // wide comb drawn horizontally twice ("get-gel"): long streaks
  b.comb(-90, 2.4, { ripple: 1.6 }); // fine comb drawn vertically once: a chain of rounded tongues with cusps between (dp 82)
  return b;
};

export const RECIPES: Recipe[] = [
  { name: "Turkish (Stone)", group: "Stone", palette: "turkish17", palettes: ["turkish17", "spotcombed18", "placard18", "dp322", "serpentine19", "frenchcurl19"], terms: ["turkish", "spot", "stone", "agate"], defaults: { ...D18 }, note: "Colours thrown in turn; earlier ones constrict into veins.",
    build: (p, pal) => new Builder(p, pal).turkish({ cell: 18, ringed: true }).drift().scene() },

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
  { name: "Nonpareil", streaks: "v", group: "Combed", palette: "nonpareil19", palettes: ["nonpareil19", "dp21", "antique19"], terms: ["nonpareil", "get gel", "getgel", "old dutch"], defaults: { ...D19, viscosity: 0.3 }, note: "Get-gel (wide comb twice) then a 2–3 mm comb drawn once.",
    build: (p, pal) => nonpareilBase(new Builder(p, pal)).drift().scene() },

  { name: "Feather", streaks: "h", group: "Combed", palette: "g229", palettes: ["g229", "g237", "g238", "g29"], terms: ["feather", "chevron"], defaults: { ...D19, viscosity: 0.8, stretchLimit: 1e5, drift: 0 }, note: "A fine comb draws every colour into hair lines; a comb with widely set teeth drawn across them and back, halving, and pulled hard draws the lines into hyperbolae: barbs swooping into the periodic quills and running along them (dp 229).",
    build: (p, pal) => { const b = new Builder(p, pal); const round = roundColours(pal); featherBase(b, round);
      for (const c of round) b.sprinkleStats(c, b.statsOf(c), { anim: 0.6 });
      return b.drift().scene(); } },
  { name: "Icarus", streaks: "v", group: "Combed", palette: "g216", palettes: ["g216", "g217", "g219", "g220", "g221", "g222"], terms: ["icarus", "whirl"], defaults: { ...D19, viscosity: 0.3 }, note: "Fine nonpareil, then a deep comb drawn down the sheet along a slow arc: nested wing-like crescents (dp 216).",
    build: (p, pal) => { const b = nonpareilBase(new Builder(p, pal)); b.wavyComb(-90, 14, 22, 260, { alternate: false, ripple: 2.5, L: 1, kernel: "wake" }); /* one deep wide-kernel comb drawn down a slow arc: nested crescents ~14 mm apart, all bowing one way (dp 216) */ return b.drift().scene(); } },
  { name: "Cathedral", streaks: "v", group: "Combed", palette: "g218", palettes: ["g218", "g224", "g234", "g242", "g243", "g244"], terms: ["cathedral"], defaults: { ...D19, viscosity: 0.3 }, note: "Nonpareil, then one wide comb with strong pull drawn up the sheet: tall pointed arches (dp 218).",
    build: (p, pal) => { const b = nonpareilBase(new Builder(p, pal)); b.comb(-90, 55, { ripple: 3.5, L: 1.5, kernel: "wake" }); return b.drift().scene(); } },
  { name: "Wide comb (Arch)", streaks: "v", group: "Combed", palette: "dp274", palettes: ["dp274", "nonpareil19"], terms: ["wide comb", "arch"], defaults: { ...D19, viscosity: 0.3 }, note: "Narrow comb twice horizontally, then a wider comb vertically once.",
    build: (p, pal) => { const b = new Builder(p, pal); b.turkish({ cell: 14, ...COMBED }); b.comb2(0, 8, { ripple: 2.5 }); b.comb(-90, 22, { ripple: 1.2 }); return b.drift().scene(); } },

  { name: "Double comb", streaks: "v", group: "Combed", palette: "dp393", palettes: ["dp393", "dp75"], terms: ["double comb", "doubled comb", "double nonpareil"], defaults: { ...D19, viscosity: 0.3 }, note: "Nonpareil, then a wider comb drawn through once.",
    build: (p, pal) => { const b = nonpareilBase(new Builder(p, pal)); b.comb(90, 14, { ripple: 0.8 }); return b.drift().scene(); } },

  { name: "Bouquet", streaks: "v", group: "Combed", palette: "dp172", palettes: ["dp172", "peacock19"], terms: ["bouquet", "fern"], defaults: { ...D19, viscosity: 0.3 }, note: "Nonpareil base (coarser fine comb), then a two-toothed comb drawn vertically in wavy lines.",
    build: (p, pal) => { const b = new Builder(p, pal); b.turkish({ cell: 14, ...COMBED }); b.comb2(0, 22, { ripple: 1.2 }); b.comb(-90, 4, { ripple: 0.8 });
      b.wavyComb(-90, 30, 7, 42, { alternate: true, ripple: 0.45, L: 8 }); /* small drag: closed staggered scallop cells (dp 172) */ return b.drift().scene(); } },

  { name: "Peacock", streaks: "v", group: "Combed", palette: "peacock19", palettes: ["peacock19", "dp172"], terms: ["peacock"], defaults: { ...D19, viscosity: 0.3 }, note: "Turkish, get-gel bands, then a two-toothed comb drawn vertically in wavy lines (dp 144).",
    build: (p, pal) => { const b = new Builder(p, pal); b.turkish({ cell: 13, ...COMBED }); b.comb2(0, 22, { ripple: 1.2 }); // get-gel only: the fan interiors are concentric bands, not a grid
      b.comb(-90, 5, { ripple: 0.6 }); /* fine comb along the drag axis: the radiating lines inside each fan (dp 144) */
      b.wavyComb(-90, 36, 8, 56, { alternate: true, ripple: 0.45, L: 8 }); /* small drag as for Bouquet but taller, wider sets: stemmed fans in staggered rows (dp 144) */ return b.drift().scene(); } },

  { name: "Serpentine", streaks: "h", group: "Combed", palette: "dp164", palettes: ["dp164", "serpentine19", "dp87"], terms: ["serpentine", "waved", "wave"], defaults: { ...D19, viscosity: 0.3 }, note: "As Peacock but a wide single-toothed comb drawn in wavy lines.",
    build: (p, pal) => { const b = new Builder(p, pal); b.turkish({ cell: 13, ...COMBED });
      b.comb2(0, 22, { ripple: 2.2 }); // get-gel only: dp 164 shows 1–2 mm bands, no fine cross-combing (a 4 mm cross-comb made sub-pixel filaments)
      b.wavyComb(-90, 13, 6, 26, { ripple: 0.5, L: 8 }); /* wide-toothed comb drawn in S-waves: ~13 mm between waves, ~6 mm swing (dp 164) */ return b.drift().scene(); } },

  { name: "Fountain", streaks: "h", group: "Combed", palette: "dp156", palettes: ["dp156", "spotcombed18"], terms: ["fountain"], defaults: { ...D18, viscosity: 0.3 }, note: "Comb with one set of teeth drawn back and forth across the bath.",
    build: (p, pal) => { const b = new Builder(p, pal); b.turkish({ cell: 14, ...COMBED }); b.comb(0, 9, { ripple: 2.5 }); b.comb(180, 9, { offset: 1.5, ripple: 2.5 }); b.comb(0, 9, { offset: 3, ripple: 2 }); return b.drift().scene(); } },

  { name: "French curl on Turkish", group: "Curled", palette: "frenchcurl19", palettes: ["frenchcurl19", "frenchcurl19b", "dp16", "placard18"], terms: ["french curl", "curl", "snail"], defaults: { ...D19, curlStrength: 1 }, note: "Stone base swirled with a stylus at regular intervals.",
    build: (p, pal) => { const b = new Builder(p, pal); b.turkish({ cell: 12, ringed: false }); b.vortexGrid(50, { z: 32, jitter: 0.3 }); return b.drift().scene(); } },

  { name: "French curl on Nonpareil", group: "Curled", palette: "dp21", palettes: ["dp21", "frenchcurl19b"], terms: ["french curl on nonpareil"], defaults: { ...D19, curlStrength: 1 }, note: "Nonpareil base, then swirled.",
    build: (p, pal) => { const b = nonpareilBase(new Builder(p, pal)); b.vortexGrid(52, { z: 40 }); return b.drift().scene(); } },

  { name: "Placard (Drawn stone)", streaks: "v", group: "Curled", palette: "placard18", palettes: ["placard18", "turkish17"], terms: ["placard", "drawn stone", "mixed"], defaults: { ...D18, curlStrength: 1 }, note: "Turkish, light combing, and a few French-curl swirls.",
    build: (p, pal) => { const b = new Builder(p, pal); b.turkish({ cell: 15, ringed: true }); b.comb(-90, 12, { ripple: 0.5 });
      for (let i = 0; i < 5; i++) { const x = (hash01(p.seed, i * 3) - 0.5) * p.sheetW, y = (hash01(p.seed, i * 3 + 1) - 0.5) * p.sheetH; b.vortex(x, y, 18 * p.curlStrength, 9, 2, 2.5, i % 2 ? 1 : -1); }
      return b.drift().scene(); } },

  { name: "Antique straight", streaks: "h", group: "Sprinkled", palette: "antique19", palettes: ["antique19", "dp125"], terms: ["antique straight", "antique"], defaults: { ...D19, viscosity: 0.3, stretchLimit: 1e5, drift: 0 }, note: "A Feather pattern completed, then a shower of fine dots, usually white, over the whole bath (Wolfe; dp 125, 131).",
    build: (p, pal) => { const b = new Builder(p, pal); const round = roundColours(pal); featherBase(b, round);
      for (const c of round) b.sprinkleStats(c, b.statsOf(c), { anim: 0.6 });   // the shower of fine dots
      if (!round.length && !hasWhiteSpot(pal)) b.sprinkleStats(pal.white, b.statsOf(pal.white, { perCm2: 2.3, d50: 1.6, wk: 0.9 }), { anim: 0.6 });
      return b.drift().scene(); } },

  { name: "Zebra", streaks: "v", group: "Sprinkled", palette: "dp61", palettes: ["dp61", "antique19"], terms: ["zebra"], defaults: { ...D19, stretchLimit: 1e5, drift: 0 }, note: "Turkish base; a comb with one set of teeth drawn through twice, down and back up with the second pass halving the first, pulls the colours into long flowing bands (gezogener Achat); then one or more colours sprinkled or splashed on as large drops that sit on the bands (Wolfe and Miura; dp 15, 386).",
    build: (p, pal) => { const b = new Builder(p, pal); const round = roundColours(pal);
      b.still = true;   // the drawn bands never move; only the drops thrown onto them animate
      b.turkish({ cell: 12, sizeMul: 2.2, densityMul: 0.35, gallDots: false, swirl: 0, exclude: round });
      b.comb2(-90, 18, { ripple: 1.0, L: 0.5, kernel: "wake" });   // as the Feather's wide comb, on the plain stone base: bands swooping into the periodic tine paths
      b.still = false;
      for (const c of round) b.sprinkleStats(c, b.statsOf(c), { anim: 0.7 });   // the large final drops
      if (!round.length && !hasWhiteSpot(pal)) b.sprinkleStats(pal.white, b.statsOf(pal.white, { perCm2: 0.5, d50: 2.4, wk: 0.9 }), { anim: 0.7 });
      return b.drift().scene(); } },

  { name: "Gloster (Partridge eye)", streaks: "v", group: "Dispersant", palette: "gloster19", palettes: ["gloster19", "dp71", "dp91", "dp330", "dp87"], terms: ["gloster", "gloucester", "partridge"], defaults: { ...D19, gall: 1.1 }, note: "Turkish, comb twice, then a turpentine-mixed colour sprinkled: speckled drops with white open spots.",
    build: (p, pal) => { const b = new Builder(p, pal); b.turkish({ cell: 14 }); b.comb2(-90, 8, { ripple: 0.6 });
      const sp = pal.special ?? pal.spots[pal.spots.length - 1]; b.sprinkleStats(sp, b.statsOf(sp, { perCm2: 0.8, d50: 4 }), { style: STYLE.PARTRIDGE, styleParam: 1 }); return b.drift().scene(); } },

  { name: "Schrottel", group: "Dispersant", palette: "schrottel19", palettes: ["schrottel19", "dp105"], terms: ["schrottel", "scrotel", "schrot"], defaults: { ...D19 }, note: "Turkish on a black ground, then a gall-and-oil mixture thrown: shot-like dark spots with white halos.",
    build: (p, pal) => { const b = new Builder(p, pal);
      // The gall-and-oil mixture is thrown last and covers most of the sheet: it is the colour with the largest coverage,
      // whether the analysis called it a spot or (when its shot drops merged into a lacy sheet) the ground. The true
      // ground is the darkest of the remaining colours; everything else is a plain Turkish spot laid before the shot.
      const all = laidColours(pal);
      const shot = pal.special ?? all.reduce((a, c) => ((pal.pigments[c].frac ?? 0) > (pal.pigments[a].frac ?? 0) ? c : a), all[0]);
      const rest = all.filter((c) => c !== shot);
      const ground = rest.length ? darkestGround(pal, rest) : pal.background;
      // Where the sheet shows paper, the ground is thrown as drops leaving that much bare size; otherwise as a film.
      const paper = pal.paperPct ?? 0;
      b.turkish({ cell: 14, spots: 0, ground, gallDots: false, bgFill: paper > 3 ? Math.max(0.2, 1 - paper / 100) : undefined, bgR: paper > 3 ? 0.62 : undefined });
      for (const c of rest) if (c !== ground) { ensureStats(pal, c, 3, 1); b.sprinkleStats(c, b.statsOf(c)); }
      ensureStats(pal, shot, 9, 0.5);
      // The mixture is thrown generously: big overlapping drops, not the many small fragments the segmentation sees
      // between its holes, so the measured density is replaced by a sparse grid and the size alone sets the coverage.
      b.sprinkleStats(shot, { ...b.statsOf(shot, { perCm2: 0.45, d50: 9 }), perCm2: 0.45 }, { style: STYLE.SHOT | STYLE.HALO, styleParam: 1 }); return b.drift().scene(); } },

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

  { name: "Dahlia", streaks: "h", group: "Dispersant", palette: "dp352", palettes: ["dp352"], terms: ["dahlia"], defaults: { ...D19 }, note: "Zebra base: the streak colours combed once across the sheet into long wavy bands; then large gall-heavy teal drops thrown on top, each speckled with pale gall spots, the bands flowing round them; paler round drops and small white specks last (dp 352, after Miura).",
    build: (p, pal) => { const b = new Builder(p, pal);
      // The dahlias are the big round drops (least elongated, largest coverage); paler round drops thrown after them sit on top.
      const round = pal.spots.filter((c) => (pal.pigments[c].el ?? 9) < 2.2);
      const teal = pal.special ?? (round.length ? round.reduce((a, c) => ((pal.pigments[c].frac ?? 0) > (pal.pigments[a].frac ?? 0) ? c : a), round[0]) : pal.spots[pal.spots.length - 1]);
      // Zebra base of the streak colours only (the round colours come later): large Turkish spots, then one
      // fine comb drawn across the sheet along a slow wave, so every spot is drawn out into a long band
      // (dp 352: bands 1–3 mm wide, waves ~70 mm long, ~6 mm high).
      const nStreak = pal.spots.findIndex((c) => round.includes(c));
      b.turkish({ cell: 12, sizeMul: 2.4, densityMul: 0.3, gallDots: false, spots: nStreak > 0 ? nStreak : undefined });
      b.wavyComb(0, 3, 6, 70, { alternate: false, ripple: 6, L: 4 }); // one hard pull: every spot drawn out into a band many times its length
      // the dahlias: gall-heavy drops thrown onto the combed bath push the bands aside; gall opens pale spots inside them.
      // Their sizes are even (8–20 mm on dp 352), so the shape is fixed rather than the heavy-tailed fit of the scan.
      b.sprinkleStats(teal, { ...b.statsOf(teal), wk: 1.6, sig: 0.3 }, { style: STYLE.GALLDOTS, styleParam: 1, anim: 0.8 });
      for (const gb of round) if (gb !== teal) b.sprinkleStats(gb, b.statsOf(gb)); // pale blobs thrown onto the dahlias
      if (!hasWhiteSpot(pal)) b.sprinkleStats(pal.white, b.statsOf(pal.white, { perCm2: 0.8, d50: 1.2, wk: 1.0 }), { anim: 1.2 });
      return b.drift().scene(); } },
  { name: "Spanish", group: "Transfer", palette: "spanish19", palettes: ["spanish19", "dp322", "dp246", "dp143", "dp295"], terms: ["spanish"], defaults: { ...D19, transferAmp: 1 }, note: "Turkish; the paper is rocked as it is laid: diagonal shaded ripples.",
    build: (p, pal) => { const b = new Builder(p, pal); b.turkish({ cell: 22, ringed: true }); b.drift(); b.shear(35, 0.9, 5.5, 0);
      return b.scene({ transfer: { mode: 1, amp: 0.6, wavelength: 5.5, angle: 35, phase: 0, wobble: 0.35 } }); } },

  { name: "Spanish moiré", group: "Transfer", palette: "spanishred19", palettes: ["spanishred19", "dp150", "dp384"], terms: ["spanish moir", "moir"], defaults: { ...D19, transferAmp: 1 }, note: "Paper folded and laid with side-to-side movement: curvilinear ripple sets.",
    build: (p, pal) => { const b = new Builder(p, pal); b.turkish({ cell: 16, ringed: true }); b.drift(); b.shear(30, 0.8, 7, 0); b.shear(-40, 0.6, 9, 1);
      return b.scene({ transfer: { mode: 2, amp: 0.55, wavelength: 7, angle: 30, phase: 0, wobble: 0.9 } }); } },

  { name: "Extra (Drag)", group: "Transfer", palette: "extra19", palettes: ["extra19"], terms: ["extra", "drag"], defaults: { ...D19 }, note: "Turkish; the paper is dragged forward as it is laid: elongated spots.",
    build: (p, pal) => { const b = new Builder(p, pal); b.turkish({ cell: 16, ringed: true }); b.drift(); b.stretch(70, 1.7);
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
    build: (p, pal) => { const b = new Builder(p, pal); b.turkish({ cell: 16, ringed: true }); b.drift(); b.shear(30, 0.8, 7, 0); b.shear(-40, 0.6, 9, 1);
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
