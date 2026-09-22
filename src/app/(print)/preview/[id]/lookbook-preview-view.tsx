import {
  BuyerPersonaPage,
  ConsultationReportClient,
  CoverPage,
  FurnitureProcurementTable,
  InvestmentSummaryPage,
  PhilosophyPage,
  ROIMetricsDashboard,
  RoomSpread,
  SignoffPage,
} from "@/components/lookbook";
import type { BuyerDemographics, LookbookRoomData, MaterialSwatchData, ProjectData, ROIMetric } from "@/components/lookbook";
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
  /** Selected staging package tier id, e.g. "essential" | "premium" | "turnkey" */
  stagingPackage?: string | null;
  /** Client sign-off (issue #556) */
  clientSignature?: string | null;
  clientSignatureStatus?: string | null;
  clientSignatureTimestamp?: string | null;
  /** Buyer Demographics (issue #589) */
  buyerDemographics?: BuyerDemographics | null;
  user: {
    firmName: string;
    ownerName: string;
    logoUrl?: string | null;
    psychologyPageContent: string | null;
    signoffContent: string | null;
  };
  rooms: PreviewRoom[];
  materialSwatches: MaterialSwatchData[];
  procurementItems: PreviewProcurementItem[];
}

export interface PreviewProcurementItem {
  id: string;
  item: string;
  category: string;
  vendor: string | null;
  sku: string | null;
  estCost: number | null;
  status: string;
  quantity?: number;
  leadTime?: string;
}

interface LookbookPreviewViewProps {
  project: PreviewProject;
  /** Optional preview token — only set on the public preview page for client signing. */
  previewToken?: string;
}

/**
 * Pure lookbook renderer for `/projects/:id/preview`. Server-safe (no
 * hooks, no client fetch): the page's server component loads the project
 * and passes it in, so the full lookbook markup is present in the initial
 * HTML response — required for the cookie-less Browserless PDF capture.
 *
 * When `previewToken` is provided AND the project is not yet signed, the
 * interactive `SignoffPageClient` is rendered to allow the client to sign
 * the lookbook. Otherwise the static `SignoffPage` (server component) is
 * rendered for PDF export / print.
 */
export function LookbookPreviewView({ project, previewToken }: LookbookPreviewViewProps) {
  const projectData: ProjectData = {
    propertyAddress: project.propertyAddress,
    clientName: project.clientName,
    targetBuyer: project.targetBuyer,
    stagingAesthetic: project.stagingAesthetic,
    clientSignature: project.clientSignature,
    clientSignatureStatus: project.clientSignatureStatus,
    clientSignatureTimestamp: project.clientSignatureTimestamp
      ? String(project.clientSignatureTimestamp)
      : null,
  };

  const signoffRooms: LookbookRoomData[] = project.rooms.map((room) => ({
    id: room.id,
    name: room.name,
    beforeImageUrl: room.beforeImageUrl,
    afterImageUrl: room.afterImageUrl,
    beforeImageUrl2: room.beforeImageUrl2,
    afterImageUrl2: room.afterImageUrl2,
    project: projectData,
    user: project.user,
  }));

  const isSigned = project.clientSignatureStatus === "Signed" && !!project.clientSignature;
  const canSign = !!previewToken && !isSigned;

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

      {project.buyerDemographics && (
        <div id="lookbook-buyer-persona">
          <BuyerPersonaPage
            buyerDemographics={project.buyerDemographics}
            user={project.user}
            project={projectData}
          />
        </div>
      )}

      <div id="lookbook-investment-summary">
        <InvestmentSummaryPage
          stagingPackageId={project.stagingPackage}
          roomCount={project.rooms.length}
        />
      </div>

      {/* Client Consultation Report with tier selection and signature (issue #626) */}
      <div id="lookbook-consultation">
        <ConsultationReportClient
          user={project.user}
          project={projectData}
          previewToken={previewToken ?? ""}
          materialSwatches={project.materialSwatches}
          procurementItems={project.procurementItems}
        />
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

      {project.procurementItems.length > 0 && (
        <div id="lookbook-procurement">
          <FurnitureProcurementTable items={project.procurementItems} />
        </div>
      )}

      <div id="lookbook-closing">
        {canSign ? (
          <SignoffPageWithSigning
            user={project.user}
            projectData={projectData}
            signoffRooms={signoffRooms}
            previewToken={previewToken}
          />
        ) : (
          <SignoffPage
            user={project.user}
            project={projectData}
            rooms={signoffRooms}
          />
        )}
      </div>
    </div>
  );
}

// Lazy-loaded signing wrapper (client component)
import { SignoffPageClient } from "@/components/lookbook/signoff-page-client";

function SignoffPageWithSigning({
  user,
  projectData,
  signoffRooms,
  previewToken,
}: {
  user: LookbookPreviewViewProps["project"]["user"];
  projectData: ProjectData;
  signoffRooms: LookbookRoomData[];
  previewToken: string;
}) {
  return (
    <SignoffPageClient
      user={user}
      project={projectData}
      rooms={signoffRooms}
      previewToken={previewToken}
    />
  );
}
