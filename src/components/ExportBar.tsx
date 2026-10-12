import { useState } from "react";
import type { DielineLayout } from "../geometry/types";
import type { ArtworkState, SideArtwork } from "../artwork/types";
import { sideHasContent } from "../artwork/types";
import { renderFullSheetCanvas } from "../artwork/renderPanel";
import { generateDielineSVG } from "../geometry/svgExport";
import { generateDielineDXF } from "../geometry/dxfExport";
import { exportDielinePDF } from "../geometry/pdfExport";
import { exportGLB } from "../geometry/glbExport";
import { downloadBlob } from "../lib/files";
import type * as THREE from "three";

interface Props {
  layout: DielineLayout;
  artwork: ArtworkState;
  title: string;
  sceneRef: React.MutableRefObject<THREE.Group | null>;
  activeTab: "2d" | "3d";
}

/**
 * The board colours used on screen (a warm beige for the inside face) exist to
 * make the 3D preview read like real board. They must NOT be baked into an
 * export: you print onto white stock, so a filled background would waste ink and
 * come out as a beige sheet. Everything printed therefore renders on white.
 */
function forPrint(side: SideArtwork): SideArtwork {
  return { ...side, backgroundColor: "#ffffff" };
}

export default function ExportBar({ layout, artwork, title, sceneRef, activeTab }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [includeMeasurements, setIncludeMeasurements] = useState(false);

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try {
      await fn();
    } catch (err) {
      console.error(err);
      alert(`Export failed: ${(err as Error).message ?? err}`);
    } finally {
      setBusy(null);
    }
  };

  const exportSVG = () =>
    run("svg", async () => {
      const hasInside = sideHasContent(artwork.inside);
      const outsideCanvas = await renderFullSheetCanvas(layout, forPrint(artwork.outside), 8);
      const outsideSvg = generateDielineSVG(layout, {
        artworkDataUrl: outsideCanvas.toDataURL("image/png"),
        title,
        trimGuide: true,
        dimensions: includeMeasurements,
      });
      downloadBlob(`${title}${hasInside ? "_outside" : ""}.svg`, new Blob([outsideSvg], { type: "image/svg+xml" }));

      if (hasInside) {
        // Saved UNMIRRORED, unlike the PDF's inside page. These are separate image
        // files handed to some other program, where the eventual page orientation
        // (and therefore which axis a long-edge flip turns about) isn't known here.
        // Shipping it the right way round keeps it predictable — mirror it in that
        // program if you send it to a duplex printer.
        const insideCanvas = await renderFullSheetCanvas(layout, forPrint(artwork.inside), 8);
        const insideSvg = generateDielineSVG(layout, {
          artworkDataUrl: insideCanvas.toDataURL("image/png"),
          title,
          trimGuide: true,
          dimensions: includeMeasurements,
        });
        downloadBlob(`${title}_inside.svg`, new Blob([insideSvg], { type: "image/svg+xml" }));
      }
    });

  const exportPDF = () =>
    run("pdf", async () => {
      // Both faces are always rendered and always exported — the inside sheet is
      // needed for print regardless of whether artwork has been added to it yet.
      const outsideCanvas = await renderFullSheetCanvas(layout, forPrint(artwork.outside), 8);
      const insideCanvas = await renderFullSheetCanvas(layout, forPrint(artwork.inside), 8);
      const blob = await exportDielinePDF(layout, {
        outsideArtworkDataUrl: outsideCanvas.toDataURL("image/png"),
        insideArtworkDataUrl: insideCanvas.toDataURL("image/png"),
        title,
        dimensions: includeMeasurements,
      });
      downloadBlob(`${title}.pdf`, blob);
    });

  const exportDXF = () =>
    run("dxf", async () => {
      const dxf = generateDielineDXF(layout);
      downloadBlob(`${title}.dxf`, new Blob([dxf], { type: "application/dxf" }));
    });

  const exportModel = () =>
    run("glb", async () => {
      if (!sceneRef.current) {
        alert("Open the 3D tab first so the model is ready to export.");
        return;
      }
      const blob = await exportGLB(sceneRef.current);
      downloadBlob(`${title}.glb`, blob);
    });

  const insidePrintNote = sideHasContent(artwork.inside)
    ? " The inside surface has artwork, so the SVG saves outside and inside as two separate, unmirrored files."
    : "";

  return (
    <div className="export-bar">
      <label className="export-checkbox" title="Overlay double-arrow measurements (overall size + every panel) on the SVG/PDF export — handy for checking the drawing or printing quick mockups, not meant for final production art.">
        <input type="checkbox" checked={includeMeasurements} onChange={(e) => setIncludeMeasurements(e.target.checked)} />
        Print measurements
      </label>
      <button disabled={!!busy} onClick={exportSVG} title={`Vector picture of the dieline.${insidePrintNote}`}>
        {busy === "svg" ? "Exporting…" : "Export SVG"}
      </button>
      <button
        disabled={!!busy}
        onClick={exportPDF}
        title={`Prints true-to-size on A4 paper. Always exports both faces: an outside page and an inside page (each with cut + crease lines), paired for duplex printing with "flip on long edge". Tiled across multiple pages with alignment marks if the dieline is larger than one sheet.`}
      >
        {busy === "pdf" ? "Exporting…" : "Export PDF (A4)"}
      </button>
      <button disabled={!!busy} onClick={exportDXF}>
        {busy === "dxf" ? "Exporting…" : "Export DXF"}
      </button>
      <button disabled={!!busy || activeTab !== "3d"} onClick={exportModel} title={activeTab !== "3d" ? "Switch to the 3D tab first" : ""}>
        {busy === "glb" ? "Exporting…" : "Export 3D Model (.glb)"}
      </button>
    </div>
  );
}
