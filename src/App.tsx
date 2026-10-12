import { useEffect, useMemo, useRef, useState } from "react";
import type * as THREE from "three";
import "./App.css";
import Sidebar from "./components/Sidebar";
import ArtworkPanel from "./components/ArtworkPanel";
import DielineEditor from "./components/DielineEditor";
import Fold3D from "./components/Fold3D";
import ExportBar from "./components/ExportBar";
import { BOX_STYLES, getBoxStyle } from "./geometry/boxBuilders";
import { computeFlatLayout } from "./geometry/layout";
import type { BoxDimensions, BoxStyleId } from "./geometry/types";
import { emptyArtwork } from "./artwork/types";
import { usePanelTextures } from "./artwork/usePanelTextures";
import { serializeProject, parseProject, PROJECT_EXTENSION } from "./project/projectFile";
import { downloadBlob } from "./lib/files";

export default function App() {
  const [boxStyleId, setBoxStyleId] = useState<BoxStyleId>("tuck-end");
  const [dims, setDims] = useState<BoxDimensions>(BOX_STYLES[0].defaultDimensions);
  const [artwork, setArtwork] = useState(emptyArtwork());
  const [activeSide, setActiveSide] = useState<"outside" | "inside">("outside");
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"2d" | "3d">("2d");
  const [foldAmount, setFoldAmount] = useState(0);
  const [showDimensions, setShowDimensions] = useState(false);
  const [lockTemplate, setLockTemplate] = useState(false);

  const sceneRef = useRef<THREE.Group | null>(null);

  const root = useMemo(() => getBoxStyle(boxStyleId).build(dims), [boxStyleId, dims]);
  const layout = useMemo(() => computeFlatLayout(root), [root]);
  const texturesById = usePanelTextures(layout, artwork, 6, showDimensions);

  // Clicking a panel flashes the sidebar control that governs it. The nonce makes
  // clicking the SAME panel again re-trigger the animation (a changing value is
  // what restarts it), and the face tells the sidebar which field to highlight.
  const [panelClickNonce, setPanelClickNonce] = useState(0);
  const selectedPanelFace = layout.panels.find((p) => p.id === selectedPanelId)?.face;

  const handleSelectPanel = (id: string | null) => {
    setSelectedPanelId(id);
    if (id) setPanelClickNonce((n) => n + 1);
  };

  const handleChangeStyle = (id: BoxStyleId) => {
    setBoxStyleId(id);
    setDims({ ...getBoxStyle(id).defaultDimensions });
    setSelectedPanelId(null);
  };

  // ---- Undo / redo ---------------------------------------------------------
  // Snapshots of the whole DESIGN state (style + dims + artwork). Snapshots hold
  // object references, not copies — all updates here are immutable, so old
  // references stay valid and pushing one costs nothing even with megabytes of
  // embedded artwork. Rapid bursts (slider drags fire many changes per second)
  // collapse into ONE undo step: only the first change of a burst pushes the
  // pre-burst state; anything within 400ms of the previous change is skipped.
  type Snapshot = { boxStyleId: BoxStyleId; dims: BoxDimensions; artwork: ReturnType<typeof emptyArtwork> };
  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const restoring = useRef(false);
  const lastEditAt = useRef(0);
  const prevSnap = useRef<Snapshot>({ boxStyleId, dims, artwork });

  useEffect(() => {
    const prev = prevSnap.current;
    if (prev.boxStyleId === boxStyleId && prev.dims === dims && prev.artwork === artwork) return;
    if (restoring.current) {
      restoring.current = false;
    } else {
      const now = Date.now();
      if (now - lastEditAt.current > 400) {
        undoStack.current.push(prev);
        if (undoStack.current.length > 50) undoStack.current.shift();
        redoStack.current = []; // a fresh edit invalidates the redo branch
      }
      lastEditAt.current = now;
    }
    prevSnap.current = { boxStyleId, dims, artwork };
  }, [boxStyleId, dims, artwork]);

  const applySnapshot = (snap: Snapshot) => {
    restoring.current = true;
    setBoxStyleId(snap.boxStyleId);
    setDims(snap.dims);
    setArtwork(snap.artwork);
    setSelectedPanelId(null);
  };

  const undo = () => {
    const snap = undoStack.current.pop();
    if (!snap) return;
    redoStack.current.push(prevSnap.current);
    applySnapshot(snap);
  };

  const redo = () => {
    const snap = redoStack.current.pop();
    if (!snap) return;
    undoStack.current.push(prevSnap.current);
    applySnapshot(snap);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never steal the shortcut from a focused text/number field — the browser's
      // own input-level undo is what the user expects there.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- New / Save / Open project (.pbox) -----------------------------------
  // The whole design — box style, dimensions, and both sides' artwork with every
  // image embedded as a data URL — serializes to one JSON file and loads back.
  const openInputRef = useRef<HTMLInputElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const newProject = () => {
    if (!window.confirm("Start a new project? The current design is discarded (you can still get it back with Undo).")) return;
    setBoxStyleId(BOX_STYLES[0].id);
    setDims({ ...BOX_STYLES[0].defaultDimensions });
    setArtwork(emptyArtwork());
    setSelectedPanelId(null);
    setActiveSide("outside");
    setFoldAmount(0);
  };

  const saveProject = () => {
    const json = serializeProject(boxStyleId, dims, artwork);
    const name = `${getBoxStyle(boxStyleId).label.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}${PROJECT_EXTENSION}`;
    downloadBlob(name, new Blob([json], { type: "application/json" }));
  };

  const openProject = async (file: File) => {
    try {
      const text = await file.text();
      const loaded = parseProject(text);
      setBoxStyleId(loaded.boxStyleId);
      setDims(loaded.dims);
      setArtwork(loaded.artwork);
      setSelectedPanelId(null);
      setActiveSide("outside");
    } catch (err) {
      alert(`Could not open project: ${(err as Error).message}`);
    } finally {
      // Allow re-opening the same file twice in a row.
      if (openInputRef.current) openInputRef.current.value = "";
    }
  };

  const style = getBoxStyle(boxStyleId);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">📦 PackBox Studio</div>
        <div className="project-bar">
          <button type="button" onClick={newProject} title="Start a fresh project (undoable).">
            New
          </button>
          <button type="button" onClick={saveProject} title="Saves the whole design — box style, dimensions, and all artwork/text/logos embedded — into one .pbox file.">
            Save
          </button>
          <button type="button" onClick={() => openInputRef.current?.click()} title="Open a saved .pbox project.">
            Open
          </button>
          <input
            ref={openInputRef}
            type="file"
            accept={PROJECT_EXTENSION}
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && openProject(e.target.files[0])}
          />
        </div>
        <div className="tabs view-tabs">
          <button className={activeTab === "2d" ? "active" : ""} onClick={() => setActiveTab("2d")}>
            2D Dieline
          </button>
          <button className={activeTab === "3d" ? "active" : ""} onClick={() => setActiveTab("3d")}>
            3D Preview
          </button>
        </div>
        <div className="help-wrap">
          <button type="button" className="help-btn" title="Keyboard & mouse shortcuts" onClick={() => setHelpOpen((v) => !v)}>
            ?
          </button>
          {helpOpen && (
            <div className="help-popover" onClick={(e) => e.stopPropagation()}>
              <div className="help-head">
                <strong>Shortcuts</strong>
                <button type="button" className="icon-btn" onClick={() => setHelpOpen(false)}>
                  ×
                </button>
              </div>
              <h4>General</h4>
              <dl>
                <dt>⌘Z / Ctrl+Z</dt>
                <dd>Undo</dd>
                <dt>⇧⌘Z / Ctrl+Shift+Z</dt>
                <dd>Redo</dd>
              </dl>
              <h4>2D editor</h4>
              <dl>
                <dt>Scroll</dt>
                <dd>Zoom (keeps the point under the cursor in place)</dd>
                <dt>Space + drag</dt>
                <dd>Pan / move the canvas</dd>
                <dt>Middle-mouse drag</dt>
                <dd>Pan / move the canvas</dd>
                <dt>Shift + rotate handle</dt>
                <dd>Snap rotation to 45° steps</dd>
                <dt>Drag corner handle</dt>
                <dd>Resize keeping proportions</dd>
                <dt>Drag edge handle</dt>
                <dd>Stretch one side only</dd>
                <dt>Click a panel</dt>
                <dd>Select it and flash its control in the sidebar</dd>
              </dl>
              <h4>3D preview</h4>
              <dl>
                <dt>Left-drag</dt>
                <dd>Rotate around the box (unlimited)</dd>
                <dt>Right-drag</dt>
                <dd>Pan the view</dd>
                <dt>Scroll</dt>
                <dd>Zoom in / out</dd>
              </dl>
            </div>
          )}
        </div>
        <ExportBar layout={layout} artwork={artwork} title={style.label.replace(/\s+/g, "_")} sceneRef={sceneRef} activeTab={activeTab} />
      </header>

      <div className="body">
        <Sidebar
          boxStyleId={boxStyleId}
          dims={dims}
          onChangeStyle={handleChangeStyle}
          onChangeDims={setDims}
          highlightFace={selectedPanelFace}
          highlightNonce={panelClickNonce}
        />

        <main className="stage">
          {activeTab === "2d" ? (
            <div className="stage-scroll">
              <DielineEditor
                layout={layout}
                side={artwork[activeSide]}
                pxPerMm={2.2}
                selectedPanelId={selectedPanelId}
                onSelectPanel={handleSelectPanel}
                onUpdateSide={(updater) => setArtwork((a) => ({ ...a, [activeSide]: updater(a[activeSide]) }))}
                showDimensions={showDimensions}
                onToggleDimensions={setShowDimensions}
                lockTemplate={lockTemplate}
                onToggleLockTemplate={setLockTemplate}
              />
            </div>
          ) : (
            <div className="stage-3d">
              <Fold3D root={root} foldAmount={foldAmount} texturesById={texturesById} onSceneReady={(g) => (sceneRef.current = g)} />
              <div className="fold-slider">
                <span>Flat</span>
                <input type="range" min={0} max={1} step={0.01} value={foldAmount} onChange={(e) => setFoldAmount(Number(e.target.value))} />
                <span>Closed</span>
                <label className="dim-toggle" title="Prints each panel's width x height right on its face.">
                  <input type="checkbox" checked={showDimensions} onChange={(e) => setShowDimensions(e.target.checked)} />
                  Measurements
                </label>
              </div>
            </div>
          )}
        </main>

        <ArtworkPanel
          layout={layout}
          artwork={artwork}
          activeSide={activeSide}
          onChangeActiveSide={setActiveSide}
          selectedPanelId={selectedPanelId}
          onUpdateArtwork={setArtwork}
        />
      </div>
    </div>
  );
}
