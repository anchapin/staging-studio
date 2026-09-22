"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

interface ComparisonSliderProps {
  beforeImageUrl: string;
  afterImageUrl: string;
  beforeAlt: string;
  afterAlt: string;
  /** Visible label for the after image, e.g. "Variant B — staged". */
  afterLabel: string;
  largeImage?: boolean;
}

const GRID_IMAGE_SIZES =
  "(max-width: 767px) calc(100vw - 320px), calc((100vw - 352px) / 2)";

const FOCUSED_IMAGE_SIZES =
  "(max-width: 767px) calc(100vw - 320px), calc(100vw - 320px)";

export default function ComparisonSlider({
  beforeImageUrl,
  afterImageUrl,
  beforeAlt,
  afterAlt,
  afterLabel,
  largeImage = false,
}: ComparisonSliderProps) {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const imageSizes = largeImage ? FOCUSED_IMAGE_SIZES : GRID_IMAGE_SIZES;

  const updateRect = useCallback(() => {
    if (containerRef.current) {
      setContainerRect(containerRef.current.getBoundingClientRect());
    }
  }, []);

  useEffect(() => {
    updateRect();
    window.addEventListener("resize", updateRect);
    return () => window.removeEventListener("resize", updateRect);
  }, [updateRect]);

  const handleMove = useCallback(
    (clientX: number) => {
      if (!containerRect) return;
      const x = clientX - containerRect.left;
      const percent = Math.max(0, Math.min(100, (x / containerRect.width) * 100));
      setSliderPosition(percent);
    },
    [containerRect]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      handleMove(e.clientX);
    },
    [handleMove]
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      setIsDragging(true);
      handleMove(e.touches[0].clientX);
    },
    [handleMove]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSliderPosition((p) => Math.max(0, p - 5));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setSliderPosition((p) => Math.min(100, p + 5));
      }
    },
    []
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      handleMove(e.clientX);
    };

    const handleTouchMove = (e: TouchEvent) => {
      handleMove(e.touches[0].clientX);
    };

    const handleEnd = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleEnd);
    window.addEventListener("touchmove", handleTouchMove);
    window.addEventListener("touchend", handleEnd);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleEnd);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleEnd);
    };
  }, [isDragging, handleMove]);

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-lg border border-stone-200 bg-stone-100 select-none"
      style={{ aspectRatio: "16/9" }}
      role="slider"
      tabIndex={0}
      aria-label="Before and after comparison slider"
      aria-valuenow={sliderPosition}
      aria-valuemin={0}
      aria-valuemax={100}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onKeyDown={handleKeyDown}
    >
      {/* Before image (bottom layer) */}
      <div className="absolute inset-0">
        <Image
          src={beforeImageUrl}
          alt={beforeAlt}
          fill
          sizes={imageSizes}
          className="object-contain"
          draggable={false}
        />
      </div>

      {/* After image (top layer, clipped by slider position) */}
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
      >
        <Image
          src={afterImageUrl}
          alt={afterAlt}
          fill
          sizes={imageSizes}
          className="object-contain"
          draggable={false}
        />
      </div>

      {/* Slider handle — transparent 44px hit area wrapping a 1px visual line */}
      <div
        className="absolute top-0 bottom-0 w-11 cursor-ew-resize z-10"
        style={{ left: `${sliderPosition}%`, transform: "translateX(-50%)" }}
      >
        {/* 1px visual line */}
        <div className="absolute inset-0 w-1 bg-white shadow-lg" />
        {/* Center circle handle */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center">
          <div className="flex items-center gap-0.5">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-stone-600"
            >
              <path d="M8 4l-6 8 6 8" />
              <path d="M16 4l6 8-6 8" />
            </svg>
          </div>
        </div>
      </div>

      {/* Labels */}
      <div className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white pointer-events-none">
        {afterLabel}
      </div>
      <div className="absolute right-3 top-3 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white pointer-events-none">
        Original
      </div>
    </div>
  );
}
