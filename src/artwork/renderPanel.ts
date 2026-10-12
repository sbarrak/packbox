import type { DielineLayout, FlatPanel } from "../geometry/types";
import { worldToPanelLocal } from "../geometry/types";
import type { SideArtwork } from "./types";

const imageCache = new Map<string, HTMLImageElement>();

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached && cached.complete) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(src, img);
      resolve(img);
    };
    img.onerror = reject;
    img.src = src;
  });
}

/** Renders the full artwork sheet (with user offset/scale) once, in sheet-space mm -> px. */
export async function buildSheetCanvas(side: SideArtwork, layout: DielineLayout, pxPerMm: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(layout.bounds.width * pxPerMm));
  canvas.height = Math.max(1, Math.round(layout.bounds.height * pxPerMm));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = side.backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (side.sheetImage) {
    try {
      const img = await loadImage(side.sheetImage);
      const w = side.sheetWidth * pxPerMm;
      const h = side.sheetHeight * pxPerMm;
      const x = side.sheetOffset.x * pxPerMm;
      // Canvas Y grows downward; our mm space grows upward, so flip.
      const y = canvas.height - h - side.sheetOffset.y * pxPerMm;
      if (side.sheetRotation) {
        ctx.save();
        ctx.translate(x + w / 2, y + h / 2);
        ctx.rotate((side.sheetRotation * Math.PI) / 180);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
      } else {
        ctx.drawImage(img, x, y, w, h);
      }
    } catch {
      /* ignore broken image */
    }
  }
  return canvas;
}

function outlinePath(ctx: CanvasRenderingContext2D, panel: FlatPanel, pxPerMm: number) {
  ctx.beginPath();
  panel.points.forEach((pt, i) => {
    // worldToPanelLocal handles mirrored (bottom-attached) flaps, whose `origin`
    // is their top hinge edge rather than their lower-left corner.
    const [lx, ly] = worldToPanelLocal(panel, pt);
    const px = lx * pxPerMm;
    const py = (panel.h - ly) * pxPerMm; // flip local Y for canvas
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
}

/**
 * Renders a single panel's face texture: per-panel image (if assigned) else a crop
 * of the full sheet canvas at this panel's world position, plus any text/logo layers.
 */
export async function renderPanelCanvas(
  panel: FlatPanel,
  side: SideArtwork,
  layout: DielineLayout,
  sheetCanvas: HTMLCanvasElement,
  pxPerMm: number,
  labelText?: string,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(panel.w * pxPerMm));
  canvas.height = Math.max(1, Math.round(panel.h * pxPerMm));
  const ctx = canvas.getContext("2d")!;

  // Fill the WHOLE bounding rectangle first, before clipping to the panel's real
  // outline. Panels with an angled or notched outline (tuck flaps, locking tabs,
  // RSC corner-cut flaps) don't cover every corner of their own bounding box — any
  // corner left untouched stays fully transparent, and since the 3D material isn't
  // set to render transparency, the GPU shows transparent canvas pixels (RGBA all
  // zero) as solid BLACK instead of see-through. Filling first means those corners
  // read as background color instead of black once clipped.
  ctx.fillStyle = side.backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  outlinePath(ctx, panel, pxPerMm);
  ctx.clip();

  const perPanelSrc = side.panelImages[panel.id];
  if (perPanelSrc) {
    try {
      const img = await loadImage(perPanelSrc);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    } catch {
      ctx.fillStyle = side.backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  } else {
    // Crop the matching region out of the full sheet, using this panel's TRUE
    // bounding box within the overall flat bounds.
    const sx = panel.min[0] * pxPerMm;
    const syTop = (layout.bounds.height - panel.max[1]) * pxPerMm;
    if (panel.mirrored) {
      // A mirrored flap's local frame has its v=h edge at world min[1], so the
      // sheet region has to be flipped vertically to land right-side-up in this
      // panel's own texture space.
      ctx.save();
      ctx.translate(0, canvas.height);
      ctx.scale(1, -1);
      ctx.drawImage(sheetCanvas, sx, syTop, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    } else {
      ctx.drawImage(sheetCanvas, sx, syTop, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    }
  }

  for (const layer of side.layers) {
    if (layer.panelId !== panel.id) continue;
    ctx.save();
    if (layer.kind === "text") {
      const px = layer.x * pxPerMm;
      const py = (panel.h - layer.y) * pxPerMm;
      ctx.translate(px, py);
      ctx.rotate((layer.rotation * Math.PI) / 180);
      ctx.fillStyle = layer.color;
      ctx.font = `${layer.fontSize * pxPerMm}px sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(layer.text, 0, 0);
    } else {
      try {
        const img = await loadImage(layer.src);
        const px = layer.x * pxPerMm;
        const py = (panel.h - layer.y - layer.height) * pxPerMm;
        ctx.translate(px + (layer.width * pxPerMm) / 2, py + (layer.height * pxPerMm) / 2);
        ctx.rotate((layer.rotation * Math.PI) / 180);
        ctx.drawImage(img, (-layer.width * pxPerMm) / 2, (-layer.height * pxPerMm) / 2, layer.width * pxPerMm, layer.height * pxPerMm);
      } catch {
        /* ignore */
      }
    }
    ctx.restore();
  }

  // "Printed" measurement label, baked directly into this panel's own texture —
  // since this canvas is always in the panel's own upright local frame, the text
  // reads correctly on the 3D model regardless of how that panel is folded/rotated.
  if (labelText && canvas.width > 26 && canvas.height > 26) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const fontPx = Math.max(9, Math.min(canvas.width, canvas.height) * 0.12);
    ctx.save();
    ctx.font = `${fontPx}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const padX = 8;
    const padY = 5;
    const textW = ctx.measureText(labelText).width;
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.fillRect(cx - textW / 2 - padX, cy - fontPx / 2 - padY, textW + padX * 2, fontPx + padY * 2);
    ctx.fillStyle = "#1e3a8a";
    ctx.fillText(labelText, cx, cy + 1);
    ctx.restore();
  }

  ctx.restore();
  return canvas;
}

/**
 * Moves the canvas into a panel's own local drawing frame within the full sheet,
 * so callers can draw local-space content (using the usual `py = h - localY`
 * convention) and have it land at the panel's real place on the sheet.
 *
 * For a mirrored (bottom-attached) flap this also flips vertically: its local
 * frame runs downward from world max[1], so without the flip its artwork would
 * come out upside-down and offset into the wall above it.
 */
function setupPanelLocalTransform(ctx: CanvasRenderingContext2D, panel: FlatPanel, layout: DielineLayout, pxPerMm: number) {
  ctx.translate(panel.min[0] * pxPerMm, (layout.bounds.height - panel.max[1]) * pxPerMm);
  if (panel.mirrored) {
    ctx.translate(0, panel.h * pxPerMm);
    ctx.scale(1, -1);
  }
}

/**
 * Composites the whole dieline sheet (sheet image, per-panel overrides, and every
 * text/logo layer) into one full-size canvas — used to embed a flattened preview
 * into the SVG/PDF export.
 */
export async function renderFullSheetCanvas(layout: DielineLayout, side: SideArtwork, pxPerMm: number): Promise<HTMLCanvasElement> {
  const canvas = await buildSheetCanvas(side, layout, pxPerMm);
  const ctx = canvas.getContext("2d")!;

  for (const panel of layout.panels) {
    const perPanelSrc = side.panelImages[panel.id];
    if (!perPanelSrc) continue;
    ctx.save();
    setupPanelLocalTransform(ctx, panel, layout, pxPerMm);
    outlinePath(ctx, panel, pxPerMm);
    ctx.clip();
    try {
      const img = await loadImage(perPanelSrc);
      ctx.drawImage(img, 0, 0, panel.w * pxPerMm, panel.h * pxPerMm);
    } catch {
      /* ignore */
    }
    ctx.restore();
  }

  for (const panel of layout.panels) {
    const layers = side.layers.filter((l) => l.panelId === panel.id);
    if (layers.length === 0) continue;
    ctx.save();
    setupPanelLocalTransform(ctx, panel, layout, pxPerMm);
    for (const layer of layers) {
      ctx.save();
      if (layer.kind === "text") {
        const px = layer.x * pxPerMm;
        const py = (panel.h - layer.y) * pxPerMm;
        ctx.translate(px, py);
        ctx.rotate((layer.rotation * Math.PI) / 180);
        ctx.fillStyle = layer.color;
        ctx.font = `${layer.fontSize * pxPerMm}px sans-serif`;
        ctx.textBaseline = "top";
        ctx.fillText(layer.text, 0, 0);
      } else {
        try {
          const img = await loadImage(layer.src);
          const px = layer.x * pxPerMm;
          const py = (panel.h - layer.y - layer.height) * pxPerMm;
          ctx.translate(px + (layer.width * pxPerMm) / 2, py + (layer.height * pxPerMm) / 2);
          ctx.rotate((layer.rotation * Math.PI) / 180);
          ctx.drawImage(img, (-layer.width * pxPerMm) / 2, (-layer.height * pxPerMm) / 2, layer.width * pxPerMm, layer.height * pxPerMm);
        } catch {
          /* ignore */
        }
      }
      ctx.restore();
    }
    ctx.restore();
  }

  return canvas;
}
