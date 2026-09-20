import { LookbookRoomData } from "./types";

interface PhilosophyPageProps {
  user: LookbookRoomData["user"];
  project: LookbookRoomData["project"];
  room?: LookbookRoomData;
}

export function PhilosophyPage({ user, project, room }: PhilosophyPageProps) {
  const content = user.psychologyPageContent || getDefaultPhilosophy(project, room);

  return (
    <div className="lookbook-page min-h-screen flex flex-col items-center justify-center bg-stone-50 p-12">
      <div className="max-w-3xl text-center space-y-8">
        <div className="space-y-4">
          <p className="font-cinzel text-sm tracking-[0.3em] uppercase text-muted-foreground">
            Our Staging Philosophy
          </p>

          <h2 className="font-playfair text-4xl font-bold text-foreground">
            Understanding the Buyer
          </h2>

          <div className="w-24 h-0.5 bg-primary mx-auto" />
        </div>

        <div className="prose prose-stone mx-auto">
          <div className="font-jakarta text-lg text-foreground leading-relaxed whitespace-pre-line">
            {content}
          </div>
        </div>

        {room?.buyerPsychology && (
          <div className="mt-8 p-6 bg-white rounded-lg border border-border">
            <p className="font-cinzel text-xs tracking-widest uppercase text-muted-foreground mb-3">
              Room-Specific Insight
            </p>
            <p className="font-playfair text-xl text-foreground">
              {room.buyerPsychology}
            </p>
          </div>
        )}

        <div className="pt-12">
          <p className="font-cinzel text-xs tracking-widest text-muted-foreground">
            {user.firmName}
          </p>
        </div>
      </div>
    </div>
  );
}

function getDefaultPhilosophy(
  project: LookbookRoomData["project"],
  room?: LookbookRoomData
): string {
  const roomName = room?.name ? ` in the ${room.name}` : "";

  return `When staging for a ${project.targetBuyer}, we focus on creating an emotional connection that transcends the physical space. Every choice we make speaks to their aspirations, lifestyle, and the story they want to tell future memories in this home${roomName}.

Our approach balances sophisticated design with warm livability, ensuring potential buyers can immediately envision themselves creating their own moments within these carefully crafted spaces.

We believe that successful staging isn't about showcasing furniture—it's about revealing possibility.`;
}
