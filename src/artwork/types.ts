export type EditorLayer =
  | {
      id: string;
      kind: "text";
      panelId: string;
      x: number; // mm, relative to panel origin (bottom-left)
      y: number;
      text: string;
      fontSize: number;
      color: string;
      rotation: number;
    }
  | {
      id: string;
      kind: "image";
      panelId: string;
      x: number;
      y: number;
      width: number;
      height: number;
      src: string; // data URL
      rotation: number;
    };

export interface SideArtwork {
  /** A single full-sheet artwork image, positioned/sized independently of the dieline. */
  sheetImage?: string;
  /** Bottom-left corner of the image, in sheet mm (Y-up) — draggable on the canvas. */
  sheetOffset: { x: number; y: number };
  /** Current displayed size, in mm — defaults to the full sheet bounds on upload,
   *  then freely resizable via the on-canvas corner/edge handles. */
  sheetWidth: number;
  sheetHeight: number;
  /** Degrees — set via the on-canvas rotate handle. */
  sheetRotation: number;
  /** Per-panel images, keyed by panel id — takes precedence over the sheet for that panel. */
  panelImages: Record<string, string>;
  /** Freeform text/logo layers added in the built-in editor. */
  layers: EditorLayer[];
  backgroundColor: string;
}

export interface ArtworkState {
  outside: SideArtwork;
  inside: SideArtwork;
}

export function emptySide(defaultColor: string): SideArtwork {
  return {
    sheetImage: undefined,
    sheetOffset: { x: 0, y: 0 },
    sheetWidth: 100,
    sheetHeight: 100,
    sheetRotation: 0,
    panelImages: {},
    layers: [],
    backgroundColor: defaultColor,
  };
}

export function emptyArtwork(): ArtworkState {
  return {
    outside: emptySide("#ffffff"),
    inside: emptySide("#f2ede3"),
  };
}

/**
 * True if a side has any actual artwork (sheet image, per-panel image, or a
 * text/logo layer) as opposed to just its default flat background color.
 * Used to decide whether the inside surface needs its own printed sheet.
 */
export function sideHasContent(side: SideArtwork): boolean {
  return Boolean(side.sheetImage) || Object.keys(side.panelImages).length > 0 || side.layers.length > 0;
}
