# Marbled paper

Live: <https://marbled-paper.vercel.app> · Source: <https://github.com/skalyan91/marbled-paper>

A WebGL2 demo whose single GLSL ES 3.00 fragment shader renders historically faithful
European marbled paper, from the 17th-century Turkish stone pattern to the combed, curled,
dispersant and transfer patterns of the 19th-century trade. The initial conditions animate
slowly, so every frame is a finished sheet; the sheet is shown at life size on the screen.
The page works on phones as well as desktops: the panel folds into a sheet along the bottom.

Every recipe and every palette is measured, not eyeballed: the colours, their coverage,
spot-size distributions and shapes come from 440 scans in the University of Washington
Libraries' *Decorated and Decorative Paper* collection (see [Sources](#sources)). Nothing
from the collection is redistributed here; only numbers derived from it.

```
npm install
npm run dev      # Vite dev server, bound to all interfaces (LAN access)
npm run build    # type-check + static build into dist/
```

Keys: `space` pause · `n` / `p` next / previous pattern · `r` random seed · `x` randomise everything · `s` save PNG.
Touch: swipe left / right for the next / previous pattern, tap with two fingers to pause.
URL parameters: `?pattern=Nonpareil&seed=1234`.

## What it renders

39 patterns, following the pattern names of the UW collection: Turkish (Stone), Italian
(hair vein), Gold vein, Nonpareil, Wide comb (Arch), Double comb, Bouquet, Peacock, Serpentine,
French curl on Fountain, on Turkish and on Nonpareil, Placard, Antique straight, Zebra, Gloster
(Partridge eye), Schrottel, Shell, Stormont, Tiger, Dahlia, Spanish, Spanish moiré, Extra
(Drag), Polnisch, Fantasy, Romantic (Broken), Morris (wet paper), Double marble, two overprinted
gold veins, Italian overprinted on Turkish, Papier croisé, tourniquet and coulé, and three
20th-century patterns that exist only in the catalogue: Feather, Icarus and Cathedral.

Each pattern offers only the sheets on which the collection attests it, 419 sheets in all,
listed oldest first. A sheet is a palette with, for each colour, its measured coverage,
density of spots per cm², median spot diameter, Weibull shape of the size distribution, and
elongation; the recipe's spot sizes are then fitted in the page until the rendered coverage
per colour matches the scan.

## Model

Everything is evaluated per pixel with no simulation state: the pixel's paper position is
mapped backwards through the inverse of every marbling operation in reverse chronological
order until it lands inside a paint drop (reverse mapping, after Lu, Jaffer, Jin, Zhao and
Mao, *Mathematical Marbling*, and Jaffer, *Oseen Flow in Paint Marbling*; see Sources). A 2×2
Jacobian (bath mm per screen pixel) is carried through every operator; it drives the drying
model, the analytic anti-aliasing and texture filtering.

Operators (`src/shaders/marble.frag`, authored forward in `src/recipes.ts`):

| op | forward map | inverse used by the shader |
|---|---|---|
| drop of radius r at C | P ↦ C + (P−C)·√(1 + r²/‖P−C‖²) | P ↦ C + (P−C)·√(1 − r²/‖P−C‖²), windowed to a 5×5 / 7×7 cell neighbourhood |
| comb (infinite train of parallel tines, spacing s) | P ↦ P + z·K(n − o)·M | two regimes, mean drag removed. *Arc*: the paint pushed ahead of each tine forms a front that bows between the neighbouring tines and meets the next in a cusp, K = √(1 − 4f² + ε) with f the position in the gap: rounded tongues, cusped valleys, flanks drawn into hair lines (nonpareil, dp 82; the arches of a wide comb). *Wake*, for widely set teeth pulled hard: the wake has nearly no width; the drag diverges towards the tine's path as L/d with a core of half a millimetre, K = Σ (1 + (d/L)²)^{−1/2} over the nine nearest tines. A line crossing the stroke becomes a hyperbola asymptotic to the path; drawn across and back with halving, the lines accumulate along each path into a straight column of near-parallel lines (the quill) joined by sigmoids of opposite sense in alternate gaps, crossing the gap at 60–70° midway (Feather, dp 29). The pull is set by that angle: ~470 mm at the tine for 55 mm tines |
| sinusoidal shear | x ↦ x − A·sin(k·y + φ) | exact; also conjugates combs into wavy combs |
| vortex (stylus swirl) | rotate about C by z·e^{−max(0,d−r)/L}/max(d,core) | rotate by the opposite angle |
| Oseen short stroke | Jaffer eq. 14/15, segmented | segments run backwards (approximate, Fantasy/Placard only) |
| stretch (paper dragged while laid) | scale along M | scale by 1/f |

Drop layers are sprinkled on jittered grids whose per-cell data (offset, radius, colour) is
baked into a half-float texture array each frame, so a candidate drop costs one texel fetch.
Within a layer the drops are visited in a fixed global order; between layers the order is
exact.

The animation moves the drops through one another rather than jiggling them in place. Each
layer carries two crossing streams: the drops of the even grid rows slide along the grid's x
axis, every row at its own steady speed, and the drops of the odd rows slide along y, every
column at its own speed. The speed profiles are sums of short-wavelength harmonics (3–11
cells), so neighbouring drops pass one another continuously, the two streams weave through
each other, and over any patch of the sheet as much paint moves one way as the other: shear
everywhere, bulk flow nowhere. Slow bounded swells and a small per-drop wobble are added on
top. The shader finds a drop by looking in the cell its row or column has slid to, so the
positions are unbounded and nothing ever returns to where it started.

Each drop also breathes: its radius follows a human breathing curve (after petasbytes'
*Breathing Blob*, PyCon AU 2026) rather than a sine: a raised-cosine inhale over about a third
of the cycle, a raised-cosine exhale over the rest, and a short pause at the end of the
exhale. Every drop has its own resting tempo (10–16 breaths a minute), every breath its own
period and depth, and now and then a drop sighs (twice the depth over one and a half periods).
The "Breath depth" control sets the peak-to-trough change of radius.

The shader is the whole cost of a frame, so while the sheet moves each frame shades only one
phase of a k-pixel lattice (every second column, or a 2×2, 3×2 or 4×2 cell) into a persistent
buffer and a trivial pass composites the phases; k is chosen so that the frame stays under
29 ms (at least 30 fps): 2–3 on a laptop panel, 8–16 on a 5K monitor. It falls back to 1
whenever the sheet is still, a control changes or a PNG is saved, so a still image is always
whole. The phases are visited in a dithered order, so neighbouring pixels are of mixed ages
and a moving edge reads as a little motion blur rather than a comb; the paint moves well under
a pixel per frame.

The comb differential ("ripple") is expressed in units of the tine spacing and was
measured on the scans: ≈1.2–1.5 spacings for fine combs, 2–6 for the get-gel passes.

### Drying onto the paper

- Film stretch σ (largest singular value of the Jacobian since the drop landed) thins the
  pigment gently; the material-space grain noise is sampled at the pre-deformation
  coordinate so it stretches with the paint (striations, speckle trails).
- Dispersant styles evaluated in drop-local coordinates: oil halo (Shell), partridge eye
  (Gloster), shot (Schrottel), lacy (Stormont), tiger eye, wet-paper (Morris), broken
  (Romantic), metallic (gold vein).
- Transfer stage: Spanish / moiré ripples, drag, wiggle, twill and trickle as coverage
  modulation plus small geometric shears (Jaffer's transfer-effect formulas).
- Analytic anti-aliasing, no supersampling: the pixel-space distance to each drop outline
  comes from the Jacobian. In a narrow footprint the outline's coverage is blurred by the
  bleed width and the trace continues behind the edge. Where the film is drawn out (combs),
  the footprint is treated as an interval along the stretch axis: each drop claims the exact
  sub-interval it covers, the trace point moves into the remainder, and up to eight pieces are
  composited with wet-edge mingling between neighbours. Chords of one colour from one layer
  share a piece, so a film drawn out into many hair lines is averaged exactly rather than
  sampled; and each chord is weighted by the drop's coverage of the pixel across the interval,
  so a streak running along the stretch axis renders as a faint continuous line instead of
  breaking into dashes. What the footprint cannot resolve (chords beyond the eight, chords
  thinner than 0.4 % of the footprint, the smaller leftover beside a claimed chord) is kept as
  an unresolved share and shown as the coverage-weighted mean colour of the sheet, so a film
  drawn out far below the pixel, as in the fans of a Feather, averages instead of stippling
  with bare ground.
- Between throws the bath keeps moving: shears applied between colour layers give each
  colour the elongation measured for it on the sheet, so earlier colours are more deformed.
- Feather is a comb of a few millimetres pulled hard (continuous bands 1–5 mm wide) followed
  by a comb with widely set teeth drawn across them and back, halving, and pulled the length of
  the bath with the wake kernel: straight columns of near-parallel lines at the quills, opposite
  sigmoids between (dp 29). The quills never move: the combs of a drawn base are laid still
  (no tine drift, no wavy-path phase), while the colours keep sliding and breathing along the
  fixed comb paths, as do the dots or drops thrown after the combing. Antique straight is a Feather followed by a shower of
  fine dots (dp 125, 131); Zebra is the same hard-pulled wide comb on a plain stone base, then
  one or more colours splashed on as large drops that sit on the bands (dp 15, 386). In all
  three the colours whose spots stayed round on the sheet (measured elongation below 2.2) are
  held back from the base and thrown after the combing.
- Wavy combs (Serpentine, Bouquet, Peacock) are straight combs conjugated by a sinusoidal
  shear; since particles then follow the sinusoid at constant offset, this is the curved-tine
  drag. Two interleaved tine sets in opposite phase give the staggered fans; the fan shape is
  set by the drag regime (small drag → closed scallops; larger drag → connected S-waves),
  verified with a forward-model sweep.
- Every pattern the catalogue describes as made "on a Turkish base" starts from the same call
  as the plain Turkish (Stone) sheet (rings, gall dots, residual swirl), with the throw inflated
  by the stretch the later combing measured on the sheet, since the drop statistics were taken
  from the combed bands. Following Miura as quoted by the catalogue: Peacock is Turkish, a
  one-row comb drawn down and back then across and back, halving, and a two-row comb drawn down
  in a loose wave (44 mm sets, 112 mm wavelength, dp 144); Bouquet is the same final comb on a
  Nonpareil (74 mm sets, 126 mm wavelength, dp 172); Serpentine is the double get-gel and one
  wider comb pulled hard down the sheet with a small swing (21 mm tines, 33 mm hairpins,
  dp 69); Double comb is an ordinary Nonpareil (4.5 mm) plus one lightly pulled 26 mm comb
  with the wake kernel, so the columns are separated by hair-line zones at the tine paths and
  the arches between them open against the pull (dp 393); Fountain is a 10 mm comb drawn
  across and back, then (on every UW sheet) stylus swirls ~165 mm apart (dp 156, 272); Placard
  is Schleicher's Drawn stone: a red film with paper patches, a few very large drops, gall
  water, free stylus sweeps and loose twirls (dp 96–98, 102).
- Spot sizes follow a shifted Weibull (1.2 mm floor) with a per-colour shape fitted on the
  scans; Weibull beat log-normal, gamma, exponential and Pareto by AIC across 43 colours.

### Paper and absorption

- Paper: cream base with anisotropic fibre noise, fine tooth and a low-frequency age tint;
  pre-1800 palettes render hand-made laid paper (laid lines 1.15 mm, chain lines 26 mm).
- Surface relief at fixed physical scales, whatever the zoom: fibre flocs (0.4 mm), formation
  mottle (1 and 0.5 mm) and fibre fuzz (0.2 and 0.1 mm). Every film takes unevenly on this
  relief, so each colour carries the mottle that 400 ppi scans of 19th-century book covers
  show inside every colour (the sheets in the collection were mostly cover papers). Heavy
  pigments granulate (settle darker in the hollows), pale ones stay even.
- Wear: on a handled cover the raised fibres rub bare, leaving pale specks on every colour
  (the "Wear" control).
- Where wet colours meet, the edge is blurred over a bleed width (default 0.12 mm) that
  wobbles with the fibres; inside the bleed zone the two pigments mingle (subtractive mix)
  and pile up into a slightly darker line.

## How the sheets were measured

For each scan, the catalogue's own sentence naming the colours of the sheet ("The primary
colors for this example are red, dark, medium and light blues, dark green and yellow") fixes
how many colours there are and what they are called. A full-covariance Gaussian mixture is
fitted to the scan in CIE Lab by expectation-maximisation, with the component count chosen so
that every named colour finds a component of compatible hue (a faded dark green may be a
near-neutral dark; it may never be a maroon), and one or two extra components admitted for
colours the description omits. Roles are assigned by measurable criteria: the least solid
colour is the ground, squeezed into a vein network by every later drop; spot colours are laid
in order of decreasing elongation; a colour full of holes is the dispersant colour; a "white"
covering much of the sheet is a thrown colour, a fine one is the sprinkle. Per colour the
coverage, spots per cm², median equivalent diameter, Weibull shape and elongation are recorded,
near-duplicate sheets of the same pattern are merged, and each sheet is attached to a recipe
by the leading term of its catalogue pattern name.

Whether a sheet was combed across or down is measured too: the global structure tensor of the
blurred scan gives the dominant streak orientation and its coherence (`streak` on each sheet),
and each combed recipe declares the orientation it is authored in; on a sheet whose coherent
streaks run the other way, every comb is turned through 90°. The same pattern name covers
both (Antique straight: dp 131 combed down the sheet, dp 125 across it). The double combs opt
out: on that two-scale pattern the tensor reads the arch bands on one sheet and the arch
flanks on another, both combed down the sheet, so their columns stay as authored.

The recipe is then fitted in the page: `window.marble.fitRecipe(name, iters, paletteKey)`
builds the real recipe, measures every colour exactly with a shader probe over a wide sheet,
and adjusts each colour's median spot size (and, on sheets showing paper, the ground fill)
until the rendered fractions match the scan. `window.marble` also exposes `measureExact`,
`showScene(scene, pal)` and `Builder` for experiments.

The measurement scripts (harvest, mixture-model analysis, palette generation, baking) are not
part of this repository because they operate on the collection's images.

## Sources

- **Marbling mathematics.** Shufang Lu, Aubrey Jaffer, Xiaogang Jin, Hanli Zhao and Xiaoyang
  Mao, "Mathematical Marbling", *IEEE Computer Graphics and Applications* 32(6), 2012; and
  Aubrey Jaffer, "Oseen Flow in Paint Marbling", arXiv:1702.02106, 2017. Aubrey Jaffer's
  pages at <https://people.csail.mit.edu/jaffer/Marbling/> collect the closed-form drop,
  tine, vortex and transfer formulas that this shader inverts.
- **Historical sheets and pattern descriptions.** University of Washington Libraries,
  Special Collections, *Decorated and Decorative Paper Collection*,
  <https://content.lib.washington.edu/dpweb/> (pattern guide at
  <https://content.lib.washington.edu/dpweb/patterns.html>; items at
  <https://digitalcollections.lib.washington.edu/digital/collection/dp>). The catalogue's
  pattern descriptions and colour lists draw on Richard J. Wolfe, *Marbled Paper: Its
  History, Techniques, and Patterns* (University of Pennsylvania Press, 1990) and Einen
  Miura, *The Art of Marbled Paper* (Kodansha, 1991), which the catalogue cites as "Wolfe and
  Miura". The collection's images are provided by the library for reference purposes only
  and may not be reproduced; accordingly no scan, thumbnail or crop is included here. Each
  palette carries the catalogue item number of the sheet it was measured from (`source:
  "dp 370"` and the like) so the original can be consulted: the ↗ beside the Sheet control
  opens the catalogue page, and the tiny thumbnails in the Sheet menu are fetched by your
  browser from the collection's own IIIF image server when the menu opens.
- **Libraries.** [Vite](https://vitejs.dev/), [TypeScript](https://www.typescriptlang.org/)
  and [lil-gui](https://lil-gui.georgealways.com/) for the panel. The shader itself has no
  dependencies.

## Files

- `src/main.ts` — WebGL2 harness, uniforms, per-frame layer baking, GUI wiring, PNG export,
  measurement and fitting hooks
- `src/recipes.ts` — the 39 pattern recipes, op builders, and the hand-written palettes
- `src/palettes.generated.ts` — the 419 measured sheets (generated, do not edit by hand)
- `src/layers.ts` — per-cell drop data (jitter, Weibull radii, balanced colours, animation)
- `src/gui.ts` — panel, per-pattern sheet list
- `src/ops.ts` — op encoding shared with the shader
- `src/shaders/marble.frag` — the simulation and shading

## Licence

MIT for the code (see `LICENSE`). The measurements in `src/palettes.generated.ts` are
derived data; the underlying images belong to the University of Washington Libraries and
their rights holders.
