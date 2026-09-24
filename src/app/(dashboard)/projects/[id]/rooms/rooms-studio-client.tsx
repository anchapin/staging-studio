"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { saveProjectMetadata } from "@/app/actions/project";
import { saveRoomMetadata } from "@/app/actions/room";
import GlobalStagingDirectivesBar from "@/components/canvas/global-staging-directives-bar";
import RoomHierarchySidebar, {
  type HierarchyRoom,
  type RoomCamera,
} from "@/components/canvas/room-hierarchy-sidebar";
import { RoomBatchCardMatrix } from "@/components/canvas/room-batch-card-matrix";
import StudioWorkbench from "@/components/canvas/studio-workbench";
import WorkbenchDock from "@/components/canvas/workbench-dock";
import { StudioWorkflowStepper } from "@/components/dashboard/studio-workflow-stepper";
import type { StagedVariantPair } from "@/lib/staged-result";
import { studioStepHref } from "@/lib/studio-workflow";
import { workbenchDockStatusText } from "@/lib/workbench-layout";

interface StudioRoom {
  id: string;
  name: string;
  beforeImageUrl: string | null;
  afterImageUrl: string | null;
  beforeImageUrl2: string | null;
  afterImageUrl2: string | null;
  selectedVariantIndex: number | null;
  rawDirectives: string | null;
  activeRequestCount: number;
  stagingStatus: "idle" | "pending" | "in_progress" | "done" | "failed";
}

interface RoomsStudioClientProps {
  project: {
    id: string;
    propertyAddress: string;
    clientName: string;
    stagingAesthetic: string;
    rooms: StudioRoom[];
  };
}

const DEFAULT_LOCKS = ["Archival Molding", "Hardwood Floors", "Exposed Brick"];

function cameraStatus(
  before: string | null,
  after: string | null
): RoomCamera["status"] {
  if (after) return "ready";
  if (before) return "in-progress";
  return "pending";
}

function variantPairsOf(room: StudioRoom): [StagedVariantPair, StagedVariantPair] {
  return [
    { before: room.beforeImageUrl, after: room.afterImageUrl },
    { before: room.beforeImageUrl2, after: room.afterImageUrl2 },
  ];
}

/**
 * Step 2 — Room Batch Stage & AI Generation Studio (issue #612).
 *
 * Composes the workbench shell (issue #620): the collapsible 256px Rooms
 * & Zones hierarchy sidebar (issue #634) on the left, the Global Staging
 * Directives bar (issue #636) on top, the room card matrix (issue #622)
 * as the canvas, and the persistent bottom dock (session status +
 * "Send to Brush Refinement" → Step 3).
 */
export function RoomsStudioClient({ project }: RoomsStudioClientProps) {
  const router = useRouter();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(
    project.rooms[0]?.id ?? null
  );

  // Global Staging Directives bar state (issue #636)
  const [aesthetic, setAesthetic] = useState(project.stagingAesthetic ?? "");
  const [lockedElements, setLockedElements] = useState<string[]>(DEFAULT_LOCKS);
  const [realismValue, setRealismValue] = useState(82);

  // Per-room card state: staging intensity + prompt injection
  const [intensityByRoom, setIntensityByRoom] = useState<
    Record<string, number>
  >({});
  const [promptByRoom, setPromptByRoom] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const renderingCount = project.rooms.filter(
    (room) => room.stagingStatus === "in_progress"
  ).length;

  const readyRooms = project.rooms.filter((room) =>
    variantPairsOf(room).some((pair) => pair.after !== null)
  ).length;

  const hierarchyRooms: HierarchyRoom[] = useMemo(
    () =>
      project.rooms.map((room) => ({
        id: room.id,
        name: room.name,
        thumbnailUrl: room.beforeImageUrl,
        cameras: [
          {
            id: "0",
            label: "Cam A",
            status: cameraStatus(room.beforeImageUrl, room.afterImageUrl),
          },
          {
            id: "1",
            label: "360° Panoramic",
            status: cameraStatus(room.beforeImageUrl2, room.afterImageUrl2),
          },
        ],
        isActive: room.id === activeRoomId,
        readyVariantCount: variantPairsOf(room).filter(
          (pair) => pair.after !== null
        ).length,
      })),
    [project.rooms, activeRoomId]
  );

  const matrixRooms = useMemo(
    () =>
      project.rooms.map((room) => ({
        id: room.id,
        name: room.name,
        beforeImageUrl: room.beforeImageUrl,
        pairs: variantPairsOf(room),
        stagingIntensity: intensityByRoom[room.id] ?? 50,
        promptInjection: promptByRoom[room.id] ?? room.rawDirectives ?? "",
        selectedVariantIndex: room.selectedVariantIndex,
        cameraLabel: "Cam A" as const,
      })),
    [project.rooms, intensityByRoom, promptByRoom]
  );

  const handleAestheticChange = useCallback(
    (next: string) => {
      setAesthetic(next);
      if (next) {
        void saveProjectMetadata(project.id, { stagingAesthetic: next });
      }
    },
    [project.id]
  );

  const handleAddLock = useCallback((element: string) => {
    setLockedElements((prev) =>
      prev.includes(element) ? prev : [...prev, element]
    );
  }, []);

  const handleRemoveLock = useCallback((element: string) => {
    setLockedElements((prev) => prev.filter((item) => item !== element));
  }, []);

  /** Save Draft: persists the global aesthetic plus each room's prompt injection. */
  const handleSaveDraft = useCallback(async () => {
    setSaving(true);
    try {
      if (aesthetic) {
        await saveProjectMetadata(project.id, { stagingAesthetic: aesthetic });
      }
      await Promise.all(
        project.rooms
          .filter((room) => (promptByRoom[room.id] ?? "") !== "")
          .map((room) =>
            saveRoomMetadata(room.id, {
              rawDirectives: promptByRoom[room.id],
            })
          )
      );
    } finally {
      setSaving(false);
    }
  }, [aesthetic, project.id, project.rooms, promptByRoom]);

  /** Send to Brush Refinement advances the workflow to Step 3. */
  const handleSendToBrushRefinement = useCallback(() => {
    const target = activeRoomId ?? project.rooms[0]?.id;
    const refineHref = target
      ? `${studioStepHref(project.id, "refine")}?room=${target}`
      : studioStepHref(project.id, "refine");
    router.push(refineHref);
  }, [activeRoomId, project.id, project.rooms, router]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-outline-variant/30 bg-surface-container-lowest/95 px-6 py-3 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              aria-expanded={!sidebarCollapsed}
              aria-label={
                sidebarCollapsed
                  ? "Expand room hierarchy sidebar"
                  : "Collapse room hierarchy sidebar"
              }
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-outline-variant/40 bg-surface-container-lowest text-muted-foreground transition-colors hover:text-foreground"
            >
              {sidebarCollapsed ? (
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium uppercase tracking-wider text-muted-foreground font-jakarta">
                Step 2 of 4 — Room Batch Stage &amp; AI Generation
              </p>
              <h1 className="truncate font-playfair text-lg font-semibold text-foreground">
                {project.propertyAddress}
              </h1>
            </div>
          </div>
          <StudioWorkflowStepper
            projectId={project.id}
            activeStep="rooms"
            className="hidden md:block"
          />
        </div>
      </header>

      <StudioWorkbench
        sidebar={
          <RoomHierarchySidebar
            projectId={project.id}
            rooms={hierarchyRooms}
            onSelectRoom={setActiveRoomId}
            onAddRoom={() => router.push(`/projects/${project.id}`)}
            isCollapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
          />
        }
        topBar={
          <GlobalStagingDirectivesBar
            aesthetic={aesthetic}
            onAestheticChange={handleAestheticChange}
            lockedElements={lockedElements}
            onAddLock={handleAddLock}
            onRemoveLock={handleRemoveLock}
            realismValue={realismValue}
            onRealismChange={setRealismValue}
            roomCount={project.rooms.length}
            renderingCount={renderingCount}
            roomStatuses={project.rooms.map((room) => ({
              id: room.id,
              name: room.name,
              status: room.stagingStatus,
            }))}
            gpuActive={renderingCount > 0}
            onStartBatch={() =>
              router.push(
                `${studioStepHref(project.id, "refine")}${
                  activeRoomId ? `?room=${activeRoomId}` : ""
                }`
              )
            }
            onAutoRegenerateAll={() =>
              router.push(`/projects/${project.id}`)
            }
            onExportBatch={() =>
              router.push(studioStepHref(project.id, "report"))
            }
          />
        }
        dock={
          <WorkbenchDock
            sessionStatus={readyRooms > 0 ? "ready" : "draft"}
            statusText={workbenchDockStatusText(readyRooms, project.rooms.length)}
            onSaveDraft={() => void handleSaveDraft()}
            onSendToBrushRefinement={handleSendToBrushRefinement}
            saveDisabled={saving}
            sendDisabled={readyRooms === 0}
          />
        }
      >
        <RoomBatchCardMatrix
          rooms={matrixRooms}
          onIntensityChange={(roomId, value) =>
            setIntensityByRoom((prev) => ({ ...prev, [roomId]: value }))
          }
          onPromptInjectionChange={(roomId, value) =>
            setPromptByRoom((prev) => ({ ...prev, [roomId]: value }))
          }
          onSelectVariant={(roomId) => setActiveRoomId(roomId)}
          onGenerateVariation={(roomId) =>
            router.push(
              `${studioStepHref(project.id, "refine")}?room=${roomId}`
            )
          }
        />
      </StudioWorkbench>
    </div>
  );
}
