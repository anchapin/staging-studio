import Image from "next/image";
import { LookbookRoomData, ChecklistItem } from "./types";

interface RoomSpreadProps {
  room: LookbookRoomData;
  user: LookbookRoomData["user"];
  project: LookbookRoomData["project"];
}

export function RoomSpread({ room, user, project }: RoomSpreadProps) {
  const pillars = extractPillars(room);
  const checklist = (room.checklistItems || []) as ChecklistItem[];

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

      <div className="flex-1 grid grid-cols-2 gap-0">
        <div className="relative aspect-[4/3] bg-muted">
          {room.beforeImageUrl ? (
            <Image
              src={room.beforeImageUrl}
              alt={`${room.name} - Before staging`}
              fill
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

      <div className="p-8 bg-white border-t border-border">
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
        <div className="p-8 bg-stone-50 border-t border-border">
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
                    item.priority === "high"
                      ? "border-primary bg-primary/10"
                      : item.priority === "medium"
                      ? "border-secondary bg-secondary/10"
                      : "border-muted bg-muted/50"
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

function extractPillars(room: LookbookRoomData): Array<{ title: string; description: string }> {
  const pillars: Array<{ title: string; description: string }> = [];

  if (room.observedChallenge) {
    pillars.push({
      title: "Observed Challenge",
      description: room.observedChallenge,
    });
  }

  if (room.recommendation) {
    pillars.push({
      title: "Our Approach",
      description: room.recommendation,
    });
  }

  if (room.buyerPsychology) {
    pillars.push({
      title: "Buyer Psychology",
      description: room.buyerPsychology,
    });
  }

  if (room.rawDirectives) {
    pillars.push({
      title: "Key Directives",
      description: room.rawDirectives,
    });
  }

  while (pillars.length < 3 && pillars.length > 0) {
    const extra = {
      title: "Design Priority",
      description: "Attention to detail ensures lasting impressions that resonate with discerning buyers.",
    };
    if (!pillars.find((p) => p.title === extra.title)) {
      pillars.push(extra);
    } else {
      break;
    }
  }

  if (pillars.length === 0) {
    return [
      { title: "First Impression", description: "Creating an inviting atmosphere that welcomes potential buyers from the moment they enter." },
      { title: "Lifestyle Appeal", description: "Highlighting the unique character of the space while allowing buyers to envision their own story." },
      { title: "Quality Craftsmanship", description: "Every detail reflects the quality they can expect from the entire home." },
    ];
  }

  return pillars.slice(0, 3);
}
