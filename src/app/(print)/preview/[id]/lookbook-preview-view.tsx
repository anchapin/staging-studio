import {
  CoverPage,
  PhilosophyPage,
  ROIMetricsDashboard,
  RoomSpread,
  SignoffPage,
} from "@/components/lookbook";
import type { ProjectData, ROIMetric } from "@/components/lookbook";
import { parseChecklistItems } from "@/lib/checklist-schema";

export interface PreviewRoom {
  id: string;
  name: string;
  beforeImageUrl: string | null;
  afterImageUrl: string | null;
  beforeImageUrl2: string | null;
  afterImageUrl2: string | null;
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
  /** ROI metrics from project settings. Null means use the dashboard's defaults. */
  roiMetrics: ROIMetric[] | null;
  user: {
    firmName: string;
    ownerName: string;
    logoUrl?: string | null;
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
      <div id="lookbook-cover">
        <CoverPage project={projectData} user={project.user} />
      </div>

      <div id="lookbook-philosophy">
        <PhilosophyPage project={projectData} user={project.user} />
      </div>

      <div id="lookbook-roi">
        <ROIMetricsDashboard metrics={project.roiMetrics ?? undefined} />
      </div>

      {project.rooms.map((room) => (
        <div key={room.id} id={`lookbook-room-${room.id}`}>
          <RoomSpread
            room={{
              id: room.id,
              name: room.name,
              beforeImageUrl: room.beforeImageUrl,
              afterImageUrl: room.afterImageUrl,
              beforeImageUrl2: room.beforeImageUrl2,
              afterImageUrl2: room.afterImageUrl2,
              selectedVariantIndex: room.selectedVariantIndex,
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
        </div>
      ))}

      <div id="lookbook-closing">
        <SignoffPage
          user={project.user}
          project={projectData}
          rooms={project.rooms.map((room) => ({
            id: room.id,
            name: room.name,
            beforeImageUrl: room.beforeImageUrl,
            afterImageUrl: room.afterImageUrl,
            beforeImageUrl2: room.beforeImageUrl2,
            afterImageUrl2: room.afterImageUrl2,
            project: projectData,
            user: project.user,
          }))}
        />
      </div>
    </div>
  );
}
