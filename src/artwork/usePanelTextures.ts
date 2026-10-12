import { useEffect, useState } from "react";
import * as THREE from "three";
import type { DielineLayout } from "../geometry/types";
import type { ArtworkState } from "./types";
import { buildSheetCanvas, renderPanelCanvas } from "./renderPanel";

export interface PanelTextures {
  outside: THREE.CanvasTexture;
  inside: THREE.CanvasTexture;
}

/**
 * Rasterizes every panel's outside/inside face into a Three.js CanvasTexture.
 * When `showDimensions` is on, each panel's outside face also gets its width x
 * height "printed" right on the texture, so the label rides along with the
 * panel through every fold rotation instead of needing a separate screen-space
 * overlay (which would have to be re-projected and re-oriented every frame).
 */
export function usePanelTextures(layout: DielineLayout, artwork: ArtworkState, pxPerMm = 6, showDimensions = false): Map<string, PanelTextures> {
  const [textures, setTextures] = useState<Map<string, PanelTextures>>(new Map());

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const outsideSheet = await buildSheetCanvas(artwork.outside, layout, pxPerMm);
      const insideSheet = await buildSheetCanvas(artwork.inside, layout, pxPerMm);
      const map = new Map<string, PanelTextures>();

      for (const panel of layout.panels) {
        const label = showDimensions ? `${panel.w.toFixed(0)} × ${panel.h.toFixed(0)}` : undefined;
        const outCanvas = await renderPanelCanvas(panel, artwork.outside, layout, outsideSheet, pxPerMm, label);
        const inCanvas = await renderPanelCanvas(panel, artwork.inside, layout, insideSheet, pxPerMm);

        const outTex = new THREE.CanvasTexture(outCanvas);
        outTex.colorSpace = THREE.SRGBColorSpace;
        outTex.needsUpdate = true;

        const inTex = new THREE.CanvasTexture(inCanvas);
        inTex.colorSpace = THREE.SRGBColorSpace;
        // Mirror horizontally: viewed from the BackSide, the texture would otherwise read backwards.
        inTex.wrapS = THREE.RepeatWrapping;
        inTex.repeat.x = -1;
        inTex.offset.x = 1;
        inTex.needsUpdate = true;

        map.set(panel.id, { outside: outTex, inside: inTex });
      }

      if (cancelled) {
        // Superseded before we finished — release the GPU resources we just made.
        for (const t of map.values()) {
          t.outside.dispose();
          t.inside.dispose();
        }
        return;
      }
      // Free the previous generation's textures. Dragging a size/angle slider
      // re-rasterizes every panel on each change, so without this the old
      // CanvasTextures would accumulate on the GPU for the whole session.
      setTextures((prev) => {
        for (const t of prev.values()) {
          t.outside.dispose();
          t.inside.dispose();
        }
        return map;
      });
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, artwork, pxPerMm, showDimensions]);

  return textures;
}
