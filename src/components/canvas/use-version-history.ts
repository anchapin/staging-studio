"use client";

import { useCallback, useState } from "react";
import {
  getInpaintVersions,
  restoreInpaintVersion,
} from "@/app/actions/inpaint-versions";

/**
 * Shared version-history row shape (issue #713): getInpaintVersions
 * selects exactly these columns, newest first. `createdAt` crosses the
 * server-action boundary as a serialized timestamp, so format it through
 * the shared helpers in @/lib/relative-time (which accept all shapes).
 */
export interface InpaintVersion {
  id: string;
  resultUrl: string;
  thumbnailUrl: string | null;
  seed: string | null;
  promptDirectives: string | null;
  createdAt: Date;
}

/** Server-action result of one restore attempt. */
export type RestoreVersionResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Single shared version-history data hook (issue #713): owns the versions
 * fetch and the restore server call that the pills and panel
 * presentations both drive. View-specific concerns stay in the components
 * (undo/redo stacks and optimistic rollback in the pills; preview state
 * and isRestoring in the panel).
 *
 * loadVersions resolves with the fetched list (null when the server
 * rejected the fetch) so callers can react to the fresh rows — the pills
 * re-sync their current index to the active version — without
 * duplicating the fetch itself. When to call it (on mount, on open, on
 * active-result change) is likewise each presentation's choice.
 */
export function useVersionHistory(roomId: string, variantSlot: 0 | 1): {
  versions: InpaintVersion[];
  isLoading: boolean;
  loadVersions: () => Promise<InpaintVersion[] | null>;
  restoreVersion: (versionId: string) => Promise<RestoreVersionResult>;
} {
  const [versions, setVersions] = useState<InpaintVersion[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadVersions = useCallback(async (): Promise<InpaintVersion[] | null> => {
    setIsLoading(true);
    try {
      const result = await getInpaintVersions(roomId, variantSlot);
      if (result.success) {
        const fetched = result.versions as InpaintVersion[];
        setVersions(fetched);
        return fetched;
      }
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [roomId, variantSlot]);

  const restoreVersion = useCallback(
    (versionId: string) => restoreInpaintVersion(versionId),
    []
  );

  return { versions, isLoading, loadVersions, restoreVersion };
}
