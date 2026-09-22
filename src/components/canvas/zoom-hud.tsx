"use client";

interface ZoomHUDProps {
  zoomLevel: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToCanvas: () => void;
}

export default function ZoomHUD({ zoomLevel, onZoomIn, onZoomOut, onFitToCanvas }: ZoomHUDProps) {
  return (
    <div className="fixed left-3 bottom-6 z-40 flex items-center gap-1 bg-white/90 dark:bg-stone-900/90 backdrop-blur-md rounded-full border border-stone-200 dark:border-stone-700 shadow-lg px-2 py-1.5">
      <button
        onClick={onZoomOut}
        title="Zoom out"
        className="w-7 h-7 flex items-center justify-center rounded-full text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors text-sm font-medium"
      >
        −
      </button>
      <span className="text-xs font-mono text-stone-600 dark:text-stone-300 min-w-[3rem] text-center font-jetbrains">
        {Math.round(zoomLevel * 100)}%
      </span>
      <button
        onClick={onZoomIn}
        title="Zoom in"
        className="w-7 h-7 flex items-center justify-center rounded-full text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors text-sm font-medium"
      >
        +
      </button>
      <div className="w-px h-4 bg-stone-200 dark:bg-stone-700 mx-0.5" />
      <button
        onClick={onFitToCanvas}
        title="Fit to canvas"
        className="px-2 py-0.5 text-xs rounded text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors font-jakarta"
      >
        Fit
      </button>
    </div>
  );
}
