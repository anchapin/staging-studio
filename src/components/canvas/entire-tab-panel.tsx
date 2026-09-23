"use client";

import StageEntireRoomPreset from "./stage-entire-room-preset";
import { editorTabId, editorTabPanelId } from "./editor-tab-bar";

export interface EntireTabPanelProps {
  tabIdBase: string;
  hidden: boolean;
  roomId: string;
  imageUrl: string;
  aesthetic: string;
  imageWidth: number | null;
  imageHeight: number | null;
  disabled: boolean;
  processing: boolean;
  statusText: string;
  onRun: (run: { maskDataUrl: string; promptDirectives: string; negativePrompt: string }) => void;
  onError: (message: string) => void;
}

/**
 * "Entire room" tab panel (extracted from inpaint-editor.tsx by #691).
 * Issue #191/#223 one-click preset, demoted to an optional shortcut by
 * issue #223: the brush → Apply Inpainting flow is the primary path and
 * works on any source without running the preset first. The preset
 * detects furnishings and restages only those regions (see
 * stage-entire-room-preset.tsx). Entire-room staging only ever runs over
 * the original photo (AC-L4).
 */
export default function EntireTabPanel({
  tabIdBase,
  hidden,
  roomId,
  imageUrl,
  aesthetic,
  imageWidth,
  imageHeight,
  disabled,
  processing,
  statusText,
  onRun,
  onError,
}: EntireTabPanelProps) {
  return (
    <div
      role="tabpanel"
      id={editorTabPanelId(tabIdBase, "entire")}
      aria-labelledby={editorTabId(tabIdBase, "entire")}
      hidden={hidden}
    >
      <div className="flex flex-col gap-6">
        <StageEntireRoomPreset
          roomId={roomId}
          imageUrl={imageUrl}
          aesthetic={aesthetic}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          disabled={disabled}
          processing={processing}
          statusText={statusText}
          onRun={onRun}
          onError={onError}
        />
      </div>
    </div>
  );
}
