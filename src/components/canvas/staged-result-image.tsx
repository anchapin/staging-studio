"use client";

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
   * Focused-room layout (issue #169): render at the taller full-width frame
   * height so the staged result matches the room photo above it.
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
  const frameHeight = largeImage ? "h-96" : "h-64";
  const imageSizes = largeImage ? FOCUSED_IMAGE_SIZES : GRID_IMAGE_SIZES;

  return (
    <div
      className={`relative ${frameHeight} overflow-hidden rounded-lg border border-stone-200 bg-stone-100`}
    >
      <Image
        src={afterImageUrl}
        alt={alt}
        fill
        sizes={imageSizes}
        className="object-cover"
      />
      <div className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white">
        {label}
      </div>
    </div>
  );
}
