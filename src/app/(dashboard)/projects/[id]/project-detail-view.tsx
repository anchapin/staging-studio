"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, PencilRuler } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { resolveFocusedRoom, resolveRoomLayoutMode } from "@/lib/focus-mode";
import {
  isCompleteVariantPair,
  resolveStagedResultDisplay,
} from "@/lib/staged-result";
import RoomCanvas from "@/components/canvas/room-canvas";
import StagedResultImage from "@/components/canvas/staged-result-image";
import InpaintEditor from "@/components/canvas/inpaint-editor";
import { VariantPicker } from "@/components/canvas/variant-picker";
import GenerateCopyForm, {
  type GeneratedCopy,
} from "@/components/canvas/generate-copy-form";
import ExportPdfButton from "@/components/canvas/export-pdf-button";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { saveVariantSelection } from "@/app/actions/room";
import { projectFetchStateFromStatus } from "@/lib/project-fetch-state";
import {
  buildInpaintResultPatch,
  inpaintSourceFromRequestRow,
  listInpaintSources,
  resolveInpaintSourceUrl,
  resolveInpaintTargetSlot,
  type InpaintSource,
} from "@/lib/inpaint-source";

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
   * complete variant exists, so the VariantPicker and the image agree.
   */
  const staged = resolveStagedResultDisplay(room.name, pairs, selectedIndex);
  const roomDirectives = directives[room.id] ?? room.rawDirectives ?? "";
  const inpaintSource =
    inpaintSourceByRoom[room.id] ?? { kind: "original" as const };
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

  const handleVariantSelect = useCallback(
    async (room: Room, index: number) => {
      const pair = variantPairsOf(room)[index];
      if (!isCompleteVariantPair(pair)) {
        showInfo(
          `Variant ${index === 0 ? "A" : "B"} hasn't been staged yet — open "Edit staging" and run inpainting to create it.`
        );
        return;
      }

      const previousIndex = room.selectedVariantIndex ?? 0;
      applyRoomUpdate(room.id, { selectedVariantIndex: index });

      const result = await saveVariantSelection(room.id, index);
      if (!result.success) {
        applyRoomUpdate(room.id, { selectedVariantIndex: previousIndex });
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-stone-800" />
      </div>
    );
  }

  if (!project && loadError) {
    if (projectFetchStateFromStatus(loadError.status) === "not-found") {
      return (
        <div className="p-8 text-center">
          <h1 className="text-2xl font-bold text-stone-800">Project not found</h1>
          <Link href="/dashboard" className="text-stone-600 hover:underline mt-4 inline-block">
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
            className="mt-4 rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700"
          >
            Retry
          </button>
          <Link
            href="/dashboard"
            className="mt-4 block text-stone-600 hover:underline text-sm"
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
        <h1 className="text-2xl font-bold text-stone-800">Project not found</h1>
        <Link href="/dashboard" className="text-stone-600 hover:underline mt-4 inline-block">
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

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200 px-8 py-4">
        <div className="flex items-center justify-between">
          <div>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 text-sm text-stone-500 hover:text-stone-700"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Dashboard
            </Link>
            <h1 className="font-playfair text-2xl font-bold text-stone-800 mt-1">
              {project.propertyAddress}
            </h1>
            <div className="mt-1 flex items-center gap-4">
              <p className="text-sm text-stone-600">{project.clientName}</p>
              <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-700">
                {project.stagingAesthetic}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={`/preview/${project.id}`}
              className="rounded-md border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
            >
              Preview Lookbook
            </Link>
            <ExportPdfButton
              projectId={project.id}
              projectName={project.propertyAddress}
            />
          </div>
        </div>
      </header>

      <main className="p-8">
        {focusedRoom && focusedInputs && layoutMode === "focused" ? (
          /*
           * Focused single-room editing (issue #169): only this room's
           * imagery and editor render, spanning the full available content
           * width — no half-width grid card, no other rooms splitting
           * attention. The mask canvas drops its compact cap (fullWidth),
           * while the source selector (#170) and masking guidance (#171)
           * stay exactly where the editor renders them. "All rooms" is the
           * visible affordance back to the grid.
           */
          <div>
            <button
              type="button"
              onClick={() => setEditorRoomId(null)}
              className="inline-flex items-center gap-2 text-sm text-stone-500 hover:text-stone-700"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              All rooms
            </button>

            <h2 className="font-playfair text-xl font-semibold text-stone-800 mt-4">
              {focusedRoom.name}
            </h2>

            <div className="mt-6 space-y-8">
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

              {focusedRoom.beforeImageUrl ? (
                <>
                  <section aria-label="Staging directives">
                    <label
                      htmlFor={`directives-${focusedRoom.id}`}
                      className="block text-sm font-medium text-stone-700 mb-1"
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
                      className="w-full px-3 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-500 resize-none"
                    />
                    <p className="mt-1 text-xs text-stone-400 text-right">
                      {focusedInputs.roomDirectives.length}/{MAX_DIRECTIVE_LENGTH}
                    </p>
                  </section>

                  <section aria-label="AI staging">
                    <h3 className="text-sm font-semibold text-stone-800 mb-3">
                      AI Staging
                    </h3>
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
                      onSourceChange={(next) =>
                        setInpaintSourceByRoom((prev) => ({
                          ...prev,
                          [focusedRoom.id]: next,
                        }))
                      }
                      pendingRequestId={focusedInputs.pendingRequest?.id ?? null}
                      pendingSource={focusedInputs.pendingSource}
                      onInpaintComplete={(resultImageUrl, runSource) =>
                        void persistInpaintResult(
                          focusedRoom,
                          resultImageUrl,
                          runSource
                        )
                      }
                    />
                  </section>

                  {focusedInputs.staged && (
                    <section aria-label="Staged result">
                      <h3 className="text-sm font-semibold text-stone-800 mb-3">
                        Staged result
                      </h3>
                      <StagedResultImage
                        afterImageUrl={focusedInputs.staged.afterImageUrl}
                        alt={focusedInputs.staged.alt}
                        label={focusedInputs.staged.label}
                        largeImage
                      />
                      <VariantPicker
                        className="mt-3"
                        selectedIndex={focusedInputs.selectedIndex}
                        onSelect={(index) =>
                          void handleVariantSelect(focusedRoom, index)
                        }
                        variant1Label="Variant A"
                        variant2Label="Variant B"
                      />
                    </section>
                  )}

                  <section
                    aria-label="Room copy"
                    className="border-t border-stone-200 pt-4"
                  >
                    <h3 className="text-sm font-semibold text-stone-800 mb-3">
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
              ) : (
                <p className="text-sm text-stone-500">
                  Upload a room photo first to enable AI staging and copy.
                </p>
              )}
            </div>
          </div>
        ) : (
          <>
            <h2 className="font-playfair text-xl font-semibold text-stone-800 mb-6">Rooms</h2>

            {project.rooms.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed border-stone-300 p-12 text-center">
                <p className="text-stone-600">No rooms yet.</p>
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
                        <h3 className="font-medium text-stone-800">{room.name}</h3>
                        <button
                          type="button"
                          onClick={() => setEditorRoomId(room.id)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
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

                      {inputs.hasAnyCompleteVariant && (
                        <VariantPicker
                          selectedIndex={inputs.selectedIndex}
                          onSelect={(index) => void handleVariantSelect(room, index)}
                          variant1Label="Variant A"
                          variant2Label="Variant B"
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
