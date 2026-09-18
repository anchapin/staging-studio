"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import Image from "next/image";

import {
  LookbookPreviewView,
  type PreviewProject,
  type PreviewRoom,
} from "@/app/(print)/preview/[id]/lookbook-preview-view";
import ExportPdfButton from "@/components/canvas/export-pdf-button";
import {
  CoverPage,
  PhilosophyPage,
  SignoffPage,
  type ProjectData,
} from "@/components/lookbook";
import { saveRoomCopyEdits } from "@/app/actions/room";
import {
  AutosaveController,
  type AutosaveStatus,
} from "@/lib/autosave-controller";
import type { RoomCopyEditInput } from "@/lib/room-copy-edit-schema";
import { CHECKLIST_PRIORITIES } from "@/lib/checklist-schema";
import {
  resolveStagedResultDisplay,
  type StagedVariantPair,
} from "@/lib/staged-result";

import { AutoTextarea } from "./auto-textarea";

type ChecklistRow = { item: string; category: string; priority: string };
type RoomOverride = RoomCopyEditInput;

/** Statuses aggregated across every room's autosave controller. */
type SaveIndicatorState = "idle" | "saving" | "saved" | "error";

interface LookbookEditorProps {
  project: PreviewProject;
}

/**
 * Edit/Preview shell for the lookbook page (issue #250).
 *
 * Preview mode renders the exact print lookbook (`LookbookPreviewView`)
 * inside the letter-proportioned paper preview. Edit mode swaps the room
 * spreads for in-place editors: the three prose fields become
 * auto-growing textareas, checklist rows get inline text/priority
 * editors plus delete, and copy-less rooms get a generate-once button
 * (the existing `/api/generate-copy` route; no regenerate control).
 *
 * Persistence goes through one {@link AutosaveController} per room:
 * keystrokes debounce ~1s, blurs save immediately, and leaving Edit
 * mode (or exporting) flushes every room first — pending saves block
 * the transition, and failures surface as a retry state, never silent.
 */
export function LookbookEditor({ project }: LookbookEditorProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [overrides, setOverrides] = useState<Record<string, RoomOverride>>({});
  const [statuses, setStatuses] = useState<Record<string, AutosaveStatus>>({});
  const [generatingRoomId, setGeneratingRoomId] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generatedRoomIds, setGeneratedRoomIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [switching, setSwitching] = useState(false);
  const [saveBlocked, setSaveBlocked] = useState(false);

  const draftsRef = useRef(new Map<string, RoomCopyEditInput>());
  const controllersRef = useRef(
    new Map<string, AutosaveController<RoomCopyEditInput>>()
  );

  const getController = useCallback((roomId: string) => {
    let controller = controllersRef.current.get(roomId);
    if (!controller) {
      controller = new AutosaveController<RoomCopyEditInput>({
        save: async (payload) => {
          const result = await saveRoomCopyEdits(roomId, payload);
          return result.success;
        },
        onStatusChange: (status) => {
          setStatuses((prev) => ({ ...prev, [roomId]: status }));
        },
      });
      controllersRef.current.set(roomId, controller);
    }
    return controller;
  }, []);

  const editRoom = useCallback(
    (roomId: string, patch: RoomOverride) => {
      const merged = { ...(draftsRef.current.get(roomId) ?? {}), ...patch };
      draftsRef.current.set(roomId, merged);
      setOverrides((prev) => ({ ...prev, [roomId]: merged }));
      getController(roomId).edit(merged);
    },
    [getController]
  );

  const blurRoom = useCallback(
    (roomId: string) => {
      getController(roomId).blur();
    },
    [getController]
  );

  const enterEdit = useCallback(() => {
    setSaveBlocked(false);
    setMode("edit");
  }, []);

  const leaveEdit = useCallback(async () => {
    if (switching) return;
    setSwitching(true);
    try {
      const results = await Promise.all(
        [...controllersRef.current.values()].map((c) => c.flush())
      );
      if (results.some((ok) => !ok)) {
        setSaveBlocked(true);
        return;
      }
      setSaveBlocked(false);
      setMode("preview");
    } finally {
      setSwitching(false);
    }
  }, [switching]);

  const retryFailedSaves = useCallback(() => {
    for (const controller of controllersRef.current.values()) {
      if (controller.status === "error") controller.retry();
    }
  }, []);

  /**
   * Export gate: flush every room's pending autosave; abort the export
   * (false) when any edit failed to persist — Browserless must never
   * capture a stale book.
   */
  const flushBeforeExport = useCallback(async () => {
    const results = await Promise.all(
      [...controllersRef.current.values()].map((c) => c.flush())
    );
    return results.every((ok) => ok);
  }, []);

  const handleGenerate = useCallback(
    async (roomId: string) => {
      setGeneratingRoomId(roomId);
      setGenerateError(null);
      try {
        const response = await fetch("/api/generate-copy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId }),
        });
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          // The route generated the copy but failed to persist it;
          // save the returned copy here instead of regenerating.
          if (data?.error === "save_failed" && data?.copy) {
            const persisted = await saveRoomCopyEdits(roomId, {
              observedChallenge: data.copy.observedChallenge,
              recommendation: data.copy.recommendation,
              buyerPsychology: data.copy.buyerPsychology,
              checklistItems: data.copy.checklist ?? [],
            });
            if (!persisted.success) {
              throw new Error(persisted.error ?? "Failed to save copy");
            }
          } else {
            throw new Error(
              data?.message || data?.error || "Failed to generate copy"
            );
          }
        }

        setGeneratedRoomIds((prev) => new Set(prev).add(roomId));
        // Populate the editors from the generated copy immediately: in
        // production the route already persisted it server-side, and in
        // tests the route is intercepted, so neither reloads the rows.
        if (data?.data) {
          const copy = data.data;
          setOverrides((prev) => ({
            ...prev,
            [roomId]: {
              observedChallenge: copy.observedChallenge ?? "",
              recommendation: copy.recommendation ?? "",
              buyerPsychology: copy.buyerPsychology ?? "",
              checklistItems: copy.checklist ?? [],
            },
          }));
        }
        draftsRef.current.delete(roomId);
        router.refresh();
      } catch (error) {
        setGenerateError(
          error instanceof Error ? error.message : "Failed to generate copy"
        );
      } finally {
        setGeneratingRoomId(null);
      }
    },
    [router]
  );

  // Aggregated save indicator: error wins, then in-flight work, then
  // "Saved" once at least one write has landed.
  const statusList = Object.values(statuses);
  const indicator: SaveIndicatorState = statusList.includes("error")
    ? "error"
    : statusList.includes("saving") || statusList.includes("dirty")
      ? "saving"
      : statusList.includes("saved")
        ? "saved"
        : "idle";

  // Lookbook context for the edit mode (issue #250 feedback): the
  // un-editable pages stay visible around the editors.
  const projectData: ProjectData = {
    propertyAddress: project.propertyAddress,
    clientName: project.clientName,
    targetBuyer: project.targetBuyer,
    stagingAesthetic: project.stagingAesthetic,
  };
  const signoffRooms = project.rooms.map((room) => ({
    id: room.id,
    name: room.name,
    beforeImageUrl: room.beforeImageUrl,
    afterImageUrl: room.afterImageUrl,
    beforeImageUrl2: room.beforeImageUrl2,
    afterImageUrl2: room.afterImageUrl2,
    project: projectData,
    user: project.user,
  }));

  return (
    <div>
      {/* Floating chrome (issue #250 feedback): sticks to the top of the
          viewport so Edit/Preview, the save state, and Export stay
          reachable without scrolling back up. */}
      <div className="no-print sticky top-0 z-20 -mx-4 mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 bg-stone-50/95 px-4 py-3 backdrop-blur">
        <div
          role="group"
          aria-label="Lookbook mode"
          className="inline-flex rounded-md border border-stone-300 bg-white p-0.5"
        >
          <button
            type="button"
            aria-pressed={mode === "edit"}
            onClick={enterEdit}
            className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
              mode === "edit"
                ? "bg-stone-800 text-white"
                : "text-stone-700 hover:bg-stone-100"
            }`}
          >
            Edit
          </button>
          <button
            type="button"
            aria-pressed={mode === "preview"}
            onClick={() => void leaveEdit()}
            disabled={switching}
            className={`rounded px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
              mode === "preview"
                ? "bg-stone-800 text-white"
                : "text-stone-700 hover:bg-stone-100"
            }`}
          >
            Preview
          </button>
        </div>

        <div className="flex items-center gap-4">
          {mode === "edit" && (
            <div aria-live="polite" className="text-sm">
              {indicator === "error" ? (
                <span className="flex items-center gap-2 text-red-700">
                  Save failed
                  <button
                    type="button"
                    onClick={retryFailedSaves}
                    className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    Retry
                  </button>
                </span>
              ) : indicator === "saving" ? (
                <span className="text-stone-500">Saving…</span>
              ) : indicator === "saved" ? (
                <span className="text-green-700">Saved</span>
              ) : null}
            </div>
          )}

          {/* Export in Preview mode only (issue #250): the browserless
              capture must never run over unsaved edits. */}
          {mode === "preview" && (
            <ExportPdfButton
              projectId={project.id}
              projectName={project.propertyAddress}
              onBeforeExport={flushBeforeExport}
            />
          )}
        </div>
      </div>

      {saveBlocked && (
        <div
          role="alert"
          className="no-print mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          Some edits could not be saved, so Preview is unavailable. Retry the
          failed saves before leaving Edit mode.
        </div>
      )}

      {mode === "preview" ? (
        <div className="paper-preview">
          <LookbookPreviewView project={project} />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Cover + philosophy as read-only letter-proportioned cards —
              context for the copy being edited below. */}
          <div className="paper-preview">
            <CoverPage project={projectData} user={project.user} />
            <PhilosophyPage project={projectData} user={project.user} />
          </div>

          {project.rooms.map((room) => (
            <RoomCopyEditor
              key={room.id}
              room={room}
              override={overrides[room.id]}
              generating={generatingRoomId === room.id}
              generateError={
                generatingRoomId === room.id ? generateError : null
              }
              onGenerate={() => void handleGenerate(room.id)}
              canGenerate={
                !room.observedChallenge &&
                !room.recommendation &&
                !room.buyerPsychology &&
                !room.checklistItems?.length &&
                !generatedRoomIds.has(room.id)
              }
              onEdit={(patch) => editRoom(room.id, patch)}
              onBlur={() => blurRoom(room.id)}
            />
          ))}

          <div className="paper-preview">
            <SignoffPage
              user={project.user}
              project={projectData}
              rooms={signoffRooms}
            />
          </div>
        </div>
      )}
    </div>
  );
}

interface RoomCopyEditorProps {
  room: PreviewRoom;
  override?: RoomOverride;
  generating: boolean;
  generateError: string | null;
  canGenerate: boolean;
  onGenerate: () => void;
  onEdit: (patch: RoomOverride) => void;
  onBlur: () => void;
}

/**
 * One room's editable copy block: three auto-growing prose textareas,
 * the checklist rows (text + priority + delete; no add/reorder), and —
 * only while the room has no copy at all — the generate-once button.
 */
function RoomCopyEditor({
  room,
  override,
  generating,
  generateError,
  canGenerate,
  onGenerate,
  onEdit,
  onBlur,
}: RoomCopyEditorProps) {
  const observedChallenge = override?.observedChallenge ?? room.observedChallenge ?? "";
  const recommendation = override?.recommendation ?? room.recommendation ?? "";
  const buyerPsychology = override?.buyerPsychology ?? room.buyerPsychology ?? "";
  const checklistItems: ChecklistRow[] =
    override?.checklistItems ?? room.checklistItems ?? [];

  // Issue #253 selection policy, same as RoomSpread: follow
  // selectedVariantIndex, fall back A → B, legacy single-slot when
  // nothing is complete — so the imagery shown while editing matches
  // what the printed spread will show.
  const variantPairs: [StagedVariantPair, StagedVariantPair] = [
    { before: room.beforeImageUrl, after: room.afterImageUrl },
    { before: room.beforeImageUrl2, after: room.afterImageUrl2 },
  ];
  const display = resolveStagedResultDisplay(
    room.name,
    variantPairs,
    room.selectedVariantIndex ?? 0
  );
  const beforeImageUrl = display
    ? variantPairs[display.variantIndex].before
    : room.beforeImageUrl;
  const afterImageUrl = display?.afterImageUrl ?? room.afterImageUrl;

  // UI rows carry wide string types (input/select values); the server
  // action re-validates through roomCopyEditSchema before Prisma, so a
  // malformed row fails the save and surfaces as the retry state.
  const rowsAsPayload = () =>
    checklistItems as unknown as RoomCopyEditInput["checklistItems"];

  const editRow = (index: number, patch: Partial<ChecklistRow>) => {
    onEdit({
      checklistItems: checklistItems.map((row, i) =>
        i === index ? { ...row, ...patch } : row
      ) as RoomCopyEditInput["checklistItems"],
    });
  };

  const deleteRow = (index: number) => {
    onEdit({
      checklistItems: (rowsAsPayload() ?? []).filter((_, i) => i !== index),
    });
  };

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="font-playfair text-xl font-bold text-stone-800">
          {room.name}
        </h2>
        {canGenerate && (
          <div className="text-right">
            <button
              type="button"
              onClick={onGenerate}
              disabled={generating}
              className="rounded-md bg-stone-800 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-stone-700 disabled:opacity-60"
            >
              {generating ? "Generating…" : "Generate copy"}
            </button>
            {generateError && (
              <p className="mt-1 text-xs text-red-700">{generateError}</p>
            )}
          </div>
        )}
      </div>

      {/* The room's printed imagery stays visible while editing so copy
          can be written against the actual before/after photos. */}
      <div className="mb-5 grid grid-cols-2 gap-4">
        <div className="relative aspect-[4/3] overflow-hidden rounded-md bg-stone-100">
          {beforeImageUrl ? (
            <Image
              src={beforeImageUrl}
              alt={`${room.name} - Before staging`}
              fill
              sizes="(max-width: 896px) 100vw, 430px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="font-jakarta text-sm text-stone-400">Before</p>
            </div>
          )}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3">
            <p className="font-cinzel text-xs tracking-wider text-white uppercase">
              Before
            </p>
          </div>
        </div>
        <div className="relative aspect-[4/3] overflow-hidden rounded-md bg-stone-100">
          {afterImageUrl ? (
            <Image
              src={afterImageUrl}
              alt={`${room.name} - After staging`}
              fill
              sizes="(max-width: 896px) 100vw, 430px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="font-jakarta text-sm text-stone-400">After</p>
            </div>
          )}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3">
            <p className="font-cinzel text-xs tracking-wider text-white uppercase">
              After
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label
            htmlFor={`challenge-${room.id}`}
            className="mb-1 block text-sm font-medium text-stone-700"
          >
            Observed challenge · {room.name}
          </label>
          <AutoTextarea
            id={`challenge-${room.id}`}
            value={observedChallenge}
            maxLength={2000}
            onChange={(e) => onEdit({ observedChallenge: e.target.value })}
            onBlur={onBlur}
            className="w-full rounded-md border border-stone-300 p-2 text-sm focus:border-stone-500 focus:outline-none"
          />
        </div>

        <div>
          <label
            htmlFor={`recommendation-${room.id}`}
            className="mb-1 block text-sm font-medium text-stone-700"
          >
            Recommendation · {room.name}
          </label>
          <AutoTextarea
            id={`recommendation-${room.id}`}
            value={recommendation}
            maxLength={2000}
            onChange={(e) => onEdit({ recommendation: e.target.value })}
            onBlur={onBlur}
            className="w-full rounded-md border border-stone-300 p-2 text-sm focus:border-stone-500 focus:outline-none"
          />
        </div>

        <div>
          <label
            htmlFor={`psychology-${room.id}`}
            className="mb-1 block text-sm font-medium text-stone-700"
          >
            Buyer psychology · {room.name}
          </label>
          <AutoTextarea
            id={`psychology-${room.id}`}
            value={buyerPsychology}
            maxLength={2000}
            onChange={(e) => onEdit({ buyerPsychology: e.target.value })}
            onBlur={onBlur}
            className="w-full rounded-md border border-stone-300 p-2 text-sm focus:border-stone-500 focus:outline-none"
          />
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-medium text-stone-700">
            Pre-listing checklist
          </legend>
          {checklistItems.length === 0 ? (
            <p className="text-sm text-stone-400">No checklist items.</p>
          ) : (
            <ul className="space-y-2">
              {checklistItems.map((row, index) => (
                <li key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={row.item}
                    aria-label={`Checklist item ${index + 1} · ${room.name}`}
                    onChange={(e) => editRow(index, { item: e.target.value })}
                    onBlur={onBlur}
                    className="min-w-0 flex-1 rounded-md border border-stone-300 px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
                  />
                  <select
                    value={row.priority}
                    aria-label={`Priority for checklist item ${index + 1} · ${room.name}`}
                    onChange={(e) =>
                      editRow(index, { priority: e.target.value as ChecklistRow["priority"] })
                    }
                    onBlur={onBlur}
                    className="rounded-md border border-stone-300 px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
                  >
                    {CHECKLIST_PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>
                        {priority}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={`Delete checklist item ${index + 1} · ${room.name}`}
                    onClick={() => deleteRow(index)}
                    className="rounded-md border border-stone-300 px-2 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      </div>
    </section>
  );
}
