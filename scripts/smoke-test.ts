import { BOX_STYLES } from "../src/geometry/boxBuilders";
import { computeFlatLayout, flattenTree } from "../src/geometry/layout";
import { generateDielineSVG } from "../src/geometry/svgExport";
import { generateDielineDXF } from "../src/geometry/dxfExport";
import { rect } from "../src/geometry/shapes";

let failures = 0;

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  } else {
    console.log(`ok   ${msg}`);
  }
}

for (const style of BOX_STYLES) {
  console.log(`\n=== ${style.label} ===`);
  const root = style.build(style.defaultDimensions);
  const nodes = flattenTree(root);
  assert(nodes.length >= 9, `has a reasonable panel count (${nodes.length})`);

  const layout = computeFlatLayout(root);
  assert(layout.panels.length === nodes.length, `layout has one FlatPanel per tree node (${layout.panels.length})`);
  assert(layout.bounds.width > 0 && layout.bounds.height > 0, `bounds are positive (${layout.bounds.width.toFixed(1)} x ${layout.bounds.height.toFixed(1)} mm)`);

  const allFinite = layout.panels.every((p) => p.points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
  assert(allFinite, "every panel point is a finite number (no NaN/Infinity)");

  const withinBounds = layout.panels.every((p) => p.points.every(([x, y]) => x >= -0.01 && y >= -0.01 && x <= layout.bounds.width + 0.01 && y <= layout.bounds.height + 0.01));
  assert(withinBounds, "every panel point falls within the computed sheet bounds");

  // Root panel should have no fold line to a parent; every other node should.
  const expectedFoldLines = nodes.filter((n) => n.parentEdge && n.hinged).length;
  assert(layout.foldLines.length === expectedFoldLines, `fold line count matches hinged children (${layout.foldLines.length}/${expectedFoldLines})`);

  // Every RAW edge (each panel's own outline is counted independently, so a shared
  // hinge boundary contributes 2 raw edges — one from each side) must resolve to
  // EITHER a cut segment (1 raw edge) OR a fold line (which collapses a matching
  // pair of raw edges into a single shared line). A hinge that also sneaks into the
  // cut outline would silently paint over the fold line — this catches that.
  const totalRawEdges = nodes.reduce((sum, n) => sum + (n.outline ?? rect(n.w, n.h)).length, 0);
  const cutSegments = layout.cutOutline.reduce((sum, poly) => sum + Math.max(0, poly.length - 1), 0);
  const reconstructed = cutSegments + 2 * layout.foldLines.length;
  assert(reconstructed === totalRawEdges, `every raw edge accounted for exactly once, no cut/fold overlap (${reconstructed}/${totalRawEdges})`);

  // No two panels should overlap in their bounding boxes (rough non-overlap sanity check).
  const bboxes = layout.panels.map((p) => {
    const xs = p.points.map((pt) => pt[0]);
    const ys = p.points.map((pt) => pt[1]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), name: p.name };
  });
  let overlapCount = 0;
  for (let i = 0; i < bboxes.length; i++) {
    for (let j = i + 1; j < bboxes.length; j++) {
      const a = bboxes[i];
      const b = bboxes[j];
      const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
      const overlapY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
      if (overlapX > 0.5 && overlapY > 0.5) {
        overlapCount++;
        console.error(`  overlap: "${a.name}" x "${b.name}" (${overlapX.toFixed(1)} x ${overlapY.toFixed(1)} mm)`);
      }
    }
  }
  assert(overlapCount === 0, `no panel bounding boxes overlap (${overlapCount} found)`);

  const svg = generateDielineSVG(layout, { showDimensions: true, title: style.label });
  assert(svg.includes("<svg") && svg.includes("cut-lines") && svg.includes("fold-lines"), "SVG export contains cut & fold groups");

  const dxf = generateDielineDXF(layout);
  assert(dxf.includes("CUT") && dxf.includes("FOLD"), "DXF export contains CUT & FOLD layers");
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
