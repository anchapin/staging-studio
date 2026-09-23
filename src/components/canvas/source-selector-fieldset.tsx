"use client";

import { inpaintSourceLabel, inpaintSourcesEqual, type InpaintSource } from "@/lib/inpaint-source";

export interface SourceSelectorFieldsetProps {
  roomId: string;
  sourceOptions: InpaintSource[];
  source: InpaintSource;
  disabled: boolean;
  onSelectSource: (source: InpaintSource) => void;
  /** Issue #378: undo affordance for the previous source switch. */
  canUndoSource: boolean;
  onUndoSource: () => void;
}

/**
 * "Edit from" radio group (extracted from inpaint-editor.tsx by #691):
 * picks the base image the mask applies to — the original photo or a
 * staged variant.
 */
export default function SourceSelectorFieldset({
  roomId,
  sourceOptions,
  source,
  disabled,
  onSelectSource,
  canUndoSource,
  onUndoSource,
}: SourceSelectorFieldsetProps) {
  return (
    <fieldset className="shrink-0 rounded-md border border-atelier-taupe/30 p-3">
      <legend className="px-1 font-jakarta text-sm font-medium text-atelier-primary">
        Edit from
      </legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {sourceOptions.map((option) => (
          <label
            key={inpaintSourceLabel(option)}
            className="inline-flex cursor-pointer items-center gap-2 font-jakarta text-sm text-atelier-primary"
          >
            <input
              type="radio"
              name={`inpaint-source-${roomId}`}
              value={inpaintSourceLabel(option)}
              checked={inpaintSourcesEqual(option, source)}
              disabled={disabled}
              onChange={() => onSelectSource(option)}
              className="h-4 w-4 accent-atelier-primary"
            />
            {inpaintSourceLabel(option)}
          </label>
        ))}
      </div>
      {canUndoSource && (
        <button
          type="button"
          onClick={onUndoSource}
          className="mt-2 text-xs text-atelier-taupe underline hover:text-atelier-primary"
        >
          Undo source change
        </button>
      )}
    </fieldset>
  );
}
