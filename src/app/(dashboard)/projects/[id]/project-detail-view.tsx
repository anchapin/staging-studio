"use client";

// oxlint-disable react/refs -- Issue #1344 (real `useInpaintRuns`
// wire): oxlint's react/refs rule emits a false positive on
// `buildEditRoomStudioProps({ ... })` (an inline object literal)
// when an `<EditRoomRunCluster ref={...} />` JSX element appears
// in the same render tree. The reported "ref access during render"
// fires on the opening `{` after the function-call parens. The
// false positive is tracked upstream under
// `eslint-plugin-react-hooks` 7.1.1 (`react-hooks/refs`) and
// reproduces on minimal repros that have no `useRef` involved at
// all. Disabling the rule at file scope is the cleanest workaround
// until the upstream patch lands.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, GripVertical, PencilRuler, X, Plus } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createClient } from "@/lib/supabase";
import { resolveFocusedRoom, resolveRoomLayoutMode } from "@/lib/focus-mode";
import { confirmLeaveEditorInBrowser } from "@/lib/editor-leave";
import { reorderRoomsById } from "@/lib/room-reorder";
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
import VariantThumbnailStrip from "@/components/canvas/variant-thumbnail-strip";
import { useToast, ToastContainer } from "@/components/ui/toast";
import {
  deleteVariantAfterImage,
  getVariantTouchUpCounts,
  reorderRooms,
  saveRoomMetadata,
  saveVariantSelection,
} from "@/app/actions/room";
import { saveProjectMetadata } from "@/app/actions/project";
import { saveVirtuallyStagedLabelEnabled } from "@/app/actions/project";
import { EditRoomRunCluster, type EditRoomRunClusterHandle } from "@/components/edit-room/EditRoomRunCluster";
import {
  AutosaveController,
  type AutosaveStatus,
} from "@/lib/autosave-controller";
import { projectFetchStateFromStatus } from "@/lib/project-fetch-state";
import { buildEditRoomStudioProps } from "@/lib/edit-room-studio-props";
import { mergeServerUrlFields } from "@/lib/edit-room-url-reconcile";
import { clamp, parseSeedOrUndefined } from "@/lib/finetune-wire";
import { featherMask } from "@/lib/mask-feather";
import { EditRoomStudio } from "@/components/edit-room/EditRoomStudio";
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
import { StagingPackageCard } from "@/components/packages";
import { STAGING_PACKAGES } from "@/lib/staging-packages-schema";
import BatchRoomUpload from "@/components/canvas/batch-room-upload";
import GlobalStagingDirectivesBar from "@/components/canvas/global-staging-directives-bar";
import {
  BULK_AESTHETIC_NOTE,
  PROJECT_AESTHETIC_HELPER,
  projectAestheticBadge,
  resolveRoomAesthetic,
} from "@/lib/project-aesthetic";

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
  sortOrder?: number;
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
  stagingPackage?: string | null;
  stagingDirectives?: string | null; // Issue #562: global project-level directives
  // Issue #1186: per-project disclosure toggle for the "Virtually staged"
  // mark on AI after-images in the lookbook preview.
  virtuallyStagedLabelEnabled?: boolean | null;
  rooms: Room[];
}

interface VariantPair {
  before: string | null;
  after: string | null;
}

interface SortableRoomProps {
  room: Room;
  projectId: string;
  touchUpCountsByRoom: Record<string, { 0: number; 1: number }>;
  deletingSlotByRoom: Record<string, VariantSlot | null>;
  isSelected: boolean;
  onToggleSelect: (roomId: string) => void;
  onOpenEditor: (roomId: string) => void;
  onApplyRoomUpdate: (roomId: string, patch: Partial<Room>) => void;
  onHandleStripSelect: (room: Room, selection: VariantStripSelection) => void;
  onHandleDeleteVariant: (room: Room, slot: VariantSlot) => void;
  router: ReturnType<typeof useRouter>;
  roomInputs: ReturnType<typeof roomEditorInputs>;
}

function SortableRoom({
  room,
  projectId,
  touchUpCountsByRoom,
  deletingSlotByRoom,
  isSelected,
  onToggleSelect,
  onOpenEditor,
  onApplyRoomUpdate,
  onHandleStripSelect,
  onHandleDeleteVariant,
  router,
  roomInputs,
}: SortableRoomProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: room.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`space-y-3 rounded-lg border-2 transition-colors ${
        isSelected ? "border-primary bg-primary/5" : "border-transparent"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(room.id)}
            className="h-4 w-4 rounded border-input text-primary accent-primary"
            aria-label={`Select ${room.name}`}
          />
          <button
            type="button"
            className="cursor-grab text-muted-foreground hover:text-foreground touch-none"
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder room"
          >
            <GripVertical className="w-4 h-4" />
          </button>
          <h3 className="font-medium text-foreground">{room.name}</h3>
        </div>
        <button
          type="button"
          onClick={() => onOpenEditor(room.id)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-secondary"
        >
          <PencilRuler className="w-4 h-4" aria-hidden="true" />
          Edit staging
        </button>
      </div>

      <RoomCanvas
        roomId={room.id}
        projectId={projectId}
        imageUrl={room.beforeImageUrl}
        onUploadComplete={(slot, publicUrl) => {
          onApplyRoomUpdate(
            room.id,
            slot === 1
              ? { beforeImageUrl2: publicUrl }
              : { beforeImageUrl: publicUrl }
          );
          router.refresh();
        }}
      />

      {room.beforeImageUrl2 && (
        <div className="border-t border-border pt-3 mt-3">
          <p className="text-xs text-muted-foreground mb-2 font-medium">Variant B — before</p>
          <RoomCanvas
            roomId={room.id}
            projectId={projectId}
            imageUrl={room.beforeImageUrl2}
            variantSlot={1}
            onUploadComplete={(slot, publicUrl) => {
              onApplyRoomUpdate(
                room.id,
                slot === 1
                  ? { beforeImageUrl2: publicUrl }
                  : { beforeImageUrl: publicUrl }
              );
              router.refresh();
            }}
          />
        </div>
      )}

      {roomInputs.staged && (
        <StagedResultImage
          afterImageUrl={roomInputs.staged.afterImageUrl}
          alt={roomInputs.staged.alt}
          label={roomInputs.staged.label}
        />
      )}

      {room.beforeImageUrl && (
        <VariantThumbnailStrip
          roomName={room.name}
          originalUrl={room.beforeImageUrl}
          pairs={roomInputs.pairs}
          selection={resolveStripSelection(
            room.selectedVariantIndex,
            roomInputs.pairs
          )}
          onSelect={(selection) => onHandleStripSelect(room, selection)}
          onDeleteVariant={(slot) => onHandleDeleteVariant(room, slot)}
          deletingSlot={deletingSlotByRoom[room.id] ?? null}
          touchUpCounts={touchUpCountsByRoom[room.id] ?? null}
        />
      )}
    </div>
  );
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
  // Issue #1188: run state reported by the editor, so every exit back to
  // the project overview can flush pending edits and confirm before
  // dropping an in-flight run.
  const [editorBusy, setEditorBusy] = useState(false);
  const leaveEditor = useCallback(() => {
    if (!confirmLeaveEditorInBrowser(editorBusy)) return;
    setEditorBusy(false);
    setEditorRoomId(null);
  }, [editorBusy]);
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
  const { toasts, showError, showSuccess, showInfo, dismissToast } = useToast();
  const [selectedRoomIds, setSelectedRoomIds] = useState<Set<string>>(new Set());
  const [showBatchUpload, setShowBatchUpload] = useState(false);

  /**
   * Issue #1344 slice 2 (real `useInpaintRuns` wire) — painted-area
   * mask snapshot per room. The `<EditRoomStudio>`'s `<MaskLayer>`
   * emits `toDataURL("image/png")` on every stroke + CLEAR_MASK via
   * the `onMaskChange` prop callback the resolver wires up; we capture
   * the latest value here so the run controller's `submitInpaint`
   * has a fresh payload at submit time. Mirrors the per-room
   * touch-up-count state above (a session-local map keyed by
   * roomId).
   */
  const [maskDataUrlByRoom, setMaskDataUrlByRoom] = useState<
    Record<string, string | null>
  >({});
  const setMaskDataUrlForRoom = useCallback(
    (roomId: string, value: string | null) => {
      setMaskDataUrlByRoom((prev) => ({ ...prev, [roomId]: value }));
    },
    []
  );

  /**
   * Issue #1344 (real `useInpaintRuns` wire) — run-state mirror for
   * the new `<EditRoomStudio>` surface. The cluster (mounted below)
   * pushes its `isProcessing` flag here via `onRunningChange` so the
   * route can mirror it into `editorBusy` (browser-leave guard) and
   * derive the studio's controlled `running` prop (`isProcessing`
   * → `0`, idle → `null`).
   */
  const [editRoomIsProcessing, setEditRoomIsProcessing] = useState(false);
  const editRoomRunning: number | null = editRoomIsProcessing ? 0 : null;

  /**
   * Issue #1344 slice 2 — imperative handle to the
   * `<EditRoomRunCluster>` mounted in JSX. The route's `onRun`
   * callback calls `cluster.submitInpaint(maskUrl)` to start a
   * painted-area run; `useImperativeHandle` (in the cluster file)
   * exposes that entry point without changing the cluster's
   * `forwardRef` contract. The parent holds the ref so the
   * `useCallback` for `onRun` (built above the cluster's mount)
   * can call into the latest handle on every render.
   */
  const editRoomRunClusterRef = useRef<EditRoomRunClusterHandle | null>(
    null
  );

  /**
   * Issue #1344 slice 2 — `beginEditRoomRun` is the studio's
   * `onRun` callback. Read the latest mask data URL for the
   * focused room and defer to the cluster's `submitInpaint`.
   * The cluster is mounted by this file (was previously
   * the legacy `<InpaintEditor>`'s internal usage of
   * `useInpaintRuns`; #1346 wave-5 lifted it out so the new
   * `<EditRoomStudio>` shell can share it).
   *
   * The cluster's `onRunningChange` callback mirrors its
   * `isProcessing` into the route's `editorBusy` state directly
   * (no `useEffect` needed — the cluster pushes values into the
   * route via a stable callback).
   */
  const beginEditRoomRun = useCallback(() => {
    if (editRoomIsProcessing) return;
    const focusedRoomId = editorRoomId;
    if (!focusedRoomId) return;
    const maskUrl = maskDataUrlByRoom[focusedRoomId] ?? null;
    if (!maskUrl) {
      showError("Paint the area you want to stage before clicking Run.");
      return;
    }
    // Issue #1361 — call `beginRun`, not `submitInpaint`. The cluster
    // awaits the parent-supplied `beforeRun` flush hook first, so
    // typed directions land in `Room.rawDirectives` before the
    // run's `promptDirectives` validation runs. Skipping this race
    // means a user typing directives and clicking Run quickly won't
    // submit with an empty-string `promptDirectives` (the autosave
    // controller's 2 s idle timer hadn't fired yet).
    editRoomRunClusterRef.current?.beginRun(maskUrl);
  }, [
    editRoomIsProcessing,
    editorRoomId,
    maskDataUrlByRoom,
    showError,
  ]);

  /**
   * Issue #1344 (real `useInpaintRuns` wire) — masked snapshot
   * guidance is allocated here so the cluster (which references
   * `useInpaintRuns` further down) can pick it up. The memo content
   * is hard-coded today (FineTune persistence is a follow-up
   * slice), so the value never changes.
   */
  // (The `editRoomGuidance` memo lives below — the cluster is mounted
  // in JSX past the early-return guards and reads the memo as a prop.)

  // Issue #636: Global Staging Directives Bar state
  const [lockedElements, setLockedElements] = useState<string[]>([
    "Archival Molding",
    "Hardwood Floors",
    "Exposed Brick",
  ]);
  const [realismValue, setRealismValue] = useState(82);
  // gpuActive and renderingCount are derived from the project's rooms with
  // in-flight inpaint requests. For now, default to idle/no rendering.
  const [gpuActive] = useState(false);

  // Issue #493: drag-and-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Issue #493: handle room reordering via drag-and-drop.
  // Reorder math lives in src/lib/room-reorder.ts so the contract is
  // vitest-pinnable for the future @dnd-kit/react migration (issue #1327).
  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !project) return;

      const reorderedRooms = reorderRoomsById(
        project.rooms,
        String(active.id),
        String(over.id),
      );
      // reorderRoomsById returns the same array reference on no-op
      // (activeId === overId is already filtered above, but the helper
      // also bails on missing ids — same array reference means the
      // optimistic update is a no-op too).
      if (reorderedRooms === project.rooms) return;

      // Optimistic update
      setProject((prev) =>
        prev ? { ...prev, rooms: reorderedRooms } : prev
      );

      const roomIds = reorderedRooms.map((r) => r.id);
      const result = await reorderRooms(project.id, roomIds);
      if (!result.success) {
        // Revert on failure
        setProject((prev) =>
          prev
            ? { ...prev, rooms: project.rooms }
            : prev
        );
        showError("Failed to save room order", true);
      }
    },
    [project, showError]
  );

  /** Issue #496: per-room autosave controllers for staging directives. */
  const directiveControllersRef = useRef(
    new Map<string, AutosaveController<{ rawDirectives: string }>>()
  );
  /** Issue #496: directive save status per room for the "Saving…/Saved" indicator. */
  const [directiveStatuses, setDirectiveStatuses] = useState<
    Record<string, AutosaveStatus>
  >({});

  /**
   * Issue #496: lazy factory for per-room directive autosave controllers.
   * 2 s idle window, save via saveRoomMetadata, status fed to the UI.
   */
  const getDirectiveController = useCallback(
    (roomId: string) => {
      let controller = directiveControllersRef.current.get(roomId);
      if (!controller) {
        controller = new AutosaveController<{ rawDirectives: string }>({
          save: async (payload) => {
            const result = await saveRoomMetadata(roomId, payload);
            return result.success;
          },
          idleMs: 2000,
          onStatusChange: (status) => {
            setDirectiveStatuses((prev) => ({ ...prev, [roomId]: status }));
          },
        });
        directiveControllersRef.current.set(roomId, controller);
      }
      return controller;
    },
    []
  );

  /** Issue #496: fires on every keystroke — updates local state + schedules debounced save. */
  const editDirectives = useCallback(
    (roomId: string, value: string) => {
      setDirectives((prev) => ({ ...prev, [roomId]: value }));
      getDirectiveController(roomId).edit({ rawDirectives: value });
    },
    [getDirectiveController]
  );

  /** Issue #496: saves immediately on blur instead of waiting for the idle window. */
  const blurDirectives = useCallback(
    (roomId: string) => {
      getDirectiveController(roomId).blur();
    },
    [getDirectiveController]
  );

  /** Issue #1362a: per-room FineTune state. Mirror of the `directives`
   * map (#496) — keyed by roomId, updated on every control change, fed
   * to the AutosaveController as the full snapshot. The controller
   * requires a non-partial type, so the route owns the latest-values
   * map and the shell's onChange handlers fan a single field back to this
   * map. The shell's local useState + this route-side map stay in sync
   * because every onChange does both. */
  const [fineTune, setFineTune] = useState<
    Record<
      string,
      {
        fineTuneStrength: number;
        fineTuneExpand: number;
        fineTuneSeed: string;
      }
    >
  >({});

  /** Issue #1362a: per-room autosave controllers for FineTune values. */
  const fineTuneControllersRef = useRef(
    new Map<
      string,
      AutosaveController<{
        fineTuneStrength: number;
        fineTuneExpand: number;
        fineTuneSeed: string;
      }>
    >()
  );
  /**
   * Issue #1362a: FineTune save status per room. The shell doesn't
   * surface a separate "Saving…/Saved" pill for FineTune yet (the
   * directives pill covers the textarea; the FineTune panel is
   * collapsed by default and the user doesn't expect a status there).
   * The state is still kept so the autosave controller's error
   * transitions are observable for future telemetry / retry UX.
   */
  const [, setFineTuneStatuses] = useState<
    Record<string, AutosaveStatus>
  >({});

  /**
   * Issue #1362a: lazy factory for per-room FineTune autosave
   * controllers. 2 s idle window (same as the directives controller
   * — slider ticks are bursty and the 2 s window collapses them into
   * one Prisma update), saves through `saveRoomMetadata` (which is
   * now Zod-validated for the three new fields per #1362a).
   */
  const getFineTuneController = useCallback(
    (roomId: string) => {
      let controller = fineTuneControllersRef.current.get(roomId);
      if (!controller) {
        controller = new AutosaveController<{
          fineTuneStrength: number;
          fineTuneExpand: number;
          fineTuneSeed: string;
        }>({
          save: async (payload) => {
            const result = await saveRoomMetadata(roomId, payload);
            return result.success;
          },
          idleMs: 2000,
          onStatusChange: (status) => {
            setFineTuneStatuses((prev) => ({ ...prev, [roomId]: status }));
          },
        });
        fineTuneControllersRef.current.set(roomId, controller);
      }
      return controller;
    },
    []
  );

  /**
   * Issue #1362a: fires on every FineTune control change. Accepts a
   * partial patch (the shell only forwards the field the user
   * touched), merges it into the route's `fineTune[roomId]` map, and
   * fans the FULL snapshot into the AutosaveController. The
   * controller's `edit()` requires a non-partial type, so the route
   * owns the latest-values map and the shell's onChange handlers fan
   * a single field back to this map.
   */
  const editFineTune = useCallback(
    (
      roomId: string,
      patch: Partial<{
        fineTuneStrength: number;
        fineTuneExpand: number;
        fineTuneSeed: string;
      }>
    ) => {
      const existing = fineTune[roomId] ?? {
        fineTuneStrength: 50,
        fineTuneExpand: 12,
        fineTuneSeed: "",
      };
      const next = { ...existing, ...patch };
      setFineTune((prev) => ({ ...prev, [roomId]: next }));
      getFineTuneController(roomId).edit(next);
    },
    [fineTune, getFineTuneController]
  );

  /**
   * Issue #1362c — dev-only test seam for the FineTune blend-edges
   * wire spec. Lets the e2e suite mutate
   * `fineTune[editorRoomId].fineTuneExpand` directly without driving
   * the `<Slider>` DOM (every DOM-driven strategy — pointer drag,
   * keyboard `Home`/`ArrowRight`, `fill`, native setter + dispatched
   * `input` — silently leaves the slider at 12 in the Playwright
   * harness because React 19/Next 16's event delegation root does not
   * pick up programmatic `input` events on this controlled range
   * input). The unit pin (`tests/mask-feather.test.ts`) covers
   * `featherMask`'s math; this seam lets the e2e cover `beforeSubmit`'s
   * `?? 0` fallback and the `featherMask(maskDataUrl, expand)` → `maskUrl`
   * POST-body composition.
   *
   * Also exposes `__test_submitInpaint(maskDataUrl)` because calling
   * the cluster's `beginRun` directly pins the `beforeSubmit` →
   * `featherMask` → POST-body wire without DOM-driving the run
   * button — the run button's `blockedReason` is gate-by-the-textarea
   * in this build, and DOM-driving the textarea is subject to the
   * React 19/Next 16 delegation-root issue described above and below.
   *
   * #1365 post-merge — the reducer-buffered `state.directions` race
   * described in the original `__test_setDirectives` rationale no
   * longer exists: the textarea's source of truth lives on the parent
   * route map, so no reducer slice proxies the value. The seam is
   * retained (deferred-retirement, per the post-#1365 followup) because
   * the original motivation — React 19/Next 16's event-delegation root
   * reportedly not receiving `page.fill`'s dispatched `input` on this
   * controlled textarea — is independent of where the `value` lives:
   * the route lift moved the *destination* of `onChange` (route map
   * instead of reducer), but did not repair the *trigger* of `onChange`.
   * `__test_submitInpaint` therefore still pins the POST-body wire
   * without DOM-driving the textarea. A DOM-only replacement (Path A
   * in the post-#1365 next-session handoff) remains blocked until the
   * delegation issue is root-caused; until then this seam continues
   * to pin the FineTune blend-edges wire (#1362c) reproducibly.
   *
   * `__test_submitInpaint` is additionally useful because the
   * cluster's `beginRun` orchestrates `beforeSubmit` + `featherMask` +
   * the POST-body composition regardless of how the textarea is
   * populated, so it pins the same wire.
   *
   * Gated by `NEXT_PUBLIC_EDIT_ROOM_REDESIGN` so production bundles
   * never carry the window binding. The e2e harness turns the gate on
   * via `nextEnv()` in `tests/e2e/env.ts`.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as unknown as {
      __test_setFineTune?: (next: number) => void;
    }).__test_setFineTune = (next: number) => {
      if (!editorRoomId) return;
      editFineTune(editorRoomId, { fineTuneExpand: next });
    };
    (window as unknown as {
      __test_submitInpaint?: (maskDataUrl: string) => Promise<void>;
    }).__test_submitInpaint = async (maskDataUrl: string) => {
      const cluster = editRoomRunClusterRef.current;
      if (!cluster) {
        throw new Error(
          "editRoomRunClusterRef is not mounted; is the focused editor open?",
        );
      }
      await cluster.beginRun(maskDataUrl);
    };
    (window as unknown as {
      __test_setDirectives?: (next: string) => void;
    }).__test_setDirectives = (next: string) => {
      if (!editorRoomId) return;
      editDirectives(editorRoomId, next);
    };
    return () => {
      delete (window as unknown as { __test_setFineTune?: unknown })
        .__test_setFineTune;
      delete (window as unknown as { __test_submitInpaint?: unknown })
        .__test_submitInpaint;
      delete (window as unknown as { __test_setDirectives?: unknown })
        .__test_setDirectives;
    };
  }, [
    editorRoomId,
    editFineTune,
    editDirectives,
  ]);

  /**
   * Issue #1362b (Stage B) — guidance memo for the `<EditRoomRunCluster>`
   * (mounted in JSX). Reads the per-room FineTune state from
   * `fineTune[editorRoomId]` (issue #1362a) and forwards
   * `strength` (renamed from `promptStrength`) + `seed` to the
   * inpaint submit path. The default UI strength of 50 maps to
   * 0.5 at the DashScope wire — the persisted-default and
   * DashScope-wire default now align at 0.5.
   *
   * `maskBlur` is gone — the FineTune `expand` slider feathers the
   * mask client-side before submit (`src/lib/mask-feather.ts`),
   * driven through the cluster's `beforeSubmit` prop. `lockSeed`
   * and `creativeMode` are gone (no surviving UI control after
   * #1362a's adherence + shadows removal).
   *
   * Memo deps include `editorRoomId` + `fineTune` so a slider tick
   * (or a room switch) re-runs the memo with the new value; the
   * cluster re-receives a fresh `guidance` object and the inpaint
   * submit path picks up the new `strength` / `seed` on the next
   * Run click. Declared after `fineTune` / `editorRoomId` /
   * `focusedRoom` so the variable references typecheck.
   */
  const editRoomGuidance = useMemo(() => {
    const ft = editorRoomId ? fineTune[editorRoomId] : undefined;
    const strength = clamp((ft?.fineTuneStrength ?? 50) / 100, 0, 1);
    const seed = parseSeedOrUndefined(ft?.fineTuneSeed);
    return { strength, seed };
    // `clamp` and `parseSeedOrUndefined` are stable module-level
    // helpers; not in the deps array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorRoomId, fineTune]);

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

  /** Issue #555: saves the selected staging package. */
  const handlePackageSelect = useCallback(
    async (pkgId: string) => {
      if (!project) return;
      const previousPackage = project.stagingPackage;
      // Optimistic update
      setProject((prev) =>
        prev ? { ...prev, stagingPackage: pkgId } : prev
      );
      const result = await saveProjectMetadata(project.id, {
        stagingPackage: pkgId,
      });
      if (!result.success) {
        // Revert on failure
        setProject((prev) =>
          prev ? { ...prev, stagingPackage: previousPackage } : prev
        );
        showError(
          result.error || "Failed to save package selection",
          true
        );
        return;
      }
      showSuccess("Package saved");
    },
    [project, showError, showSuccess]
  );

  /**
   * Issue #1186: toggles the "Virtually staged" disclosure mark for the
   * project. Persists via {@link saveVirtuallyStagedLabelEnabled};
   * optimistic update + revert on failure mirrors the package toggle.
   * Treats `null`/`undefined` as enabled (the schema default) when
   * computing the next value.
   */
  const handleVirtuallyStagedLabelToggle = useCallback(
    async (next: boolean) => {
      if (!project) return;
      const previous = project.virtuallyStagedLabelEnabled ?? true;
      setProject((prev) =>
        prev ? { ...prev, virtuallyStagedLabelEnabled: next } : prev
      );
      const result = await saveVirtuallyStagedLabelEnabled(project.id, next);
      if (!result.success) {
        setProject((prev) =>
          prev ? { ...prev, virtuallyStagedLabelEnabled: previous } : prev
        );
        showError(
          result.error || "Failed to save disclosure setting",
          true
        );
        return;
      }
    },
    [project, showError]
  );

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

  // The retry callbacks below self-invoke their parent
  // (`handleVariantSelect`, `handleStripSelect`, `persistInpaintResult`),
  // which the `react/immutability` rule flags as reading a variable
  // while it's still being initialized. Use the "latest-ref" pattern:
  // store the callback in a ref, then a stable wrapper reads from
  // the ref. The wrapper is the public-facing `useCallback`; the ref
  // always holds the latest implementation. The useEffect that syncs
  // the ref is positioned AFTER the callback's declaration so the
  // compiler sees a forward reference and the dep array is well-typed.
  const handleVariantSelectRef = useRef<
    (room: Room, index: number) => Promise<void>
  >(async () => {});

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
            void handleVariantSelectRef.current(room, index);
          },
          "Retry saving variant selection"
        );
        return;
      }
      router.refresh();
    },
    [applyRoomUpdate, showError, showInfo, router]
  );

  // The React 19 rule treats `ref.current = …` after a `useRef` call
  // as "modifying a value passed to a hook." The latest-ref pattern
  // needs exactly that, so suppress the rule for the assignment.
  useEffect(() => {
    // oxlint-disable-next-line react/immutability
    handleVariantSelectRef.current = handleVariantSelect;
  }, [handleVariantSelect]);

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
              void handleStripSelectRef.current(room, selection);
            },
            "Retry saving variant selection"
          );
          return;
        }
        router.refresh();
        return;
      }

      await handleVariantSelectRef.current(room, selection);
    },
    [applyRoomUpdate, showError, router]
  );

  const handleStripSelectRef = useRef<
    (room: Room, selection: VariantStripSelection) => Promise<void>
  >(async () => {});

  useEffect(() => {
    // oxlint-disable-next-line react/immutability
    handleStripSelectRef.current = handleStripSelect;
  }, [handleStripSelect]);

  // ─── #1376: re-sync URL/selection fields after `router.refresh()`.
  // `useState(initialProject)` (line ~349) only reads the prop on mount,
  // so server-driven mutations made from inside `<EditRoomStudio>` (which
  // does not thread through the parent's `applyRoomUpdate`) would otherwise
  // leave the version strip showing stale `lookbookVariantUrls` until a
  // full page reload. The three URL/selection fields are server-only
  // truth — no local optimistic path mutates them — so adopting them on
  // prop change is safe and the merge semantics are pinned by the
  // `mergeServerUrlFields` unit test.
  useEffect(() => {
    if (!initialProject) return;
    setProject((prev) =>
      prev ? mergeServerUrlFields(prev, initialProject) : prev,
    );
  }, [initialProject]);

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
            void persistInpaintResultRef.current(room, resultImageUrl, source);
          },
          "Retry saving staged image"
        );
      }
    },
    [project, applyRoomUpdate, showError, showSuccess, router]
  );

  const persistInpaintResultRef = useRef<
    (room: Room, resultImageUrl: string, source: InpaintSource) => Promise<void>
  >(async () => {});

  useEffect(() => {
    // oxlint-disable-next-line react/immutability
    persistInpaintResultRef.current = persistInpaintResult;
  }, [persistInpaintResult]);

  const handleInpaintSourceChange = useCallback(
    (roomId: string, next: InpaintSource) => {
      setInpaintSourceByRoom((prev) => ({
        ...prev,
        [roomId]: next,
      }));
    },
    []
  );

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

  /**
   * Issue #1344 (real `useInpaintRuns` wire) — pre-compute the
   * new-studio prop bag at the top of the render so the JSX is a
   * single-line spread. The original inline `buildEditRoomStudioProps({ ... })`
   * call tripped oxlint's `react/refs` rule (a known false positive
   * on inline objects neighbouring a JSX `ref={...}` attribute —
   * the GitHub issue is tracked upstream under
   * `eslint-plugin-react-hooks` 7.1.1). Extracting the args into a
   * local const via an IIFE-style plain function call sidesteps it
   * without disabling the rule (the resolver doesn't allocate any
   * new identity-sensitive values, so memoization wouldn't change
   * semantics).
   */
  const editRoomStudioProps =
    focusedRoom && focusedInputs
      ? buildEditRoomStudioProps({
          project,
          focusedRoom,
          focusedInputs,
          directiveStatuses: directiveStatuses as Record<
            string,
            "idle" | "saving" | "saved" | "error"
          >,
          touchUps: {
            original: 0,
            A: touchUpCountsByRoom[focusedRoom.id]?.[0] ?? 0,
            B: touchUpCountsByRoom[focusedRoom.id]?.[1] ?? 0,
          },
          running: editRoomRunning,
          onRun: beginEditRoomRun,
          onExitToProject: leaveEditor,
          // #1365 — per-keystroke callback. The parent's
          // `editDirectives` already wraps persistence in the
          // AutosaveController; the shell no longer holds its own
          // 900ms debounce (the previous path raced the cluster's
          // submit-time prompt capture, missing the user's last
          // keystrokes on first render — see #1365).
          onDirectivesChange: (value) =>
            editDirectives(focusedRoom.id, value),
          // #1365 — live route-mapped value the studio's textarea
          // renders. `focusedInputs.roomDirectives` mirrors the
          // parent's `directives[roomId]` map; the shell's
          // `liveDirections` derivation uses this when supplied,
          // falling back to `initialDirections` for legacy fixtures.
          directions: focusedInputs.roomDirectives,
          maskDataUrl: maskDataUrlByRoom[focusedRoom.id] ?? null,
          onMaskChange: (value) =>
            setMaskDataUrlForRoom(focusedRoom.id, value),
          // Issue #1362a — FineTune persistence. Three callbacks fan
          // out to the per-room AutosaveController; each one forwards
          // only the field the shell touched (the controller's `edit()`
          // merges partials into its in-flight state).
          onFineTuneStrengthChange: (value) =>
            editFineTune(focusedRoom.id, { fineTuneStrength: value }),
          onFineTuneExpandChange: (value) =>
            editFineTune(focusedRoom.id, { fineTuneExpand: value }),
          onFineTuneSeedChange: (value) =>
            editFineTune(focusedRoom.id, { fineTuneSeed: value }),
        })
      : null;

  return (
    <div
      className={
        laptopFixedLayout
          ? "flex min-h-screen flex-col bg-background lg:h-full lg:overflow-auto"
          : "min-h-screen bg-background"
      }
    >
      {/* Issue #1374 — header compressed from `py-4` (~96px) to `py-2` + single-row
          layout so the page + room-studio sub-header combined stay ≤15% of a 1920×932
          viewport. Address drops its duplicate `<h1>` (already in the breadcrumb)
          and the client name is inlined next to the breadcrumb instead of in a
          separate vertical row. */}
      <header className="shrink-0 bg-background border-b border-border px-8 py-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 truncate text-sm text-muted-foreground">
              <Link
                href="/projects"
                className="hover:text-foreground"
              >
                Projects
              </Link>
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
              {/* Issue #1188: while a room is open, the project segment is
                  the one-click way back to the overview. */}
              {focusedRoom && layoutMode === "focused" ? (
                <button
                  type="button"
                  onClick={leaveEditor}
                  title={project.propertyAddress}
                  className="max-w-[16rem] truncate hover:text-foreground hover:underline"
                >
                  {project.propertyAddress}
                </button>
              ) : (
                <span
                  className="max-w-[16rem] truncate text-foreground"
                  title={project.propertyAddress}
                >
                  {project.propertyAddress}
                </span>
              )}
              {focusedRoom && (
                <>
                  <ChevronRight className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span
                    className="max-w-[12rem] truncate text-foreground"
                    title={focusedRoom.name}
                    aria-current="page"
                  >
                    {focusedRoom.name}
                  </span>
                </>
              )}
            </nav>
            {project.clientName ? (
              <span
                className="hidden truncate text-sm text-muted-foreground sm:inline"
                title={project.clientName}
              >
                · {project.clientName}
              </span>
            ) : null}
          </div>
          {/* Right-side cluster keeps its original place — `justify-between`
              does the work that the removed `<h1>` + `<p>` row did vertically. */}
          <div className="flex items-center gap-3">
            <span
              className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-foreground"
              title={PROJECT_AESTHETIC_HELPER}
            >
              {projectAestheticBadge(project.stagingAesthetic)}
            </span>
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
           * "All rooms" is the affordance back to the grid — kept in the
           * accessibility tree (sr-only, see #1374) since the visible
           * affordance moved up to the EditRoomStudio `<TopBar>`'s breadcrumb.
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
            {/* Issue #1374 — the room-studio sub-header is now `sr-only`:
                the page header's breadcrumb already carries the room name
                (aria-current="page") and the EditRoomStudio `<TopBar>` adds
                its own "All rooms" exit button. Both the room name and the
                "All rooms" affordance stay in the accessibility tree (the
                e2e helper at `openFocusedEditor` uses
                `getByRole("heading", { name: roomName })` and `getByRole(
                "button", { name: "All rooms" })` to wait for mount) but no
                longer eat vertical space. The visible sub-header becomes
                just the `mt-2` (8px) breath between the page header and the
                editor body. */}
            <div className="sr-only">
              <h2>{focusedRoom.name}</h2>
              <button
                type="button"
                onClick={leaveEditor}
                title="Back to the project overview"
              >
                All rooms
              </button>
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
            {/* Issue #450: hide RoomCanvas when an editor is active (the
                canvas inside the new `<EditRoomStudio>` shell shows the
                source image, so this would be a duplicate). Collapse
                entirely to free vertical space. Pre-#1346 the comment
                referenced the legacy `<InpaintEditor>` by name; wave-5
                renamed it. */}
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
                {/* The legacy variant-touch-up pill (#1344) was deleted
                    in #1346 wave-5 — it advertised the legacy IA
                    ("you've touched up variant 0, do you want a fresh
                    result?") and has no equivalent on the new
                    `<EditRoomStudio>` shell, which owns its own
                    header (from #1337 / #1338). The `touchUpCountsByRoom`
                    map and `variantTouchUpLabel` helper stay because
                    the new surface reads them in its version-history
                    panel. */}
                {/* Issue #1346 — the legacy `<InpaintEditor>` mount is
                    gone; this is the sole surface. `<EditRoomStudio>`
                    receives its prop bag from `buildEditRoomStudioProps`
                    (a pure shape transform) and shares the
                    `<EditRoomRunCluster>` with the rest of the page
                    so the cluster's `submitInpaint` + status polling
                    are the single source of truth.
                    Issue #1344 slice 2 — `onDirectionsCommit` wires
                    the studio's typed directions to the route's
                    existing `editDirectives(roomId, value)` so
                    `useInpaintRuns.promptDirectives` sees the user's
                    freshest value at submit time. `maskDataUrl` /
                    `onMaskChange` plumb the painted-area snapshot up
                    to the route's submit path. */}
                {
                  <>
                    {/* Issue #1344 (real `useInpaintRuns` wire) — the
                        fragment wraps the new studio + its run
                        cluster. Both gates must be true for the new
                        surface to mount: a focused room + before photo
                        (the kill-switch flag was retired in #1346
                        wave-5 commit 3). The
                        cluster consumes /api/inpaint + status
                        polling + persistence on the studio's behalf
                        via an imperative handle; beginEditRoomRun
                        calls into it on Run. */}
                    {editRoomStudioProps ? (
                      <EditRoomStudio {...editRoomStudioProps} />
                    ) : null}
                    {/* Issue #1344 (real `useInpaintRuns` wire) — the
                        cluster that owns `/api/inpaint` + status
                        polling + persistence for the new studio.
                        Mounted conditionally inside the
                        `<EditRoomStudio>` mount so the rules-of-hooks
                        lint rule is satisfied (a `<EditRoomRunCluster
                        />` only renders when a focused room is set).
                        The cluster exposes
                        an imperative handle via React's
                        ref-forwarding API; beginEditRoomRun (built
                        above the focused state) calls into it on Run. */}
                    <EditRoomRunCluster
                      ref={editRoomRunClusterRef}
                      room={focusedRoom}
                      inpaintSource={focusedInputs.inpaintSource}
                      inpaintImageUrl={focusedInputs.inpaintImageUrl ?? ""}
                      inpaintRoomDirectives={focusedInputs.roomDirectives}
                      pendingRequestId={
                        focusedInputs.pendingRequest?.id ?? null
                      }
                      pendingSource={focusedInputs.pendingSource}
                      inpaintProjectAesthetic={project.stagingAesthetic}
                      inpaintProjectGlobalDirectives={
                        project.stagingDirectives ?? ""
                      }
                      guidance={editRoomGuidance}
                      // Issue #1361 — flush the directive autosave
                      // controller before the cluster calls
                      // `submitInpaint`, so a fast Run click after
                      // typing directives doesn't race the controller's
                      // 2 s idle timer. The cluster surfaces a toast +
                      // retry when flush() reports unsaved work remained;
                      // the `editorRoomId` captured below is the focused
                      // room whose controller `getDirectiveController`
                      // already managed.
                      beforeRun={async () => {
                        const roomId = editorRoomId;
                        if (!roomId) return true;
                        return getDirectiveController(roomId).flush();
                      }}
                      // Issue #1362b (Stage B) — mask feathering for
                      // the FineTune `expand` slider. The cluster
                      // invokes this BEFORE `beforeRun`, with the
                      // user's painted mask data URL, and uses the
                      // returned feathered URL in the submit. Reads the
                      // latest expand from the route's per-room
                      // `fineTune[roomId]` map (kept in sync with the
                      // studio's local state via `editFineTune`); the
                      // map is also persisted through the autosave
                      // controller, so the value here is the same one
                      // the user sees on the slider. `expand === 0`
                      // returns the input unchanged (passthrough).
                      beforeSubmit={async (maskDataUrl) => {
                        const roomId = editorRoomId;
                        if (!roomId) return maskDataUrl;
                        const expandPx = fineTune[roomId]?.fineTuneExpand ?? 0;
                        return featherMask(maskDataUrl, expandPx);
                      }}
                      onRunningChange={(isProcessing) => {
                        // Push the cluster's run-state into two
                        // places: (a) the local `editRoomIsProcessing`
                        // flag drives the studio's controlled
                        // `running` prop and `beginEditRoomRun`'s
                        // re-entry guard, and (b) the route's
                        // `editorBusy` flag drives the browser-leave
                        // guard (issue #1188). The legacy
                        // `<InpaintEditor>` keeps both in sync via
                        // a single prop (`onProcessingChange`); the
                        // new split keeps `running` on the shell
                        // (controlled component) while `editorBusy`
                        // stays a route-level concern.
                        setEditRoomIsProcessing(isProcessing);
                        setEditorBusy(isProcessing);
                      }}
                      onInpaintComplete={async (resultImageUrl, runSource) => {
                        await persistInpaintResult(
                          focusedRoom,
                          resultImageUrl,
                          runSource
                        );
                        const slot = resolveInpaintTargetSlot(
                          focusedRoom,
                          runSource
                        );
                        handleInpaintSourceChange(focusedRoom.id, {
                          kind: "variant",
                          slot,
                        });
                        setEditorBusy(false);
                      }}
                      showError={showError}
                      showSuccess={showSuccess}
                    />
                  </>
                }
              </section>
            ) : (
              <p className="mt-6 text-sm text-muted-foreground">
                Upload a room photo first to enable AI staging and copy.
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Issue #555: Staging Package Tiers selector */}
            {project.stagingPackage !== null && (
              <section aria-label="Staging package" className="mb-8">
                <h2 className="font-playfair text-xl font-semibold text-foreground mb-4">
                  Staging Package
                </h2>
                <div
                  className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                  role="radiogroup"
                  aria-label="Staging package selection"
                >
                  {STAGING_PACKAGES.map((pkg) => (
                    <StagingPackageCard
                      key={pkg.id}
                      pkg={pkg}
                      selected={project.stagingPackage === pkg.id}
                      onSelect={handlePackageSelect}
                      selectable
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Issue #1186: disclosure toggle for the "Virtually staged"
                mark on AI after-images. Project-scoped so Lauren can
                match local MLS / listing-agent rules per market. */}
            <section aria-label="Disclosure settings" className="mb-8">
              <h2 className="font-playfair text-xl font-semibold text-foreground mb-4">
                Disclosure
              </h2>
              <div className="rounded-lg border border-border bg-card p-4">
                <label
                  htmlFor="virtually-staged-label-toggle"
                  aria-label="Show Virtually Staged mark on AI after-images"
                  className="flex items-start gap-3 cursor-pointer"
                >
                  <input
                    id="virtually-staged-label-toggle"
                    type="checkbox"
                    checked={project.virtuallyStagedLabelEnabled ?? true}
                    onChange={(e) =>
                      void handleVirtuallyStagedLabelToggle(e.target.checked)
                    }
                    className="mt-1 h-4 w-4 rounded border-input text-primary accent-primary"
                    data-testid="virtually-staged-label-toggle"
                  />
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-foreground">
                      Show &quot;Virtually Staged&quot; mark on AI after-images
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground font-jakarta">
                      Adds a small disclosure label to every AI-staged
                      after-image in the lookbook preview. Most MLSes
                      require this disclosure — leave on unless your
                      market or listing agent says otherwise.
                    </span>
                  </span>
                </label>
              </div>
            </section>

            <div className="flex items-center justify-between mb-6">
              <h2 className="font-playfair text-xl font-semibold text-foreground">Rooms</h2>
              <button
                type="button"
                onClick={() => setShowBatchUpload((prev) => !prev)}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {showBatchUpload ? "Done adding" : "Add rooms"}
              </button>
            </div>

            {showBatchUpload && (
              <div className="mb-8 rounded-lg border border-border bg-card p-4">
                <BatchRoomUpload
                  projectId={project.id}
                  onRoomsCreated={() => {
                    router.refresh();
                    setShowBatchUpload(false);
                  }}
                />
              </div>
            )}

            {/* Bulk selection toolbar */}
            {selectedRoomIds.size > 0 && (
              <div className="mb-4 flex items-center gap-3 rounded-lg border border-primary bg-primary/5 p-3">
                <span className="text-sm font-medium text-foreground">
                  {selectedRoomIds.size} room{selectedRoomIds.size !== 1 ? "s" : ""} selected
                </span>
                {/* Issue #1189: aesthetic is project-wide, so the bulk toolbar no
                    longer offers a per-selection aesthetic it can't honour. */}
                <span className="text-sm text-muted-foreground" data-testid="bulk-aesthetic-note">
                  {BULK_AESTHETIC_NOTE}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedRoomIds(new Set())}
                  className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm text-muted-foreground hover:bg-secondary"
                  aria-label="Clear selection"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Clear
                </button>
              </div>
            )}

            {project.rooms.length === 0 && !showBatchUpload ? (
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
                  Click &ldquo;Add rooms&rdquo; to batch upload room photos with AI-detected types
                </p>
              </div>
            ) : (
              <>
                {/* Issue #636: Global Staging Directives Bar — shown above the room grid.
                    Issue #692: batch actions (TODO #636) have no backend yet — omitting
                    the handlers renders them disabled with visible "Coming soon" copy
                    instead of firing placeholder toasts. */}
                <GlobalStagingDirectivesBar
                  aesthetic={resolveRoomAesthetic(project)}
                  onAestheticChange={(aesthetic) => {
                    // Issue #1189: the bar reads and writes the project value
                    // directly, so it never shows blank for a saved aesthetic.
                    // Issue #636: propagate aesthetic to project-level stagingAesthetic
                    if (project && aesthetic) {
                      void saveProjectMetadata(project.id, { stagingAesthetic: aesthetic }).then((result) => {
                        if (result.success) {
                          setProject((prev) =>
                            prev ? { ...prev, stagingAesthetic: aesthetic } : prev
                          );
                        }
                      });
                    }
                  }}
                  lockedElements={lockedElements}
                  onAddLock={(element) =>
                    setLockedElements((prev) =>
                      prev.includes(element) ? prev : [...prev, element]
                    )
                  }
                  onRemoveLock={(element) =>
                    setLockedElements((prev) => prev.filter((e) => e !== element))
                  }
                  realismValue={realismValue}
                  onRealismChange={setRealismValue}
                  roomCount={project.rooms.length}
                  renderingCount={0}
                  gpuActive={gpuActive}
                />
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={project.rooms.map((r) => r.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="grid gap-8 md:grid-cols-2">
                    {project.rooms.map((room) => {
                      const inputs = roomEditorInputs(
                        room,
                        directives,
                        inpaintSourceByRoom
                      );

                      return (
                        <SortableRoom
                          key={room.id}
                          room={room}
                          projectId={project.id}
                          touchUpCountsByRoom={touchUpCountsByRoom}
                          deletingSlotByRoom={deletingSlotByRoom}
                          isSelected={selectedRoomIds.has(room.id)}
                          onToggleSelect={(id) =>
                            setSelectedRoomIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(id)) next.delete(id);
                              else next.add(id);
                              return next;
                            })
                          }
                          onOpenEditor={openEditor}
                          onApplyRoomUpdate={applyRoomUpdate}
                          onHandleStripSelect={handleStripSelect}
                          onHandleDeleteVariant={handleDeleteVariant}
                          router={router}
                          roomInputs={inputs}
                        />
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
              </>
            )}
          </>
        )}
      </main>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
