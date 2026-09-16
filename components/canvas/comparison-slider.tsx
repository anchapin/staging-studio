"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { VariantPicker } from "./variant-picker";

interface ComparisonSliderProps {
  beforeImageUrl: string;
  afterImageUrl: string;
  beforeImageUrl2?: string;
  afterImageUrl2?: string;
  selectedVariantIndex: number;
  onVariantChange: (index: number) => void;
  roomName: string;
  className?: string;
}

export function ComparisonSlider({
  beforeImageUrl,
  afterImageUrl,
  beforeImageUrl2,
  afterImageUrl2,
  selectedVariantIndex,
  onVariantChange,
  roomName,
  className,
}: ComparisonSliderProps) {
  const [sliderPosition, setSliderPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const currentBefore = selectedVariantIndex === 0 ? beforeImageUrl : (beforeImageUrl2 || beforeImageUrl);
  const currentAfter = selectedVariantIndex === 0 ? afterImageUrl : (afterImageUrl2 || afterImageUrl);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = (x / rect.width) * 100;
      setSliderPosition(Math.min(Math.max(percentage, 0), 100));
    };

    const handleMouseUp = () => {
      isDragging.current = false;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleMouseDown = () => {
    isDragging.current = true;
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between">
        <h3 className="font-playfair text-lg font-semibold text-stone-800">{roomName}</h3>
        <VariantPicker
          selectedIndex={selectedVariantIndex}
          onSelect={onVariantChange}
          variant1Label="A"
          variant2Label="B"
        />
      </div>

      <div
        ref={containerRef}
        className="relative aspect-[4/3] overflow-hidden rounded-lg bg-stone-100"
      >
        {currentBefore && currentAfter ? (
          <>
            <img
              src={currentBefore}
              alt={`${roomName} before`}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
            >
              <img
                src={currentAfter}
                alt={`${roomName} after`}
                className="absolute inset-0 h-full w-full object-cover"
                style={{ width: `${100 / (sliderPosition / 100)}%` }}
              />
            </div>
            <div
              className="absolute top-0 bottom-0 w-1 bg-white shadow-lg cursor-ew-resize"
              style={{ left: `${sliderPosition}%`, transform: "translateX(-50%)" }}
              onMouseDown={handleMouseDown}
            >
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
                </svg>
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-stone-500">
            No images available
          </div>
        )}
      </div>
    </div>
  );
}
