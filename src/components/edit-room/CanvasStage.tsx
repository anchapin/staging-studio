/**
 * Issue #1339 — CanvasStage + MaskLayer + CompareLayer + on-canvas object boxes.
 *
 * `CanvasStage` is the top-level canvas orchestrator for the Edit Room
 * UX redesign. It renders the photo as the largest thing on the page
 * (3:2 aspect, sized by `useFitSize`), the scope-aware toolbar above
 * it, the on-canvas overlays in scope order, and the running-progress
 * overlay when a run is in flight.
 *
 * Magic Patterns reference:
 * `dVy8jC2kXpi1ca8b4A1hcS/components/CanvasStage.tsx` (verbatim port
 * with the data wiring changed: this component takes its data via
 * props instead of importing the design's stub `DETECTIONS`).
 *
 * Scope gate (the issue's structural rule):
 *  - `showPaint = scope === "paint" && !compare && running === null`
 *  - `showObjects = scope === "objects" && !compare && running === null`
 *
 * Children wired here (and pinned 1:1 by their tests):
 *  - `<MaskLayer>` (this slice) — paint scope
 *  - `<CompareLayer>` (this slice) — overlay when compare is on
 *  - `<ObjectOverlay>` (this slice) — one per detected object in the
 *    active concept
 *  - `<useFitSize>` (this slice) — measure the photo's 3:2 box
 *
 * Children NOT wired here (deferred to later slices):
 *  - the toast + run-progress integration (#1342 wires the actual run)
 *  - the inspector / directions-textarea (#1341 surface)
 *  - the version strip + lookbook slot (#1340 surface)
 *
 * Color discipline: every color is an Atelier token. The hex-literal
 * defense-in-depth test (`tests/edit-room-canvas-stage.test.tsx`)
 * scans the rendered HTML for `#xxxxxx` patterns and fails on a hit;
 * this keeps the visual language tied to the design system even as the
 * canvas tree grows.
 */

import {
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Brush, Eraser, SplitSquareHorizontal, Trash2 } from "lucide-react";

import { CompareLayer } from "@/components/edit-room/CompareLayer";
import { MaskLayer, type BrushMode } from "@/components/edit-room/MaskLayer";
import { ObjectOverlay } from "@/components/edit-room/object-overlay";
import { useFitSize } from "@/components/edit-room/use-fit-size";
import type { ObjectBoundingBox } from "@/lib/canvas-coords";
import type { EditRoomScope, SlotId } from "@/lib/edit-room-scope";

/** Aspect ratio of the photo (3:2, per the design). */
const PHOTO_ASPECT = 3 / 2;

/** Minimum brush diameter. Mirrors the design's slider min. */
const BRUSH_SIZE_MIN = 48;

/** A single detection the canvas overlays. The provider (segment, inpaint)
 * supplies these as percent-based bounding boxes for the active concept. */
export interface DetectedObject {
  id: string;
  concept: string;
  label: string;
  box: ObjectBoundingBox;
}

export interface CanvasStageProps {
  /** URL of the photo the canvas currently displays. */
  imageUrl: string;
  /** URL of the original (pre-staging) photo for the compare overlay. */
  originalUrl: string;
  /** Which variant slot the canvas is viewing. */
  viewing: SlotId;
  /** Which scope is active. Drives toolbar + overlay visibility. */
  scope: EditRoomScope;
  /** Whether the compare overlay is on. */
  compare: boolean;
  /** Toggles the compare overlay (the toolbar's Compare button). */
  onToggleCompare: () => void;
  /** Active concept the object overlay filters by. */
  concept: string | null;
  /** IDs of the currently-selected objects. */
  selected: string[];
  /** Toggles one object in the parent's selection set. */
  onToggleObject: (id: string) => void;
  /** Detections to render (filtered to the active concept). */
  detections: DetectedObject[];
  /** Bump on CLEAR_MASK so the MaskLayer resets its canvas. */
  maskVersion: number;
  /** Fires on the first stroke of a new paint. */
  onMaskPainted: () => void;
  /** Fires on the Clear button. */
  onClearMask: () => void;
  /** True iff the user has any painted strokes. */
  hasMask: boolean;
  /** Brush diameter in CSS px. */
  brushSize: number;
  onBrushSizeChange: (n: number) => void;
  brushMode: BrushMode;
  onBrushModeChange: (m: BrushMode) => void;
  /** 0..100 while a run is in flight; null otherwise. */
  running: number | null;
  /** Where the next run lands (the Run button's helper copy). */
  targetSlot: SlotId;
}

export function CanvasStage(props: CanvasStageProps) {
  const { scope, compare, viewing, running } = props;
  const areaRef = useRef<HTMLDivElement>(null);
  const size = useFitSize(areaRef, PHOTO_ASPECT);
  const visibleObjects = props.detections.filter(
    (d) => d.concept === props.concept
  );
  const showPaint = scope === "paint" && !compare && running === null;
  const showObjects =
    scope === "objects" && !compare && running === null;

  return (
    <section
      aria-label="Room canvas"
      className="flex min-h-0 flex-1 flex-col"
    >
      {/* Canvas toolbar: only the controls that apply to the current scope */}
      <div className="flex h-12 shrink-0 items-center justify-between px-6">
        <p className="text-sm text-ink-muted">
          {viewing === "original" ? (
            <>
              Viewing the{" "}
              <span className="font-medium text-ink">original photo</span>
            </>
          ) : (
            <>
              Viewing{" "}
              <span className="font-medium text-ink">Variant {viewing}</span>
            </>
          )}
          {compare && (
            <span className="text-ink-subtle">
              {" "}
              — drag to compare with original
            </span>
          )}
        </p>

        <div className="flex items-center gap-2">
          {showPaint && (
            <div className="flex items-center gap-1 rounded-lg border border-line-soft bg-surface-lowest p-1">
              <ToolButton
                active={props.brushMode === "paint"}
                onClick={() => props.onBrushModeChange("paint")}
                label="Brush"
              >
                <Brush className="h-4 w-4" aria-hidden />
              </ToolButton>
              <ToolButton
                active={props.brushMode === "erase"}
                onClick={() => props.onBrushModeChange("erase")}
                label="Eraser"
              >
                <Eraser className="h-4 w-4" aria-hidden />
              </ToolButton>
              <span className="mx-1 h-5 w-px bg-line-soft" aria-hidden />
              <label className="flex items-center gap-2 px-1.5 text-xs text-ink-subtle">
                Size
                <input
                  type="range"
                  min={12}
                  max={120}
                  value={props.brushSize}
                  onChange={(e) =>
                    props.onBrushSizeChange(Number(e.target.value))
                  }
                  className="atelier-range w-24"
                  style={
                    {
                      ["--fill" as string]: `${((props.brushSize - 12) / 108) * 100}%`,
                    } satisfies CSSProperties
                  }
                />
              </label>
              <span className="mx-1 h-5 w-px bg-line-soft" aria-hidden />
              <button
                type="button"
                onClick={props.onClearMask}
                disabled={!props.hasMask}
                className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-muted transition-colors duration-150 hover:bg-surface-low hover:text-ink disabled:pointer-events-none disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Clear
              </button>
            </div>
          )}
          {viewing !== "original" && (
            <button
              type="button"
              onClick={props.onToggleCompare}
              aria-pressed={compare}
              className={`flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors duration-150 ${
                compare
                  ? "border-walnut bg-walnut text-on-walnut"
                  : "border-line-soft bg-surface-lowest text-ink hover:bg-surface-low"
              }`}
            >
              <SplitSquareHorizontal className="h-4 w-4" aria-hidden />
              Compare
            </button>
          )}
        </div>
      </div>

      {/* The photo: the largest thing on the page, always */}
      <div
        ref={areaRef}
        className="relative flex min-h-0 flex-1 items-center justify-center px-6 pb-4"
      >
        <div
          className="relative overflow-hidden rounded-lg bg-surface-highest shadow-[0_1px_2px_rgba(32,26,21,0.08),0_12px_40px_-16px_rgba(32,26,21,0.3)]"
          style={
            size && size.w > 0
              ? { width: size.w, height: size.h }
              : { aspectRatio: PHOTO_ASPECT, width: "100%" }
          }
          data-photo-size={
            size && size.w > 0
              ? `${size.w}x${size.h}`
              : "unmeasured"
          }
        >
          <img
            key={props.imageUrl}
            src={props.imageUrl}
            alt={
              viewing === "original"
                ? "Living room, vacant"
                : `Living room, Variant ${viewing}`
            }
            className="absolute inset-0 h-full w-full select-none object-cover"
            draggable={false}
          />

          {compare && <CompareLayer originalUrl={props.originalUrl} />}

          {showObjects &&
            visibleObjects.map((obj) => {
              const on = props.selected.includes(obj.id);
              return (
                <ObjectOverlay
                  key={obj.id}
                  id={obj.id}
                  box={obj.box}
                  label={obj.label}
                  selected={on}
                  onToggle={props.onToggleObject}
                />
              );
            })}

          {showPaint && size && size.w > 0 && (
            <MaskLayer
              resetKey={props.maskVersion}
              width={size.w}
              height={size.h}
              brushSize={Math.max(BRUSH_SIZE_MIN, props.brushSize)}
              mode={props.brushMode}
              onPainted={props.onMaskPainted}
            />
          )}

          {running !== null && (
            <div
              role="status"
              aria-live="polite"
              data-running-percent={running}
              className="absolute inset-0 flex items-end bg-walnut/35"
            >
              <div className="m-4 w-full rounded-lg bg-surface-lowest/95 px-4 py-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-ink">
                    {props.viewing === "original" ? "Staging" : "Touching up"}{" "}
                    Variant {props.targetSlot}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-ink-subtle">
                    {running}%
                  </span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-line-soft">
                  <div
                    className="h-full origin-left bg-bronze"
                    style={{ transform: `scaleX(${running / 100})` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ToolButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 ${
        active
          ? "bg-walnut text-on-walnut"
          : "text-ink-muted hover:bg-surface-low hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}