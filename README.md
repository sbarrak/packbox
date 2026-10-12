# PackBox Studio

A local packaging design app: generate dielines, place artwork, and preview the box folding in 3D — no cloud account, no upload of your artwork anywhere.

> **New to packaging, or to this app?** Read the **PackBox Studio User Manual** in
> [`docs/PackBox-Studio-User-Manual.pdf`](docs/PackBox-Studio-User-Manual.pdf) (also supplied
> as `.docx`, `.txt` and the Markdown source, with its figures in `docs/assets/`). It covers
> the packaging vocabulary from scratch, installation on macOS and Windows, every feature in
> the UI, a step-by-step worked example building the Card Deck Box (Lock Lid), and how to
> print, cut and assemble the result. Every illustration in it is rendered from this
> repository's own geometry code. This README is the short technical summary.

## What it does

- **Parametric dielines** across ten box styles: Straight Tuck End carton, RSC shipping box, Card Deck Box (glued), Card Deck Box (Lock Lid — re-openable lid with a lock flap on the glue panel), Mailer Box, Open Tray (HSC), Auto-Lock Bottom Tray, Tuck-Top Auto-Bottom Box, and a Two-Piece Box (separate Base + Lid templates). Pick a style from the dropdown, enter L/W/H (and flap depths), and the cut/fold lines regenerate instantly.
- **Cut/fold color convention**: cut lines are red, fold lines are green, in the on-screen editor and in every export (SVG, DXF layers, PDF).
- **Artwork**: upload one full flattened artwork sheet aligned to the dieline, or assign a separate image per panel. Add text and logo layers on top, per panel, for outside and inside separately.
- **3D fold simulator**: drag a slider to unfold/fold the box, orbit freely all the way around it (no floor/ground plane to clip through), and see your artwork mapped onto the outside and inside faces.
- **Exports**: production-ready SVG and DXF (cut lines on a `CUT` layer, fold lines on a `FOLD` layer) for a die-cutter or print vendor, a print-ready A4 PDF (true to size, tiled across pages when the dieline is larger than one sheet, and always emitting a pre-mirrored inside page for duplex printing), and a textured GLB of the 3D model.
- **Editing**: zoom (1–999 %, anchored at the cursor) and pan the 2D canvas, click a panel to flash the sidebar control that governs it, resize/rotate artwork with proportional corner handles and 45° rotation snapping, and undo/redo the whole design with ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Shift+Z).

## Running it

This is an Electron desktop app built with React, Three.js (via react-three-fiber), and Konva.

**Easiest way — double-click the launcher** (needs Node.js installed once, from nodejs.org):

- macOS: double-click **`PackBox Studio.app`** in this folder
- Windows: double-click **`PackBox Studio.bat`** in this folder

The launcher installs dependencies on first run, then on EVERY launch rebuilds
from the current source before opening — so after the code is updated (e.g. by
Claude), the next double-click automatically runs the latest version. Nothing
is installed to your system; delete the folder and it's gone. If macOS blocks
the first open, right-click the app → Open once. If a launch fails, check
`launcher.log` in this folder.

**Saving your work:** the Save button (top-left) writes the whole design — box
style, dimensions, and all artwork/text/logos with every image embedded — into
a single `.pbox` file. Open loads it back. The file is self-contained JSON, so
it survives being moved between machines.

For development with hot reload:

```bash
npm install
npm run electron:dev     # launches the app in a desktop window with hot reload
```

To build an installable app for your OS:

```bash
npm run electron:build   # outputs to ./release
```

You can also run it as a plain local web app (in a browser tab) without Electron:

```bash
npm run dev               # then open the printed http://localhost:5173 URL
```

## Project layout

```
src/
  geometry/       Box dieline math: panel-tree builders (per box style), flat-layout
                  computation, and SVG/PDF/DXF/GLB exporters. Pure functions, no UI.
  artwork/        Artwork data model + canvas rendering (per-panel textures, full-sheet
                  compositing) used by both the 2D editor and the 3D viewer.
  components/     React UI: Sidebar (style/dimensions), DielineEditor (2D canvas),
                  Fold3D (3D viewer), ArtworkPanel (uploads/layers), ExportBar.
electron/         Electron main process + preload script.
scripts/          smoke-test.ts — geometry regression checks (panel counts, no
                  overlaps, valid bounds, exact cut/fold edge accounting) across
                  every box style. Run with `npx tsx scripts/smoke-test.ts`.
                  Alongside it: verify-fold.ts (wall facing + flap closing per
                  style), verify-duplex.ts, verify-a4.ts, verify-bbox.ts,
                  verify-project.ts, verify-texture.ts, and render-svg.ts.
```

## How the geometry model works

Each box style is built as a **tree of panels**: every non-root panel is attached to its
parent along one edge (a "hinge"), with a target fold angle. That single tree is used two ways:

- Flattened (all hinge angles at 0) → the 2D dieline you cut.
- Folded (hinge angles animated to their targets) → the 3D box.

Adding a new box style means writing one function in `src/geometry/boxBuilders.ts` that
attaches panels together — the 2D layout, fold-line detection, 3D fold hierarchy, and all
exporters work automatically from that tree.

## Known limitations / next steps

- The panel-tree model only supports a single rigid crease per hinge, so styles with
  compound/curved creases — gable-top (milk carton) boxes, pillow boxes — don't fit it
  cleanly and aren't included. Everything that's a chain of flat rectangular panels
  (tube + flaps) works well and is cheap to add; see `boxBuilders.ts`.
- The Two-Piece Box ships as two separate templates (Base and Lid) rather than one
  style that generates both pieces at once — simpler to reason about, but you do have
  to switch templates and export twice.
- The Auto-Lock Bottom Tray shows the general tab shape of a snap-lock bottom, not the
  interlocking mating slots between adjacent tabs (that needs multi-panel slot cuts,
  not modeled yet).
- The 3D fold directions are computed from geometric reasoning about each hinge; if a
  flap ever folds the "wrong way" for a given style, it's a one-line sign flip on that
  panel's `foldAngle` in `boxBuilders.ts`.
- The in-app editor supports text and image layers (move / resize / rotate) and global
  undo-redo across style, dimensions and artwork; it doesn't yet do multi-select or
  alignment guides.
- Board thickness is not modelled — the geometry treats the board as having zero
  thickness, so a lid that has to slide over a base needs its clearance added by hand
  (see the Two-Piece Box defaults).
