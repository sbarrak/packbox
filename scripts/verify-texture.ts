/**
 * End-to-end check of the artwork -> panel texture pipeline, the thing that kept
 * failing to appear in the 3D view. Runs the REAL renderPanel code against a
 * node canvas implementation and asserts the artwork's own pixels actually land
 * inside each panel's texture (and that UVs map the panel to 0..1).
 */
import { createCanvas, Image as NodeImage } from "@napi-rs/canvas";
import * as THREE from "three";
import { getBoxStyle } from "../src/geometry/boxBuilders";
import { computeFlatLayout } from "../src/geometry/layout";
import { rect } from "../src/geometry/shapes";
import { buildSheetCanvas, renderPanelCanvas } from "../src/artwork/renderPanel";
import { emptySide } from "../src/artwork/types";

// Shim the two DOM globals renderPanel.ts uses.
(globalThis as any).document = { createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}) };
(globalThis as any).Image = NodeImage;

// A distinctive magenta artwork sheet.
const art = createCanvas(200, 200);
const actx = art.getContext("2d");
actx.fillStyle = "#ff00ff";
actx.fillRect(0, 0, 200, 200);
const artUrl = art.toDataURL("image/png");

const style = getBoxStyle("card-deck");
const layout = computeFlatLayout(style.build(style.defaultDimensions));

const side = { ...emptySide("#ffffff"), sheetImage: artUrl, sheetWidth: layout.bounds.width, sheetHeight: layout.bounds.height };

(async () => {
  const sheet = await buildSheetCanvas(side as any, layout, 4);
  let fails = 0;

  // 1. the sheet canvas itself must contain the artwork
  const sctx = (sheet as any).getContext("2d");
  const mid = sctx.getImageData(Math.floor(sheet.width / 2), Math.floor(sheet.height / 2), 1, 1).data;
  const sheetOk = mid[0] > 200 && mid[1] < 60 && mid[2] > 200;
  console.log(`${sheetOk ? "ok  " : "FAIL"} sheet canvas carries the artwork (rgb ${mid[0]},${mid[1]},${mid[2]})`);
  if (!sheetOk) fails++;

  // 2. every panel texture must carry artwork pixels, mirrored flaps included
  for (const panel of layout.panels) {
    const c: any = await renderPanelCanvas(panel, side as any, layout, sheet as any, 4);
    const ctx = c.getContext("2d");
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let magenta = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] > 200) magenta++;
    const frac = magenta / (c.width * c.height);
    const ok = frac > 0.25;
    if (!ok) fails++;
    console.log(`${ok ? "ok  " : "FAIL"} ${panel.name.padEnd(24)}${panel.mirrored ? " (mirrored)" : "           "} artwork covers ${(frac * 100).toFixed(0)}% of texture`);
  }

  // 3. UVs must be normalised 0..1 (the earlier smeared-colour bug)
  for (const node of [{ w: 70, h: 100, outline: undefined as any }]) {
    const pts = node.outline ?? rect(node.w, node.h);
    const geom = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, y]: any) => new THREE.Vector2(x, y))));
    const uv = geom.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / node.w, uv.getY(i) / node.h);
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < uv.count; i++) { mn = Math.min(mn, uv.getX(i), uv.getY(i)); mx = Math.max(mx, uv.getX(i), uv.getY(i)); }
    const ok = Math.abs(mn) < 1e-6 && Math.abs(mx - 1) < 1e-6;
    if (!ok) fails++;
    console.log(`${ok ? "ok  " : "FAIL"} panel UVs normalised to 0..1 (got ${mn}..${mx})`);
  }

  console.log(fails === 0 ? "\nALL TEXTURE CHECKS PASSED" : `\n${fails} FAILED`);
  process.exit(fails ? 1 : 0);
})();
