import type { BoxDimensions, BoxStyleId } from "../geometry/types";
import type { ArtworkState, SideArtwork, EditorLayer } from "../artwork/types";
import { emptySide } from "../artwork/types";
import { BOX_STYLES } from "../geometry/boxBuilders";

/**
 * PackBox project file (.pbox).
 *
 * Format: plain JSON. Chosen deliberately over a zip/binary container because
 * every piece of artwork in the app (full-sheet image, per-panel images, logo
 * layers) is ALREADY held as a base64 data URL in state — so JSON.stringify of
 * the state embeds every image, text and logo byte-for-byte with zero extra
 * encoding steps, stays human-inspectable, and diffing/versioning it works.
 * The `version` field lets future releases migrate old files instead of
 * rejecting them.
 */
export interface ProjectFile {
  app: "packbox";
  version: 1;
  savedAt: string; // ISO timestamp, informational only
  boxStyleId: BoxStyleId;
  dims: BoxDimensions;
  artwork: ArtworkState;
}

export const PROJECT_EXTENSION = ".pbox";

export function serializeProject(boxStyleId: BoxStyleId, dims: BoxDimensions, artwork: ArtworkState): string {
  const file: ProjectFile = {
    app: "packbox",
    version: 1,
    savedAt: new Date().toISOString(),
    boxStyleId,
    dims,
    artwork,
  };
  return JSON.stringify(file);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Re-validates a side's artwork against the CURRENT shape of SideArtwork,
 * merging over emptySide() defaults. This is what makes older project files
 * forward-compatible: a file saved before e.g. `sheetRotation` existed simply
 * inherits the default instead of leaving undefined holes in the state.
 */
function normalizeSide(raw: unknown, fallbackColor: string): SideArtwork {
  const base = emptySide(fallbackColor);
  if (typeof raw !== "object" || raw === null) return base;
  const r = raw as Record<string, unknown>;

  const layers: EditorLayer[] = Array.isArray(r.layers)
    ? (r.layers as EditorLayer[]).filter(
        (l) =>
          l &&
          typeof l.id === "string" &&
          typeof l.panelId === "string" &&
          (l.kind === "text" ? typeof l.text === "string" : l.kind === "image" && typeof l.src === "string"),
      )
    : [];

  return {
    ...base,
    sheetImage: typeof r.sheetImage === "string" ? r.sheetImage : undefined,
    sheetOffset:
      typeof r.sheetOffset === "object" &&
      r.sheetOffset !== null &&
      isFiniteNumber((r.sheetOffset as Record<string, unknown>).x) &&
      isFiniteNumber((r.sheetOffset as Record<string, unknown>).y)
        ? (r.sheetOffset as { x: number; y: number })
        : base.sheetOffset,
    sheetWidth: isFiniteNumber(r.sheetWidth) ? r.sheetWidth : base.sheetWidth,
    sheetHeight: isFiniteNumber(r.sheetHeight) ? r.sheetHeight : base.sheetHeight,
    sheetRotation: isFiniteNumber(r.sheetRotation) ? r.sheetRotation : base.sheetRotation,
    panelImages:
      typeof r.panelImages === "object" && r.panelImages !== null
        ? Object.fromEntries(Object.entries(r.panelImages as Record<string, unknown>).filter(([, v]) => typeof v === "string")) as Record<string, string>
        : {},
    layers,
    backgroundColor: typeof r.backgroundColor === "string" ? r.backgroundColor : base.backgroundColor,
  };
}

/**
 * Parses and validates a .pbox file's text. Throws with a human-readable
 * message on anything unusable; tolerates and repairs missing optional fields.
 */
export function parseProject(text: string): { boxStyleId: BoxStyleId; dims: BoxDimensions; artwork: ArtworkState } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("This is not a PackBox project file (invalid JSON).");
  }
  if (typeof raw !== "object" || raw === null || (raw as Record<string, unknown>).app !== "packbox") {
    throw new Error("This is not a PackBox project file.");
  }
  const file = raw as Partial<ProjectFile> & Record<string, unknown>;
  if (file.version !== 1) {
    throw new Error(`Unsupported project version (${String(file.version)}). This app reads version 1.`);
  }

  const style = BOX_STYLES.find((s) => s.id === file.boxStyleId);
  if (!style) {
    throw new Error(`The project uses a box style ("${String(file.boxStyleId)}") that this version of the app doesn't have.`);
  }

  const d = (typeof file.dims === "object" && file.dims !== null ? file.dims : {}) as Partial<BoxDimensions>;
  if (!isFiniteNumber(d.length) || !isFiniteNumber(d.width) || !isFiniteNumber(d.height)) {
    throw new Error("The project's box dimensions are missing or invalid.");
  }
  const dims: BoxDimensions = {
    ...style.defaultDimensions,
    ...d,
    length: d.length,
    width: d.width,
    height: d.height,
  };

  const a = (typeof file.artwork === "object" && file.artwork !== null ? file.artwork : {}) as Record<string, unknown>;
  const artwork: ArtworkState = {
    outside: normalizeSide(a.outside, "#ffffff"),
    inside: normalizeSide(a.inside, "#f2ede3"),
  };

  return { boxStyleId: style.id, dims, artwork };
}
