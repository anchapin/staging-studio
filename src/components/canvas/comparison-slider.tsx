"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  nudgeSliderPercent,
  sliderPercentFromClientX,
} from "@/lib/comparison-slider-geometry";
import { ComparisonPill } from "./comparison-pill";

interface ComparisonSliderProps {
  beforeImageUrl: string;
  afterImageUrl: string;
  beforeAlt: string;
  afterAlt: string;
  /** Visible label for the after image, e.g. "Variant B — staged". */
  afterLabel: string;
  largeImage?: boolean;
  /**
   * Issue #623: Report/lookbook mode.
   * Enables hover-position mode (no drag needed on desktop), passive reveal animation,
   * drag-to-compare tooltip, mobile progress bar, and hidden handle.
   */
  report?: boolean;
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
  report = false,
}: ComparisonSliderProps) {
  const [sliderPosition, setSliderPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null);
  const [imageAspect, setImageAspect] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasRevealed = useRef(false);

  const imageSizes = largeImage ? FOCUSED_IMAGE_SIZES : GRID_IMAGE_SIZES;

  // Issue #623: passive reveal animation — on first load animate 0 → 50% over 800ms
  useEffect(() => {
    if (!report || hasRevealed.current) return;
    hasRevealed.current = true;

    // Small delay to let the image render first
    const animTimer = setTimeout(() => {
      setRevealed(true);
      setSliderPosition(50);
      // Show tooltip briefly after animation completes
      const tooltipTimer = setTimeout(() => {
        setTooltipVisible(true);
        const fadeTimer = setTimeout(() => setTooltipVisible(false), 2000);
        return () => clearTimeout(fadeTimer);
      }, 800);
      return () => clearTimeout(tooltipTimer);
    }, 100);

    return () => clearTimeout(animTimer);
  }, [report]);

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

  // Measure the photo once it loads so the frame adapts to its aspect ratio
  // instead of forcing a fixed 16/9 letterbox (issue #542).
  useEffect(() => {
    const img = new window.Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setImageAspect({ width: img.naturalWidth, height: img.naturalHeight });
      }
    };
    img.src = beforeImageUrl;
    return () => {
      img.onload = null;
    };
  }, [beforeImageUrl]);

  const handleMove = useCallback(
    (clientX: number) => {
      if (!containerRect) return;
      setSliderPosition(sliderPercentFromClientX(clientX, containerRect));
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
        setSliderPosition((p) => nudgeSliderPercent(p, -1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setSliderPosition((p) => nudgeSliderPercent(p, 1));
      }
    },
    []
  );

  // Hover mode: track mouse position when hovering (report mode, desktop only)
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!report || isDragging) return;
      handleMove(e.clientX);
    },
    [report, isDragging, handleMove]
  );

  useEffect(() => {
    if (!report) return;
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("mousemove", handleMouseMove);
    return () => el.removeEventListener("mousemove", handleMouseMove);
  }, [report, handleMouseMove]);

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

  // In report hover mode, show handle only when dragging
  const showHandle = !report || isDragging;

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-lg border border-stone-200 bg-stone-100 select-none"
      style={
        imageAspect
          ? { aspectRatio: `${imageAspect.width} / ${imageAspect.height}` }
          : undefined
      }
      role="slider"
      tabIndex={0}
      aria-label="Before and after comparison slider"
      aria-valuenow={sliderPosition}
      aria-valuemin={0}
      aria-valuemax={100}
      onMouseDown={report ? undefined : handleMouseDown}
      onTouchStart={handleTouchStart}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
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
        style={{
          clipPath: `inset(0 ${100 - sliderPosition}% 0 0)`,
          // Issue #623: passive reveal animation — animate from 0% to 50%
          transition: revealed
            ? "clip-path 0s"
            : "clip-path 800ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
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

      {/* Slider handle — transparent 44px hit area wrapping the visual 28px handle */}
      {/* Issue #623: hidden in hover mode (report) unless actively dragging */}
      {showHandle && (
        <div
          className="absolute top-0 bottom-0 w-11 cursor-ew-resize z-10"
          style={{ left: `${sliderPosition}%`, transform: "translateX(-50%)" }}
          onMouseDown={report ? undefined : handleMouseDown}
        >
          {/* 1px visual line — Issue #645 */}
          <div className="absolute inset-0 w-0.5 bg-secondary pointer-events-none" />
          {/* Center circle handle — Issue #645 */}
          <div
            className={`
              absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
              w-7 h-7 rounded-full
              bg-atelier-primary
              flex items-center justify-center
              transition-transform duration-150
              ${isDragging ? "scale-105 cursor-grabbing" : isHovered ? "scale-110" : ""}
              ${isHovered || isDragging ? "shadow-handle-hover" : ""}
            `}
          >
            {/* Drag indicator icon — 3 horizontal grip dots */}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="white"
              className="pointer-events-none"
            >
              <circle cx="8" cy="6" r="1.5" />
              <circle cx="16" cy="6" r="1.5" />
              <circle cx="8" cy="12" r="1.5" />
              <circle cx="16" cy="12" r="1.5" />
              <circle cx="8" cy="18" r="1.5" />
              <circle cx="16" cy="18" r="1.5" />
            </svg>
          </div>
        </div>
      )}

      {/* Labels — Issue #644 / #623 */}
      {/* Before pill: always visible, top-left */}
      <div className="absolute left-3 top-3 pointer-events-none z-10">
        <ComparisonPill variant="report">Before</ComparisonPill>
      </div>
      {/* After pill: always visible, top-right with terracotta dot prefix */}
      <div className="absolute right-3 top-3 pointer-events-none z-10">
        <ComparisonPill variant="after" showDot>
          {afterLabel}
        </ComparisonPill>
      </div>

      {/* Issue #623: "drag to compare" tooltip — fades after initial reveal */}
      {report && tooltipVisible && !isDragging && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none z-20 animate-tooltip-fade"
          aria-hidden="true"
        >
          <span className="inline-flex items-center gap-1.5 bg-stone-800/80 text-white text-xs font-jakarta px-3 py-1.5 rounded-full backdrop-blur-sm">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 9l-3 3 3 3" />
              <path d="M9 5l3-3 3 3" />
              <path d="M15 19l-3 3-3-3" />
              <path d="M19 9l3 3-3 3" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <line x1="12" y1="2" x2="12" y2="22" />
            </svg>
            drag to compare
          </span>
        </div>
      )}

      {/* Issue #623: Mobile progress bar — bottom of slider */}
      {report && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-stone-200/50 z-10">
          <div
            className="h-full bg-secondary/70 transition-all duration-75"
            style={{ width: `${sliderPosition}%` }}
          />
        </div>
      )}
    </div>
  );
}
