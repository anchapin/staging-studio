"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, PencilRuler, X } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { ComparisonSlider } from "@/components/canvas/comparison-slider";
import RoomCanvas from "@/components/canvas/room-canvas";
import InpaintEditor from "@/components/canvas/inpaint-editor";
import { VariantPicker } from "@/components/canvas/variant-picker";
import GenerateCopyForm, {
  type GeneratedCopy,
} from "@/components/canvas/generate-copy-form";
import ExportPdfButton from "@/components/canvas/export-pdf-button";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { saveVariantSelection } from "@/app/actions/room";
import { projectFetchStateFromStatus } from "@/lib/project-fetch-state";

const MAX_DIRECTIVE_LENGTH = 2000;

interface Room {
  id: string;
  name: string;
  beforeImageUrl: string | null;
  afterImageUrl: string | null;
  beforeImageUrl2: string | null;
  afterImageUrl2: string | null;
  selectedVariantIndex: number | null;
  inpaintRequests?: { id: string }[];
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

function isComplete(pair: VariantPair): pair is { before: string; after: string } {
  return Boolean(pair.before && pair.after);
}

/**
 * Which variant slot a fresh inpaint result should land in: the first empty
 * "after" slot, or — when both are full — the slot NOT currently selected,
 * so the lookbook selection stays stable.
 */
function pickVariantSlot(room: Room): 0 | 1 {
  if (!room.afterImageUrl) return 0;
  if (!room.afterImageUrl2) return 1;
  return room.selectedVariantIndex === 1 ? 0 : 1;
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
      if (!isComplete(pair)) {
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
    async (room: Room, resultImageUrl: string) => {
      const slot = pickVariantSlot(room);
      const body =
        slot === 0
          ? { afterImageUrl: resultImageUrl, selectedVariantIndex: 0 }
          : {
              beforeImageUrl2: room.beforeImageUrl,
              afterImageUrl2: resultImageUrl,
              selectedVariantIndex: 1,
            };

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
            void persistInpaintResult(room, resultImageUrl);
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
        <h2 className="font-playfair text-xl font-semibold text-stone-800 mb-6">Rooms</h2>

        {project.rooms.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-stone-300 p-12 text-center">
            <p className="text-stone-600">No rooms yet.</p>
          </div>
        ) : (
          <div className="grid gap-8 md:grid-cols-2">
            {project.rooms.map((room) => {
              const pairs = variantPairsOf(room);
              const selectedIndex = room.selectedVariantIndex ?? 0;
              const displayIndex = isComplete(pairs[selectedIndex])
                ? selectedIndex
                : isComplete(pairs[0])
                  ? 0
                  : 1;
              const displayPair = pairs[displayIndex];
              const hasAnyCompleteVariant = pairs.some(isComplete);
              const isEditorOpen = editorRoomId === room.id;
              const roomDirectives = directives[room.id] ?? "";

              return (
                <div key={room.id} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-stone-800">{room.name}</h3>
                    <button
                      onClick={() => setEditorRoomId(isEditorOpen ? null : room.id)}
                      aria-expanded={isEditorOpen}
                      className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
                    >
                      {isEditorOpen ? (
                        <>
                          <X className="w-4 h-4" />
                          Close editor
                        </>
                      ) : (
                        <>
                          <PencilRuler className="w-4 h-4" />
                          Edit staging
                        </>
                      )}
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

                  {isComplete(displayPair) && (
                    <ComparisonSlider
                      roomName={room.name}
                      originalImage={displayPair.before}
                      variantImage={displayPair.after}
                    />
                  )}

                  {hasAnyCompleteVariant && (
                    <VariantPicker
                      selectedIndex={selectedIndex}
                      onSelect={(index) => void handleVariantSelect(room, index)}
                      variant1Label="Variant A"
                      variant2Label="Variant B"
                    />
                  )}

                  {isEditorOpen && (
                    <div className="rounded-lg border border-stone-200 bg-white p-4 space-y-6">
                      {room.beforeImageUrl ? (
                        <>
                          <div>
                            <label
                              htmlFor={`directives-${room.id}`}
                              className="block text-sm font-medium text-stone-700 mb-1"
                            >
                              Staging directives (required)
                            </label>
                            <textarea
                              id={`directives-${room.id}`}
                              value={roomDirectives}
                              onChange={(e) =>
                                setDirectives((prev) => ({
                                  ...prev,
                                  [room.id]: e.target.value,
                                }))
                              }
                              maxLength={MAX_DIRECTIVE_LENGTH}
                              rows={3}
                              placeholder="e.g. Add a neutral linen sofa, warm wood coffee table, and layered lighting..."
                              className="w-full px-3 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-500 resize-none"
                            />
                            <p className="mt-1 text-xs text-stone-400 text-right">
                              {roomDirectives.length}/{MAX_DIRECTIVE_LENGTH}
                            </p>
                          </div>

                          <div>
                            <h4 className="text-sm font-semibold text-stone-800 mb-3">
                              AI Staging
                            </h4>
                            <InpaintEditor
                              roomId={room.id}
                              imageUrl={room.beforeImageUrl}
                              aesthetic={project.stagingAesthetic}
                              promptDirectives={roomDirectives.trim()}
                              variantSlot={pickVariantSlot(room)}
                              pendingRequestId={room.inpaintRequests?.[0]?.id ?? null}
                              onInpaintComplete={(resultImageUrl) =>
                                void persistInpaintResult(room, resultImageUrl)
                              }
                            />
                          </div>

                          <div className="border-t border-stone-200 pt-4">
                            <h4 className="text-sm font-semibold text-stone-800 mb-3">
                              Room Copy
                            </h4>
                            <GenerateCopyForm
                              roomId={room.id}
                              initialDirectives={roomDirectives}
                              onCopyGenerated={(
                                _copy: GeneratedCopy,
                                rawDirectives: string
                              ) =>
                                // The form saves directives before generating;
                                // mirror them into the inpaint editor's state.
                                setDirectives((prev) => ({
                                  ...prev,
                                  [room.id]: rawDirectives,
                                }))
                              }
                            />
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-stone-500">
                          Upload a room photo first to enable AI staging and copy.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
