"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  LookbookPreviewView,
  type PreviewProject,
} from "@/app/(print)/preview/[id]/lookbook-preview-view";
import ExportPdfButton from "@/components/canvas/export-pdf-button";
import {
  CoverPage,
  PhilosophyPage,
  SignoffPage,
  type MaterialSwatchData,
  type ProjectData,
} from "@/components/lookbook";
import { MaterialSwatchEditor } from "./material-swatch-editor";
import { RoomCopyEditor } from "./room-copy-editor";
import { ProcurementTableEditor } from "./procurement-editor";
import {
  AutosaveController,
  type AutosaveStatus,
} from "@/lib/autosave-controller";

import { LookbookNav } from "./lookbook-nav";
import { saveRoomCopyEdits } from "@/app/actions/room";
import { saveProcurementItems } from "@/app/actions/procurement";
import type { ProcurementItemInput } from "@/app/actions/procurement";
import { type RoomCopyEditInput } from "@/lib/room-copy-edit-schema";

interface LookbookEditorProps {
  project: PreviewProject;
}

type SaveIndicatorState = AutosaveStatus;

/**
 * Lookbook editor shell.
 *
 * Composes RoomCopyEditor, MaterialSwatchEditor, and ProcurementTableEditor
 * with autosave controllers for room copy and procurement items.
 */
export function LookbookEditor({ project }: LookbookEditorProps) {
  const router = useRouter();

  // ─── Room copy autosave ────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controllersRef = useRef<Record<string, any>>({});

  const getController = useCallback(
    (roomId: string) => {
      if (!controllersRef.current[roomId]) {
        controllersRef.current[roomId] = new AutosaveController<RoomCopyEditInput>({
          save: async (payload: RoomCopyEditInput) => {
            const result = await saveRoomCopyEdits(roomId, payload);
            return result.success;
          },
          idleMs: 2000,
          onStatusChange: (status: AutosaveStatus) =>
            setStatuses((prev) => ({ ...prev, [roomId]: status })),
        });
      }
      return controllersRef.current[roomId];
    },
    []
  );

  const [overrides, setOverrides] = useState<Record<string, RoomCopyEditInput>>(
    {}
  );
  const [statuses, setStatuses] = useState<Record<string, SaveIndicatorState>>({});

  const editRoom = useCallback(
    (roomId: string, patch: Partial<RoomCopyEditInput>) => {
      const next = { ...(overrides[roomId] ?? {}), ...patch };
      setOverrides((prev) => ({ ...prev, [roomId]: next }));
      getController(roomId).edit(next);
    },
    [overrides, getController]
  );

  const blurRoom = useCallback(
    (roomId: string) => {
      getController(roomId).blur();
    },
    [getController]
  );

  // ─── Generate-copy state ──────────────────────────────────────────
  const [generatingRoomId, setGeneratingRoomId] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generatedRoomIds, setGeneratedRoomIds] = useState<Set<string>>(new Set());

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
          // The route generated the copy but failed to persist it; save
          // the returned copy here instead of regenerating.
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
        // Populate editors from generated copy immediately.
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

  // ─── Procurement autosave ─────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const procurementControllerRef = useRef<any>(
    new AutosaveController<ProcurementItemInput[]>({
      save: async (items: ProcurementItemInput[]) => {
        await saveProcurementItems(project.id, items);
        return true;
      },
      idleMs: 2000,
      onStatusChange: (status: AutosaveStatus) =>
        setStatuses((prev) => ({ ...prev, __procurement__: status })),
    })
  );
  const [procurementDraft, setProcurementDraft] = useState<ProcurementItemInput[]>(
    (project.procurementItems as ProcurementItemInput[]) ?? []
  );

  // ─── Edit/Preview mode ────────────────────────────────────────────
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const [switching, setSwitching] = useState(false);
  const [saveBlocked, setSaveBlocked] = useState(false);

  const enterEdit = useCallback(() => {
    setMode("edit");
    // Pre-create a controller + empty override for every room.
    for (const room of project.rooms) {
      getController(room.id);
      setOverrides((prev) => {
        if (prev[room.id]) return prev;
        return { ...prev, [room.id]: {} };
      });
    }
  }, [project.rooms, getController]);

  const leaveEdit = useCallback(async () => {
    if (switching) return;
    setSwitching(true);
    try {
      const flushResults = [...controllersRef.current.values()].map((c) => c.flush());
      const procurementFlush = procurementControllerRef.current.flush();
      const allVoid = flushResults.every((r) => r === undefined) && procurementFlush === undefined;
      if (allVoid) {
        setSaveBlocked(false);
        setMode("preview");
        return;
      }
      const results = await Promise.all([procurementFlush, ...flushResults]);
      const [procurementOk, ...controllerResults] = results;
      if (controllerResults.some((ok) => ok === false) || procurementOk === false) {
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
    if (procurementControllerRef.current.status === "error") {
      procurementControllerRef.current.retry();
    }
  }, []);

  const flushBeforeExport = useCallback(async () => {
    const procurementResult = procurementControllerRef.current.flush();
    const results = [...controllersRef.current.values()].map((c) => c.flush());
    const allVoid = procurementResult === undefined && results.every((r) => r === undefined);
    if (allVoid) return true;
    const [pResult, ...rResults] = await Promise.all([procurementResult, ...results]);
    return Boolean(pResult) && rResults.every((ok) => ok !== false);
  }, []);

  // Keep controllers alive in edit mode.
  useEffect(() => {
    if (mode !== "edit") return;
    const id = setInterval(() => {
      procurementControllerRef.current.tick();
      for (const c of controllersRef.current.values()) c.tick();
    }, 1000);
    return () => clearInterval(id);
  }, [mode]);

  // ─── Save indicator ───────────────────────────────────────────────
  const procurementStatus = statuses.__procurement__;
  const roomStatuses = (Object.entries(statuses)
    .filter(([k]) => k !== "__procurement__")
    .map(([, v]) => v) as AutosaveStatus[]);
  const statusList: AutosaveStatus[] = [...roomStatuses, procurementStatus].filter(
    (s): s is AutosaveStatus => Boolean(s)
  );
  const indicator: SaveIndicatorState = statusList.includes("error")
    ? "error"
    : statusList.includes("saving") || statusList.includes("dirty")
      ? "saving"
      : statusList.includes("saved")
        ? "saved"
        : "idle";

  const [showDotText, setShowDotText] = useState(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (indicator === "saved") {
      setShowDotText(true);
      if (fadeTimerRef.current !== null) clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = setTimeout(() => {
        setShowDotText(false);
        fadeTimerRef.current = null;
      }, 3000);
    } else {
      setShowDotText(false);
      if (fadeTimerRef.current !== null) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    }
    return () => {
      if (fadeTimerRef.current !== null) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
  }, [indicator]);

  // ─── Derived data ─────────────────────────────────────────────────
  const projectData: ProjectData = {
    propertyAddress: project.propertyAddress,
    clientName: project.clientName,
    targetBuyer: project.targetBuyer,
    stagingAesthetic: project.stagingAesthetic,
    clientSignature: project.clientSignature,
    clientSignatureStatus: project.clientSignatureStatus,
    clientSignatureTimestamp: project.clientSignatureTimestamp
      ? String(project.clientSignatureTimestamp)
      : null,
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

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <div>
      {/* Floating chrome */}
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
            <div
              aria-live="polite"
              className="flex items-center gap-1.5"
            >
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  indicator === "saved"
                    ? "bg-tertiary"
                    : indicator === "saving"
                      ? "bg-secondary animate-pulse"
                      : indicator === "error"
                        ? "bg-destructive"
                        : "bg-outline"
                }`}
                aria-hidden="true"
              />
              {indicator === "error" ? (
                <span className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-destructive">
                    Save failed — Retry
                  </span>
                  <button
                    type="button"
                    onClick={retryFailedSaves}
                    className="rounded-md border border-destructive/40 px-2 py-0.5 text-xs font-medium text-destructive hover:bg-destructive/5"
                  >
                    Retry
                  </button>
                </span>
              ) : indicator === "saving" ? (
                <span className="text-xs text-secondary font-medium">
                  Saving...
                </span>
              ) : indicator === "saved" && showDotText ? (
                <span className="text-xs text-tertiary font-medium">
                  Saved
                </span>
              ) : null}
            </div>
          )}

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
        <div>
          <LookbookNav
            rooms={project.rooms.map((r) => ({ id: r.id, name: r.name }))}
            hasSwatches={project.materialSwatches.length > 0}
          />
          <div className="paper-preview">
            <LookbookPreviewView project={project} />
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Cover + philosophy as read-only cards */}
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

          {/* Material Swatches */}
          <div id="lookbook-swatches">
            <MaterialSwatchEditor
              projectId={project.id}
              swatches={project.materialSwatches as MaterialSwatchData[]}
            />
          </div>

          {/* Procurement table */}
          <ProcurementTableEditor
            items={procurementDraft}
            onChange={(items) => {
              setProcurementDraft(items);
              procurementControllerRef.current.edit(items);
            }}
          />

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
