import { BOX_STYLES } from "../src/geometry/boxBuilders";
import { computeFlatLayout } from "../src/geometry/layout";
import { worldToPanelLocal, panelLocalToWorld } from "../src/geometry/types";

let fails = 0;
for (const style of BOX_STYLES) {
  const layout = computeFlatLayout(style.build(style.defaultDimensions));
  let bad = 0, mirrored = 0;
  for (const p of layout.panels) {
    if (p.mirrored) mirrored++;
    // 1. min/max must be the true bbox of points
    const xs = p.points.map((q) => q[0]), ys = p.points.map((q) => q[1]);
    if (Math.abs(Math.min(...xs) - p.min[0]) > 1e-6 || Math.abs(Math.min(...ys) - p.min[1]) > 1e-6) bad++;
    if (Math.abs(Math.max(...xs) - p.max[0]) > 1e-6 || Math.abs(Math.max(...ys) - p.max[1]) > 1e-6) bad++;
    // 2. every point must map into local range 0..w / 0..h
    for (const pt of p.points) {
      const [lx, ly] = worldToPanelLocal(p, pt);
      if (lx < -1e-6 || lx > p.w + 1e-6 || ly < -1e-6 || ly > p.h + 1e-6) bad++;
      // 3. round-trip must be exact
      const [bx, by] = panelLocalToWorld(p, [lx, ly]);
      if (Math.abs(bx - pt[0]) > 1e-6 || Math.abs(by - pt[1]) > 1e-6) bad++;
    }
    // 4. bbox must not be degenerate
    if (p.max[0] - p.min[0] < 1e-9 || p.max[1] - p.min[1] < 1e-9) bad++;
  }
  const ok = bad === 0;
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${style.label.padEnd(28)} ${layout.panels.length} panels (${mirrored} mirrored), ${bad} problem(s)`);
}
console.log(fails === 0 ? "\nALL BBOX CHECKS PASSED" : `\n${fails} STYLE(S) FAILED`);
process.exit(fails ? 1 : 0);
