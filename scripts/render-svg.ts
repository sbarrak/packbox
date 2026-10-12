import { writeFileSync } from "node:fs";
import { BOX_STYLES } from "../src/geometry/boxBuilders";
import { computeFlatLayout } from "../src/geometry/layout";
import { generateDielineSVG } from "../src/geometry/svgExport";

for (const style of BOX_STYLES) {
  const root = style.build(style.defaultDimensions);
  const layout = computeFlatLayout(root);
  const svg = generateDielineSVG(layout, { showDimensions: true, title: style.label });
  console.log(`${style.label}: bounds ${layout.bounds.width.toFixed(1)} x ${layout.bounds.height.toFixed(1)} mm`);
  const filename = `/tmp/dieline-${style.id}.svg`;
  writeFileSync(filename, svg);
  console.log(`wrote ${filename}`);
}
