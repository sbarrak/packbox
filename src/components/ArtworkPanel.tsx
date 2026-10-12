import { useRef } from "react";
import type { DielineLayout } from "../geometry/types";
import type { ArtworkState, EditorLayer, SideArtwork } from "../artwork/types";
import { readFileAsDataURL, loadImageSize } from "../lib/files";

interface Props {
  layout: DielineLayout;
  artwork: ArtworkState;
  activeSide: "outside" | "inside";
  onChangeActiveSide: (s: "outside" | "inside") => void;
  selectedPanelId: string | null;
  onUpdateArtwork: (updater: (a: ArtworkState) => ArtworkState) => void;
}

function updateSide(artwork: ArtworkState, side: "outside" | "inside", fn: (s: SideArtwork) => SideArtwork): ArtworkState {
  return { ...artwork, [side]: fn(artwork[side]) };
}

let layerCounter = 0;
function newId(prefix: string) {
  layerCounter += 1;
  return `${prefix}-${Date.now()}-${layerCounter}`;
}

export default function ArtworkPanel({ layout, artwork, activeSide, onChangeActiveSide, selectedPanelId, onUpdateArtwork }: Props) {
  const sheetInputRef = useRef<HTMLInputElement>(null);
  const panelInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const side = artwork[activeSide];
  const selectedPanel = layout.panels.find((p) => p.id === selectedPanelId);

  const handleSheetUpload = async (file: File) => {
    const dataUrl = await readFileAsDataURL(file);
    // Fit the whole sheet bounds by default (matches the old auto-scale-to-template
    // behavior) — the user can then drag/resize/rotate it freely on the canvas.
    onUpdateArtwork((a) =>
      updateSide(a, activeSide, (s) => ({
        ...s,
        sheetImage: dataUrl,
        sheetOffset: { x: 0, y: 0 },
        sheetWidth: layout.bounds.width,
        sheetHeight: layout.bounds.height,
        sheetRotation: 0,
      })),
    );
  };

  const resetSheetToFit = () => {
    onUpdateArtwork((a) =>
      updateSide(a, activeSide, (s) => ({
        ...s,
        sheetOffset: { x: 0, y: 0 },
        sheetWidth: layout.bounds.width,
        sheetHeight: layout.bounds.height,
        sheetRotation: 0,
      })),
    );
  };

  const handlePanelUpload = async (file: File) => {
    if (!selectedPanel) return;
    const dataUrl = await readFileAsDataURL(file);
    onUpdateArtwork((a) => updateSide(a, activeSide, (s) => ({ ...s, panelImages: { ...s.panelImages, [selectedPanel.id]: dataUrl } })));
  };

  const handleLogoUpload = async (file: File) => {
    if (!selectedPanel) return;
    const dataUrl = await readFileAsDataURL(file);

    // Fit the logo's OWN aspect ratio inside a target box (~50% of the panel)
    // instead of forcing it into a fixed 50%x50% square — that stretch is what
    // was distorting every upload. Fall back to the old square-ish box if the
    // image dimensions can't be read for some reason.
    let width = selectedPanel.w * 0.5;
    let height = selectedPanel.h * 0.5;
    try {
      const natural = await loadImageSize(dataUrl);
      const targetW = selectedPanel.w * 0.5;
      const targetH = selectedPanel.h * 0.5;
      const scale = Math.min(targetW / natural.width, targetH / natural.height);
      width = natural.width * scale;
      height = natural.height * scale;
    } catch {
      /* use the fallback box size above */
    }

    const layer: EditorLayer = {
      id: newId("img"),
      kind: "image",
      panelId: selectedPanel.id,
      x: (selectedPanel.w - width) / 2,
      y: (selectedPanel.h - height) / 2,
      width,
      height,
      src: dataUrl,
      rotation: 0,
    };
    onUpdateArtwork((a) => updateSide(a, activeSide, (s) => ({ ...s, layers: [...s.layers, layer] })));
  };

  const addText = () => {
    if (!selectedPanel) return;
    const layer: EditorLayer = {
      id: newId("txt"),
      kind: "text",
      panelId: selectedPanel.id,
      x: selectedPanel.w * 0.15,
      y: selectedPanel.h * 0.5,
      text: "Your text",
      fontSize: Math.max(4, selectedPanel.h * 0.12),
      color: "#111111",
      rotation: 0,
    };
    onUpdateArtwork((a) => updateSide(a, activeSide, (s) => ({ ...s, layers: [...s.layers, layer] })));
  };

  const removeLayer = (id: string) => {
    onUpdateArtwork((a) => updateSide(a, activeSide, (s) => ({ ...s, layers: s.layers.filter((l) => l.id !== id) })));
  };

  const updateLayerText = (id: string, text: string) => {
    onUpdateArtwork((a) =>
      updateSide(a, activeSide, (s) => ({ ...s, layers: s.layers.map((l) => (l.id === id && l.kind === "text" ? { ...l, text } : l)) })),
    );
  };

  const removePanelImage = () => {
    if (!selectedPanel) return;
    onUpdateArtwork((a) =>
      updateSide(a, activeSide, (s) => {
        const next = { ...s.panelImages };
        delete next[selectedPanel.id];
        return { ...s, panelImages: next };
      }),
    );
  };

  return (
    <aside className="panel artwork-panel">
      <h2>Artwork</h2>
      <div className="tabs">
        <button className={activeSide === "outside" ? "active" : ""} onClick={() => onChangeActiveSide("outside")}>
          Outside
        </button>
        <button className={activeSide === "inside" ? "active" : ""} onClick={() => onChangeActiveSide("inside")}>
          Inside
        </button>
      </div>

      <section>
        <h3>Full artwork sheet</h3>
        <p className="muted">Upload one flattened artwork file — it starts fit to the whole dieline, then drag it on the canvas to reposition, or use the corner/edge handles to resize and rotate.</p>
        <input
          ref={sheetInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => e.target.files?.[0] && handleSheetUpload(e.target.files[0])}
        />
        {side.sheetImage && (
          <>
            <div className="button-row">
              <button className="secondary" onClick={resetSheetToFit}>
                Reset to fit sheet
              </button>
              <button className="secondary" onClick={() => onUpdateArtwork((a) => updateSide(a, activeSide, (s) => ({ ...s, sheetImage: undefined })))}>
                Remove sheet
              </button>
            </div>
          </>
        )}
      </section>

      <section>
        <h3>Selected panel {selectedPanel ? `— ${selectedPanel.name}` : ""}</h3>
        {!selectedPanel && <p className="muted">Click a panel in the 2D view to target it.</p>}
        {selectedPanel && (
          <>
            <label className="upload-row">
              <span>Assign image to this panel</span>
              <input
                ref={panelInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && handlePanelUpload(e.target.files[0])}
              />
            </label>
            {side.panelImages[selectedPanel.id] && (
              <button className="secondary" onClick={removePanelImage}>
                Remove panel image
              </button>
            )}
            <div className="button-row">
              <button onClick={addText}>+ Text</button>
              <label className="upload-button">
                + Logo
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => e.target.files?.[0] && handleLogoUpload(e.target.files[0])}
                />
              </label>
            </div>
          </>
        )}
      </section>

      <section>
        <h3>Layers ({activeSide})</h3>
        {side.layers.length === 0 && <p className="muted">No text or logo layers yet.</p>}
        <ul className="layer-list">
          {side.layers.map((l) => (
            <li key={l.id}>
              {l.kind === "text" ? (
                <input value={l.text} onChange={(e) => updateLayerText(l.id, e.target.value)} />
              ) : (
                <span className="muted">Logo image</span>
              )}
              <button className="icon-btn" onClick={() => removeLayer(l.id)} title="Remove">
                ×
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
