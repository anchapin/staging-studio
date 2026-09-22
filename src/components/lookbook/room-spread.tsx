import Image from "next/image";
import { parseChecklistItems } from "@/lib/checklist-schema";
import { extractPillars } from "@/lib/lookbook-pillars";
import {
  resolveStagedResultDisplay,
  type StagedVariantPair,
} from "@/lib/staged-result";
import { LookbookRoomData, ChecklistItem } from "./types";

const PRIORITY_STYLES: Record<ChecklistItem["priority"], string> = {
  Critical: "border-primary bg-primary/10",
  High: "border-secondary bg-secondary/10",
  Standard: "border-muted bg-muted/50",
};

// Standalone /preview route: no dashboard sidebar — spreads span the full
// viewport width.
const SPREAD_IMAGE_SIZES = "calc(100vw / 2)";

interface RoomSpreadProps {
  room: LookbookRoomData;
  user: LookbookRoomData["user"];
  project: LookbookRoomData["project"];
}

export function RoomSpread({ room, project }: RoomSpreadProps) {
  const pillars = extractPillars(room);
  const checklist = parseChecklistItems(room.checklistItems, { roomId: room.id });

  // Issue #253: render the SELECTED variant's image pair, not variant A's
  // slot. Same policy as the dashboard (pinned by tests/staged-result.test.ts):
  // follow `selectedVariantIndex`, fall back A → B when the selection is
  // unset or points at an incomplete slot. When no variant is complete at
  // all, keep the legacy single-slot rendering (placeholder box).
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

  return (
    <div className="lookbook-page min-h-screen flex flex-col bg-stone-50">
      <div className="p-8 border-b border-border">
        <div className="flex items-baseline justify-between">
          <h2 className="font-playfair text-3xl font-bold text-foreground">
            {room.name}
          </h2>
          <p className="font-cinzel text-xs tracking-widest uppercase text-muted-foreground">
            {project.stagingAesthetic}
          </p>
        </div>
      </div>

      <div className="avoid-break flex-1 grid grid-cols-2 gap-0">
        <div className="relative aspect-[4/3] bg-muted">
          {beforeImageUrl ? (
            <Image
              src={beforeImageUrl}
              alt={`${room.name} - Before staging`}
              fill
              sizes={SPREAD_IMAGE_SIZES}
              loading="eager"
              className="object-cover"
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="font-jakarta text-muted-foreground">Before</p>
            </div>
          )}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-4">
            <p className="font-cinzel text-sm tracking-wider text-white uppercase">
              Before
            </p>
          </div>
        </div>

        <div className="relative aspect-[4/3] bg-muted">
          {afterImageUrl ? (
            <Image
              src={afterImageUrl}
              alt={`${room.name} - After staging`}
              fill
              sizes={SPREAD_IMAGE_SIZES}
              loading="eager"
              className="object-cover"
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="font-jakarta text-muted-foreground">After</p>
            </div>
          )}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-4">
            <p className="font-cinzel text-sm tracking-wider text-white uppercase">
              After
            </p>
          </div>
        </div>
      </div>

      <div className="avoid-break p-8 bg-white border-t border-border">
        <div className="grid grid-cols-3 gap-8">
          {pillars.map((pillar, index) => (
            <div key={index} className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center">
                  <span className="font-cinzel text-base font-bold text-primary">
                    {index + 1}
                  </span>
                </div>
                <h3 className="font-playfair text-lg font-semibold text-foreground">
                  {pillar.title}
                </h3>
              </div>
              <p className="font-jakarta text-sm text-muted-foreground leading-relaxed">
                {pillar.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {checklist.length > 0 && (
        <div className="avoid-break p-8 bg-stone-50 border-t border-border">
          <h4 className="font-cinzel text-xs tracking-widest uppercase text-muted-foreground mb-4">
            Staging Checklist
          </h4>
          <div className="grid grid-cols-3 gap-4">
            {checklist.map((item, index) => (
              <div
                key={index}
                className="flex items-start gap-2 text-sm"
              >
                <div
                  className={`w-4 h-4 rounded border flex-shrink-0 mt-0.5 ${
                    PRIORITY_STYLES[item.priority]
                  }`}
                />
                <span className="font-jakarta text-foreground">{item.item}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

