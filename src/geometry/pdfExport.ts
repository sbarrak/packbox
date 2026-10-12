import { jsPDF } from "jspdf";
import "svg2pdf.js";
import type { DielineLayout } from "./types";
import { generateDielineSVG } from "./svgExport";
import { planA4Pages } from "./paginate";

const MARGIN_MM = 10;
// Extra room shown around each tile's true content so the corner crop-mark ticks
// (which extend OUTWARD from the trim guide) aren't clipped at the viewBox edge.
const BLEED_MM = 6;
// The overall-sheet dimension lines (drawn when "Print measurements" is on) sit
// further outside the sheet than the crop marks do, so they need extra page
// margin to avoid being clipped — only allocated when actually requested, so a
// plain export's layout/margins are unaffected.
const DIMENSION_MARGIN_MM = 22;
const DIMENSION_BLEED_MM = 18;

export interface PdfExportOptions {
  /** Flattened outside-surface artwork, if any. */
  outsideArtworkDataUrl?: string;
  /**
   * Flattened inside-surface artwork. Only pass this when the inside actually
   * has content — its presence is what triggers printing a second, aligned
   * sheet for every tile.
   */
  insideArtworkDataUrl?: string;
  title?: string;
  /** Overlay double-arrow measurements (overall size + every panel), for mockups/tests. */
  dimensions?: boolean;
}

async function embedSvg(doc: jsPDF, svgString: string, x: number, y: number, width: number, height: number) {
  const parser = new DOMParser();
  const svgEl = parser.parseFromString(svgString, "image/svg+xml").documentElement;

  // svg2pdf needs the element attached to a live document to measure text/images.
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-99999px";
  container.appendChild(svgEl);
  document.body.appendChild(container);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (doc as any).svg(svgEl, { x, y, width, height });
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * Renders the dieline to a print-ready, true-to-scale PDF on standard A4 paper.
 * A dieline that fits on one A4 sheet (portrait or landscape) gets a single page,
 * centered, with a trim-guide rectangle and corner crop marks so you can square up
 * the paper before cutting the actual shape. A dieline too big for one sheet is
 * automatically tiled across a grid of A4 pages, abutting edge-to-edge, with small
 * "+" alignment marks at the seams so the printed pages line up when taped together.
 *
 * If the inside surface has artwork, every tile gets a second page right after its
 * outside page, mirrored horizontally so a duplex print set to "flip on long edge"
 * lands the inside artwork correctly registered on the back of the same sheet —
 * print duplex, cut once, and both faces are already right where they should be.
 */
export async function exportDielinePDF(layout: DielineLayout, opts: PdfExportOptions = {}): Promise<Blob> {
  const { outsideArtworkDataUrl, insideArtworkDataUrl, title = "Dieline", dimensions = false } = opts;
  // ALWAYS emit both faces: an outside page and an inside page, each with its own
  // cut/crease lines, whether or not the inside carries artwork yet. A print run
  // needs the inside sheet regardless, and getting a consistent 2-page (or 2-per-
  // tile) document means the duplex setup never changes between exports.
  const hasInside = true;
  const marginMm = dimensions ? DIMENSION_MARGIN_MM : MARGIN_MM;
  const bleedMm = dimensions ? DIMENSION_BLEED_MM : BLEED_MM;
  const plan = planA4Pages(layout.bounds, marginMm);
  const pageFormat: "a4" = "a4";
  const pageOrientation = plan.orientation === "landscape" ? "l" : "p";
  const pageH = pageOrientation === "l" ? 210 : 297;

  const doc = new jsPDF({ orientation: pageOrientation, unit: "mm", format: pageFormat });

  const renderSide = async (tile: (typeof plan.pages)[number], side: "outside" | "inside", artworkDataUrl: string | undefined, isFirstPageOfDoc: boolean) => {
    if (!isFirstPageOfDoc) doc.addPage(pageFormat, pageOrientation);

    // Single page: center the artwork on the sheet. Tiled: anchor every tile at the
    // same top-left margin so neighboring pages' seams land on top of each other.
    const offsetX = plan.singlePage ? marginMm + (plan.usable.width - tile.width) / 2 : marginMm;
    const offsetY = plan.singlePage ? marginMm + (plan.usable.height - tile.height) / 2 : marginMm;

    // Expand the requested view by a bit of bleed on every side so the corner crop-mark
    // ticks (which extend outward from the trim guide) — and, when measurements are on,
    // the overall-size dimension arrows further out still — have room to render instead
    // of getting clipped exactly at the tile's edge. The page margin always comfortably
    // fits the bleed, so the extra region lands within the blank page margin.
    const bleedView = {
      x: tile.x - bleedMm,
      y: tile.y - bleedMm,
      width: tile.width + 2 * bleedMm,
      height: tile.height + 2 * bleedMm,
    };

    const svgString = generateDielineSVG(layout, {
      artworkDataUrl,
      title,
      viewBox: bleedView,
      outputSizeMm: { width: bleedView.width, height: bleedView.height },
      trimGuide: true,
      dimensions,
      // "Flip on long edge" turns the sheet about an axis parallel to its 297mm
      // edge, so which way the inside page has to be mirrored depends on how the
      // page is oriented: portrait's long edge is vertical (left/right flip),
      // landscape's long edge is horizontal (top/bottom flip).
      mirror: side === "inside" ? (plan.orientation === "landscape" ? "y" : "x") : undefined,
      tileGrid: plan.singlePage ? undefined : { usableWidth: plan.usable.width, usableHeight: plan.usable.height },
    });

    await embedSvg(doc, svgString, offsetX - bleedMm, offsetY - bleedMm, bleedView.width, bleedView.height);

    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    const sideLabel =
      side === "outside" ? "OUTSIDE" : `INSIDE — pre-mirrored; print double-sided, FLIP ON LONG EDGE (${plan.orientation})`;
    if (plan.singlePage) {
      doc.text(sideLabel ? `${title}  |  ${sideLabel}` : title, marginMm, pageH - 4);
    } else {
      const tileNote = `page ${tile.row * plan.cols + tile.col + 1}/${plan.pages.length}  (row ${tile.row + 1}/${plan.rows}, col ${tile.col + 1}/${plan.cols})`;
      doc.text(
        `${title}${sideLabel ? `  |  ${sideLabel}` : ""}  |  sheet ${layout.bounds.width.toFixed(0)}x${layout.bounds.height.toFixed(0)}mm  |  ${tileNote}  |  trim to the dashed guide, align "+" marks at page edges when taping`,
        marginMm,
        pageH - 4,
      );
    }
  };

  for (let i = 0; i < plan.pages.length; i++) {
    const tile = plan.pages[i];
    await renderSide(tile, "outside", outsideArtworkDataUrl, i === 0);
    if (hasInside) {
      await renderSide(tile, "inside", insideArtworkDataUrl, false);
    }
  }

  return doc.output("blob");
}
