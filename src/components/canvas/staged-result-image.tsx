"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

/**
 * Matches RoomCanvas's grid-card sizing: half the two-column grid on
 * desktop, full viewport width on mobile.
 */
const GRID_IMAGE_SIZES =
  "(max-width: 767px) calc(100vw - 320px), calc((100vw - 352px) / 2)";

/**
 * Matches RoomCanvas's focused-room sizing (issue #169): the photo spans
 * the full content width.
 */
const FOCUSED_IMAGE_SIZES =
  "(max-width: 767px) calc(100vw - 320px), calc(100vw - 320px)";

interface StagedResultImageProps {
  afterImageUrl: string;
  /** Alt text for the staged image, e.g. "Living room staged — Variant B". */
  alt: string;
  /** Visible variant label, e.g. "Variant B — staged". */
  label: string;
  /**
   * Focused-room layout (issue #169): span the full content width so the
   * staged result matches the room photo above it. Since #188 the frame
   * height follows the photo's aspect ratio (viewport-capped), so this only
   * affects sizing.
   */
  largeImage?: boolean;
}

/**
 * Renders a room's staged "after" image as a static image (issue #168) —
 * no draggable before/after slider. The frame mirrors `RoomCanvas` so the
 * before photo above and the staged result below read as one coherent
 * pair; the variant label is shown as a small badge over the image.
 */
export default function StagedResultImage({
  afterImageUrl,
  alt,
  label,
  largeImage = false,
}: StagedResultImageProps) {
  /**
   * Natural pixel dimensions of the loaded photo (issue #188). The frame
   * adopts the photo's own aspect ratio so the FULL image stays visible —
   * a fixed-height frame with `object-cover` cropped the bottom (and top)
   * off wide photos. Null until the photo loads; the fixed `frameHeight`
   * fallback covers that window.
   */
  const [imageAspect, setImageAspect] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Measure the photo once it loads (same pattern as RoomCanvas /
  // InpaintEditor). `window.Image` — not the imported next/image component —
  // is the DOM constructor here.
  useEffect(() => {
    const img = new window.Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setImageAspect({ width: img.naturalWidth, height: img.naturalHeight });
      }
    };
    img.src = afterImageUrl;
    return () => {
      img.onload = null;
    };
  }, [afterImageUrl]);

  const frameHeight = largeImage ? "h-96" : "h-64";
  const imageSizes = largeImage ? FOCUSED_IMAGE_SIZES : GRID_IMAGE_SIZES;

  return (
    <div
      className={`relative w-full overflow-hidden rounded-lg border border-stone-200 bg-stone-100 ${
        imageAspect ? "max-h-[70vh]" : frameHeight
      }`}
      style={
        imageAspect
          ? { aspectRatio: `${imageAspect.width} / ${imageAspect.height}` }
          : undefined
      }
    >
      {/*
        Issue #188: letterbox with `object-contain` instead of cropping with
        `object-cover` — the staged result must be fully visible, never cut
        off at the bottom.
      */}
      <Image
        src={afterImageUrl}
        alt={alt}
        fill
        sizes={imageSizes}
        className="object-contain"
      />
      <div className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white">
        {label}
      </div>
    </div>
  );
}
