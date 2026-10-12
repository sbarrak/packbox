import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Line, Arrow, Group, Image as KonvaImage, Text as KonvaText, Rect, Transformer } from "react-konva";
import type Konva from "konva";
import type { DielineLayout, FlatPanel } from "../geometry/types";
import { panelLocalToWorld, worldToPanelLocal } from "../geometry/types";
import type { EditorLayer, SideArtwork } from "../artwork/types";
import { computeDimensionLines } from "../geometry/dimensions";
import { useImage } from "./useImage";

interface Props {
  layout: DielineLayout;
  side: SideArtwork;
  pxPerMm: number;
  selectedPanelId: string | null;
  onSelectPanel: (id: string | null) => void;
  onUpdateSide: (updater: (side: SideArtwork) => SideArtwork) => void;
  showDimensions?: boolean;
  onToggleDimensions?: (v: boolean) => void;
  /**
   * When true the dieline stops intercepting clicks, so the artwork can be
   * selected and dragged from anywhere — including over the panels. When false
   * (the default) the panels take click priority and the artwork can only be
   * grabbed from outside the printed lines.
   */
  lockTemplate?: boolean;
  onToggleLockTemplate?: (v: boolean) => void;
}

/** Renders every double-headed dimension line as a Konva Arrow (pointer at both ends) + label. */
function DimensionsLayer({ layout, pxPerMm }: { layout: DielineLayout; pxPerMm: number }) {
  const entries = computeDimensionLines(layout);
  return (
    <>
      {entries.map((e) => {
        const [x1, y1] = toStage(e.x1, e.y1, layout.bounds.height, pxPerMm);
        const [x2, y2] = toStage(e.x2, e.y2, layout.bounds.height, pxPerMm);
        const [lx, ly] = toStage(e.labelX, e.labelY, layout.bounds.height, pxPerMm);
        return (
          <Group key={e.id}>
            <Arrow
              points={[x1, y1, x2, y2]}
              stroke="#2563eb"
              fill="#2563eb"
              strokeWidth={1}
              pointerLength={6}
              pointerWidth={5}
              pointerAtBeginning
              pointerAtEnding
              listening={false}
            />
            <KonvaText
              text={e.label}
              x={lx}
              y={ly}
              fontSize={11}
              fill="#2563eb"
              stroke="#ffffff"
              strokeWidth={3}
              fillAfterStrokeEnabled
              rotation={e.orientation === "v" ? -90 : 0}
              offsetX={e.label.length * 3}
              offsetY={5}
              listening={false}
            />
          </Group>
        );
      })}
    </>
  );
}

// Pseudo layer-id used to let the full-sheet artwork image share the same
// selection/Transformer machinery as the per-panel text/logo layers below.
const SHEET_LAYER_ID = "__sheet__";

function toStage(mmX: number, mmY: number, boundsHeight: number, pxPerMm: number) {
  return [mmX * pxPerMm, (boundsHeight - mmY) * pxPerMm];
}

function PanelPerImage({ panel, src, pxPerMm, boundsHeight }: { panel: DielineLayout["panels"][number]; src: string; pxPerMm: number; boundsHeight: number }) {
  const img = useImage(src);
  if (!img) return null;
  const [x, y] = toStage(panel.min[0], panel.max[1], boundsHeight, pxPerMm);
  const clipFunc = (ctx: CanvasRenderingContext2D) => {
    ctx.beginPath();
    panel.points.forEach((pt, i) => {
      const [ux, uy] = worldToPanelLocal(panel, pt);
      const lx = ux * pxPerMm;
      const ly = (panel.h - uy) * pxPerMm;
      if (i === 0) ctx.moveTo(lx, ly);
      else ctx.lineTo(lx, ly);
    });
    ctx.closePath();
  };
  return <KonvaImage image={img} x={x} y={y} width={panel.w * pxPerMm} height={panel.h * pxPerMm} clipFunc={clipFunc} />;
}

function SheetImageLayer({
  side,
  layout,
  pxPerMm,
  selected,
  onSelect,
  onUpdateSide,
  onRef,
}: {
  side: SideArtwork;
  layout: DielineLayout;
  pxPerMm: number;
  selected: boolean;
  onSelect: () => void;
  onUpdateSide: (updater: (side: SideArtwork) => SideArtwork) => void;
  onRef: (node: Konva.Node | null) => void;
}) {
  const img = useImage(side.sheetImage);
  const shapeRef = useRef<Konva.Image>(null);
  if (!img) return null;

  const w = side.sheetWidth * pxPerMm;
  const h = side.sheetHeight * pxPerMm;
  const x = side.sheetOffset.x * pxPerMm;
  const y = layout.bounds.height * pxPerMm - h - side.sheetOffset.y * pxPerMm;

  return (
    <KonvaImage
      ref={(node) => {
        shapeRef.current = node;
        onRef(node);
      }}
      image={img}
      x={x}
      y={y}
      width={w}
      height={h}
      rotation={side.sheetRotation}
      draggable
      onClick={onSelect}
      onTap={onSelect}
      stroke={selected ? "#2563eb" : undefined}
      strokeWidth={selected ? 1 : 0}
      onDragEnd={(e) => {
        const nx = e.target.x() / pxPerMm;
        const ny = layout.bounds.height - e.target.y() / pxPerMm - side.sheetHeight;
        onUpdateSide((s) => ({ ...s, sheetOffset: { x: nx, y: ny } }));
      }}
      onTransformEnd={() => {
        const node = shapeRef.current;
        if (!node) return;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        const newWidth = side.sheetWidth * scaleX;
        const newHeight = side.sheetHeight * scaleY;
        node.scaleX(1);
        node.scaleY(1);
        const nx = node.x() / pxPerMm;
        const ny = layout.bounds.height - node.y() / pxPerMm - newHeight;
        onUpdateSide((s) => ({
          ...s,
          sheetOffset: { x: nx, y: ny },
          sheetWidth: newWidth,
          sheetHeight: newHeight,
          sheetRotation: node.rotation(),
        }));
      }}
    />
  );
}

function TextLayerNode({ layer, panel, boundsHeight, pxPerMm, selected, onSelect, onChange, onRef }: any) {
  const shapeRef = useRef<Konva.Text>(null);
  const [x, y] = toStage(...(panelLocalToWorld(panel, [layer.x, layer.y]) as [number, number]), boundsHeight, pxPerMm);
  return (
    <KonvaText
      ref={(node) => {
        shapeRef.current = node;
        onRef?.(node);
      }}
      text={layer.text}
      x={x}
      y={y}
      rotation={layer.rotation}
      fontSize={layer.fontSize * pxPerMm}
      fill={layer.color}
      draggable
      onClick={onSelect}
      onTap={onSelect}
      stroke={selected ? "#2563eb" : undefined}
      strokeWidth={selected ? 0.5 : 0}
      onDragEnd={(e) => {
        const [nx, ny] = worldToPanelLocal(panel, [e.target.x() / pxPerMm, boundsHeight - e.target.y() / pxPerMm]);
        onChange({ ...layer, x: nx, y: ny });
      }}
      onTransformEnd={() => {
        const node = shapeRef.current;
        if (!node) return;
        // Text has no independent width/height in our model — a resize just scales
        // the font size (using the average of X/Y scale so a diagonal drag still
        // feels proportional even though only one scalar comes out of it).
        const scale = (node.scaleX() + node.scaleY()) / 2;
        node.scaleX(1);
        node.scaleY(1);
        const [nx, ny] = worldToPanelLocal(panel, [node.x() / pxPerMm, boundsHeight - node.y() / pxPerMm]);
        onChange({
          ...layer,
          x: nx,
          y: ny,
          fontSize: Math.max(1, layer.fontSize * scale),
          rotation: node.rotation(),
        });
      }}
    />
  );
}

/**
 * Converts an image layer's world-space TOP-left corner back into the panel's
 * local (x, y) where y is the layer's BOTTOM edge — the inverse of the topLocalY
 * calculation below, accounting for a mirrored flap's downward local y axis.
 */
function localFromImageTopLeft(panel: FlatPanel, worldX: number, worldTopY: number, height: number): [number, number] {
  const [lx, topLocalY] = worldToPanelLocal(panel, [worldX, worldTopY]);
  return [lx, panel.mirrored ? topLocalY : topLocalY - height];
}

function ImageLayerNode({ layer, panel, boundsHeight, pxPerMm, selected, onSelect, onChange, onRef }: any) {
  const img = useImage(layer.src);
  const shapeRef = useRef<Konva.Image>(null);
  if (!img) return null;
  // Konva anchors an image at its TOP-left. In a mirrored flap's local frame the
  // +y axis runs downward in world space, so the layer's top edge is at local y
  // rather than local y + height.
  const topLocalY = panel.mirrored ? layer.y : layer.y + layer.height;
  const [x, y] = toStage(...(panelLocalToWorld(panel, [layer.x, topLocalY]) as [number, number]), boundsHeight, pxPerMm);
  return (
    <KonvaImage
      ref={(node) => {
        shapeRef.current = node;
        onRef?.(node);
      }}
      image={img}
      x={x}
      y={y}
      width={layer.width * pxPerMm}
      height={layer.height * pxPerMm}
      rotation={layer.rotation}
      draggable
      onClick={onSelect}
      onTap={onSelect}
      stroke={selected ? "#2563eb" : undefined}
      strokeWidth={selected ? 1 : 0}
      onDragEnd={(e) => {
        const [nx, ny] = localFromImageTopLeft(panel, e.target.x() / pxPerMm, boundsHeight - e.target.y() / pxPerMm, layer.height);
        onChange({ ...layer, x: nx, y: ny });
      }}
      onTransformEnd={() => {
        const node = shapeRef.current;
        if (!node) return;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        const newWidth = layer.width * scaleX;
        const newHeight = layer.height * scaleY;
        node.scaleX(1);
        node.scaleY(1);
        // Resizing from a top/left handle moves the shape's own top-left anchor —
        // read the node's post-transform position (not the pre-transform layer.x/y)
        // or the image visibly jumps back to its old spot on the next render.
        const [nx, ny] = localFromImageTopLeft(panel, node.x() / pxPerMm, boundsHeight - node.y() / pxPerMm, newHeight);
        onChange({
          ...layer,
          x: nx,
          y: ny,
          width: newWidth,
          height: newHeight,
          rotation: node.rotation(),
        });
      }}
    />
  );
}

// Extra canvas margin reserved when dimension lines are visible, so the
// overall-sheet-size arrows (drawn just outside the sheet bounds) aren't clipped.
const DIMENSION_MARGIN_MM = 18;

// Padding kept around all content so a Transformer's resize/rotate anchors —
// which sit slightly OUTSIDE the shape they belong to — always land on canvas
// and stay clickable, even for artwork larger than the sheet itself.
const HANDLE_PAD_MM = 14;

/** Rotation snap targets used while Shift is held. */
const ROTATION_SNAPS_45 = [0, 45, 90, 135, 180, 225, 270, 315];

// Zoom runs from 1% to 999% — the readout reserves room for 3 digits so the
// - and + buttons never shift position as the number's width changes.
const MIN_ZOOM = 0.01;
const MAX_ZOOM = 9.99;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export default function DielineEditor({
  layout,
  side,
  pxPerMm: basePxPerMm,
  selectedPanelId,
  onSelectPanel,
  onUpdateSide,
  showDimensions,
  onToggleDimensions,
  lockTemplate = false,
  onToggleLockTemplate,
}: Props) {
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  // Shadows the `pxPerMm` prop for the rest of this component — every existing
  // toStage()/*pxPerMm computation below picks up the zoomed value automatically.
  const pxPerMm = basePxPerMm * zoom;

  /**
   * The canvas has to cover more than just the dieline: if the artwork is dragged
   * or resized past the sheet edge, anything outside the canvas is unreachable —
   * including the Transformer's resize handles. So the stage spans the union of
   * the dieline, the placed sheet artwork and every layer, plus padding for the
   * handles themselves and (optionally) the dimension arrows.
   */
  const contentPadMm = Math.max(showDimensions ? DIMENSION_MARGIN_MM : 0, HANDLE_PAD_MM);
  const content = (() => {
    let minX = 0;
    let minY = 0;
    let maxX = layout.bounds.width;
    let maxY = layout.bounds.height;
    if (side.sheetImage) {
      minX = Math.min(minX, side.sheetOffset.x);
      minY = Math.min(minY, side.sheetOffset.y);
      maxX = Math.max(maxX, side.sheetOffset.x + side.sheetWidth);
      maxY = Math.max(maxY, side.sheetOffset.y + side.sheetHeight);
    }
    const panelsById = new Map(layout.panels.map((p) => [p.id, p]));
    for (const l of side.layers) {
      const panel = panelsById.get(l.panelId);
      if (!panel) continue;
      const w = l.kind === "image" ? l.width : 0;
      const h = l.kind === "image" ? l.height : 0;
      const [wx, wy] = panelLocalToWorld(panel, [l.x, l.y]);
      minX = Math.min(minX, wx);
      maxX = Math.max(maxX, wx + w);
      minY = Math.min(minY, wy - h);
      maxY = Math.max(maxY, wy + h);
    }
    return { minX: minX - contentPadMm, minY: minY - contentPadMm, maxX: maxX + contentPadMm, maxY: maxY + contentPadMm };
  })();

  // Stage offset shifts every child, so all the existing toStage() maths (which
  // is relative to the sheet's own origin) keeps working unchanged.
  const offsetXpx = -content.minX * pxPerMm;
  const offsetYpx = (content.maxY - layout.bounds.height) * pxPerMm;
  const stageW = (content.maxX - content.minX) * pxPerMm;
  const stageH = (content.maxY - content.minY) * pxPerMm;

  const panelById = Object.fromEntries(layout.panels.map((p) => [p.id, p]));

  const updateLayer = (updated: EditorLayer) => {
    onUpdateSide((s) => ({ ...s, layers: s.layers.map((l) => (l.id === updated.id ? updated : l)) }));
  };

  // Resize/rotate handles for the selected text or logo layer. Konva's Transformer
  // attaches to a live shape node rather than taking React props for the shape
  // itself, so we keep a ref to each layer's underlying Konva node and re-point the
  // Transformer at whichever one is currently selected.
  const shapeRefs = useRef<Map<string, Konva.Node>>(new Map());
  const transformerRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    const node = selectedLayerId ? shapeRefs.current.get(selectedLayerId) : undefined;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedLayerId, side.layers, side.sheetWidth, side.sheetHeight, side.sheetRotation, side.sheetOffset, pxPerMm, stageW, stageH]);

  // Shift toggles 45-degree rotation snapping; Space (held) turns dragging into
  // panning the canvas — handy when a resize handle is hidden under the image
  // inspector or off the edge of the visible area.
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      setShiftHeld(e.shiftKey);
      if (e.code === "Space" && !isTyping(e)) {
        // Stop the page/scroll-area from reacting to space itself.
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      setShiftHeld(e.shiftKey);
      if (e.code === "Space") setSpaceHeld(false);
    };
    // Releasing a key outside the window would otherwise leave it stuck on.
    const onBlur = () => {
      setShiftHeld(false);
      setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Canvas panning: Space + left-drag, or middle-mouse drag, scrolls the
  // viewport by the pointer's movement.
  const panState = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);

  const onPanPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const panButton = e.button === 1 || (e.button === 0 && spaceHeld);
    if (!panButton) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    panState.current = { startX: e.clientX, startY: e.clientY, scrollLeft: vp.scrollLeft, scrollTop: vp.scrollTop };
  };

  const onPanPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const vp = viewportRef.current;
    const p = panState.current;
    if (!vp || !p) return;
    vp.scrollLeft = p.scrollLeft - (e.clientX - p.startX);
    vp.scrollTop = p.scrollTop - (e.clientY - p.startY);
  };

  const onPanPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (panState.current) e.currentTarget.releasePointerCapture(e.pointerId);
    panState.current = null;
  };

  /**
   * The currently selected image — either the full sheet artwork or a logo layer —
   * exposed as a uniform shape so the floating size/angle panel can drive both.
   * Returns null when nothing resizable is selected (text layers have no
   * independent width/height), which is what hides the panel.
   */
  const selectedImage = (() => {
    if (selectedLayerId === SHEET_LAYER_ID && side.sheetImage) {
      return {
        label: "Sheet artwork",
        width: side.sheetWidth,
        height: side.sheetHeight,
        rotation: side.sheetRotation,
        set: (v: { width?: number; height?: number; rotation?: number }) =>
          onUpdateSide((s) => ({
            ...s,
            sheetWidth: v.width ?? s.sheetWidth,
            sheetHeight: v.height ?? s.sheetHeight,
            sheetRotation: v.rotation ?? s.sheetRotation,
          })),
        reset: () =>
          onUpdateSide((s) => ({
            ...s,
            sheetOffset: { x: 0, y: 0 },
            sheetWidth: layout.bounds.width,
            sheetHeight: layout.bounds.height,
            sheetRotation: 0,
          })),
      };
    }
    const layer = side.layers.find((l) => l.id === selectedLayerId);
    if (layer && layer.kind === "image") {
      const panel = panelById[layer.panelId];
      return {
        label: "Logo / image",
        width: layer.width,
        height: layer.height,
        rotation: layer.rotation,
        set: (v: { width?: number; height?: number; rotation?: number }) =>
          updateLayer({ ...layer, width: v.width ?? layer.width, height: v.height ?? layer.height, rotation: v.rotation ?? layer.rotation }),
        reset: () => {
          // Back to unrotated, centred at half the panel size.
          const w = panel ? panel.w * 0.5 : layer.width;
          const h = panel ? panel.h * 0.5 : layer.height;
          updateLayer({ ...layer, rotation: 0, width: w, height: h, x: panel ? (panel.w - w) / 2 : layer.x, y: panel ? (panel.h - h) / 2 : layer.y });
        },
      };
    }
    return null;
  })();

  /**
   * Changes zoom while keeping the content under `anchor` (viewport-relative px,
   * defaulting to the viewport's centre) pinned in place. Without this the canvas
   * grows from its top-left corner, so whatever you were looking at slides away
   * off-screen as you zoom.
   */
  const viewportRef = useRef<HTMLDivElement>(null);
  const applyZoom = (nextZoom: number, anchor?: { x: number; y: number }) => {
    const vp = viewportRef.current;
    const prev = zoom;
    const next = clampZoom(nextZoom);
    if (next === prev) return;
    if (!vp) {
      setZoom(next);
      return;
    }
    const ax = anchor?.x ?? vp.clientWidth / 2;
    const ay = anchor?.y ?? vp.clientHeight / 2;
    // Position within the unscaled content that currently sits under the anchor.
    const contentX = (vp.scrollLeft + ax) / prev;
    const contentY = (vp.scrollTop + ay) / prev;
    setZoom(next);
    // Scroll has to be corrected after the larger/smaller canvas has been laid out.
    requestAnimationFrame(() => {
      vp.scrollLeft = contentX * next - ax;
      vp.scrollTop = contentY * next - ay;
    });
  };

  // Registered natively (not via React's onWheel) so it can be non-passive and
  // therefore actually able to preventDefault the page/zoom gesture.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 1) return;
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      applyZoom(zoom * Math.exp(-e.deltaY * 0.0015), { x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  return (
    <div className="dieline-canvas-wrap">
      <div className="zoom-toolbar">
        <button type="button" onClick={() => applyZoom(zoom / 1.25)} title="Zoom out">
          −
        </button>
        <button type="button" className="zoom-readout" onClick={() => applyZoom(1)} title="Reset to 100%">
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" onClick={() => applyZoom(zoom * 1.25)} title="Zoom in">
          +
        </button>
        <span className="toolbar-sep" />
        <label className="toolbar-check" title="Overlay double-arrow measurements on the dieline.">
          <input type="checkbox" checked={!!showDimensions} onChange={(e) => onToggleDimensions?.(e.target.checked)} />
          Measure
        </label>
        <label
          className="toolbar-check"
          title="Off: clicking the dieline selects panels, and artwork can only be grabbed outside the lines. On: the dieline ignores clicks so you can grab and move the artwork anywhere."
        >
          <input type="checkbox" checked={lockTemplate} onChange={(e) => onToggleLockTemplate?.(e.target.checked)} />
          Lock
        </label>
      </div>
      <div
        className="dieline-viewport"
        ref={viewportRef}
        style={{ cursor: spaceHeld ? (panState.current ? "grabbing" : "grab") : undefined }}
        onPointerDown={onPanPointerDown}
        onPointerMove={onPanPointerMove}
        onPointerUp={onPanPointerUp}
        onPointerCancel={onPanPointerUp}
      >
      <Stage
        width={stageW}
        height={stageH}
        x={offsetXpx}
        y={offsetYpx}
        // While Space is held, drags pan the viewport — the canvas must not also
        // grab them and move a shape at the same time.
        listening={!spaceHeld}
        style={{ background: "#e9ebf0", borderRadius: 8, margin: "auto" }}
      >
      <Layer>
        <Rect
          x={content.minX * pxPerMm}
          y={(layout.bounds.height - content.maxY) * pxPerMm}
          width={stageW}
          height={stageH}
          fill={side.backgroundColor}
          onClick={() => setSelectedLayerId(null)}
        />
        {side.sheetImage && Object.keys(side.panelImages).length === 0 && (
          <SheetImageLayer
            side={side}
            layout={layout}
            pxPerMm={pxPerMm}
            selected={selectedLayerId === SHEET_LAYER_ID}
            onSelect={() => setSelectedLayerId(SHEET_LAYER_ID)}
            onUpdateSide={onUpdateSide}
            onRef={(node) => {
              if (node) shapeRefs.current.set(SHEET_LAYER_ID, node);
              else shapeRefs.current.delete(SHEET_LAYER_ID);
            }}
          />
        )}
        {Object.entries(side.panelImages).map(([panelId, src]) => {
          const panel = panelById[panelId];
          if (!panel) return null;
          return <PanelPerImage key={panelId} panel={panel} src={src} pxPerMm={pxPerMm} boundsHeight={layout.bounds.height} />;
        })}
      </Layer>

      {/* Printed lines are drawn above the artwork but never intercept clicks. */}
      <Layer listening={false}>
        {layout.cutOutline.map((poly, i) => (
          <Line
            key={`cut-${i}`}
            points={poly.flatMap(([x, y]) => toStage(x, y, layout.bounds.height, pxPerMm))}
            stroke="#e2231a"
            strokeWidth={1.1}
            closed={false}
            lineJoin="round"
          />
        ))}
        {layout.foldLines.map((f, i) => (
          <Line
            key={`fold-${i}`}
            points={[...toStage(f.a[0], f.a[1], layout.bounds.height, pxPerMm), ...toStage(f.b[0], f.b[1], layout.bounds.height, pxPerMm)]}
            stroke="#1a9e4f"
            strokeWidth={0.9}
            dash={[6, 4]}
          />
        ))}
      </Layer>

      {/* Interactive layer. Child order matters: logo/text layers first, then the
          panel hit-areas above them (so an unlocked template wins clicks over the
          artwork), then the Transformer last so its handles are always on top and
          clickable regardless. */}
      <Layer>
        {side.layers.map((layer) => {
          const panel = panelById[layer.panelId];
          if (!panel) return null;
          const common = {
            key: layer.id,
            layer,
            panel,
            boundsHeight: layout.bounds.height,
            pxPerMm,
            selected: selectedLayerId === layer.id,
            onSelect: () => setSelectedLayerId(layer.id),
            onChange: updateLayer,
            onRef: (node: Konva.Node | null) => {
              if (node) shapeRefs.current.set(layer.id, node);
              else shapeRefs.current.delete(layer.id);
            },
          };
          return layer.kind === "text" ? <TextLayerNode {...common} /> : <ImageLayerNode {...common} />;
        })}

        {layout.panels.map((p) => {
          // Use the panel's true bbox — NOT origin + w/h. For a mirrored
          // bottom-attached flap, `origin` is its top hinge edge, so the old
          // origin-based rect landed inside the wall above it (which is why
          // clicking a bottom flap highlighted a box inside the fold rectangle).
          const [x, y] = toStage(p.min[0], p.max[1], layout.bounds.height, pxPerMm);
          return (
            <Rect
              key={`hit-${p.id}`}
              x={x}
              y={y}
              width={(p.max[0] - p.min[0]) * pxPerMm}
              height={(p.max[1] - p.min[1]) * pxPerMm}
              fill="transparent"
              stroke={selectedPanelId === p.id ? "#f59e0b" : undefined}
              strokeWidth={2}
              // Locking the template lets clicks fall through to the artwork
              // underneath, so the image can be grabbed anywhere.
              listening={!lockTemplate}
              onClick={() => {
                onSelectPanel(p.id);
                setSelectedLayerId(null);
              }}
              onTap={() => onSelectPanel(p.id)}
            />
          );
        })}

        {/* keepRatio makes the four DIAGONAL corner anchors scale proportionally
            (so an image can't be distorted by a corner drag), while the four edge
            anchors deliberately stretch a single axis. rotateEnabled adds the
            rotation handle above the selection. */}
        <Transformer
          ref={transformerRef}
          rotateEnabled
          keepRatio
          enabledAnchors={[
            "top-left",
            "top-center",
            "top-right",
            "middle-left",
            "middle-right",
            "bottom-left",
            "bottom-center",
            "bottom-right",
          ]}
          anchorSize={9}
          rotateAnchorOffset={22}
          // Hold Shift while dragging the rotate handle to snap to 45-degree steps.
          rotationSnaps={shiftHeld ? ROTATION_SNAPS_45 : []}
          rotationSnapTolerance={shiftHeld ? 22.5 : 0}
          borderStroke="#2563eb"
          anchorStroke="#2563eb"
          anchorFill="#ffffff"
          boundBoxFunc={(_oldBox, newBox) => ({
            ...newBox,
            width: Math.max(4, newBox.width),
            height: Math.max(4, newBox.height),
          })}
        />
      </Layer>

      {showDimensions && (
        <Layer listening={false}>
          <DimensionsLayer layout={layout} pxPerMm={pxPerMm} />
        </Layer>
      )}
      </Stage>
      </div>

      {/* Only rendered while a resizable image is selected — deselecting hides it. */}
      {selectedImage && (
        <div className="image-inspector">
          <div className="image-inspector-head">
            <strong>{selectedImage.label}</strong>
            <button type="button" className="icon-btn" title="Deselect" onClick={() => setSelectedLayerId(null)}>
              ×
            </button>
          </div>

          <label className="slider-row">
            <span>
              Width <b>{selectedImage.width.toFixed(0)} mm</b>
            </span>
            <input
              type="range"
              min={5}
              max={Math.max(400, Math.round(layout.bounds.width * 2))}
              step={1}
              value={Math.round(selectedImage.width)}
              onChange={(e) => selectedImage.set({ width: Number(e.target.value) })}
            />
          </label>

          <label className="slider-row">
            <span>
              Height <b>{selectedImage.height.toFixed(0)} mm</b>
            </span>
            <input
              type="range"
              min={5}
              max={Math.max(400, Math.round(layout.bounds.height * 2))}
              step={1}
              value={Math.round(selectedImage.height)}
              onChange={(e) => selectedImage.set({ height: Number(e.target.value) })}
            />
          </label>

          <label className="slider-row">
            <span>
              Angle <b>{Math.round(selectedImage.rotation)}°</b>
            </span>
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={Math.round(selectedImage.rotation)}
              onChange={(e) => selectedImage.set({ rotation: Number(e.target.value) })}
            />
          </label>

          <div className="button-row">
            <button type="button" className="secondary" onClick={() => selectedImage.set({ rotation: 0 })}>
              Straighten
            </button>
            <button type="button" className="secondary" onClick={selectedImage.reset}>
              Reset image
            </button>
          </div>
          <p className="muted small">Hold Shift while dragging the rotate handle to snap to 45° steps.</p>
        </div>
      )}
    </div>
  );
}
