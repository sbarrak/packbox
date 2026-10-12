import Drawing, { type Point2D } from "dxf-writer";
import type { DielineLayout } from "./types";

/** Production DXF with CUT and FOLD on separate layers, in millimeters. */
export function generateDielineDXF(layout: DielineLayout): string {
  const d = new Drawing();
  d.setUnits("Millimeters");
  d.addLayer("CUT", Drawing.ACI.RED, "CONTINUOUS");
  d.addLayer("FOLD", Drawing.ACI.GREEN, "DASHED");

  d.setActiveLayer("CUT");
  for (const poly of layout.cutOutline) {
    // Flip Y: DXF/CAD convention is Y-up from a different origin than our SVG (top-left).
    const pts: Point2D[] = poly.map(([x, y]) => [x, layout.bounds.height - y]);
    d.drawPolyline(pts, false);
  }

  d.setActiveLayer("FOLD");
  for (const f of layout.foldLines) {
    d.drawLine(f.a[0], layout.bounds.height - f.a[1], f.b[0], layout.bounds.height - f.b[1]);
  }

  return d.toDxfString();
}
