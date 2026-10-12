// Numerically replays the exact same hinge math Fold3D.tsx uses (via THREE.Object3D
// matrix composition, no renderer needed) so we can check whether flaps actually reach
// their closed position at foldAmount = 1, without needing a live GUI.
import * as THREE from "three";
import { getBoxStyle } from "../src/geometry/boxBuilders";
import { rect } from "../src/geometry/shapes";
import type { PanelNode } from "../src/geometry/types";

interface HingeInfo {
  pivot: [number, number, number];
  axis: "x" | "y";
  baseAngle: number;
}

function computeHinge(node: PanelNode, parentW: number, parentH: number): HingeInfo {
  const offset = node.parentOffset ?? 0;
  switch (node.parentEdge) {
    case "right":
      return { pivot: [parentW, offset, 0], axis: "y", baseAngle: 0 };
    case "left":
      return { pivot: [0, offset, 0], axis: "y", baseAngle: 0 };
    case "top":
      return { pivot: [offset, parentH, 0], axis: "x", baseAngle: 0 };
    case "bottom":
      return { pivot: [offset, 0, 0], axis: "x", baseAngle: Math.PI };
    default:
      return { pivot: [0, 0, 0], axis: "x", baseAngle: 0 };
  }
}

function buildGroup(node: PanelNode, parentW: number, parentH: number, foldAmount: number): THREE.Group {
  const { pivot, axis, baseAngle } = computeHinge(node, parentW, parentH);
  const start = node.foldStart ?? 0;
  const end = node.foldEnd ?? 1;
  const localT = end > start ? Math.min(1, Math.max(0, (foldAmount - start) / (end - start))) : foldAmount;
  const angle = baseAngle + localT * node.foldAngle;
  const group = new THREE.Group();
  group.position.set(...pivot);
  if (axis === "x") group.rotation.set(angle, 0, 0);
  else group.rotation.set(0, angle, 0);

  // Marker at the flap/panel's own "tip" (far edge midpoint, away from the hinge).
  const pts = node.outline ?? rect(node.w, node.h);
  const midX = (Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2;
  const maxY = Math.max(...pts.map((p) => p[1]));
  const marker = new THREE.Object3D();
  marker.position.set(midX, maxY, 0);
  marker.name = `${node.name}::tip`;
  group.add(marker);

  if (["front", "back", "left", "right"].includes(node.face)) {
    const wallMarker = new THREE.Object3D();
    wallMarker.position.set(node.w / 2, node.h / 2, 0);
    wallMarker.name = `${node.name}::wall`;
    group.add(wallMarker);
  }

  for (const child of node.children) {
    group.add(buildGroup(child, node.w, node.h, foldAmount));
  }
  return group;
}

function collectTips(group: THREE.Object3D, out: { name: string; pos: THREE.Vector3 }[]) {
  group.updateWorldMatrix(true, false);
  if (group.name.endsWith("::tip")) {
    const pos = new THREE.Vector3();
    group.getWorldPosition(pos);
    out.push({ name: group.name.replace("::tip", ""), pos });
  }
  for (const child of group.children) collectTips(child, out);
}

function collectWallNormals(group: THREE.Object3D, out: { name: string; center: THREE.Vector3; normal: THREE.Vector3 }[]) {
  group.updateWorldMatrix(true, false);
  if (group.name.endsWith("::wall")) {
    const center = new THREE.Vector3();
    group.getWorldPosition(center);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(group.matrixWorld);
    out.push({ name: group.name.replace("::wall", ""), center, normal });
  }
  for (const child of group.children) collectWallNormals(child, out);
}

const styleId = process.argv[2] ?? "rsc";
const style = getBoxStyle(styleId as any);
const dims = style.defaultDimensions;
const root = style.build(dims);

console.log(`\n=== ${style.label} — L${dims.length} W${dims.width} H${dims.height} ===`);

function tipsAt(t: number) {
  const sceneRoot = buildGroup(root, root.w, root.h, t);
  sceneRoot.updateWorldMatrix(true, true);
  const tips: { name: string; pos: THREE.Vector3 }[] = [];
  collectTips(sceneRoot, tips);
  const walls: { name: string; center: THREE.Vector3; normal: THREE.Vector3 }[] = [];
  collectWallNormals(sceneRoot, walls);
  return { tips, walls };
}

/**
 * Names of panels whose face is the manufacturer's glue/end tab. These wrap around
 * and bond to the INSIDE of an adjacent wall, so their tip legitimately finishes
 * level with that wall rather than deep inside the box — the "closes inward past
 * its own wall" rule below doesn't apply to them. Matched by FACE, not by display
 * name: an earlier version hard-coded the string "Glue Flap" and silently started
 * reporting false failures the moment the panel was renamed.
 */
const glueNames = new Set<string>();
(function collectGlue(node: typeof root) {
  if (node.face === "glue") glueNames.add(node.name);
  node.children.forEach(collectGlue);
})(root);

const open = tipsAt(0);
const closed = tipsAt(1);
const centroid = closed.walls.reduce((acc, w) => acc.add(w.center), new THREE.Vector3()).divideScalar(closed.walls.length);
const footprintRadius = Math.max(...closed.walls.map((w) => w.center.distanceTo(centroid))) + 1;

console.log(`\n  Wall texture-facing check (outside should face away from the box centroid):`);
let failures = 0;
for (const w of closed.walls) {
  const toOutside = w.center.clone().sub(centroid).normalize();
  const dot = w.normal.dot(toOutside);
  const ok = dot > 0;
  if (!ok) failures++;
  console.log(`    ${w.name.padEnd(16)} ${ok ? "OK " : "BUG"}  (dot=${dot.toFixed(2)})`);
}

// Compare horizontal (X,Z) distance only — flap tips sit at rim height (Y=H) while
// wall centers sit at half height (Y=H/2), and that fixed vertical offset would
// otherwise pollute a full 3D distance comparison for short/shallow walls.
const flatDist = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

console.log(`\n  Flap closing check (folded tip should end up closer to centroid than its own wall, horizontally):`);
const wallNames = new Set(closed.walls.map((w) => w.name));
for (const openTip of open.tips) {
  if (wallNames.has(openTip.name) || glueNames.has(openTip.name)) continue;
  const closedTip = closed.tips.find((c) => c.name === openTip.name);
  if (!closedTip) continue;
  // Find the wall this flap is hinged to (best-effort: match by name suffix "(Left)"/"(Right)"/"Front"/"Back").
  const parentWall =
    closed.walls.find((w) => openTip.name.includes(w.name)) ??
    closed.walls.find((w) => (openTip.name.includes("Left") && w.name.includes("Left")) || (openTip.name.includes("Right") && w.name.includes("Right")) || (openTip.name.includes("Front") && w.name.includes("Front")) || (openTip.name.includes("Back") && w.name.includes("Back")));
  const wallDist = flatDist((parentWall ?? closed.walls[0]).center, centroid);
  const openDist = flatDist(openTip.pos, centroid);
  const closedDist = flatDist(closedTip.pos, centroid);
  const ok = closedDist < wallDist;
  if (!ok) failures++;
  console.log(
    `    ${openTip.name.padEnd(28)} open=${openDist.toFixed(0).padStart(5)}  closed=${closedDist.toFixed(0).padStart(5)}  wall=${wallDist.toFixed(0).padStart(5)}  ${ok ? "OK (moved inward past its wall)" : "BUG (still outside its wall)"}`,
  );
}
void footprintRadius;

console.log(`\n${failures === 0 ? "ALL OK for this style" : `${failures} PROBLEM(S) FOUND`}`);
process.exitCode = failures === 0 ? 0 : 1;
