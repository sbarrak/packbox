import { useEffect, useState } from "react";
import { BOX_STYLES, getBoxStyle } from "../geometry/boxBuilders";
import { computeFlatLayout } from "../geometry/layout";
import type { BoxDimensions, BoxStyleId, FaceRole, FlapWall } from "../geometry/types";
import { FLAP_WALLS } from "../geometry/types";

interface Props {
  boxStyleId: BoxStyleId;
  dims: BoxDimensions;
  onChangeStyle: (id: BoxStyleId) => void;
  onChangeDims: (dims: BoxDimensions) => void;
  /** Face of the panel just clicked in the 2D view, so its control can flash. */
  highlightFace?: FaceRole;
  /** Bumped on every panel click so re-clicking the same panel replays the flash. */
  highlightNonce?: number;
}

/**
 * Maps a clicked panel's face to the id of the sidebar control that governs it,
 * so clicking a shape in the drawing points you at the field that changes it.
 */
function controlIdForFace(face: FaceRole): string | null {
  const flapMatch = /^flap-(?:top|bottom)-(front|back|left|right)$/.exec(face);
  if (flapMatch) return `flap-${flapMatch[1]}`;
  switch (face) {
    case "front":
    case "back":
      return "length"; // front/back walls are L wide
    case "left":
    case "right":
      return "width"; // side walls are W deep
    case "glue":
      return "endFlapRight";
    case "top":
    case "bottom":
      return "height";
    default:
      return null;
  }
}

/**
 * A numeric field that can be freely cleared and retyped.
 *
 * The value is kept as a STRING while focused so an empty box (or a partial entry
 * like "-" or "0") is a legal intermediate state. Clamping the number on every
 * keystroke — which is what this used to do — meant you could never delete the
 * existing digits to type new ones: erasing "18" snapped straight back to the
 * minimum. The clamped number is committed on blur or on Enter instead.
 */
function Field({
  label,
  value,
  onChange,
  min = 1,
  hint,
  flash,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  hint?: string;
  /** When true this field plays the brief highlight animation. */
  flash?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);

  // Keep in sync when the value changes from elsewhere (style switch, reset...)
  // but never yank the text out from under the user mid-edit.
  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n)) {
      setDraft(String(value)); // nothing usable typed — put the old value back
      return;
    }
    const clamped = Math.max(min, n);
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <label className={`field${flash ? " field-flash" : ""}`} title={hint}>
      <span>{label}</span>
      <input
        type="number"
        min={min}
        value={draft}
        onFocus={() => setEditing(true)}
        onChange={(e) => {
          setEditing(true);
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
    </label>
  );
}

/** Human labels for the four per-wall flap controls. */
const WALL_LABELS: Record<FlapWall, string> = {
  front: "Front wall flap",
  back: "Back wall flap",
  left: "Left wall flap",
  right: "Right wall flap",
};

export default function Sidebar({ boxStyleId, dims, onChangeStyle, onChangeDims, highlightFace, highlightNonce }: Props) {
  const style = BOX_STYLES.find((s) => s.id === boxStyleId)!;

  // Which control is currently flashing. Cleared on a timer so the highlight is a
  // brief cue rather than a persistent selected state.
  const [flashId, setFlashId] = useState<string | null>(null);
  useEffect(() => {
    if (!highlightFace || !highlightNonce) return;
    const id = controlIdForFace(highlightFace);
    if (!id) return;
    setFlashId(null); // drop it first so re-clicking the same panel restarts the animation
    const start = requestAnimationFrame(() => setFlashId(id));
    const clear = setTimeout(() => setFlashId(null), 1000);
    return () => {
      cancelAnimationFrame(start);
      clearTimeout(clear);
    };
  }, [highlightFace, highlightNonce]);

  /**
   * Which flaps this template actually has, derived by building it and looking at
   * the resulting panels — no hand-maintained per-style table to drift out of
   * sync when a builder changes. `hasWall` also reports which walls currently
   * have a flap at 0mm (i.e. hidden), so those controls stay visible and can be
   * turned back on.
   */
  const present = (() => {
    const layout = computeFlatLayout(getBoxStyle(boxStyleId).build(dims));
    const walls = new Set<FlapWall>();
    for (const p of layout.panels) {
      const m = /^flap-(top|bottom)-(front|back|left|right)$/.exec(p.face);
      if (m) walls.add(m[2] as FlapWall);
    }
    return walls;
  })();

  const flapValue = (wall: FlapWall): number => {
    if (dims.flaps?.[wall] !== undefined) return dims.flaps[wall]!;
    // Fall back to whatever the builder actually produced, so the field shows the
    // real current depth rather than a placeholder.
    const layout = computeFlatLayout(getBoxStyle(boxStyleId).build(dims));
    const panel = layout.panels.find((p) => p.face === `flap-top-${wall}` || p.face === `flap-bottom-${wall}`);
    return panel ? Math.round(panel.h) : 0;
  };

  const setFlap = (wall: FlapWall, v: number) => onChangeDims({ ...dims, flaps: { ...dims.flaps, [wall]: v } });

  // A wall control is worth showing if the template has that flap now, or if the
  // user explicitly zeroed it (so it can be brought back).
  const wallsToShow = FLAP_WALLS.filter((w) => present.has(w) || dims.flaps?.[w] !== undefined);

  return (
    <aside className="panel sidebar">
      <h2>Box style</h2>
      <select value={boxStyleId} onChange={(e) => onChangeStyle(e.target.value as BoxStyleId)}>
        {BOX_STYLES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <p className="muted">{style.description}</p>

      <h2>Dimensions (mm)</h2>
      <Field label="Length (L)" value={dims.length} onChange={(v) => onChangeDims({ ...dims, length: v })} flash={flashId === "length"} />
      <Field label="Width (W)" value={dims.width} onChange={(v) => onChangeDims({ ...dims, width: v })} flash={flashId === "width"} />
      <Field label="Height (H)" value={dims.height} onChange={(v) => onChangeDims({ ...dims, height: v })} flash={flashId === "height"} />

      {wallsToShow.length > 0 && (
        <>
          <h2>Flap depths (mm)</h2>
          <p className="muted">
            One per wall. Each applies to that wall's top <em>and</em> bottom flap, so they always stay symmetrical. Set 0 to remove a flap.
          </p>
          {wallsToShow.map((wall) => (
            <Field
              key={wall}
              label={WALL_LABELS[wall]}
              value={flapValue(wall)}
              min={0}
              onChange={(v) => setFlap(wall, v)}
              hint="Applies to both the top and bottom flap on this wall. 0 removes it."
              flash={flashId === `flap-${wall}`}
            />
          ))}
        </>
      )}

      <h2>End flaps (mm)</h2>
      <p className="muted">Tabs at the two ends of the unfolded strip. Set 0 for none.</p>
      <Field
        label="Right end (glue tab)"
        value={dims.endFlapRight ?? 0}
        min={0}
        onChange={(v) => onChangeDims({ ...dims, endFlapRight: v })}
        hint="The manufacturer's glue tab that bonds the tube closed."
        flash={flashId === "endFlapRight"}
      />
      <Field
        label="Left end"
        value={dims.endFlapLeft ?? 0}
        min={0}
        onChange={(v) => onChangeDims({ ...dims, endFlapLeft: v })}
        hint="Optional matching tab on the opposite end. 0 for none (the usual case)."
      />

      {boxStyleId === "mailer" && (
        <>
          <h2>Lid</h2>
          <Field
            label="Lid tuck depth"
            value={Math.round(dims.lidDepth ?? dims.height * 0.9)}
            min={1}
            onChange={(v) => onChangeDims({ ...dims, lidDepth: v })}
          />
        </>
      )}

      <button className="secondary" onClick={() => onChangeDims({ ...style.defaultDimensions })}>
        Reset to defaults
      </button>
    </aside>
  );
}
