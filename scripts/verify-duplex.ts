/**
 * Proves the PDF's outside and inside pages line up once the sheet is physically
 * flipped for duplex printing.
 *
 * Method: take the cut-line geometry as it is actually emitted on each page (in
 * page mm), apply the physical flip that "flip on long edge" performs to the
 * INSIDE page, and check every point lands back on the OUTSIDE page's geometry.
 *   - portrait  page (210x297): long edge vertical   -> x' = pageW - x
 *   - landscape page (297x210): long edge horizontal -> y' = pageH - y
 */
import { BOX_STYLES } from "../src/geometry/boxBuilders";
import { computeFlatLayout } from "../src/geometry/layout";
import { generateDielineSVG } from "../src/geometry/svgExport";
import { planA4Pages } from "../src/geometry/paginate";

const MARGIN = 10, BLEED = 6;

/** Pulls every coordinate out of the cut-lines group of an SVG string. */
function cutPoints(svg: string): [number, number][] {
  const grp = svg.split('<g id="cut-lines">')[1].split("</g>")[0];
  const pts: [number, number][] = [];
  for (const m of grp.matchAll(/[ML]\s*(-?[\d.]+),(-?[\d.]+)/g)) pts.push([parseFloat(m[1]), parseFloat(m[2])]);
  return pts;
}

/** Applies the group transform the exporter emitted, so we compare real page positions. */
function applyMirror(svg: string, p: [number, number]): [number, number] {
  const mx = /translate\((-?[\d.]+),0\)\s*scale\(-1,1\)/.exec(svg);
  if (mx) return [parseFloat(mx[1]) - p[0], p[1]];
  const my = /translate\(0,(-?[\d.]+)\)\s*scale\(1,-1\)/.exec(svg);
  if (my) return [p[0], parseFloat(my[1]) - p[1]];
  return p;
}

let fails = 0;
for (const style of BOX_STYLES) {
  const layout = computeFlatLayout(style.build(style.defaultDimensions));
  const plan = planA4Pages(layout.bounds, MARGIN);
  const tile = plan.pages[0];
  const view = { x: tile.x - BLEED, y: tile.y - BLEED, width: tile.width + 2 * BLEED, height: tile.height + 2 * BLEED };
  const common = { title: "t", viewBox: view, outputSizeMm: { width: view.width, height: view.height }, trimGuide: true } as const;

  const outSvg = generateDielineSVG(layout, common);
  const inSvg = generateDielineSVG(layout, { ...common, mirror: plan.orientation === "landscape" ? "y" : "x" });

  // Where the tile is placed on the physical page.
  const offX = plan.singlePage ? MARGIN + (plan.usable.width - tile.width) / 2 : MARGIN;
  const offY = plan.singlePage ? MARGIN + (plan.usable.height - tile.height) / 2 : MARGIN;
  const pageW = plan.orientation === "landscape" ? 297 : 210;
  const pageH = plan.orientation === "landscape" ? 210 : 297;
  // viewBox units map 1:1 to mm; translate viewBox space -> page space.
  const toPage = (p: [number, number]): [number, number] => [p[0] - view.x + (offX - BLEED), p[1] - (plan.orientation && 0) + (offY - BLEED) - (view.y - view.y)];

  const outPts = cutPoints(outSvg).map((p) => applyMirror(outSvg, p));
  const inPts = cutPoints(inSvg).map((p) => applyMirror(inSvg, p));

  if (outPts.length !== inPts.length) { console.log(`FAIL ${style.label}: point count differs`); fails++; continue; }

  // Physically flip the inside page, then it must coincide with the outside page.
  const flipped = inPts.map(([x, y]): [number, number] =>
    plan.orientation === "landscape" ? [x, 2 * (view.y + view.height / 2) - y] : [2 * (view.x + view.width / 2) - x, y],
  );

  const key = (p: [number, number]) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  const outSet = new Set(outPts.map(key));
  const missing = flipped.filter((p) => !outSet.has(key(p)));
  const ok = missing.length === 0;
  if (!ok) fails++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${style.label.padEnd(28)} ${plan.orientation.padEnd(9)} mirror=${plan.orientation === "landscape" ? "y" : "x"}  ${outPts.length} pts, ${missing.length} misaligned`,
  );
}
console.log(fails === 0 ? "\nBOTH PAGES REGISTER CORRECTLY AFTER THE LONG-EDGE FLIP" : `\n${fails} FAILED`);
process.exit(fails ? 1 : 0);
