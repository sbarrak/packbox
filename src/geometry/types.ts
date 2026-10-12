// Core data model shared by the 2D dieline layout, the 3D fold simulator,
// and every exporter (SVG / PDF / DXF / GLB).
//
// A box is represented as a TREE of panels. Each non-root panel is attached
// to its parent along one edge of the parent ("hinge"). This single tree is
// used two ways:
//   - Flattened (all hinge angles = 0)  -> the 2D dieline (what you cut)
//   - Folded    (hinge angle = target)  -> the 3D box (what you get)

export type HingeEdge = "top" | "bottom" | "left" | "right";

export type FaceRole =
  | "front"
  | "back"
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "glue"
  | "flap-top-front"
  | "flap-top-back"
  | "flap-top-left"
  | "flap-top-right"
  | "flap-bottom-front"
  | "flap-bottom-back"
  | "flap-bottom-left"
  | "flap-bottom-right";

/** A 2D point in millimeters, local to the panel's own coordinate frame. */
export type Point = [number, number];

export interface PanelNode {
  id: string;
  name: string;
  /** Bounding width/height of the panel in mm (its local frame is 0..w, 0..h). */
  w: number;
  h: number;
  /**
   * Outline of the panel in its own local coordinates (0,0 at bottom-left).
   * Defaults to a rectangle [w x h] if omitted. Used for flaps with angled
   * corners (dust flaps) or tuck-flap profiles (trapezoid + locking slot).
   */
  outline?: Point[];
  /** Edge of the PARENT this panel is hinged to. Root has none. */
  parentEdge?: HingeEdge;
  /** Where along the parent's edge this panel starts, in mm from the edge's origin corner. */
  parentOffset?: number;
  /** Fold angle (radians) this panel reaches at foldAmount = 1, relative to its parent's plane. */
  foldAngle: number;
  /**
   * Where in the overall 0..1 fold slider this hinge should animate, so the box closes
   * in a realistic order (tube first, then inner/glued flaps, then outer flaps) instead
   * of every hinge moving in lockstep. Defaults to the full 0..1 range if omitted.
   */
  foldStart?: number;
  foldEnd?: number;
  /** True if a fold line should be drawn between this panel and its parent (false = plain cut). */
  hinged: boolean;
  /** Which real-world face of the finished box this panel represents (for artwork mapping). */
  face: FaceRole;
  /** True if this face is only visible on the INSIDE of the finished box. */
  isInside?: boolean;
  parentId?: string;
  children: PanelNode[];
}

/** The four walls of the tube that can carry a top/bottom flap. */
export type FlapWall = "front" | "back" | "left" | "right";

export const FLAP_WALLS: FlapWall[] = ["front", "back", "left", "right"];

export interface BoxDimensions {
  length: number; // L - front/back width, mm
  width: number; // W - side depth, mm
  height: number; // H - box height, mm
  /**
   * Per-wall flap depth in mm. Each value applies SYMMETRICALLY to that wall's
   * top and bottom flap — real dielines size flaps per wall (see the reference
   * card-deck drawing: 18mm front/back vs 35mm left/right), which is what lets a
   * closed lid stop short of the opposite edge instead of colliding with it.
   * A wall left undefined falls back to the style's own computed default;
   * an explicit 0 omits that flap entirely.
   */
  flaps?: Partial<Record<FlapWall, number>>;
  /**
   * Flap at the LEFT end of the unfolded strip. Defaults to 0 (no panel) —
   * most styles only have a right-end tab.
   */
  endFlapLeft?: number;
  /**
   * Flap at the RIGHT end of the strip: the manufacturer's glue tab. 0 omits it.
   */
  endFlapRight?: number;
  /** Depth of a style-specific lid/tuck panel (mailer lid tuck). */
  lidDepth?: number;
}

export type BoxStyleId =
  | "tuck-end"
  | "rsc"
  | "card-deck"
  | "card-deck-lock"
  | "mailer"
  | "hsc"
  | "auto-lock-tray"
  | "tuck-top-auto-bottom"
  | "two-piece-base"
  | "two-piece-lid";

export interface BoxStyleDefinition {
  id: BoxStyleId;
  label: string;
  description: string;
  defaultDimensions: BoxDimensions;
  build: (dims: BoxDimensions) => PanelNode;
}

/** A panel positioned in flat (unfolded) world space, ready to draw/export. */
export interface FlatPanel {
  id: string;
  name: string;
  face: FaceRole;
  isInside?: boolean;
  /** Polygon in world mm coordinates (already rotated/translated flat). */
  points: Point[];
  /**
   * The anchor this panel was placed from — for a "bottom"-attached (mirrored)
   * panel this is its HINGE edge at the TOP of the panel, not its lower-left
   * corner. Prefer `min`/`max` for anything geometric; see `mirrored`.
   */
  origin: Point;
  angle: number; // radians, panel's rotation in the flat sheet (should be axis-aligned: 0 or ±90/180)
  /**
   * True axis-aligned bounding box of `points`, in world mm (Y-up). This — not
   * `origin` — is what click hit-testing, dimension lines, and artwork cropping
   * should use: `origin` is only the placement anchor and does NOT equal the
   * lower-left corner for mirrored (bottom-attached) flaps.
   */
  min: Point;
  max: Point;
  /**
   * True when this panel was laid out with its local Y axis flipped (every
   * "bottom"-attached flap). Its local frame's v=h edge sits at world `min[1]`
   * instead of `max[1]`, so artwork sampled from the sheet has to be flipped
   * vertically to line up with the panel's own texture space.
   */
  mirrored: boolean;
  w: number;
  h: number;
}

/**
 * Converts a world-space point into a panel's own local frame (0..w, 0..h with
 * the origin at the panel's lower-left as the artwork sees it), accounting for
 * mirrored bottom-attached flaps.
 */
export function worldToPanelLocal(panel: FlatPanel, [x, y]: Point): Point {
  return [x - panel.min[0], panel.mirrored ? panel.max[1] - y : y - panel.min[1]];
}

/** Exact inverse of `worldToPanelLocal`. */
export function panelLocalToWorld(panel: FlatPanel, [x, y]: Point): Point {
  return [panel.min[0] + x, panel.mirrored ? panel.max[1] - y : panel.min[1] + y];
}

export interface FoldLine {
  a: Point;
  b: Point;
}

export interface DielineLayout {
  panels: FlatPanel[];
  cutOutline: Point[][]; // one or more closed polygons (outer boundary + any internal cut slots)
  foldLines: FoldLine[];
  bounds: { width: number; height: number };
}
