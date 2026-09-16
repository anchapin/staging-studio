"use client";

import { useCallback, useRef, useState } from "react";

interface ComparisonSliderProps {
  originalImage: string;
  variantImage: string;
  roomName?: string;
}

export function ComparisonSlider({
  originalImage,
  variantImage,
  roomName,
}: ComparisonSliderProps) {
  const [sliderPosition, setSliderPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const updateSliderPosition = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(percentage);
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      updateSliderPosition(e.clientX);
    },
    [updateSliderPosition]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging.current) return;
      updateSliderPosition(e.clientX);
    },
    [updateSliderPosition]
  );

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      isDragging.current = true;
      updateSliderPosition(e.touches[0].clientX);
    },
    [updateSliderPosition]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isDragging.current) return;
      updateSliderPosition(e.touches[0].clientX);
    },
    [updateSliderPosition]
  );

  const handleTouchEnd = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 1 : 5;
      let next: number;
      switch (e.key) {
        case "ArrowLeft":
          next = Math.max(0, sliderPosition - step);
          break;
        case "ArrowRight":
          next = Math.min(100, sliderPosition + step);
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = 100;
          break;
        default:
          return;
      }
      e.preventDefault();
      setSliderPosition(next);
    },
    [sliderPosition]
  );

  const sliderLabel = roomName
    ? `${roomName} before/after comparison slider`
    : "Before/after comparison slider";
  const sliderValue = Math.round(sliderPosition);

  return (
    <div className="relative w-full overflow-hidden rounded-lg bg-stone-100">
      {roomName && (
        <div className="absolute left-3 top-3 z-10 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white">
          {roomName}
        </div>
      )}

      <div
        ref={containerRef}
        role="presentation"
        className="relative h-64 w-full cursor-col-resize select-none sm:h-96"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="absolute inset-0">
          <img
            src={originalImage}
            alt={roomName ? `${roomName} before staging` : "Before staging"}
            className="h-full w-full object-cover"
            draggable={false}
          />
        </div>

        <div
          className="absolute inset-0 overflow-hidden"
          style={{ width: `${sliderPosition}%` }}
        >
          <img
            src={variantImage}
            alt={roomName ? `${roomName} after staging` : "After staging"}
            className="h-full object-cover"
            style={{ width: containerRef.current?.offsetWidth }}
            draggable={false}
          />
        </div>

        <div
          role="slider"
          tabIndex={0}
          aria-label={sliderLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={sliderValue}
          aria-valuetext={`Showing ${sliderValue}% after image`}
          onKeyDown={handleKeyDown}
          className="absolute top-0 bottom-0 w-1 cursor-col-resize bg-white shadow-[0_0_10px_rgba(0,0,0,0.3)] focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-700 focus-visible:ring-offset-2"
          style={{ left: `${sliderPosition}%` }}
        >
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white p-2 shadow-lg">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-4 w-4 text-stone-700"
            >
              <path d="M8 5l-5 7 5 7M16 5l5 7-5 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        <div className="absolute bottom-3 left-3 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white">
          Before
        </div>
        <div className="absolute bottom-3 right-3 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white">
          After
        </div>
      </div>
    </div>
  );
}
