import type { DielineLayout, Point } from "./types";
import { computeDimensionLines } from "./dimensions";

const MM_TO_PT = 72 / 25.4;

// Our layout coordinates are Y-up (origin bottom-left, matching how a person reads
// panel dimensions) but SVG is Y-down (origin top-left). Every vector coordinate we
// emit has to flip Y so "top" flaps land at the top of the rendered file — the
// embedded artwork raster is already flipped this way when it's rasterized, so
// leaving the vector lines un-flipped would (and used to) mismatch the artwork.
function flipY([x, y]: Point, height: number): Point {
  return [x, height - y];
}

function pathFromPoints(points: Point[], height: number): string {
  if (points.length === 0) return "";
  const flipped = points.map((p) => flipY(p, height));
  const [first, ...rest] = flipped;
  return `M ${first[0].toFixed(2)},${first[1].toFixed(2)} ` + rest.map((p) => `L ${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");
}

export interface SvgExportOptions {
  /** Data URL of the flattened artwork (full sheet), drawn behind the cut/fold lines. */
  artworkDataUrl?: string;
  showDimensions?: boolean;
  title?: string;
  /**
   * Sub-region of the full sheet to render, in sheet mm coordinates (Y-up, same as
   * layout.bounds). Defaults to the whole sheet. Used to cut one A4-sized tile out
   * of a larger dieline — everything outside the viewBox is simply clipped by SVG,
   * no separate geometry cropping needed.
   */
  viewBox?: { x: number; y: number; width: number; height: number };
  /** Physical output size in mm, if different from the viewBox (defaults to 1:1). */
  outputSizeMm?: { width: number; height: number };
  /** Draw a trim-guide rectangle + corner crop marks around the full sheet bounds. */
  trimGuide?: boolean;
  /** Draw "+" alignment marks at every `tileGrid.usable` interval, for taping multi-page prints together. */
  tileGrid?: { usableWidth: number; usableHeight: number };
  /**
   * Draw double-headed dimension-line measurements (overall sheet size + every
   * panel's width/height) for checking the drawing, or for printed mockups.
   * Off by default — this is a verification/reference overlay, not production art.
   */
  dimensions?: boolean;
  /**
   * Mirrors the ENTIRE rendered page (dieline + artwork + guides) about the
   * given axis. Used for the inside-surface sheet so that, once printed
   * double-sided and cut once, the inside artwork lands exactly behind the
   * outside artwork on the same physical paper.
   *
   * Which axis is correct depends on the PAGE ORIENTATION, because "flip on long
   * edge" means rotating the sheet about an axis parallel to its 297mm edge:
   *   - portrait  (210x297): the long edge runs vertically   -> "x" (left/right flip)
   *   - landscape (297x210): the long edge runs horizontally -> "y" (top/bottom flip)
   * Getting this wrong puts the inside artwork on the correct sheet but rotated
   * 180 degrees relative to the outside, so nothing lines up.
   */
  mirror?: "x" | "y";
  /** Extra raw SVG markup injected just before </svg> (e.g. a page label). */
  extra?: string;
}

function buildTrimGuide(sheetWidth: number, sheetHeight: number, viewHeight: number, markLen = 6): string {
  const corners: Point[] = [
    [0, 0],
    [sheetWidth, 0],
    [sheetWidth, sheetHeight],
    [0, sheetHeight],
  ];
  const rectPath = pathFromPoints([...corners, corners[0]], viewHeight);
  const rect = `<path d="${rectPath}" fill="none" stroke="#94a3b8" stroke-width="0.25" stroke-dasharray="3,2" />`;

  const ticks = corners
    .map(([x, y]) => {
      const dx = x === 0 ? -1 : 1;
      const dy = y === 0 ? -1 : 1;
      const [fx, fy] = flipY([x, y], viewHeight);
      return [
        `<line x1="${fx}" y1="${fy}" x2="${fx + dx * markLen}" y2="${fy}" stroke="#111827" stroke-width="0.3" />`,
        `<line x1="${fx}" y1="${fy}" x2="${fx}" y2="${fy + dy * markLen}" stroke="#111827" stroke-width="0.3" />`,
      ].join("\n    ");
    })
    .join("\n    ");

  return `${rect}\n    ${ticks}`;
}

function buildSeamMarks(sheetWidth: number, sheetHeight: number, viewHeight: number, usableWidth: number, usableHeight: number, spacing = 50): string {
  const marks: string[] = [];
  const crossAt = (x: number, y: number) => {
    const [fx, fy] = flipY([x, y], viewHeight);
    marks.push(
      `<line x1="${fx - 2.5}" y1="${fy}" x2="${fx + 2.5}" y2="${fy}" stroke="#2563eb" stroke-width="0.3" />`,
      `<line x1="${fx}" y1="${fy - 2.5}" x2="${fx}" y2="${fy + 2.5}" stroke="#2563eb" stroke-width="0.3" />`,
    );
  };
  for (let x = usableWidth; x < sheetWidth; x += usableWidth) {
    for (let y = 0; y <= sheetHeight; y += spacing) crossAt(x, y);
  }
  for (let y = usableHeight; y < sheetHeight; y += usableHeight) {
    for (let x = 0; x <= sheetWidth; x += spacing) crossAt(x, y);
  }
  return marks.join("\n    ");
}

/**
 * Draws double-headed dimension lines (line + two outward-pointing arrowheads).
 * Returns the arrow/line "shapes" (safe to mirror along with the rest of the
 * drawing — direction-agnostic) separately from the text "labels" (kept
 * unmirrored and pre-positioned, so digits never render backwards on a
 * horizontally-flipped inside-surface sheet).
 */
function buildDimensionMarkup(
  entries: ReturnType<typeof computeDimensionLines>,
  viewHeight: number,
  mirrorTx?: number,
  mirrorTy?: number,
): { shapes: string; labels: string } {
  const HEAD_LEN = 2.2;
  const HEAD_WIDTH = 1.1;
  const COLOR = "#2563eb";
  const mirrorLabelX = (x: number) => (mirrorTx !== undefined ? mirrorTx - x : x);
  const mirrorLabelY = (y: number) => (mirrorTy !== undefined ? mirrorTy - y : y);

  const arrowHead = (tipX: number, tipY: number, outX: number, outY: number) => {
    const baseX = tipX - outX * HEAD_LEN;
    const baseY = tipY - outY * HEAD_LEN;
    const perpX = -outY;
    const perpY = outX;
    const p1x = baseX + perpX * HEAD_WIDTH;
    const p1y = baseY + perpY * HEAD_WIDTH;
    const p2x = baseX - perpX * HEAD_WIDTH;
    const p2y = baseY - perpY * HEAD_WIDTH;
    return `<polygon points="${tipX.toFixed(2)},${tipY.toFixed(2)} ${p1x.toFixed(2)},${p1y.toFixed(2)} ${p2x.toFixed(2)},${p2y.toFixed(2)}" fill="${COLOR}" />`;
  };

  const shapes: string[] = [];
  const labels: string[] = [];

  for (const e of entries) {
    const [ax, ay] = flipY([e.x1, e.y1], viewHeight);
    const [bx, by] = flipY([e.x2, e.y2], viewHeight);
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const [flippedLx, flippedLy] = flipY([e.labelX, e.labelY], viewHeight);
    const lx = mirrorLabelX(flippedLx);
    const ly = mirrorLabelY(flippedLy);

    shapes.push(`<line x1="${ax.toFixed(2)}" y1="${ay.toFixed(2)}" x2="${bx.toFixed(2)}" y2="${by.toFixed(2)}" stroke="${COLOR}" stroke-width="0.25" />`);
    shapes.push(arrowHead(ax, ay, -ux, -uy));
    shapes.push(arrowHead(bx, by, ux, uy));

    if (e.orientation === "h") {
      const bgW = e.label.length * 1.9 + 1.5;
      labels.push(`<rect x="${(lx - bgW / 2).toFixed(2)}" y="${(ly - 2.6).toFixed(2)}" width="${bgW.toFixed(2)}" height="3.4" fill="#ffffff" opacity="0.85" />`);
      labels.push(`<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" font-size="3" fill="${COLOR}" text-anchor="middle" dominant-baseline="middle">${e.label}</text>`);
    } else {
      labels.push(
        `<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" font-size="3" fill="${COLOR}" text-anchor="middle" dominant-baseline="middle" transform="rotate(-90 ${lx.toFixed(2)} ${ly.toFixed(2)})">${e.label}</text>`,
      );
    }
  }

  return { shapes: shapes.join("\n    "), labels: labels.join("\n    ") };
}

/** Builds a production-style dieline SVG: cut lines red, fold lines dashed green. */
export function generateDielineSVG(layout: DielineLayout, opts: SvgExportOptions = {}): string {
  const { width: sheetWidth, height: sheetHeight } = layout.bounds;
  // When the caller doesn't specify a viewBox (e.g. the plain "Export SVG" button,
  // as opposed to the PDF exporter which manages its own per-tile bleed), auto-add
  // enough margin to fit whichever guides are enabled: the overall-size dimension
  // lines sit OUTER_MARGIN_MM outside the sheet, the trim-guide corner ticks sit a
  // few mm out. Without this, those elements would be silently clipped by the
  // viewBox exactly at the sheet edge.
  const autoMargin = opts.dimensions ? 18 : opts.trimGuide ? 6 : 0;
  const view = opts.viewBox ?? { x: -autoMargin, y: -autoMargin, width: sheetWidth + 2 * autoMargin, height: sheetHeight + 2 * autoMargin };
  const outputSize = opts.outputSizeMm ?? { width: view.width, height: view.height };
  const widthPt = (outputSize.width * MM_TO_PT).toFixed(2);
  const heightPt = (outputSize.height * MM_TO_PT).toFixed(2);

  // viewBox Y also needs flipping: a region "near the top" in our Y-up sheet space
  // is at low Y-down values once flipped, so the viewBox's Y origin is measured from
  // the flipped top-left, i.e. sheetHeight - (view.y + view.height).
  const viewBoxY = sheetHeight - (view.y + view.height);

  const artwork = opts.artworkDataUrl
    ? `<image href="${opts.artworkDataUrl}" x="0" y="0" width="${sheetWidth}" height="${sheetHeight}" preserveAspectRatio="none" opacity="0.95" />`
    : "";

  const cutPaths = layout.cutOutline
    .map((poly) => `<path d="${pathFromPoints(poly, sheetHeight)}" fill="none" stroke="#e2231a" stroke-width="0.35" stroke-linejoin="round" />`)
    .join("\n    ");

  const foldPaths = layout.foldLines
    .map((f) => {
      const [ax, ay] = flipY(f.a, sheetHeight);
      const [bx, by] = flipY(f.b, sheetHeight);
      return `<line x1="${ax.toFixed(2)}" y1="${ay.toFixed(2)}" x2="${bx.toFixed(2)}" y2="${by.toFixed(2)}" stroke="#1a9e4f" stroke-width="0.3" stroke-dasharray="2,1.5" />`;
    })
    .join("\n    ");

  // Mirrors the whole drawing about the current view's centreline, on whichever
  // axis the caller asked for (see the `mirror` option for why the axis depends
  // on page orientation).
  const mirrorTx = 2 * view.x + view.width;
  const mirrorTy = 2 * viewBoxY + view.height;
  const contentOpen =
    opts.mirror === "x"
      ? `<g transform="translate(${mirrorTx.toFixed(2)},0) scale(-1,1)">`
      : opts.mirror === "y"
        ? `<g transform="translate(0,${mirrorTy.toFixed(2)}) scale(1,-1)">`
        : "<g>";
  const contentClose = "</g>";
  const mirrorLabelTx = opts.mirror === "x" ? mirrorTx : undefined;
  const mirrorLabelTy = opts.mirror === "y" ? mirrorTy : undefined;

  // Text is kept OUTSIDE the mirrored group (with its position pre-flipped
  // instead) so digits and labels always read correctly on a mirrored page.
  const dimsRawX = view.x + 2;
  const dimsRawY = flipY([0, view.y + 2], sheetHeight)[1];
  const dimsLabelX = mirrorLabelTx !== undefined ? mirrorLabelTx - dimsRawX : dimsRawX;
  const dimsLabelY = mirrorLabelTy !== undefined ? mirrorLabelTy - dimsRawY : dimsRawY;
  const dims = opts.showDimensions
    ? `<text x="${dimsLabelX.toFixed(2)}" y="${dimsLabelY.toFixed(2)}" font-size="3.5" fill="#666">${sheetWidth.toFixed(0)} x ${sheetHeight.toFixed(0)} mm</text>`
    : "";

  const trimGuide = opts.trimGuide ? buildTrimGuide(sheetWidth, sheetHeight, sheetHeight) : "";
  const seamMarks = opts.tileGrid ? buildSeamMarks(sheetWidth, sheetHeight, sheetHeight, opts.tileGrid.usableWidth, opts.tileGrid.usableHeight) : "";
  const dimensionMarkup = opts.dimensions
    ? buildDimensionMarkup(computeDimensionLines(layout), sheetHeight, mirrorLabelTx, mirrorLabelTy)
    : { shapes: "", labels: "" };

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${widthPt}pt" height="${heightPt}pt"
     viewBox="${view.x} ${viewBoxY} ${view.width} ${view.height}">
  <title>${opts.title ?? "Dieline"}</title>
  <rect x="${view.x}" y="${viewBoxY}" width="${view.width}" height="${view.height}" fill="#ffffff" />
  ${contentOpen}
  <g id="artwork">${artwork}</g>
  <g id="fold-lines">
    ${foldPaths}
  </g>
  <g id="cut-lines">
    ${cutPaths}
  </g>
  <g id="trim-guide">
    ${trimGuide}
  </g>
  <g id="seam-marks">
    ${seamMarks}
  </g>
  <g id="dimension-shapes">
    ${dimensionMarkup.shapes}
  </g>
  ${contentClose}
  <g id="dimension-labels">
    ${dimensionMarkup.labels}
  </g>
  ${dims}
  ${opts.extra ?? ""}
</svg>`;
}

export function downloadTextFile(filename: string, content: string, mime = "image/svg+xml") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
