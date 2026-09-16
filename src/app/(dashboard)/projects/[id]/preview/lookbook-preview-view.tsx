import { CoverPage, PhilosophyPage, RoomSpread, SignoffPage } from "@/components/lookbook";
import type { ProjectData } from "@/components/lookbook";
import { parseChecklistItems } from "@/lib/checklist-schema";

export interface PreviewRoom {
  id: string;
  name: string;
  beforeImageUrl: string | null;
  afterImageUrl: string | null;
  selectedVariantIndex: number | null;
  observedChallenge: string | null;
  recommendation: string | null;
  buyerPsychology: string | null;
  checklistItems: { item: string; category: string; priority: string }[] | null;
}

export interface PreviewProject {
  id: string;
  propertyAddress: string;
  clientName: string;
  targetBuyer: string;
  stagingAesthetic: string;
  user: {
    firmName: string;
    ownerName: string;
    psychologyPageContent: string | null;
    signoffContent: string | null;
  };
  rooms: PreviewRoom[];
}

/**
 * Pure lookbook renderer for `/projects/:id/preview`. Server-safe (no
 * hooks, no client fetch): the page's server component loads the project
 * and passes it in, so the full lookbook markup is present in the initial
 * HTML response — required for the cookie-less Browserless PDF capture.
 */
export function LookbookPreviewView({ project }: { project: PreviewProject }) {
  const projectData: ProjectData = {
    propertyAddress: project.propertyAddress,
    clientName: project.clientName,
    targetBuyer: project.targetBuyer,
    stagingAesthetic: project.stagingAesthetic,
  };

  return (
    <div className="lookbook-preview">
      <CoverPage project={projectData} user={project.user} />

      <PhilosophyPage project={projectData} user={project.user} />

      {project.rooms.map((room) => (
        <RoomSpread
          key={room.id}
          room={{
            id: room.id,
            name: room.name,
            beforeImageUrl: room.beforeImageUrl,
            afterImageUrl: room.afterImageUrl,
            observedChallenge: room.observedChallenge,
            recommendation: room.recommendation,
            buyerPsychology: room.buyerPsychology,
            checklistItems: parseChecklistItems(room.checklistItems, {
              roomId: room.id,
            }),
            project: projectData,
            user: project.user,
          }}
          user={project.user}
          project={projectData}
        />
      ))}

      <SignoffPage
        user={project.user}
        project={projectData}
        rooms={project.rooms.map((room) => ({
          id: room.id,
          name: room.name,
          beforeImageUrl: room.beforeImageUrl,
          afterImageUrl: room.afterImageUrl,
          project: projectData,
          user: project.user,
        }))}
      />
    </div>
  );
}
