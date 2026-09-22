"use client";

import { useState } from "react";
import {
  MousePointer2,
  Brush,
  Eraser,
  Wand2,
  Lasso,
  Pipette,
  Hand,
} from "lucide-react";
import type { MaskTool } from "./inpaint-mask-canvas";

interface FloatingToolDockProps {
  activeTool: MaskTool;
  onToolChange: (tool: MaskTool) => void;
}

/** Tool groups: 0=pointer, 1=brush/eraser, 2=AI/lasso/eyedropper, 3=pan */
const TOOLS: { id: MaskTool; icon: React.ReactNode; label: string; group: number }[] = [
  { id: "pointer", icon: <MousePointer2 size={18} />, label: "Pointer", group: 0 },
  { id: "brush", icon: <Brush size={18} />, label: "Brush Mask", group: 1 },
  { id: "eraser", icon: <Eraser size={18} />, label: "Eraser Mask", group: 1 },
  { id: "select", icon: <Wand2 size={18} />, label: "AI Auto-segment", group: 2 },
  { id: "lasso", icon: <Lasso size={18} />, label: "Polygonal Lasso", group: 2 },
  { id: "eyedropper", icon: <Pipette size={18} />, label: "Color Sampler", group: 2 },
  { id: "pan", icon: <Hand size={18} />, label: "Pan", group: 3 },
];

export default function FloatingToolDock({ activeTool, onToolChange }: FloatingToolDockProps) {
  const [hoveredTool, setHoveredTool] = useState<MaskTool | null>(null);

  return (
    <div
      className="fixed left-3 top-1/2 -translate-y-1/2 z-40 flex flex-col gap-0.5 bg-white/85 dark:bg-stone-900/85 backdrop-blur-md rounded-xl border border-stone-200 dark:border-stone-700 shadow-xl px-1.5 py-1.5"
      style={{ minWidth: 52 }}
    >
      {TOOLS.map((tool, i) => {
        const isActive = activeTool === tool.id;
        const isHovered = hoveredTool === tool.id;
        const showDivider = i > 0 && TOOLS[i - 1].group !== tool.group;

        return (
          <div key={tool.id}>
            {showDivider && (
              <div className="w-full h-px bg-stone-200 dark:bg-stone-700 my-1" />
            )}
            <button
              onClick={() => onToolChange(tool.id as MaskTool)}
              onMouseEnter={() => setHoveredTool(tool.id as MaskTool)}
              onMouseLeave={() => setHoveredTool(null)}
              title={tool.label}
              className={`
                relative w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-150
                ${isActive
                  ? "bg-stone-800 text-white shadow-sm"
                  : "text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"
                }
              `}
            >
              {tool.icon}
              {/* Active indicator dot */}
              {isActive && (
                <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-orange-500" />
              )}
              {/* Tooltip */}
              {isHovered && (
                <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs px-2 py-1 rounded whitespace-nowrap z-50 pointer-events-none font-jakarta">
                  {tool.label}
                </span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
