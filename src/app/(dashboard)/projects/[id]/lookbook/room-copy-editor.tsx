"use client";

import Image from "next/image";
import { AutoTextarea } from "./auto-textarea";
import { CHECKLIST_PRIORITIES } from "@/lib/checklist-schema";
import { resolveStagedResultDisplay } from "@/lib/staged-result";
import type { PreviewRoom } from "@/app/(print)/preview/[id]/lookbook-preview-view";
import { type RoomCopyEditInput } from "@/lib/room-copy-edit-schema";
import type { StagedVariantPair } from "@/lib/staged-result";

type ChecklistRow = { item: string; category: string; priority: string };

interface RoomCopyEditorProps {
  room: PreviewRoom;
  override?: Partial<RoomCopyEditInput>;
  generating: boolean;
  generateError: string | null;
  canGenerate: boolean;
  onGenerate: () => void;
  onEdit: (patch: Partial<RoomCopyEditInput>) => void;
  onBlur: () => void;
}

/**
 * One room's editable copy block: three auto-growing prose textareas,
 * the checklist rows (text + priority + delete; no add/reorder), and —
 * only while the room has no copy at all — the generate-once button.
 */
export function RoomCopyEditor({
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

  // Issue #253 selection policy: follow selectedVariantIndex,
  // fall back A → B, legacy single-slot when nothing is complete.
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
