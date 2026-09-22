import Image from "next/image";
import { ProposalFooter } from "./proposal-footer";
import { LookbookRoomData } from "./types";

interface CoverPageProps {
  project: LookbookRoomData["project"];
  user: LookbookRoomData["user"];
}

export function CoverPage({ project, user }: CoverPageProps) {
  return (
    <div className="lookbook-page min-h-screen flex flex-col items-center justify-between bg-stone-50 p-12">
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="max-w-2xl text-center space-y-8">
          {user.logoUrl && (
            <div className="flex justify-center">
              <Image
                src={user.logoUrl}
                alt={`${user.firmName} logo`}
                width={320}
                height={80}
                sizes="320px"
                loading="eager"
                className="h-20 w-auto object-contain"
              />
            </div>
          )}

          <div className="space-y-4">
            <p className="font-cinzel text-sm tracking-[0.3em] uppercase text-muted-foreground">
              {user.firmName}
            </p>

            <h1 className="font-playfair text-5xl font-bold text-foreground leading-tight">
              {project.stagingAesthetic}
            </h1>

            <div className="w-24 h-0.5 bg-primary mx-auto" />
          </div>

          <div className="space-y-3">
            <p className="font-playfair text-2xl text-foreground">
              {project.propertyAddress}
            </p>

            <p className="font-jakarta text-lg text-muted-foreground">
              Prepared for {project.clientName}
            </p>
          </div>

          <div className="pt-8 space-y-2">
            <p className="font-jakarta text-sm text-muted-foreground">
              Target Buyer Profile
            </p>
            <p className="font-playfair text-xl text-foreground">
              {project.targetBuyer}
            </p>
          </div>

          <div className="pt-12">
            <p className="font-cinzel text-xs tracking-widest text-muted-foreground">
              STAGING LOOKBOOK
            </p>
          </div>
        </div>
      </div>

      <ProposalFooter />
    </div>
  );
}
