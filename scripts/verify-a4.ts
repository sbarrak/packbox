import { writeFileSync } from "node:fs";
import { getBoxStyle, BOX_STYLES } from "../src/geometry/boxBuilders";
import { computeFlatLayout } from "../src/geometry/layout";
import { generateDielineSVG } from "../src/geometry/svgExport";
import { planA4Pages } from "../src/geometry/paginate";

for (const style of BOX_STYLES) {
  const root = style.build(style.defaultDimensions);
  const layout = computeFlatLayout(root);
  const plan = planA4Pages(layout.bounds, 10);
  console.log(
    `${style.label.padEnd(28)} sheet=${layout.bounds.width.toFixed(0)}x${layout.bounds.height.toFixed(0)}mm  -> ${
      plan.singlePage ? `1 page (${plan.orientation})` : `${plan.pages.length} pages (${plan.cols}x${plan.rows} grid, ${plan.orientation})`
    }`,
  );
}

// Render one small (single-page) and one large (tiled) style to inspect visually.
function renderTiles(styleId: string) {
  const style = getBoxStyle(styleId as any);
  const root = style.build(style.defaultDimensions);
  const layout = computeFlatLayout(root);
  const plan = planA4Pages(layout.bounds, 10);
  console.log(`\n${style.label}: ${plan.pages.length} page(s), ${plan.cols}x${plan.rows}, orientation=${plan.orientation}`);
  plan.pages.forEach((tile, i) => {
    const svg = generateDielineSVG(layout, {
      showDimensions: plan.singlePage,
      title: style.label,
      viewBox: { x: tile.x, y: tile.y, width: tile.width, height: tile.height },
      trimGuide: true,
      tileGrid: plan.singlePage ? undefined : { usableWidth: plan.usable.width, usableHeight: plan.usable.height },
    });
    const filename = `/tmp/a4-${styleId}-page${i + 1}.svg`;
    writeFileSync(filename, svg);
    console.log(`  wrote ${filename} (tile ${tile.width.toFixed(0)}x${tile.height.toFixed(0)}mm at ${tile.x.toFixed(0)},${tile.y.toFixed(0)})`);
  });
}

renderTiles("card-deck"); // should fit on one A4 (landscape)
renderTiles("rsc"); // should need tiling
