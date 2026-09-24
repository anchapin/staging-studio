"use client";

import { useEffect, useState } from "react";

/**
 * Natural-dimension tracking for the editor's base photo (issue #691
 * extraction from inpaint-editor.tsx): resolves once per imageUrl so
 * masks and instance grids are exported at the photo's exact pixel
 * dimensions.
 */
export function useImageDimensions(imageUrl: string) {
  const [imageDims, setImageDims] = useState<{ width: number; height: number } | null>(
    null
  );

  useEffect(() => {
    if (!imageUrl) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setImageDims({ width: img.naturalWidth, height: img.naturalHeight });
      }
    };
    img.src = imageUrl;
    return () => {
      img.onload = null;
    };
  }, [imageUrl]);

  return { imageDims, aspectRatio: imageDims ? imageDims.width / imageDims.height : null };
}
