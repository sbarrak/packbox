/**
 * Save -> load round-trip for the .pbox project format: builds a state using
 * EVERY artwork feature (sheet image w/ offset+size+rotation, per-panel image,
 * text + logo layers on both sides), serializes, parses, and asserts deep
 * equality. Also checks corrupted/foreign input is rejected cleanly and that a
 * pre-`sheetRotation`-era file loads with defaults (forward compatibility).
 */
import { serializeProject, parseProject } from "../src/project/projectFile";
import { emptySide } from "../src/artwork/types";
import type { ArtworkState } from "../src/artwork/types";

const px = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const artwork: ArtworkState = {
  outside: {
    ...emptySide("#ffffff"),
    sheetImage: px,
    sheetOffset: { x: 12.5, y: -3.25 },
    sheetWidth: 216,
    sheetHeight: 178,
    sheetRotation: 45,
    panelImages: { "front-1": px },
    layers: [
      { id: "t1", kind: "text", panelId: "front-1", x: 5, y: 10, text: "Hello Box", fontSize: 8, color: "#112233", rotation: 15 },
      { id: "i1", kind: "image", panelId: "back-3", x: 1, y: 2, width: 30, height: 20, src: px, rotation: -30 },
    ],
  },
  inside: { ...emptySide("#f2ede3"), layers: [{ id: "t2", kind: "text", panelId: "left-2", x: 3, y: 4, text: "inside note", fontSize: 5, color: "#000000", rotation: 0 }] },
};
const dims = { length: 70, width: 24, height: 100, endFlapRight: 18, flaps: { front: 24, back: 18, left: 35, right: 35 } };

let fails = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? "ok  " : "FAIL"} ${label}`); if (!ok) fails++; };

// 1. full round trip
const loaded = parseProject(serializeProject("card-deck-lock", dims, artwork));
check("box style survives", loaded.boxStyleId === "card-deck-lock");
check("dims survive (incl. per-wall flaps)", JSON.stringify(loaded.dims) === JSON.stringify({ length: 70, width: 24, height: 100, endFlapRight: 18, flaps: { front: 24, back: 18, left: 35, right: 35 } }));
check("artwork survives byte-identically", JSON.stringify(loaded.artwork) === JSON.stringify(artwork));
check("embedded image data URL intact", loaded.artwork.outside.sheetImage === px && loaded.artwork.outside.panelImages["front-1"] === px);

// 2. rejects garbage with readable errors
for (const [label, bad] of [["random text", "not json at all"], ["foreign JSON", '{"hello":1}'], ["wrong version", '{"app":"packbox","version":99}'], ["unknown style", '{"app":"packbox","version":1,"boxStyleId":"nope","dims":{"length":1,"width":1,"height":1}}']] as const) {
  let threw = false;
  try { parseProject(bad); } catch (e) { threw = e instanceof Error && e.message.length > 5; }
  check(`rejects ${label}`, threw);
}

// 3. forward compatibility: an "old" file missing sheetRotation/sheetWidth loads with defaults
const oldFile = JSON.stringify({
  app: "packbox", version: 1, savedAt: "2026-01-01", boxStyleId: "card-deck",
  dims: { length: 70, width: 24, height: 100 },
  artwork: { outside: { sheetImage: px, sheetOffset: { x: 0, y: 0 }, panelImages: {}, layers: [], backgroundColor: "#fff" }, inside: {} },
});
const old = parseProject(oldFile);
check("old file loads, missing fields get defaults", old.artwork.outside.sheetRotation === 0 && Number.isFinite(old.artwork.outside.sheetWidth) && old.artwork.inside.backgroundColor === "#f2ede3");

console.log(fails === 0 ? "\nALL PROJECT-FILE CHECKS PASSED" : `\n${fails} FAILED`);
process.exit(fails ? 1 : 0);
