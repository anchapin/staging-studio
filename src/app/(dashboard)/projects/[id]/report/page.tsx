import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { signPreviewToken } from "@/lib/preview-token";
import ComparisonSlider from "@/components/canvas/comparison-slider";
import { StudioWorkflowStepper } from "@/components/dashboard/studio-workflow-stepper";
import {
  ConsultationReportClient,
} from "@/components/lookbook/consultation-report-client";
import { ROIMetricsDashboard } from "@/components/lookbook/roi-metrics-dashboard";
import { ProposalFooter } from "@/components/lookbook/proposal-footer";
import type { ROIMetric, UserData } from "@/components/lookbook/types";

interface ReportPageProps {
  params: Promise<{ id: string }>;
}

/** Ownership-scoped fetch shared by generateMetadata and the page. */
const getOwnedReportProject = cache(async (projectId: string) => {
  const user = await getAuthedPrismaUser();
  if (!user) return null;

  return prisma.project.findUnique({
    where: { id: projectId, userId: user.id },
    select: {
      id: true,
      propertyAddress: true,
      clientName: true,
      targetBuyer: true,
      stagingAesthetic: true,
      stagingDirectives: true,
      roiSalesPricePremium: true,
      roiTransactionVelocity: true,
      roiInvestmentTier: true,
      user: {
        select: {
          firmName: true,
          ownerName: true,
          logoUrl: true,
          psychologyPageContent: true,
          signoffContent: true,
        },
      },
      rooms: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          beforeImageUrl: true,
          afterImageUrl: true,
          afterImageUrl2: true,
          selectedVariantIndex: true,
          observedChallenge: true,
          recommendation: true,
          buyerPsychology: true,
        },
      },
      materialSwatches: {
        select: {
          id: true,
          name: true,
          hexCode: true,
          materialType: true,
          useCase: true,
          vendor: true,
          sku: true,
        },
      },
      procurementItems: {
        select: {
          id: true,
          item: true,
          category: true,
          vendor: true,
          sku: true,
          estCost: true,
          status: true,
        },
      },
    },
  });
});

export async function generateMetadata({
  params,
}: ReportPageProps): Promise<Metadata> {
  const { id } = await params;
  const project = await getOwnedReportProject(id);
  return {
    title: project
      ? { absolute: `Consultation Report · ${project.propertyAddress}` }
      : "Consultation Report",
  };
}

/** ROI metrics from persisted project fields, or undefined for spec defaults. */
function buildRoiMetrics(
  project: NonNullable<Awaited<ReturnType<typeof getOwnedReportProject>>>
): ROIMetric[] | undefined {
  const { roiSalesPricePremium, roiTransactionVelocity, roiInvestmentTier } =
    project;
  if (!roiSalesPricePremium && !roiTransactionVelocity && !roiInvestmentTier) {
    return undefined;
  }

  const metrics: ROIMetric[] = [];
  if (roiSalesPricePremium) {
    metrics.push({
      value: roiSalesPricePremium,
      title: "Estimated Sales Price Premium",
      description: "Above as-is appraisal, based on comparable staged listings.",
      icon: "trending_up",
    });
  }
  if (roiTransactionVelocity) {
    metrics.push({
      value: roiTransactionVelocity,
      title: "Faster Sale Velocity",
      description: "Against the local market's average days-on-market.",
      icon: "clock",
    });
  }
  if (roiInvestmentTier) {
    metrics.push({
      value: roiInvestmentTier,
      title: "Recommended Staging Investment",
      description: "Turnkey delivery across every keyed staging zone.",
      icon: "dollar",
    });
  }
  return metrics.length > 0 ? metrics : undefined;
}

/**
 * Step 4 of the Atelier Canvas studio workflow (issue #612): the Client
 * Consultation Report & Export — editorial hero banner with property
 * specs, the executive ROI metrics dashboard (issue #624), the
 * room-by-room transformation showcase with before/after comparison
 * sliders (issue #623), the designer rationale narrative, and the
 * engagement tier + client signature acceptance flow (issue #626) via
 * `ConsultationReportClient`, closed by the Atelier Canvas proposal
 * footer (issue #643). The 5-minute preview token minted here powers the
 * client signature save (`/api/sign-project`), mirroring the PDF export
 * path.
 */
export default async function ReportPage({ params }: ReportPageProps) {
  const { id } = await params;
  const project = await getOwnedReportProject(id);

  if (!project) {
    notFound();
  }

  const previewToken = await signPreviewToken(project.id);

  const reportUser: UserData = {
    firmName: project.user.firmName,
    ownerName: project.user.ownerName,
    logoUrl: project.user.logoUrl,
    psychologyPageContent: project.user.psychologyPageContent,
    signoffContent: project.user.signoffContent,
  };

  const showcaseRooms = project.rooms
    .map((room) => ({
      id: room.id,
      name: room.name,
      beforeImageUrl: room.beforeImageUrl,
      afterImageUrl:
        room.selectedVariantIndex === 1
          ? (room.afterImageUrl2 ?? room.afterImageUrl)
          : room.afterImageUrl,
      observedChallenge: room.observedChallenge,
      recommendation: room.recommendation,
    }))
    .filter(
      (room) => room.beforeImageUrl !== null && room.afterImageUrl !== null
    );

  return (
    <div className="min-h-full bg-stone-50">
      {/* ── Workflow chrome ─────────────────────────────────────────── */}
      <header className="no-print sticky top-0 z-40 border-b border-outline-variant/30 bg-surface-container-lowest/95 px-6 py-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1560px] flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground font-jakarta">
            Step 4 of 4 — Client Consultation Report &amp; Export
          </p>
          <StudioWorkflowStepper projectId={project.id} activeStep="report" />
        </div>
      </header>

      {/* ── Editorial hero banner with property specs ───────────────── */}
      <section
        aria-label="Property hero"
        className="border-b border-outline-variant/30 bg-gradient-to-br from-surface-container-lowest via-surface-container-low to-surface-container px-6 py-14"
      >
        <div className="mx-auto max-w-4xl text-center">
          <p className="font-cinzel text-xs uppercase tracking-[0.3em] text-muted-foreground">
            Client Consultation Report
          </p>
          <h1 className="mt-3 font-playfair text-4xl font-bold text-foreground md:text-5xl">
            {project.propertyAddress}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground font-jakarta">
            Prepared for {project.clientName} · {project.user.firmName}
          </p>

          <dl className="mx-auto mt-8 grid max-w-3xl grid-cols-2 gap-4 md:grid-cols-4">
            {[
              { term: "Client", detail: project.clientName },
              { term: "Target Buyer", detail: project.targetBuyer },
              { term: "Aesthetic", detail: project.stagingAesthetic },
              {
                term: "Rooms Staged",
                detail: `${showcaseRooms.length} zone${
                  showcaseRooms.length === 1 ? "" : "s"
                }`,
              },
            ].map((spec) => (
              <div
                key={spec.term}
                className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3 py-4"
              >
                <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground font-jakarta">
                  {spec.term}
                </dt>
                <dd className="mt-1 truncate text-sm font-semibold text-foreground">
                  {spec.detail}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── Executive ROI metrics dashboard (issue #624) ─────────────── */}
      <ROIMetricsDashboard metrics={buildRoiMetrics(project)} />

      {/* ── Room-by-room transformation showcase (issue #623) ────────── */}
      <section
        aria-label="Room by room transformations"
        className="bg-stone-50 px-6 py-14"
      >
        <div className="mx-auto max-w-5xl space-y-12">
          <div className="text-center">
            <p className="font-cinzel text-xs uppercase tracking-[0.3em] text-muted-foreground">
              The Transformation
            </p>
            <h2 className="mt-2 font-playfair text-3xl font-bold text-foreground">
              Room by Room
            </h2>
          </div>

          {showcaseRooms.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground font-jakarta">
              No staged room pairs yet — complete Steps 2 and 3 to populate the
              showcase.
            </p>
          ) : (
            showcaseRooms.map((room, index) => (
              <article
                key={room.id}
                className="grid grid-cols-1 items-center gap-6 lg:grid-cols-2"
              >
                <div
                  className={
                    index % 2 === 1 ? "lg:order-2" : undefined
                  }
                >
                  <ComparisonSlider
                    report
                    beforeImageUrl={room.beforeImageUrl as string}
                    afterImageUrl={room.afterImageUrl as string}
                    beforeAlt={`${room.name} — before staging`}
                    afterAlt={`${room.name} — after staging`}
                    afterLabel={`${room.name} — staged`}
                    largeImage
                  />
                </div>
                <div className={index % 2 === 1 ? "lg:order-1" : undefined}>
                  <h3 className="font-playfair text-2xl font-semibold text-foreground">
                    {room.name}
                  </h3>
                  {room.observedChallenge && (
                    <div className="mt-4">
                      <p className="font-cinzel text-[10px] uppercase tracking-widest text-on-surface-variant">
                        The Challenge
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-foreground font-jakarta">
                        {room.observedChallenge}
                      </p>
                    </div>
                  )}
                  {room.recommendation && (
                    <div className="mt-4">
                      <p className="font-cinzel text-[10px] uppercase tracking-widest text-on-surface-variant">
                        Our Approach
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-foreground font-jakarta">
                        {room.recommendation}
                      </p>
                    </div>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      {/* ── Designer rationale narrative ────────────────────────────── */}
      <section
        aria-label="Designer rationale"
        className="border-t border-outline-variant/30 bg-surface-container-low px-6 py-14"
      >
        <div className="mx-auto max-w-3xl text-center">
          <p className="font-cinzel text-xs uppercase tracking-[0.3em] text-muted-foreground">
            Designer Rationale
          </p>
          <h2 className="mt-2 font-playfair text-3xl font-bold text-foreground">
            Why This Works
          </h2>
          <p className="mt-6 text-base leading-relaxed text-foreground font-jakarta">
            {project.user.psychologyPageContent?.trim() ||
              project.stagingDirectives?.trim() ||
              `Every vignette in this plan is composed around ${project.targetBuyer.toLowerCase()} psychology — layered warm neutrals, deliberate sightlines, and tactile materiality that photograph as a lifestyle rather than a listing. The ${project.stagingAesthetic} directive keeps each room legible at MLS thumbnail size while rewarding the in-person walk-through.`}
          </p>
        </div>
      </section>

      {/* ── Engagement tiers + swatches + procurement + signature ────── */}
      <ConsultationReportClient
        user={reportUser}
        project={{
          id: project.id,
          propertyAddress: project.propertyAddress,
          clientName: project.clientName,
          targetBuyer: project.targetBuyer,
          stagingAesthetic: project.stagingAesthetic,
        }}
        previewToken={previewToken}
        materialSwatches={project.materialSwatches}
        procurementItems={project.procurementItems}
      />

      {/* ── Proposal footer (issue #643) ─────────────────────────────── */}
      <div className="bg-stone-50 px-6 pb-10">
        <div className="mx-auto max-w-4xl">
          <ProposalFooter />
        </div>
      </div>
    </div>
  );
}
