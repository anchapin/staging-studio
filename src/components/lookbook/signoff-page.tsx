import { LookbookRoomData } from "./types";

interface SignoffPageProps {
  user: LookbookRoomData["user"];
  project: LookbookRoomData["project"];
  rooms: LookbookRoomData[];
}

export function SignoffPage({ user, project, rooms }: SignoffPageProps) {
  const content = user.signoffContent || getDefaultSignoff(user, project);

  return (
    <div className="lookbook-page min-h-screen flex flex-col items-center justify-center bg-stone-50 p-12">
      <div className="max-w-2xl text-center space-y-8">
        <div className="space-y-4">
          <p className="font-cinzel text-sm tracking-[0.3em] uppercase text-muted-foreground">
            Thank You
          </p>

          <h2 className="font-playfair text-4xl font-bold text-foreground">
            Ready to Make Your Move
          </h2>

          <div className="w-24 h-0.5 bg-primary mx-auto" />
        </div>

        <div className="prose prose-stone mx-auto">
          <div className="font-jakarta text-lg text-foreground leading-relaxed whitespace-pre-line">
            {content}
          </div>
        </div>

        <div className="pt-8 space-y-4">
          {user.logoUrl && (
            <div className="flex justify-center">
              <img
                src={user.logoUrl}
                alt={`${user.firmName} logo`}
                className="h-16 w-auto object-contain"
              />
            </div>
          )}

          <div className="space-y-1">
            <p className="font-playfair text-xl text-foreground">
              {user.firmName}
            </p>
            {user.ownerName && (
              <p className="font-jakarta text-muted-foreground">
                {user.ownerName}
              </p>
            )}
            {user.email && (
              <p className="font-jakarta text-sm text-primary">
                {user.email}
              </p>
            )}
          </div>
        </div>

        <div className="pt-12 border-t border-border">
          <p className="font-cinzel text-xs tracking-widest text-muted-foreground">
            STAGED PROPERTIES
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {rooms.map((room) => (
              <span
                key={room.id}
                className="px-3 py-1 bg-white border border-border rounded-full font-jakarta text-xs text-foreground"
              >
                {room.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function getDefaultSignoff(
  user: LookbookRoomData["user"],
  project: LookbookRoomData["project"]
): string {
  return `This lookbook represents our collaborative vision for ${project.propertyAddress}.

We have carefully considered every detail—from the overall aesthetic to the smallest staging element—to create an emotional connection that resonates with ${project.targetBuyer}.

Each room has been thoughtfully designed to tell a story of possibility, where potential buyers can immediately envision their own future memories.

${user.firmName} is honored to present this home with the care and attention it deserves.

We look forward to seeing you thrive in your new space.`;
}
