import Image from "next/image";
import { parseChecklistItems } from "@/lib/checklist-schema";
import { extractPillars } from "@/lib/lookbook-pillars";
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
          {room.beforeImageUrl ? (
            <Image
              src={room.beforeImageUrl}
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
          {room.afterImageUrl ? (
            <Image
              src={room.afterImageUrl}
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
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="font-cinzel text-sm text-primary">
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

