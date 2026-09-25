import Image from "next/image";
import { LookbookRoomData } from "./types";
import { ProposalFooter } from "./proposal-footer";
import { formatLongDate } from "@/lib/relative-time";
import { decryptSignature } from "@/lib/signature-encryption";

interface SignoffPageProps {
  user: LookbookRoomData["user"];
  project: LookbookRoomData["project"];
  rooms: LookbookRoomData[];
}

/**
 * Server-rendered sign-off page (issue #556).
 *
 * Renders the closing content and, if already signed, the client's signature
 * with timestamp and a "Signed & Approved" badge.
 *
 * The interactive signing form (draw/type signature + approval checkbox) is
 * handled by `SignoffPageClient`, which wraps this component on the preview page.
 */
export async function SignoffPage({ user, project, rooms }: SignoffPageProps) {
  const isSigned = project.clientSignatureStatus === "Signed" && project.clientSignature;
  const content = user.signoffContent || getDefaultSignoff(user, project);

  const decryptedSignature = isSigned && project.clientSignature
    ? await decryptSignature(project.clientSignature).catch(() => project.clientSignature)
    : null;

  return (
    <div className="lookbook-page min-h-screen flex flex-col items-center justify-between bg-stone-50 p-12">
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="max-w-2xl text-center space-y-8">
          <div className="space-y-4">
            <p className="font-cinzel text-sm tracking-[0.3em] uppercase text-muted-foreground">
              {isSigned ? "Approved" : "Thank You"}
            </p>

            <h2 className="font-playfair text-4xl font-bold text-foreground">
              {isSigned ? "Staging Approved" : "Ready to Make Your Move"}
            </h2>

            <div className="w-24 h-0.5 bg-primary mx-auto" />
          </div>

          <div className="prose prose-stone mx-auto">
            <div className="font-jakarta text-lg text-foreground leading-relaxed whitespace-pre-line">
              {content}
            </div>
          </div>

          {/* Signed signature display */}
          {isSigned && project.clientSignature && (
            <div className="pt-4 border-t border-border space-y-3">
              <div className="flex justify-center">
                <Image
                  src={decryptedSignature ?? project.clientSignature}
                  alt="Client signature"
                  width={200}
                  height={80}
                  className="object-contain max-h-20"
                  unoptimized={project.clientSignature.startsWith("data:")}
                />
              </div>
              <div className="space-y-1">
                <p className="font-playfair text-lg text-foreground">
                  {project.clientName}
                </p>
                {project.clientSignatureTimestamp && (
                  <p className="font-jakarta text-sm text-muted-foreground">
                    Signed{" "}
                    {formatLongDate(project.clientSignatureTimestamp)}
                  </p>
                )}
              </div>
              <div className="flex justify-center">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 border border-green-200 rounded-full text-xs font-jakarta text-green-700 font-medium">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Signed & Approved
                </span>
              </div>
            </div>
          )}

          <div className="pt-8 space-y-4">
            {user.logoUrl && (
              <div className="flex justify-center">
                <Image
                  src={user.logoUrl}
                  alt={`${user.firmName} logo`}
                  width={256}
                  height={64}
                  sizes="256px"
                  loading="eager"
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

      <ProposalFooter />
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
