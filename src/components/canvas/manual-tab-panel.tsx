"use client";

import InpaintOperationModeTabs, {
  type InpaintOperationModeId,
} from "./inpaint-operation-mode-tabs";
import { editorTabId, editorTabPanelId } from "./editor-tab-bar";

export interface ManualTabPanelProps {
  tabIdBase: string;
  hidden: boolean;
  roomId: string;
  /** Inline directives value (issue #507); falls back to the prop copy. */
  directivesValue?: string;
  promptDirectives: string;
  onDirectivesChange?: (value: string) => void;
  /** Issue #629 operation-mode state. */
  operationMode: InpaintOperationModeId;
  onOperationModeChange: (mode: InpaintOperationModeId) => void;
  /** Issue #558 AI guidance. */
  promptStrength: number;
  onPromptStrengthChange: (strength: number) => void;
  guidanceScale: number;
  onGuidanceScaleChange: (scale: number) => void;
  seed: number | undefined;
  onSeedChange: (seed: number | undefined) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  hasMask: boolean;
}

/**
 * "Manual paint" tab panel (extracted from inpaint-editor.tsx by #691):
 * the inline staging directives textarea (#507) plus the #629/#558
 * operation-mode tabs.
 */
export default function ManualTabPanel({
  tabIdBase,
  hidden,
  roomId,
  directivesValue,
  promptDirectives,
  onDirectivesChange,
  operationMode,
  onOperationModeChange,
  promptStrength,
  onPromptStrengthChange,
  guidanceScale,
  onGuidanceScaleChange,
  seed,
  onSeedChange,
  onGenerate,
  isGenerating,
  hasMask,
}: ManualTabPanelProps) {
  return (
    <div
      role="tabpanel"
      id={editorTabPanelId(tabIdBase, "manual")}
      aria-labelledby={editorTabId(tabIdBase, "manual")}
      hidden={hidden}
    >
      <div className="flex flex-col gap-3">
        {/* Issue #507: inline staging directives textarea — always visible
            in the right panel beside the Generate button, so users
            can find it without scrolling the left pane. The label is
            deliberately distinct from the Room Details "Staging
            directives (required)" field it mirrors (same state, both
            editable): two controls on one page must never share an
            accessible name — screen readers announce them
            interchangeably and strict locators (e2e, AT automation)
            become ambiguous (issue #742). */}
        <div>
          <label
            htmlFor={`inpaint-directives-${roomId}`}
            className="mb-1 font-jakarta block text-sm font-medium text-atelier-primary"
          >
            Manual paint directives (required)
          </label>
          <textarea
            id={`inpaint-directives-${roomId}`}
            value={directivesValue ?? promptDirectives}
            onChange={(e) => onDirectivesChange?.(e.target.value)}
            rows={3}
            placeholder="e.g., Modern coastal furniture, light neutrals, natural textures, minimal accessories..."
            className="w-full px-3 py-2 rounded-md border border-border text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </div>
        {/* Issue #629: Inpaint Operation Mode tabs — secondary tab strip for AI
            inpaint operations. Issue #692: Relight / Restore / Material render
            visibly disabled ("Coming soon") until their endpoints exist; their
            parameter panels are inert. The brush / Fill / Select Region toggles
            live in the canvas toolbar. */}
        <InpaintOperationModeTabs
          activeMode={operationMode}
          onModeChange={onOperationModeChange}
          strength={Math.round(promptStrength * 100)}
          onStrengthChange={(v) => onPromptStrengthChange(v / 100)}
          guidanceScale={guidanceScale}
          onGuidanceScaleChange={onGuidanceScaleChange}
          seed={seed}
          onSeedChange={onSeedChange}
          onGenerate={onGenerate}
          isGenerating={isGenerating}
          hasMask={hasMask}
        />
      </div>
    </div>
  );
}
