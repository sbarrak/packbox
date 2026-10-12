import type { BoxDimensions, BoxStyleDefinition, BoxStyleId, FaceRole, FlapWall, HingeEdge, PanelNode } from "./types";
import { FLAP_WALLS } from "./types";
import { boundsOf, dustFlap, lockTab, rect, tuckFlap } from "./shapes";

let uid = 0;
function nextId(prefix: string) {
  uid += 1;
  return `${prefix}-${uid}`;
}

interface MakeOpts {
  name: string;
  face: FaceRole;
  w: number;
  h: number;
  outline?: PanelNode["outline"];
  foldAngle?: number;
  hinged?: boolean;
  isInside?: boolean;
  foldStart?: number;
  foldEnd?: number;
}

function makePanel(opts: MakeOpts): PanelNode {
  return {
    id: nextId(opts.face),
    name: opts.name,
    w: opts.w,
    h: opts.h,
    outline: opts.outline,
    foldAngle: opts.foldAngle ?? -Math.PI / 2,
    hinged: opts.hinged ?? true,
    face: opts.face,
    isInside: opts.isInside,
    foldStart: opts.foldStart,
    foldEnd: opts.foldEnd,
    children: [],
  };
}

// Assembly order for the fold slider: forming the tube has to happen before any flap
// can close, inner flaps (the ones that get glued/tucked UNDER) close next, and the
// outer flaps that cover everything close last. Purely a presentation nicety — doesn't
// affect the 2D dieline or the fully-open/fully-closed end states.
const PHASE_TUBE = { foldStart: 0, foldEnd: 0.4 };
const PHASE_INNER = { foldStart: 0.4, foldEnd: 0.7 };
const PHASE_OUTER = { foldStart: 0.7, foldEnd: 1 };

/** Attach `child` to `parent` along `edge`, at `offset` mm from that edge's origin corner. */
function attach(parent: PanelNode, edge: HingeEdge, offset: number, child: PanelNode): PanelNode {
  child.parentEdge = edge;
  child.parentOffset = offset;
  child.parentId = parent.id;
  parent.children.push(child);
  return child;
}

// Every "right"-edge tube-wall hinge below uses the SAME sign (TUBE_FOLD) so the
// chain winds consistently and closes back on itself after 4 quarter-turns. This
// sign was brute-force verified against all 4 sign combinations (scripts/brute-fold.ts):
// it's the only one, paired with TOP_FOLD/BOTTOM_FOLD below, that makes every wall's
// FrontSide ("outside" texture) face away from the box AND every flap close inward
// over the opening — the two don't share one root cause, so both had to be checked
// together, not assumed from either one alone.
const TUBE_FOLD = Math.PI / 2;
const TOP_FOLD = -Math.PI / 2;
const BOTTOM_FOLD = Math.PI / 2;

/**
 * Resolves the four per-wall flap depths for a style: the user's explicit value
 * for a wall wins, otherwise the style's own computed default. The SAME resolved
 * value is used for that wall's top and bottom flap, keeping the two symmetrical.
 * A resolved depth of 0 means "no flap on this wall" and the panel is skipped.
 */
function resolveFlaps(dims: BoxDimensions, defaults: Record<FlapWall, number>): Record<FlapWall, number> {
  const out = {} as Record<FlapWall, number>;
  for (const wall of FLAP_WALLS) {
    const v = dims.flaps?.[wall];
    out[wall] = Math.max(0, v ?? defaults[wall]);
  }
  return out;
}

/** The 4-wall tube shared by every "tube" style box, plus its end flap(s). */
function buildTube(dims: BoxDimensions) {
  const { length: L, width: W, height: H } = dims;
  const glue = dims.endFlapRight ?? Math.max(20, W * 0.5);
  const leftEnd = dims.endFlapLeft ?? 0;

  const front = makePanel({ name: "Front", face: "front", w: L, h: H, foldAngle: 0, hinged: false });
  const side1 = attach(front, "right", 0, makePanel({ name: "Side (Left)", face: "left", w: W, h: H, foldAngle: TUBE_FOLD, ...PHASE_TUBE }));
  const back = attach(side1, "right", 0, makePanel({ name: "Back", face: "back", w: L, h: H, foldAngle: TUBE_FOLD, ...PHASE_TUBE }));
  const side2 = attach(back, "right", 0, makePanel({ name: "Side (Right)", face: "right", w: W, h: H, foldAngle: TUBE_FOLD, ...PHASE_TUBE }));
  if (glue > 0) {
    attach(side2, "right", 0, makePanel({ name: "Glue Flap (Right End)", face: "glue", w: glue, h: H, foldAngle: TUBE_FOLD, ...PHASE_TUBE }));
  }
  if (leftEnd > 0) {
    // Mirror of the glue tab on the opposite end of the strip. Folds the other
    // way (negative TUBE_FOLD) since it wraps inward from the left instead.
    attach(front, "left", 0, makePanel({ name: "End Flap (Left End)", face: "glue", w: leftEnd, h: H, foldAngle: -TUBE_FOLD, ...PHASE_TUBE }));
  }

  return { front, side1, back, side2 };
}

/**
 * The style default per-wall flap depths for an RSC-style closure. Industry
 * convention: flaps on the shorter (W-wide) side walls reach ~L/2 so the two
 * opposing ones meet in the middle, while flaps on the longer (L-wide)
 * front/back walls reach ~W minus a little clearance so they fold over on top.
 */
function rscFlapDefaults(dims: BoxDimensions): Record<FlapWall, number> {
  const { length: L, width: W } = dims;
  const minor = Math.max(8, L / 2 - 1);
  const major = Math.max(8, W - 6);
  return { front: major, back: major, left: minor, right: minor };
}

function attachRSCFlaps(edge: "top" | "bottom", tube: ReturnType<typeof buildTube>, depths: Record<FlapWall, number>) {
  const { front, side1, back, side2 } = tube;
  const foldAngle = edge === "top" ? TOP_FOLD : BOTTOM_FOLD;
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  const add = (parent: PanelNode, wall: FlapWall, label: string, phase: typeof PHASE_INNER) => {
    const h = depths[wall];
    if (h <= 0) return; // 0 mm means "no flap on this wall"
    attach(parent, edge, 0, makePanel({ name: `${cap(edge)} Flap (${label})`, face: `flap-${edge}-${wall}`, w: parent.w, h, foldAngle, ...phase }));
  };
  add(side1, "left", "Left", PHASE_INNER);
  add(side2, "right", "Right", PHASE_INNER);
  add(front, "front", "Front", PHASE_OUTER);
  add(back, "back", "Back", PHASE_OUTER);
}

// ---------------------------------------------------------------------------
// 1. Straight Tuck End (STE) carton
// ---------------------------------------------------------------------------
function buildTuckEndCarton(dims: BoxDimensions): PanelNode {
  const { width: W } = dims;
  const tube = buildTube(dims);
  const { front, side1, back, side2 } = tube;
  const tuck = W * 0.55;
  const depths = resolveFlaps(dims, { front: tuck, back: tuck, left: tuck * 0.85, right: tuck * 0.85 });

  // Tuck flaps on front/back fold last; dust flaps on the sides tuck under first.
  // Same depth is used on top and bottom for each wall, so the two stay symmetrical.
  const addTuck = (parent: PanelNode, wall: FlapWall, edge: "top" | "bottom", label: string) => {
    const h = depths[wall];
    if (h <= 0) return;
    const isSide = wall === "left" || wall === "right";
    attach(
      parent,
      edge,
      0,
      makePanel({
        name: `${edge === "top" ? "Top" : "Bottom"} ${isSide ? "Dust" : "Tuck"} Flap (${label})`,
        face: `flap-${edge}-${wall}`,
        w: parent.w,
        h,
        outline: isSide ? dustFlap(parent.w, h) : tuckFlap(parent.w, h),
        foldAngle: edge === "top" ? TOP_FOLD : BOTTOM_FOLD,
        ...(isSide ? PHASE_INNER : PHASE_OUTER),
      }),
    );
  };

  for (const edge of ["top", "bottom"] as const) {
    addTuck(front, "front", edge, "Front");
    addTuck(side1, "left", edge, "Left");
    addTuck(back, "back", edge, "Back");
    addTuck(side2, "right", edge, "Right");
  }

  return front;
}

// ---------------------------------------------------------------------------
// 2. RSC (Regular Slotted Container) shipping box
// ---------------------------------------------------------------------------
// Standard RSC convention: MINOR flaps hinge off the shorter (W-wide) side panels and
// reach depth ~L/2 so the two opposing minor flaps meet at the center underneath.
// MAJOR flaps hinge off the longer (L-wide) front/back panels and reach depth ~W
// (minus a couple mm of clearance) so they fold OVER the minor flaps on top.
function buildRSC(dims: BoxDimensions): PanelNode {
  const tube = buildTube(dims);
  const depths = resolveFlaps(dims, rscFlapDefaults(dims));
  attachRSCFlaps("top", tube, depths);
  attachRSCFlaps("bottom", tube, depths);
  return tube.front;
}

// ---------------------------------------------------------------------------
// 2b. Half Slotted Container / open tray — RSC-style bottom, open top.
//     (Also reused for the Two-Piece Box base & lid presets below.)
// ---------------------------------------------------------------------------
function buildOpenTray(dims: BoxDimensions): PanelNode {
  const tube = buildTube(dims);
  attachRSCFlaps("bottom", tube, resolveFlaps(dims, rscFlapDefaults(dims)));
  return tube.front;
}

// ---------------------------------------------------------------------------
// 2c. Auto-lock bottom tray — open top, stylized snap-lock bottom tabs.
//     Note: this shows the general shape of a lock-bottom closure; the mating
//     slots that make opposing tabs actually interlock aren't modeled.
// ---------------------------------------------------------------------------
function buildAutoLockTray(dims: BoxDimensions): PanelNode {
  const { front, side1, back, side2 } = buildTube(dims);
  const depths = resolveFlaps(dims, rscFlapDefaults(dims));
  const addLock = (parent: PanelNode, wall: FlapWall, label: string, phase: typeof PHASE_INNER) => {
    const h = depths[wall];
    if (h <= 0) return;
    attach(parent, "bottom", 0, makePanel({ name: `Lock Flap (${label})`, face: `flap-bottom-${wall}`, w: parent.w, h, outline: lockTab(parent.w, h), foldAngle: BOTTOM_FOLD, ...phase }));
  };
  addLock(side1, "left", "Left", PHASE_INNER);
  addLock(side2, "right", "Right", PHASE_INNER);
  addLock(front, "front", "Front", PHASE_OUTER);
  addLock(back, "back", "Back", PHASE_OUTER);
  return front;
}

// ---------------------------------------------------------------------------
// 2d. Tuck-top, auto-bottom box — glued RSC-style bottom, tuck-end style top.
//     Common for cosmetics/cereal-style retail boxes that ship flat and get
//     erected + bottom-glued by machine, with a reusable tuck lid on top.
// ---------------------------------------------------------------------------
function buildTuckTopAutoBottom(dims: BoxDimensions): PanelNode {
  const { front, side1, back, side2 } = buildTube(dims);
  const depths = resolveFlaps(dims, rscFlapDefaults(dims));
  attachRSCFlaps("bottom", { front, side1, back, side2 }, depths);

  // Top is a tuck closure rather than a glued one, but it uses the SAME per-wall
  // depths as the bottom so the two stay symmetrical.
  const addTop = (parent: PanelNode, wall: FlapWall, label: string) => {
    const h = depths[wall];
    if (h <= 0) return;
    const isSide = wall === "left" || wall === "right";
    attach(
      parent,
      "top",
      0,
      makePanel({
        name: `Top ${isSide ? "Dust" : "Tuck"} Flap (${label})`,
        face: `flap-top-${wall}`,
        w: parent.w,
        h,
        outline: isSide ? dustFlap(parent.w, h) : tuckFlap(parent.w, h),
        foldAngle: TOP_FOLD,
        ...(isSide ? PHASE_INNER : PHASE_OUTER),
      }),
    );
  };
  addTop(front, "front", "Front");
  addTop(side1, "left", "Left");
  addTop(back, "back", "Back");
  addTop(side2, "right", "Right");

  return front;
}

// ---------------------------------------------------------------------------
// 3. Mailer box (tuck lid on top, auto-lock tabs on the bottom)
// ---------------------------------------------------------------------------
function buildMailer(dims: BoxDimensions): PanelNode {
  const { width: W, height: H } = dims;
  const { front, side1, back, side2 } = buildTube(dims);
  const lidDepth = dims.lidDepth ?? H * 0.9;
  const lockDefault = Math.min(W * 0.6, 30);
  const depths = resolveFlaps(dims, { front: lockDefault, back: lockDefault, left: lockDefault, right: lockDefault });
  back.name = "Back / Lid";

  // Lid hinges off the back panel (mailer style: lid folds over the top). A 180 degree
  // hinge is symmetric in its resting angle regardless of sign, so TOP_FOLD*2 here just
  // means "use the same winding convention as everything else" for consistency.
  const lid = attach(back, "top", 0, makePanel({ name: "Lid Top", face: "top", w: back.w, h: H, foldAngle: TOP_FOLD * 2, foldStart: 0.55, foldEnd: 0.85 }));
  // Lid Top is already flipped 180 degrees, which reverses which sign of its own
  // children's rotation reads as "inward" — hence -TOP_FOLD here, not TOP_FOLD.
  attach(lid, "top", 0, makePanel({ name: "Lid Tuck Flap", face: "flap-top-back", w: lid.w, h: lidDepth, outline: tuckFlap(lid.w, lidDepth), foldAngle: -TOP_FOLD, foldStart: 0.85, foldEnd: 1 }));
  // Side dust flaps under the lid use the same per-wall depth as their matching
  // bottom lock tab, so left/right stay symmetrical top-to-bottom.
  const addSideDust = (parent: PanelNode, wall: FlapWall, label: string) => {
    const h = depths[wall];
    if (h <= 0) return;
    attach(parent, "top", 0, makePanel({ name: `Lid Side Dust (${label})`, face: `flap-top-${wall}`, w: W, h, outline: dustFlap(W, h), foldAngle: TOP_FOLD, ...PHASE_INNER }));
  };
  addSideDust(side1, "left", "Left");
  addSideDust(side2, "right", "Right");

  // Bottom: auto-lock style tabs.
  const addLock = (parent: PanelNode, wall: FlapWall, label: string, phase: typeof PHASE_INNER) => {
    const h = depths[wall];
    if (h <= 0) return;
    attach(parent, "bottom", 0, makePanel({ name: `Bottom Lock (${label})`, face: `flap-bottom-${wall}`, w: parent.w, h, outline: lockTab(parent.w, h), foldAngle: BOTTOM_FOLD, ...phase }));
  };
  addLock(front, "front", "Front", PHASE_OUTER);
  addLock(side1, "left", "Left", PHASE_INNER);
  addLock(back, "back", "Back", PHASE_OUTER);
  addLock(side2, "right", "Right", PHASE_INNER);

  return front;
}

// ---------------------------------------------------------------------------
// 2e. Card Deck Box (Lock Lid) — from the reference card-deck drawing.
//     Strip order matches the drawing: Side(W), Front(L), Side(W), Back(L),
//     Glue(18). Per wall (top & bottom mirrored):
//       - Side dust flaps are L/2 deep (35 on the 70mm deck) so the two meet
//         exactly in the middle under the lid (35 + 35 = 70).
//       - The BACK inner flap is short (~W-6 = 18) so it folds in first and
//         stops clear of the cards.
//       - The FRONT flap is the LID: exactly W deep (24) so it closes flush
//         over the top of the cards. Not glued — it can be re-opened.
//       - The glue panel carries its own small LOCK flap (drawing's flap 5,
//         same depth as the back flap) that folds inward and sits UNDER the
//         lid's leading edge, locking it shut.
// ---------------------------------------------------------------------------
function buildCardDeckLockLid(dims: BoxDimensions): PanelNode {
  const { length: L, width: W, height: H } = dims;
  const glue = dims.endFlapRight ?? 18;
  const depths = resolveFlaps(dims, {
    left: L / 2,
    right: L / 2,
    front: W,
    back: Math.max(8, W - 6),
  });
  // The lock flap (drawing's flap 5) mirrors the back inner flap's depth so the
  // two always sit at the same level under the lid (18mm in the drawing).
  const lockDepth = depths.back;

  // STRICTLY SEQUENTIAL fold windows: each layer of the closure finishes folding
  // completely before the next one starts, so the animation never shows a flap
  // closing onto a layer that is itself still moving. Order matches how you'd
  // actually close the box: form the tube, fold the side dust flaps all the way
  // in, then the short back flap and the lock flap onto them, and the lid last.
  const SEQ_TUBE = { foldStart: 0, foldEnd: 0.3 };
  const SEQ_DUST = { foldStart: 0.3, foldEnd: 0.55 };
  const SEQ_INNER = { foldStart: 0.55, foldEnd: 0.78 };
  const SEQ_LID = { foldStart: 0.78, foldEnd: 1 };

  // Tube in the drawing's own strip order (root is the LEFT side wall). Same
  // TUBE_FOLD winding convention as buildTube, so outsides still face out.
  const side1 = makePanel({ name: "Side (Left)", face: "left", w: W, h: H, foldAngle: 0, hinged: false });
  const front = attach(side1, "right", 0, makePanel({ name: "Front", face: "front", w: L, h: H, foldAngle: TUBE_FOLD, ...SEQ_TUBE }));
  const side2 = attach(front, "right", 0, makePanel({ name: "Side (Right)", face: "right", w: W, h: H, foldAngle: TUBE_FOLD, ...SEQ_TUBE }));
  const back = attach(side2, "right", 0, makePanel({ name: "Back", face: "back", w: L, h: H, foldAngle: TUBE_FOLD, ...SEQ_TUBE }));
  const gluePanel =
    glue > 0 ? attach(back, "right", 0, makePanel({ name: "Glue Flap", face: "glue", w: glue, h: H, foldAngle: TUBE_FOLD, ...SEQ_TUBE })) : null;

  for (const edge of ["top", "bottom"] as const) {
    const foldAngle = edge === "top" ? TOP_FOLD : BOTTOM_FOLD;
    const cap = edge === "top" ? "Top" : "Bottom";
    const add = (parent: PanelNode, wall: FlapWall, label: string, h: number, phase: typeof PHASE_INNER) => {
      if (h <= 0) return;
      attach(parent, edge, 0, makePanel({ name: `${cap} ${label}`, face: `flap-${edge}-${wall}`, w: parent.w, h, foldAngle, ...phase }));
    };
    // Dust flaps + short back flap close first; the lid covers everything last.
    add(side1, "left", "Dust Flap (Left)", depths.left, SEQ_DUST);
    add(side2, "right", "Dust Flap (Right)", depths.right, SEQ_DUST);
    add(back, "back", "Inner Flap (Back)", depths.back, SEQ_INNER);
    add(front, "front", "Lid (Front)", depths.front, SEQ_LID);
    if (gluePanel && lockDepth > 0) {
      // Drawing's flap 5: hinges off the glue panel, folds inward together with the
      // back inner flap (after the dust flaps are fully closed), and ends up under the lid's edge as the lock. After the
      // tube's four quarter-turns the glue panel is parallel to the root wall,
      // so the same TOP_FOLD/BOTTOM_FOLD sign folds this flap inward too.
      attach(gluePanel, edge, 0, makePanel({ name: `${cap} Lock Flap`, face: "glue", w: gluePanel.w, h: lockDepth, foldAngle, ...SEQ_INNER }));
    }
  }

  return side1;
}

export const BOX_STYLES: BoxStyleDefinition[] = [
  {
    id: "tuck-end",
    label: "Straight Tuck End Carton",
    description: "Classic retail folding carton with tuck flaps top & bottom.",
    defaultDimensions: { length: 100, width: 60, height: 150, endFlapRight: 15 },
    build: buildTuckEndCarton,
  },
  {
    id: "rsc",
    label: "RSC Shipping Box",
    description: "Regular Slotted Container — the standard corrugated shipping box.",
    defaultDimensions: { length: 300, width: 200, height: 200, endFlapRight: 40 },
    build: buildRSC,
  },
  {
    id: "card-deck",
    label: "Card Deck Box (Glued)",
    description: "Glued RSC-style tuck box sized for a deck of cards — minor flaps meet in the middle, major flaps glue down on top.",
    defaultDimensions: { length: 70, width: 24, height: 100, endFlapRight: 18 },
    build: buildRSC,
  },
  {
    id: "card-deck-lock",
    label: "Card Deck Box (Lock Lid)",
    description:
      "Re-openable card deck box: side dust flaps meet in the middle, a short inner back flap, a lid exactly one box-depth deep that closes flush over the cards, and a lock flap on the glue panel that tucks under the lid.",
    defaultDimensions: { length: 70, width: 24, height: 100, endFlapRight: 18 },
    build: buildCardDeckLockLid,
  },
  {
    id: "mailer",
    label: "Mailer Box",
    description: "Tuck-lid mailer box with auto-lock bottom tabs.",
    defaultDimensions: { length: 250, width: 180, height: 80, endFlapRight: 15 },
    build: buildMailer,
  },
  {
    id: "hsc",
    label: "Open Tray (HSC)",
    description: "Half Slotted Container — RSC-style glued bottom, open top. Used on its own as a tray, or as the base under a separate lid.",
    defaultDimensions: { length: 300, width: 200, height: 100, endFlapRight: 40 },
    build: buildOpenTray,
  },
  {
    id: "auto-lock-tray",
    label: "Auto-Lock Bottom Tray",
    description: "Open-top tray with snap-lock bottom tabs instead of glue. Shows the general tab shape — the interlocking slots between tabs aren't modeled.",
    defaultDimensions: { length: 220, width: 150, height: 90, endFlapRight: 30 },
    build: buildAutoLockTray,
  },
  {
    id: "tuck-top-auto-bottom",
    label: "Tuck-Top Auto-Bottom Box",
    description: "Glued RSC-style bottom with a reusable tuck lid on top — common for cosmetics and cereal-style retail boxes.",
    defaultDimensions: { length: 180, width: 90, height: 250, endFlapRight: 20 },
    build: buildTuckTopAutoBottom,
  },
  {
    id: "two-piece-base",
    label: "Two-Piece Box — Base",
    description: "Open-top base tray for a telescoping lid-and-base box. Pair with the matching Lid template below.",
    defaultDimensions: { length: 150, width: 100, height: 60, endFlapRight: 25 },
    build: buildOpenTray,
  },
  {
    id: "two-piece-lid",
    label: "Two-Piece Box — Lid",
    description: "Shallow cap that slips over the Base template. Enter L/W a few mm larger than the base (board thickness + a little clearance) and a shallow height.",
    defaultDimensions: { length: 154, width: 104, height: 35, endFlapRight: 25 },
    build: buildOpenTray,
  },
];

export function getBoxStyle(id: BoxStyleId): BoxStyleDefinition {
  const found = BOX_STYLES.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown box style: ${id}`);
  return found;
}

export function panelBounds(node: PanelNode) {
  return boundsOf(node.outline ?? rect(node.w, node.h));
}
