import type { DielineLayout, FlatPanel } from "./types";

/**
 * A single double-headed dimension line: a straight measurement between two
 * points with arrowheads at both ends and a text label at its midpoint.
 * Coordinates are in sheet millimeters, Y-up (same convention as FoldLine/
 * Point elsewhere in the layout — callers that render to SVG/canvas are
 * responsible for flipping Y themselves, same as they already do for
 * cut/fold lines).
 */
export interface DimensionLine {
  id: string;
  orientation: "h" | "v";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  labelX: number;
  labelY: number;
}

// How far outside the sheet the two "overall size" dimension lines sit.
const OUTER_OFFSET_MM = 14;
// Segments/rows smaller than this on the relevant axis are skipped — no room to
// draw arrows + a readable label without clutter.
const MIN_DIM_MM = 16;
// Panels are grouped into the same "row" when their vertical extent matches
// within this tolerance.
const ROW_EPS_MM = 0.5;

interface Row {
  y0: number;
  y1: number;
  panels: FlatPanel[];
}

/**
 * Groups panels that share the same vertical extent (same origin.y AND height)
 * into rows — exactly how every box style here is actually laid out: a main strip
 * of side walls, plus tiers of flaps attached above/below at a shared depth. This
 * is what lets width/height get dimensioned the way a real dieline reference
 * does: one row of panels = one shared height (labeled once, not once per
 * panel) and one shared horizontal "lane" where each panel gets its own width
 * segment rather than a separate, independently-offset arrow.
 */
function groupIntoRows(panels: FlatPanel[]): Row[] {
  const rows: Row[] = [];
  for (const p of panels) {
    // Must use the true bbox, not origin+h: for a mirrored (bottom-attached)
    // flap, `origin` is its top hinge edge, so origin..origin+h would describe a
    // band inside the wall above it instead of the flap itself — which is exactly
    // what put bottom-flap depth labels in the wrong place.
    const y0 = p.min[1];
    const y1 = p.max[1];
    let row = rows.find((r) => Math.abs(r.y0 - y0) < ROW_EPS_MM && Math.abs(r.y1 - y1) < ROW_EPS_MM);
    if (!row) {
      row = { y0, y1, panels: [] };
      rows.push(row);
    }
    row.panels.push(p);
  }
  return rows;
}

/**
 * Builds a clean, "one line per distinct measurement" set of dimension lines:
 * the overall sheet width/height (outside the sheet, shown once), plus — per
 * row of panels that share the same height — one shared height arrow and one
 * shared horizontal lane carrying each panel's individual width. This avoids
 * the clutter of repeating the same height arrow inside every panel of a row
 * that are all, by construction, the same height.
 */
export function computeDimensionLines(layout: DielineLayout): DimensionLine[] {
  const lines: DimensionLine[] = [];
  const { width: W, height: H } = layout.bounds;

  lines.push({
    id: "overall-w",
    orientation: "h",
    x1: 0,
    y1: -OUTER_OFFSET_MM,
    x2: W,
    y2: -OUTER_OFFSET_MM,
    label: `${W.toFixed(0)} mm`,
    labelX: W / 2,
    labelY: -OUTER_OFFSET_MM,
  });
  lines.push({
    id: "overall-h",
    orientation: "v",
    x1: -OUTER_OFFSET_MM,
    y1: 0,
    x2: -OUTER_OFFSET_MM,
    y2: H,
    label: `${H.toFixed(0)} mm`,
    labelX: -OUTER_OFFSET_MM,
    labelY: H / 2,
  });

  const rows = groupIntoRows(layout.panels);

  for (const row of rows) {
    const rowH = row.y1 - row.y0;
    const sorted = [...row.panels].sort((a, b) => a.min[0] - b.min[0]);

    if (rowH >= MIN_DIM_MM) {
      // One height arrow for the whole row, inset inside its leftmost panel.
      const rep = sorted[0];
      const x = rep.min[0] + rep.w * 0.4;
      const inset = Math.min(rowH * 0.14, 6);
      lines.push({
        // Must be unique per row BAND, not just per y0 — two different flap tiers
        // (e.g. an RSC-style major flap and minor flap) can share the same y0 with
        // a different y1/height. A collision here isn't just cosmetic: this id
        // doubles as the React key in the 2D editor, so two rows colliding on the
        // same key made React mismatch/reuse the wrong element's position between
        // re-renders — which is what caused a height label to render in the wrong
        // spot (reported on the card-deck box's bottom flap row).
        id: `row-${row.y0.toFixed(1)}-${row.y1.toFixed(1)}-h`,
        orientation: "v",
        x1: x,
        y1: row.y0 + inset,
        x2: x,
        y2: row.y1 - inset,
        label: `${rowH.toFixed(0)}`,
        labelX: x,
        labelY: (row.y0 + row.y1) / 2,
      });
    }

    // One shared horizontal lane through the row's vertical center; every
    // wide-enough panel gets its own width segment along that same line.
    const laneY = row.y0 + rowH * 0.5;
    for (const p of sorted) {
      if (p.w < MIN_DIM_MM) continue;
      const inset = Math.min(p.w * 0.12, 5);
      lines.push({
        id: `${p.id}-w`,
        orientation: "h",
        x1: p.min[0] + inset,
        y1: laneY,
        x2: p.min[0] + p.w - inset,
        y2: laneY,
        label: `${p.w.toFixed(0)}`,
        labelX: p.min[0] + p.w / 2,
        labelY: laneY,
      });
    }
  }

  return lines;
}
