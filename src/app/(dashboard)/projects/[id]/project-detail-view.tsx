"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, PencilRuler } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { resolveFocusedRoom, resolveRoomLayoutMode } from "@/lib/focus-mode";
import {
  isCompleteVariantPair,
  resolveStagedResultDisplay,
} from "@/lib/staged-result";
import {
  resolveActiveEditingSlot,
  resolveSelectionAfterDelete,
  resolveStripSelection,
  variantTouchUpLabel,
  type VariantStripSelection,
} from "@/lib/variant-legibility";
import RoomCanvas from "@/components/canvas/room-canvas";
import StagedResultImage from "@/components/canvas/staged-result-image";
import InpaintEditor from "@/components/canvas/inpaint-editor";
import VariantThumbnailStrip from "@/components/canvas/variant-thumbnail-strip";
import GenerateCopyForm, {
  type GeneratedCopy,
} from "@/components/canvas/generate-copy-form";
import { useToast, ToastContainer } from "@/components/ui/toast";
import {
  deleteVariantAfterImage,
  getVariantTouchUpCounts,
  saveVariantSelection,
} from "@/app/actions/room";
import { projectFetchStateFromStatus } from "@/lib/project-fetch-state";
import {
  buildInpaintResultPatch,
  healInpaintSource,
  inpaintSourceFromRequestRow,
  listInpaintSources,
  resolveInpaintSourceUrl,
  resolveInpaintTargetSlot,
  type InpaintSource,
  type VariantSlot,
} from "@/lib/inpaint-source";
import { buildPrefill } from "@/lib/prompt-prefill";

const MAX_DIRECTIVE_LENGTH = 2000;

interface Room {
  id: string;
  name: string;
  beforeImageUrl: string | null;
  afterImageUrl: string | null;
  beforeImageUrl2: string | null;
  afterImageUrl2: string | null;
  selectedVariantIndex: number | null;
  /** Saved AI directives (Generate Copy persists them); seeds the textarea. */
  rawDirectives?: string | null;
  inpaintRequests?: {
    id: string;
    variantSlot: number;
    sourceSlot: number | null;
  }[];
}

interface Project {
  id: string;
  propertyAddress: string;
  clientName: string;
  targetBuyer: string;
  stagingAesthetic: string;
  rooms: Room[];
}

interface VariantPair {
  before: string | null;
  after: string | null;
}

function variantPairsOf(room: Room): [VariantPair, VariantPair] {
  return [
    { before: room.beforeImageUrl, after: room.afterImageUrl },
    { before: room.beforeImageUrl2, after: room.afterImageUrl2 },
  ];
}

/**
 * Derives the per-room editor inputs shared by the all-rooms grid cards and
 * the focused full-width view (issue #169) so both layouts agree on the
 * displayed variant, the inpaint source resolution (#170), the pending-run
 * state, and the staged "after" image shown post-staging (#168).
 * Directives typed in-session win; otherwise a room with saved AI copy
 * starts from its persisted `rawDirectives`.
 */
function roomEditorInputs(
  room: Room,
  directives: Record<string, string>,
  inpaintSourceByRoom: Record<string, InpaintSource>
) {
  const pairs = variantPairsOf(room);
  const selectedIndex = room.selectedVariantIndex ?? 0;
  /**
   * The staged result to show in place of the old before/after slider
   * (issue #168): the selected variant's after image, falling back to A
   * then B, or null while no variant is complete. Non-null exactly when a
   * complete variant exists, so the variant strip and the image agree.
   */
  const staged = resolveStagedResultDisplay(room.name, pairs, selectedIndex);
  const roomDirectives = directives[room.id] ?? room.rawDirectives ?? "";
  // Issue #223: the session's stored source can go stale when room data
  // changes underneath it (variant cleared, persistence failure, refresh)
  // — heal it against the room so a dead sourceSlot is never submitted.
  const inpaintSource = healInpaintSource(
    room,
    inpaintSourceByRoom[room.id] ?? { kind: "original" as const }
  );
  const pendingRequest = room.inpaintRequests?.[0] ?? null;
  return {
    pairs,
    selectedIndex,
    staged,
    hasAnyCompleteVariant: pairs.some(isCompleteVariantPair),
    roomDirectives,
    inpaintSource,
    inpaintImageUrl:
      resolveInpaintSourceUrl(room, inpaintSource) ?? room.beforeImageUrl,
    pendingRequest,
    pendingSource: pendingRequest
      ? inpaintSourceFromRequestRow(pendingRequest)
      : null,
  };
}

/**
 * @param initialProject Server-rendered project data (issue #83): the page
 *   fetches it through the request-cached loader shared with
 *   generateMetadata, so first paint needs no client auth round-trip or
 *   fetch. `loadProject` (the issue #90 retry-state machinery) is kept as
 *   the client-side REFETCH path for interactive updates — it is only
 *   invoked explicitly (e.g. by the retry affordance below), never on mount.
 */
export default function ProjectDetailView({
  id,
  initialProject,
}: {
  id: string;
  initialProject: Project;
}) {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(initialProject);
  const [loading, setLoading] = useState(false);
  /**
   * Null while loaded (the normal server-rendered state) or once a refetch
   * succeeds. When set, `status` is the failing response's HTTP status —
   * or null when the fetch threw (network error). Only a real 404 renders
   * the not-found state; everything else is a retryable load failure
   * (issue #90).
   */
  const [loadError, setLoadError] = useState<{ status: number | null } | null>(
    null
  );
  const [editorRoomId, setEditorRoomId] = useState<string | null>(null);
  const [directives, setDirectives] = useState<Record<string, string>>({});
  // Per-room inpaint source choice (issue #170): original photo by default,
  // or a completed staged variant for progressive editing.
  const [inpaintSourceByRoom, setInpaintSourceByRoom] = useState<
    Record<string, InpaintSource>
  >({});
  /**
   * Issue #192: per-room variant touch-up counts, derived from the room's
   * `InpaintRequest` rows (fetched when the editor opens via
   * `getVariantTouchUpCounts`) and incremented in-session as variant-source
   * runs land.
   */
  const [touchUpCountsByRoom, setTouchUpCountsByRoom] = useState<
    Record<string, { 0: number; 1: number }>
  >({});
  /** Slot with a delete in flight (spinner on the strip's trash button). */
  const [deletingSlotByRoom, setDeletingSlotByRoom] = useState<
    Record<string, VariantSlot | null>
  >({});
  /** Issue #460: per-room toggle for staged result ↔ original comparison. */
  const [showOriginalByRoom, setShowOriginalByRoom] = useState<
    Record<string, boolean>
  >({});
  const { toasts, showError, showSuccess, showInfo, dismissToast } = useToast();

  /**
   * Explicit refetch through GET /api/projects/[id] (issue #90 retry-state
   * machinery). Not run on mount — initial render is server data (issue
   * #83); interactive updates re-sync via local state plus
   * `router.refresh()` (which re-renders the server tree, including the
   * sidebar). Kept for the retry affordance and future refetch needs.
   */
  const loadProject = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        // Session missing/expired: same treatment as the API's 401 — a
        // load failure the user can retry after signing back in, never
        // "project not found".
        setLoadError({ status: 401 });
        return;
      }

      const response = await fetch(`/api/projects/${id}`);
      if (!response.ok) {
        setLoadError({ status: response.status });
        return;
      }
      setProject(await response.json());
    } catch {
      // Thrown network error (dropped connection, offline, DNS): no
      // status at all — retryable, never not-found.
      setLoadError({ status: null });
    } finally {
      setLoading(false);
    }
  }, [id]);

  const applyRoomUpdate = useCallback((roomId: string, patch: Partial<Room>) => {
    setProject((prev) =>
      prev
        ? {
            ...prev,
            rooms: prev.rooms.map((room) =>
              room.id === roomId ? { ...room, ...patch } : room
            ),
          }
        : prev
    );
  }, []);

  /**
   * Issue #192: refreshes a room's per-slot touch-up counts from its
   * `InpaintRequest` rows. Called when the focused editor opens; failures
   * leave the previous counts in place (the indicator just omits the
   * count until a fetch succeeds).
   */
  const fetchTouchUpCounts = useCallback(async (roomId: string) => {
    const result = await getVariantTouchUpCounts(roomId);
    if (result.success && result.counts) {
      const counts = result.counts;
      setTouchUpCountsByRoom((prev) => ({ ...prev, [roomId]: counts }));
    }
  }, []);

  /** Opens the focused editor and refreshes its touch-up counts. */
  const openEditor = useCallback(
    (roomId: string) => {
      setEditorRoomId(roomId);
      void fetchTouchUpCounts(roomId);
    },
    [fetchTouchUpCounts]
  );

  const handleVariantSelect = useCallback(
    async (room: Room, index: number) => {
      const pair = variantPairsOf(room)[index];
      if (!isCompleteVariantPair(pair)) {
        showInfo(
          `Variant ${index === 0 ? "A" : "B"} hasn't been staged yet — open "Edit staging" and run inpainting to create it.`
        );
        return;
      }

      // Selection may now be null (Original selected via the strip);
      // revert to the exact prior value on failure instead of 0.
      const previousRaw = room.selectedVariantIndex;
      applyRoomUpdate(room.id, { selectedVariantIndex: index });

      const result = await saveVariantSelection(room.id, index);
      if (!result.success) {
        applyRoomUpdate(room.id, { selectedVariantIndex: previousRaw });
        showError(
          result.error || "Failed to save variant selection",
          true,
          () => {
            void handleVariantSelect(room, index);
          },
          "Retry saving variant selection"
        );
        return;
      }
      router.refresh();
    },
    [applyRoomUpdate, showError, showInfo, router]
  );

  /**
   * Issue #192: single entry point for the thumbnail strip's select
   * clicks. "Original" clears the lookbook selection
   * (`selectedVariantIndex: null`); re-clicking the already-highlighted
   * item is a no-op. Variant clicks delegate to {@link handleVariantSelect}
   * (which toasts for unstaged slots).
   */
  const handleStripSelect = useCallback(
    async (room: Room, selection: VariantStripSelection) => {
      const current = resolveStripSelection(
        room.selectedVariantIndex,
        variantPairsOf(room)
      );
      if (selection === current) return;

      if (selection === "original") {
        const previousRaw = room.selectedVariantIndex;
        applyRoomUpdate(room.id, { selectedVariantIndex: null });

        const result = await saveVariantSelection(room.id, null);
        if (!result.success) {
          applyRoomUpdate(room.id, { selectedVariantIndex: previousRaw });
          showError(
            result.error || "Failed to save variant selection",
            true,
            () => {
              void handleStripSelect(room, selection);
            },
            "Retry saving variant selection"
          );
          return;
        }
        router.refresh();
        return;
      }

      await handleVariantSelect(room, selection);
    },
    [applyRoomUpdate, handleVariantSelect, showError, router]
  );

  /**
   * Issue #192: deletes one variant's staged after-image. Optimistically
   * clears the slot and lands the selection on a valid item via the same
   * pure resolver the server action uses; reverts and offers a retry on
   * failure.
   */
  const handleDeleteVariant = useCallback(
    async (room: Room, slot: VariantSlot) => {
      const letter = slot === 0 ? "A" : "B";
      setDeletingSlotByRoom((prev) => ({ ...prev, [room.id]: slot }));
      const previous = {
        afterImageUrl: room.afterImageUrl,
        afterImageUrl2: room.afterImageUrl2,
        selectedVariantIndex: room.selectedVariantIndex,
      };
      const nextSelection = resolveSelectionAfterDelete(
        variantPairsOf(room),
        room.selectedVariantIndex,
        slot
      );

      try {
        applyRoomUpdate(
          room.id,
          slot === 0
            ? { afterImageUrl: null, selectedVariantIndex: nextSelection }
            : { afterImageUrl2: null, selectedVariantIndex: nextSelection }
        );

        const result = await deleteVariantAfterImage(room.id, slot);
        if (!result.success) {
          applyRoomUpdate(room.id, previous);
          showError(
            result.error || `Failed to delete Variant ${letter}`,
            true,
            () => {
              void handleDeleteVariant(room, slot);
            },
            `Retry deleting Variant ${letter}`
          );
          return;
        }
        showSuccess(`Variant ${letter} deleted.`);
        router.refresh();
      } finally {
        setDeletingSlotByRoom((prev) => ({ ...prev, [room.id]: null }));
      }
    },
    [applyRoomUpdate, showError, showSuccess, router]
  );

  const persistInpaintResult = useCallback(
    async (room: Room, resultImageUrl: string, source: InpaintSource) => {
      const slot = resolveInpaintTargetSlot(room, source);
      const body = buildInpaintResultPatch(room, resultImageUrl, source);

      try {
        const response = await fetch(
          `/api/projects/${project?.id ?? ""}/rooms/${room.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            data?.error || data?.message || "Failed to save staged image"
          );
        }

        applyRoomUpdate(room.id, {
          beforeImageUrl: data.beforeImageUrl ?? room.beforeImageUrl,
          afterImageUrl: data.afterImageUrl,
          beforeImageUrl2: data.beforeImageUrl2,
          afterImageUrl2: data.afterImageUrl2,
          selectedVariantIndex: data.selectedVariantIndex,
        });
        if (source.kind === "variant") {
          // Issue #192: count this landed touch-up in-session so the
          // editing indicator advances without waiting for a refetch.
          setTouchUpCountsByRoom((prev) => {
            const counts = prev[room.id] ?? { 0: 0, 1: 0 };
            return {
              ...prev,
              [room.id]: { ...counts, [source.slot]: counts[source.slot] + 1 },
            };
          });
        }
        showSuccess(`Staged image saved as Variant ${slot === 0 ? "A" : "B"}.`);
        router.refresh();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to save staged image";
        showError(
          message,
          true,
          () => {
            void persistInpaintResult(room, resultImageUrl, source);
          },
          "Retry saving staged image"
        );
      }
    },
    [project?.id, applyRoomUpdate, showError, showSuccess, router]
  );

  const handleInpaintSourceChange = useCallback(
    (roomId: string, next: InpaintSource) => {
      setInpaintSourceByRoom((prev) => ({
        ...prev,
        [roomId]: next,
      }));
    },
    []
  );

  /** Issue #460: toggles staged result ↔ original comparison for a room. */
  const handleToggleStagedComparison = useCallback((roomId: string) => {
    setShowOriginalByRoom((prev) => ({
      ...prev,
      [roomId]: !prev[roomId],
    }));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  if (!project && loadError) {
    if (projectFetchStateFromStatus(loadError.status) === "not-found") {
      return (
        <div className="p-8 text-center">
          <h1 className="text-2xl font-bold text-foreground">Project not found</h1>
          <Link href="/dashboard" className="text-muted-foreground hover:underline mt-4 inline-block">
            Back to dashboard
          </Link>
        </div>
      );
    }

    return (
      <div className="p-8">
        <div
          role="alert"
          className="mx-auto mt-8 max-w-lg rounded-lg border border-red-200 bg-red-50 p-6 text-center"
        >
          <p className="text-red-700">Couldn&apos;t load this project.</p>
          {loadError.status === 401 && (
            <p className="mt-1 text-sm text-red-600">
              Your session may have expired — sign in again if retrying
              doesn&apos;t work.
            </p>
          )}
          <button
            onClick={() => void loadProject()}
            className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
          >
            Retry
          </button>
          <Link
            href="/dashboard"
            className="mt-4 block text-muted-foreground hover:underline text-sm"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-2xl font-bold text-foreground">Project not found</h1>
        <Link href="/dashboard" className="text-muted-foreground hover:underline mt-4 inline-block">
          Back to dashboard
        </Link>
      </div>
    );
  }

  /**
   * Focused single-room editing (issue #169): when an editor room is set —
   * and it still matches a real room — only that room renders, spanning the
   * full available content width. A stale id (room gone after a refetch)
   * falls back to the grid; the single `editorRoomId` guarantees one editor
   * at a time, and the directives/source maps live above this component's
   * layouts so they survive grid↔focused transitions.
   */
  const focusedRoom = resolveFocusedRoom(project.rooms, editorRoomId);
  const layoutMode = resolveRoomLayoutMode(project.rooms, editorRoomId);
  const focusedInputs = focusedRoom
    ? roomEditorInputs(focusedRoom, directives, inpaintSourceByRoom)
    : null;
  /**
   * Issue #192: the variant slot currently being edited — the editor's
   * chosen source when it is a staged variant, or a resuming pending run
   * that edits one. Drives the "editing Variant X · n touch-ups"
   * indicator in the focused view.
    */
  const focusedEditingSlot =
    focusedRoom && focusedInputs
        ? resolveActiveEditingSlot(
            focusedInputs.inpaintSource,
            focusedInputs.pendingSource
          )
        : null;

  // Issue #252 D5: laptop-first fixed-viewport layout for the focused
  // editor — the page fills the dashboard shell's height and the editor's
  // two panes scroll internally, so page-level scrolling dies at laptop
  // size. Only when the editor actually renders (a before photo exists);
  // grid and photo-less views keep the normal scrolling page.
  const laptopFixedLayout =
    layoutMode === "focused" &&
    focusedRoom !== null &&
    focusedInputs !== null &&
    focusedRoom.beforeImageUrl !== null;

  return (
    <div
      className={
        laptopFixedLayout
          ? "flex min-h-screen flex-col bg-background lg:h-full lg:overflow-auto"
          : "min-h-screen bg-background"
      }
    >
      <header className="shrink-0 bg-background border-b border-border px-8 py-4">
        <div className="flex items-center justify-between">
          <div>
            <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground">
              <Link
                href="/projects"
                className="hover:text-foreground"
              >
                Projects
              </Link>
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
              <span className="text-foreground">{project.propertyAddress}</span>
              {focusedRoom && (
                <>
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                  <span className="text-foreground">{focusedRoom.name}</span>
                </>
              )}
            </nav>
            <h1 className="font-playfair text-2xl font-bold text-foreground mt-1">
              {project.propertyAddress}
            </h1>
            <div className="mt-1 flex items-center gap-4">
              <p className="text-sm text-muted-foreground">{project.clientName}</p>
              <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-foreground">
                {project.stagingAesthetic}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={`/projects/${project.id}/lookbook`}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary"
            >
              Preview Lookbook
            </Link>
          </div>
        </div>
      </header>

      <main
        className={
          laptopFixedLayout
            ? "flex min-h-0 flex-1 flex-col p-8"
            : "p-8"
        }
      >
        {focusedRoom && focusedInputs && layoutMode === "focused" ? (
          /*
           * Focused single-room editing (issue #169): only this room's
           * imagery and editor render, spanning the full available content
           * width — no half-width grid card, no other rooms splitting
           * attention. The mask canvas drops its compact cap (fullWidth).
           * "All rooms" is the visible affordance back to the grid.
           *
           * Issue #252 D5: laptop-first fixed-viewport layout — the page
           * fills the dashboard shell's height and the editor's two panes
           * (mask canvas left, tabbed control panel right) scroll
           * internally, so page-level scrolling dies at laptop size. The
           * room imagery, variant strip, directives, staged result, and
           * copy sections render through the editor's secondaryPane slot:
           * height-capped and internally scrollable above the mask canvas
           * at lg+.
           */
          <div className="flex min-h-0 flex-col lg:flex-1">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <button
                type="button"
                onClick={() => setEditorRoomId(null)}
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                All rooms
              </button>
              <h2 className="font-playfair text-xl font-semibold text-foreground">
                {focusedRoom.name}
              </h2>
            </div>

            {/* One PERSISTENT RoomCanvas for the focused room, above the
                photo/no-photo conditional: the upload flow completes by
                flipping this branch (beforeImageUrl arrives), and a canvas
                living INSIDE a branch would unmount mid-flight — wiping the
                "Room photo upload complete." status before it can be read
                (pre-#252 regression guard; the element also anchors the
                a11y live region the upload flow announces through). At lg+
                it is height-capped with internal scroll so it can never
                push the fixed-layout editor below the overflow-hidden clip
                (issue #252 D5: page-level scrolling dies at laptop size). */}
            {/* Issue #450: hide RoomCanvas when InpaintEditor is active (the
                canvas inside InpaintEditor shows the source image, so this
                would be a duplicate). Collapse entirely to free vertical space. */}
            {!focusedRoom.beforeImageUrl && (
              <div className="mt-4 lg:min-h-0 lg:max-h-[45%] lg:overflow-y-auto">
                <RoomCanvas
                  roomId={focusedRoom.id}
                  projectId={project.id}
                  imageUrl={focusedRoom.beforeImageUrl}
                  largeImage
                  onUploadComplete={(slot, publicUrl) => {
                    applyRoomUpdate(
                      focusedRoom.id,
                      slot === 1
                        ? { beforeImageUrl2: publicUrl }
                        : { beforeImageUrl: publicUrl }
                    );
                    router.refresh();
                  }}
                />
              </div>
            )}

            {focusedRoom.beforeImageUrl ? (
              <section
                aria-label="AI staging"
                className="mt-4 flex min-h-0 flex-col lg:flex-1"
              >                <h3 className="text-sm font-semibold text-foreground mb-3">
                  AI Staging
                </h3>
                {focusedEditingSlot !== null && (
                  <p
                    role="status"
                    className="mb-3 inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200"
                  >
                    {variantTouchUpLabel(
                      focusedEditingSlot,
                      touchUpCountsByRoom[focusedRoom.id]?.[
                        focusedEditingSlot
                      ] ?? 0
                    )}
                  </p>
                )}
                <InpaintEditor
                  roomId={focusedRoom.id}
                  imageUrl={focusedInputs.inpaintImageUrl ?? ""}
                  aesthetic={project.stagingAesthetic}
                  promptDirectives={focusedInputs.roomDirectives.trim()}
                  variantSlot={resolveInpaintTargetSlot(
                    focusedRoom,
                    focusedInputs.inpaintSource
                  )}
                  source={focusedInputs.inpaintSource}
                  sourceOptions={listInpaintSources(focusedRoom)}
                  fullWidth
                  onSourceChange={(next) => handleInpaintSourceChange(focusedRoom.id, next)}
                  pendingRequestId={focusedInputs.pendingRequest?.id ?? null}
                  pendingSource={focusedInputs.pendingSource}
                  onActiveConceptLabelChange={(label) => {
                    // Issue #230: seed the single-object staging
                    // directives with the concept pre-fill, only when
                    // the effective field is still empty — typed
                    // directives are never clobbered, and clearing the
                    // seed degrades to raw directives (no mode flag).
                    if (!label) return;
                    setDirectives((prev) => {
                      const current =
                        prev[focusedRoom.id] ?? focusedRoom.rawDirectives ?? "";
                      if (current.trim().length > 0) return prev;
                      return { ...prev, [focusedRoom.id]: buildPrefill(label) };
                    });
                  }}
                  onInpaintComplete={async (resultImageUrl, runSource) => {
                    await persistInpaintResult(focusedRoom, resultImageUrl, runSource);
                    const slot = resolveInpaintTargetSlot(focusedRoom, runSource);
                    handleInpaintSourceChange(focusedRoom.id, { kind: "variant", slot });
                  }}
                  secondaryPane={
                    <>
                      {/* Issue #460: textarea first — always visible above the fold */}
                      <section aria-label="Staging directives">
                        <label
                          htmlFor={`directives-${focusedRoom.id}`}
                          className="block text-sm font-medium text-foreground mb-1"
                        >
                          Staging directives (required)
                        </label>
                        <textarea
                          id={`directives-${focusedRoom.id}`}
                          value={focusedInputs.roomDirectives}
                          onChange={(e) =>
                            setDirectives((prev) => ({
                              ...prev,
                              [focusedRoom.id]: e.target.value,
                            }))
                          }
                          maxLength={MAX_DIRECTIVE_LENGTH}
                          rows={3}
                          placeholder="e.g. Add a neutral linen sofa, warm wood coffee table, and layered lighting..."
                          className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                        />
                        {focusedInputs.roomDirectives.length > 0 && (
                          <p className="mt-1 text-xs text-muted-foreground text-right">
                            {focusedInputs.roomDirectives.length}/{MAX_DIRECTIVE_LENGTH}
                          </p>
                        )}
                      </section>

                      <VariantThumbnailStrip
                        roomName={focusedRoom.name}
                        originalUrl={focusedRoom.beforeImageUrl}
                        pairs={focusedInputs.pairs}
                        selection={resolveStripSelection(
                          focusedRoom.selectedVariantIndex,
                          focusedInputs.pairs
                        )}
                        onSelect={(selection) =>
                          void handleStripSelect(focusedRoom, selection)
                        }
                        onDeleteVariant={(slot) =>
                          void handleDeleteVariant(focusedRoom, slot)
                        }
                        deletingSlot={deletingSlotByRoom[focusedRoom.id] ?? null}
                        touchUpCounts={touchUpCountsByRoom[focusedRoom.id] ?? null}
                      />

                      {focusedInputs.staged && (
                        <section aria-label="Staged result">
                          <h3 className="text-sm font-semibold text-foreground mb-3">
                            Staged result
                          </h3>
                          {/* Issue #460: click to toggle staged ↔ original comparison */}
                          <StagedResultImage
                            afterImageUrl={focusedInputs.staged.afterImageUrl}
                            alt={focusedInputs.staged.alt}
                            label={focusedInputs.staged.label}
                            largeImage
                            originalImageUrl={focusedRoom.beforeImageUrl}
                            onClickToggleComparison={() =>
                              handleToggleStagedComparison(focusedRoom.id)
                            }
                            showingOriginal={
                              showOriginalByRoom[focusedRoom.id] ?? false
                            }
                          />
                        </section>
                      )}

                      <section
                        aria-label="Room copy"
                        className="border-t border-border pt-4"
                      >
                        <h3 className="text-sm font-semibold text-foreground mb-3">
                          Room Copy
                        </h3>
                        <GenerateCopyForm
                          roomId={focusedRoom.id}
                          initialDirectives={focusedInputs.roomDirectives}
                          onCopyGenerated={(
                            _copy: GeneratedCopy,
                            rawDirectives: string
                          ) =>
                            // The form saves directives before generating;
                            // mirror them into the inpaint editor's state.
                            setDirectives((prev) => ({
                              ...prev,
                              [focusedRoom.id]: rawDirectives,
                            }))
                          }
                        />
                      </section>
                    </>
                  }
                />
              </section>
            ) : (
              <p className="mt-6 text-sm text-muted-foreground">
                Upload a room photo first to enable AI staging and copy.
              </p>
            )}
          </div>
        ) : (
          <>
            <h2 className="font-playfair text-xl font-semibold text-foreground mb-6">Rooms</h2>

            {project.rooms.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-12 text-center">
                <svg
                  className="mb-3 h-12 w-12 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                  />
                </svg>
                <p className="font-medium text-foreground">No rooms yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Upload a room photo to begin staging
                </p>
              </div>
            ) : (
              <div className="grid gap-8 md:grid-cols-2">
                {project.rooms.map((room) => {
                  const inputs = roomEditorInputs(
                    room,
                    directives,
                    inpaintSourceByRoom
                  );

                  return (
                    <div key={room.id} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-medium text-foreground">{room.name}</h3>
                        <button
                          type="button"
                          onClick={() => openEditor(room.id)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-secondary"
                        >
                          <PencilRuler className="w-4 h-4" aria-hidden="true" />
                          Edit staging
                        </button>
                      </div>

                      <RoomCanvas
                        roomId={room.id}
                        projectId={project.id}
                        imageUrl={room.beforeImageUrl}
                        onUploadComplete={(slot, publicUrl) => {
                          applyRoomUpdate(
                            room.id,
                            slot === 1
                              ? { beforeImageUrl2: publicUrl }
                              : { beforeImageUrl: publicUrl }
                          );
                          router.refresh();
                        }}
                      />

                      {inputs.staged && (
                        <StagedResultImage
                          afterImageUrl={inputs.staged.afterImageUrl}
                          alt={inputs.staged.alt}
                          label={inputs.staged.label}
                        />
                      )}

                      {room.beforeImageUrl && (
                        <VariantThumbnailStrip
                          roomName={room.name}
                          originalUrl={room.beforeImageUrl}
                          pairs={inputs.pairs}
                          selection={resolveStripSelection(
                            room.selectedVariantIndex,
                            inputs.pairs
                          )}
                          onSelect={(selection) =>
                            void handleStripSelect(room, selection)
                          }
                          onDeleteVariant={(slot) =>
                            void handleDeleteVariant(room, slot)
                          }
                          deletingSlot={deletingSlotByRoom[room.id] ?? null}
                          touchUpCounts={touchUpCountsByRoom[room.id] ?? null}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
