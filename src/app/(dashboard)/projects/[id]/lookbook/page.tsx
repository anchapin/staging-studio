import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import type { PreviewProject } from "@/app/(print)/preview/[id]/lookbook-preview-view";

import { LookbookEditor } from "./lookbook-editor";
import type { ROIMetric } from "@/components/lookbook";

interface LookbookPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Single Prisma fetch shared by generateMetadata and the page via React
 * `cache()` — one ownership-scoped query per navigation. The include
 * mirrors the /preview/[id] fetch exactly so both routes feed the same
 * renderer with the same data semantics (all rooms, insertion order).
 */
const getOwnedLookbookProject = cache(async (projectId: string) => {
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
      roiSalesPricePremium: true,
      roiTransactionVelocity: true,
      roiInvestmentTier: true,
      clientSignature: true,
      clientSignatureStatus: true,
      clientSignatureTimestamp: true,
      user: {
        select: {
          firmName: true,
          ownerName: true,
          logoUrl: true,
          psychologyPageContent: true,
          signoffContent: true,
        },
      },
      rooms: true,
      materialSwatches: true,
    },
  });
});

export async function generateMetadata({
  params,
}: LookbookPageProps): Promise<Metadata> {
  const { id } = await params;
  const project = await getOwnedLookbookProject(id);
  return {
    title: project
      ? { absolute: `Lookbook · ${project.propertyAddress}` }
      : "Lookbook",
  };
}

/**
 * Lookbook view/edit page for the owning firm (issue #250). Session-
 * authed by the (dashboard) layout plus an ownership-scoped fetch here:
 * another user's project id renders the not-found state, never the
 * project's data. The paper preview reuses the exact components and data
 * mapping as /preview/[id] — same cover, philosophy, room spreads, and
 * signoff, scaled to letter proportions on screen via `.paper-preview`.
 */
export default async function LookbookPage({ params }: LookbookPageProps) {
  const { id } = await params;
  const project = await getOwnedLookbookProject(id);

  if (!project) {
    notFound();
  }

  const previewProject: PreviewProject = {
    id: project.id,
    propertyAddress: project.propertyAddress,
    clientName: project.clientName,
    targetBuyer: project.targetBuyer,
    stagingAesthetic: project.stagingAesthetic,
    roiMetrics: buildROIMetrics(project),
    clientSignature: project.clientSignature,
    clientSignatureStatus: project.clientSignatureStatus,
    clientSignatureTimestamp: project.clientSignatureTimestamp
      ? project.clientSignatureTimestamp.toISOString()
      : null,
    user: {
      firmName: project.user.firmName,
      ownerName: project.user.ownerName,
      logoUrl: project.user.logoUrl,
      psychologyPageContent: project.user.psychologyPageContent,
      signoffContent: project.user.signoffContent,
    },
    rooms: project.rooms.map((room) => ({
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
      // Parsed/validated by parseChecklistItems inside the view.
      checklistItems:
        room.checklistItems as PreviewProject["rooms"][number]["checklistItems"],
    })),
    materialSwatches: project.materialSwatches,
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="no-print mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-playfair text-2xl font-bold text-stone-800">
            Lookbook
          </h1>
          <p className="text-sm text-stone-500">{project.propertyAddress}</p>
        </div>
        <Link
          href={`/projects/${id}`}
          className="rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100"
        >
          Back to project
        </Link>
      </div>

      {/* Letter-proportioned on-screen rendering of the print lookbook —
          see .paper-preview in globals.css (issue #250). Edit/Preview
          modes, autosave, and generate-once live in LookbookEditor. */}
      <LookbookEditor project={previewProject} />
    </div>
  );
}

/** Build ROI metrics array from project fields, or null for defaults. */
function buildROIMetrics(
  project: Awaited<ReturnType<typeof getOwnedLookbookProject>>
): ROIMetric[] | null {
  if (!project) return null;
  const { roiSalesPricePremium, roiTransactionVelocity, roiInvestmentTier } =
    project;
  if (!roiSalesPricePremium && !roiTransactionVelocity && !roiInvestmentTier)
    return null;

  const metrics: ROIMetric[] = [];

  if (roiSalesPricePremium) {
    metrics.push({
      value: roiSalesPricePremium,
      title: "Estimated Sales Price Premium",
      description:
        "Generates equity over vacant baseline based on comparable staged properties in the local market.",
      icon: "trending_up",
    });
  }

  if (roiTransactionVelocity) {
    metrics.push({
      value: roiTransactionVelocity,
      title: "Faster Transaction Velocity",
      description:
        "Staged homes sell faster with fewer listing price reductions in your market area.",
      icon: "clock",
    });
  }

  if (roiInvestmentTier) {
    metrics.push({
      value: roiInvestmentTier,
      title: "Recommended Investment Tier",
      description:
        "Turnkey physical delivery across all zones — furniture placement, artwork, and finishing touches included.",
      icon: "dollar",
    });
  }

  return metrics.length > 0 ? metrics : null;
}
