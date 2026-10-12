import type { Point } from "./types";

/** Plain rectangle outline, origin at bottom-left, going counter-clockwise. */
export function rect(w: number, h: number): Point[] {
  return [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
}

/**
 * Dust flap: rectangle with the two outer top corners cut at 45 degrees so
 * adjacent flaps don't collide when folded. `h` is measured at the center.
 */
export function dustFlap(w: number, h: number): Point[] {
  const cut = Math.min(h, w / 2);
  return [
    [0, 0],
    [w, 0],
    [w, h - cut],
    [w - cut, h],
    [cut, h],
    [0, h - cut],
  ];
}

/**
 * Straight tuck-end flap: trapezoid that narrows slightly toward the tip,
 * with a small locking slot cut into the leading edge.
 */
export function tuckFlap(w: number, h: number): Point[] {
  const inset = Math.min(w * 0.12, h * 0.6);
  const slotW = w * 0.22;
  const slotDepth = Math.min(h * 0.18, 6);
  const cx = w / 2;
  return [
    [0, 0],
    [w, 0],
    [w - inset, h],
    [cx + slotW / 2, h],
    [cx + slotW / 2, h - slotDepth],
    [cx - slotW / 2, h - slotDepth],
    [cx - slotW / 2, h],
    [inset, h],
  ];
}

/** Simple triangular/angled auto-lock style flap tab used on mailer boxes. */
export function lockTab(w: number, h: number): Point[] {
  const tip = w * 0.3;
  return [
    [0, 0],
    [w, 0],
    [w, h * 0.55],
    [w / 2 + tip / 2, h],
    [w / 2 - tip / 2, h],
    [0, h * 0.55],
  ];
}

export function boundsOf(points: Point[]): { w: number; h: number } {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
