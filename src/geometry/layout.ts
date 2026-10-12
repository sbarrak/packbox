import { rect } from "./shapes";
import type { DielineLayout, FlatPanel, FoldLine, HingeEdge, PanelNode, Point } from "./types";

/**
 * For a child panel, which edge index (into its own LOCAL outline) is the
 * hinge shared with its parent. By construction (see shapes.ts):
 *   - "right"-attached children (rect only) have their hinge on the LEFT edge (last edge).
 *   - "top"/"bottom"-attached children (rect or flap shapes) have their hinge
 *     on the BOTTOM edge (first edge, points[0] -> points[1]).
 */
function hingeEdgeIndex(node: PanelNode, pointCount: number): number {
  if (!node.parentEdge) return -1;
  // A "right"-attached child sits to the right of its parent, so the shared edge
  // is the child's own LEFT edge (last edge). A "left"-attached child sits to the
  // left, so the shared edge is its RIGHT edge (index 1 on a rect) instead.
  if (node.parentEdge === "right") return pointCount - 1;
  if (node.parentEdge === "left") return 1;
  return 0;
}

/**
 * Edge index (into a plain rectangle's outline) that a child attached via `edge`
 * occupies on the PARENT's own boundary. Only meaningful for canonical 4-point
 * rectangles — the only shape in this app that ever has children.
 */
function edgeIndexForAttachment(edge: HingeEdge, pointCount: number): number {
  if (pointCount !== 4) return -1;
  switch (edge) {
    case "bottom":
      return 0;
    case "right":
      return 1;
    case "top":
      return 2;
    case "left":
      return 3;
    default:
      return -1;
  }
}

/** Every edge index of `node`'s own outline that is a hinge — either to its parent or to one of its children. */
function excludedEdges(node: PanelNode, pointCount: number): Set<number> {
  const excluded = new Set<number>();
  if (node.parentEdge) excluded.add(hingeEdgeIndex(node, pointCount));
  for (const child of node.children) {
    if (!child.parentEdge) continue;
    const idx = edgeIndexForAttachment(child.parentEdge, pointCount);
    if (idx >= 0) excluded.add(idx);
  }
  return excluded;
}

/**
 * Groups every edge of `points` that ISN'T in `excluded` into one or more open
 * polylines (a panel can have zero free edges if it's fully interior, one
 * contiguous run, or — in principle — several disjoint runs).
 */
function cutPaths(points: Point[], excluded: Set<number>): Point[][] {
  const n = points.length;
  if (excluded.size === 0) return [[...points, points[0]]]; // no hinges at all -> closed loop
  if (excluded.size >= n) return []; // every edge is a hinge -> fully interior, nothing to cut

  const start = (Math.min(...excluded) + 1) % n;
  const runs: Point[][] = [];
  let current: Point[] | null = null;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (excluded.has(i)) {
      current = null;
      continue;
    }
    if (!current) {
      current = [points[i]];
      runs.push(current);
    }
    current.push(points[(i + 1) % n]);
  }
  return runs;
}

interface WalkResult {
  panels: FlatPanel[];
  foldLines: FoldLine[];
  cutOutline: Point[][];
}

/** Axis-aligned bounding box of a polygon, in the same space as the input. */
function bboxOf(points: Point[]): { min: Point; max: Point } {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    min: [Math.min(...xs), Math.min(...ys)],
    max: [Math.max(...xs), Math.max(...ys)],
  };
}

function walk(node: PanelNode, originX: number, originY: number): WalkResult {
  const localPoints = node.outline ?? rect(node.w, node.h);
  const worldPoints: Point[] = localPoints.map(([x, y]) => [originX + x, originY + y]);
  const n = worldPoints.length;

  const panels: FlatPanel[] = [
    {
      id: node.id,
      name: node.name,
      face: node.face,
      isInside: node.isInside,
      points: worldPoints,
      origin: [originX, originY],
      angle: 0,
      ...bboxOf(worldPoints),
      mirrored: false,
      w: node.w,
      h: node.h,
    },
  ];
  const foldLines: FoldLine[] = [];
  if (node.parentEdge) {
    const hingeIdx = hingeEdgeIndex(node, n);
    if (node.hinged) foldLines.push({ a: worldPoints[hingeIdx], b: worldPoints[(hingeIdx + 1) % n] });
  }

  const cutOutline = cutPaths(worldPoints, excludedEdges(node, n));

  for (const child of node.children) {
    let childOriginX = originX;
    let childOriginY = originY;
    let flip = false;
    const offset = child.parentOffset ?? 0;
    if (child.parentEdge === "right") {
      childOriginX = originX + node.w;
      childOriginY = originY + offset;
    } else if (child.parentEdge === "left") {
      // Sits to the LEFT of the parent, so its own origin is its width back from
      // the parent's left edge.
      childOriginX = originX - child.w;
      childOriginY = originY + offset;
    } else if (child.parentEdge === "top") {
      childOriginX = originX + offset;
      childOriginY = originY + node.h;
    } else if (child.parentEdge === "bottom") {
      childOriginX = originX + offset;
      childOriginY = originY;
      flip = true;
    }

    const res = flip ? mirrorWalk(child, childOriginX, childOriginY) : walk(child, childOriginX, childOriginY);
    panels.push(...res.panels);
    foldLines.push(...res.foldLines);
    cutOutline.push(...res.cutOutline);
  }

  return { panels, foldLines, cutOutline };
}

/** Same as walk(), but flips local Y before translating — used for "bottom" attached flaps. */
function mirrorWalk(node: PanelNode, originX: number, originY: number): WalkResult {
  const localPoints = node.outline ?? rect(node.w, node.h);
  const worldPoints: Point[] = localPoints.map(([x, y]) => [originX + x, originY - y]);
  const n = worldPoints.length;

  const panels: FlatPanel[] = [
    {
      id: node.id,
      name: node.name,
      face: node.face,
      isInside: node.isInside,
      points: worldPoints,
      origin: [originX, originY],
      angle: Math.PI,
      ...bboxOf(worldPoints),
      mirrored: true,
      w: node.w,
      h: node.h,
    },
  ];
  const foldLines: FoldLine[] = [];
  if (node.parentEdge && node.hinged) {
    const hingeIdx = hingeEdgeIndex(node, n);
    foldLines.push({ a: worldPoints[hingeIdx], b: worldPoints[(hingeIdx + 1) % n] });
  }
  const cutOutline = cutPaths(worldPoints, excludedEdges(node, n));
  // Leaf flaps never have children in this app, so no further recursion needed here.
  return { panels, foldLines, cutOutline };
}

export function computeFlatLayout(root: PanelNode): DielineLayout {
  const { panels, foldLines, cutOutline } = walk(root, 0, 0);

  const allPoints = panels.flatMap((p) => p.points);
  const xs = allPoints.map((p) => p[0]);
  const ys = allPoints.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  // Normalize so everything starts at (0,0) with a small margin.
  const margin = 5;
  const shiftX = -minX + margin;
  const shiftY = -minY + margin;
  const shift = (pts: Point[]): Point[] => pts.map(([x, y]) => [x + shiftX, y + shiftY]);

  return {
    panels: panels.map((p) => ({
      ...p,
      points: shift(p.points),
      origin: [p.origin[0] + shiftX, p.origin[1] + shiftY] as Point,
      min: [p.min[0] + shiftX, p.min[1] + shiftY] as Point,
      max: [p.max[0] + shiftX, p.max[1] + shiftY] as Point,
    })),
    cutOutline: cutOutline.map(shift),
    foldLines: foldLines.map((f) => ({ a: shift([f.a])[0], b: shift([f.b])[0] })),
    bounds: { width: maxX - minX + margin * 2, height: maxY - minY + margin * 2 },
  };
}

export function flattenTree(root: PanelNode): PanelNode[] {
  return [root, ...root.children.flatMap(flattenTree)];
}
