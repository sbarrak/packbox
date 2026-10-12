export const A4_MM = { width: 210, height: 297 };

export interface PageTile {
  row: number;
  col: number;
  /** Origin of this tile within the full sheet, mm. */
  x: number;
  y: number;
  /** Size of this tile's content area, mm (the last row/col is often smaller). */
  width: number;
  height: number;
}

export interface PaginationPlan {
  /** True if the whole dieline fits on one A4 page (no tiling needed). */
  singlePage: boolean;
  /** Page orientation used. */
  orientation: "portrait" | "landscape";
  rows: number;
  cols: number;
  usable: { width: number; height: number };
  pages: PageTile[];
}

/**
 * Lays a sheet of `bounds` size out across one or more A4 pages. Prefers a single
 * page (portrait, then landscape) if the sheet fits; otherwise tiles it across a
 * grid of full A4 pages, abutting edge-to-edge (no overlap — alignment marks at the
 * seams are what let you line the printed sheets up when taping them together).
 */
export function planA4Pages(bounds: { width: number; height: number }, marginMm = 10): PaginationPlan {
  const usablePortrait = { width: A4_MM.width - marginMm * 2, height: A4_MM.height - marginMm * 2 };
  const usableLandscape = { width: A4_MM.height - marginMm * 2, height: A4_MM.width - marginMm * 2 };

  const fitsPortrait = bounds.width <= usablePortrait.width && bounds.height <= usablePortrait.height;
  const fitsLandscape = bounds.width <= usableLandscape.width && bounds.height <= usableLandscape.height;

  if (fitsPortrait || fitsLandscape) {
    const orientation: "portrait" | "landscape" = fitsPortrait ? "portrait" : "landscape";
    const usable = orientation === "portrait" ? usablePortrait : usableLandscape;
    return {
      singlePage: true,
      orientation,
      rows: 1,
      cols: 1,
      usable,
      pages: [{ row: 0, col: 0, x: 0, y: 0, width: bounds.width, height: bounds.height }],
    };
  }

  // Doesn't fit on one page either way — tile across a grid of portrait A4 pages.
  const usable = usablePortrait;
  const cols = Math.max(1, Math.ceil(bounds.width / usable.width));
  const rows = Math.max(1, Math.ceil(bounds.height / usable.height));
  const pages: PageTile[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * usable.width;
      const y = row * usable.height;
      pages.push({
        row,
        col,
        x,
        y,
        width: Math.min(usable.width, bounds.width - x),
        height: Math.min(usable.height, bounds.height - y),
      });
    }
  }
  return { singlePage: false, orientation: "portrait", rows, cols, usable, pages };
}
