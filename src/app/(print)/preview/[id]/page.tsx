import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { PREVIEW_TOKEN_QUERY_PARAM } from "@/lib/preview-token";
import {
  extractPreviewToken,
  getPreviewAccess as resolvePreviewAccessRequest,
} from "@/lib/preview-access";

import {
  LookbookPreviewView,
  type PreviewProject,
} from "./lookbook-preview-view";
import { EditLookbookDropdown } from "@/components/lookbook/edit-lookbook-dropdown";
import type { ROIMetric } from "@/components/lookbook";

interface LookbookPreviewPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * React `cache()` dedupes ONE access resolution per request, shared by
 * generateMetadata and the page (same trick as getPreviewProject below).
 */
const getPreviewAccess = cache(resolvePreviewAccessRequest);

/**
 * Single Prisma fetch shared by generateMetadata and the page via React
 * `cache()` — deduped to one query per request, so the title adds no
 * fetch waterfall.
 */
const getPreviewProject = cache(async (id: string) =>
  prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      propertyAddress: true,
      clientName: true,
      targetBuyer: true,
      stagingAesthetic: true,
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
      rooms: true,
    },
  })
);

/**
 * Access is resolved (token OR owning session, see src/lib/preview-access.ts)
 * before the address is read: a denied request never leaks a
 * propertyAddress into the title (the page itself 404s in that case).
 */
export async function generateMetadata({
  params,
  searchParams,
}: LookbookPreviewPageProps): Promise<Metadata> {
  const [{ id }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);

  const allowed = await getPreviewAccess(
    id,
    extractPreviewToken(resolvedSearchParams)
  );
  if (!allowed) {
    return { title: "Lookbook Preview" };
  }

  // A thrown data-layer error falls back to the generic title too — only a
  // successfully loaded project earns the address in the document title.
  try {
    const project = await getPreviewProject(id);
    if (!project) {
      return { title: "Lookbook Preview" };
    }

    return {
      title: { absolute: `Lookbook Preview · ${project.propertyAddress}` },
    };
  } catch {
    return { title: "Lookbook Preview" };
  }
}

/**
 * Lookbook preview, server-rendered. Access is authorized by the signed
 * preview token (see src/lib/preview-token.ts): the token must be valid,
 * unexpired, and scoped to THIS URL's projectId — a forged or mismatched
 * token 404s instead of rendering an arbitrary project. Data is fetched
 * here with Prisma so the lookbook markup reaches Browserless in the HTML
 * response without a client-side auth + fetch chain.
 */
/**
 * Lookbook preview, server-rendered. Access is authorized by EITHER the
 * signed preview token (see src/lib/preview-token.ts) — the cookie-less
 * Browserless PDF-export flow — OR an authenticated session whose user
 * owns the project (see src/lib/preview-access.ts): the human
 * "Preview Lookbook" button links here without a token. Everything else —
 * anonymous without a token, invalid/expired/mismatched tokens,
 * non-owner sessions — 404s instead of rendering or leaking existence.
 * Data is fetched here with Prisma so the lookbook markup reaches
 * Browserless in the HTML response without a client-side auth + fetch
 * chain.
 */
export default async function LookbookPreviewPage({
  params,
  searchParams,
}: LookbookPreviewPageProps) {
  const [{ id }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);

  const token = extractPreviewToken(resolvedSearchParams);

  const allowed = await getPreviewAccess(id, token);
  if (!allowed) {
    notFound();
  }

  // Only a real miss (no row) is a 404. A thrown data-layer error is a
  // load failure (issue #90): render an inline retryable error state
  // server-side instead of crashing the page or faking data loss.
  let project: Awaited<ReturnType<typeof getPreviewProject>>;
  try {
    project = await getPreviewProject(id);
  } catch (error) {
    console.error("Error loading preview project:", error);
    // Access was already granted (token or owning session), so
    // re-requesting the same URL replays it as a plain-server-render
    // "Retry". The token, when present, is preserved on the real
    // /preview/:id route (issue #254: this link previously pointed at the
    // removed /projects/:id/preview route and 404ed itself).
    const retryHref = `/preview/${id}${
      token ? `?${PREVIEW_TOKEN_QUERY_PARAM}=${encodeURIComponent(token)}` : ""
    }`;
    return (
      <div className="p-8">
        <div
          role="alert"
          className="mx-auto mt-8 max-w-lg rounded-lg border border-red-200 bg-red-50 p-6 text-center"
        >
          <p className="text-red-700">Couldn&apos;t load this project.</p>
          <a
            href={retryHref}
            className="mt-4 inline-block rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700"
          >
            Retry
          </a>
        </div>
      </div>
    );
  }

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
      // Already parsed/validated by parseChecklistItems in the view.
      checklistItems: room.checklistItems as PreviewProject["rooms"][number]["checklistItems"],
    })),
  };

  // Session-origin access (no token) is the owning firm browsing their
  // book — offer the lookbook edit page (issue #250). The Browserless
  // token path never sees the link, so the captured PDF is untouched;
  // .no-print additionally keeps it out of any manual browser printing.
  return (
    <div>
      {!token && (
        <div className="no-print flex justify-end p-4">
          <EditLookbookDropdown
            projectId={id}
            firstRoomId={project.rooms[0]?.id ?? null}
          />
        </div>
      )}
      <LookbookPreviewView project={previewProject} previewToken={token ?? undefined} />
    </div>
  );
}

/**
 * Build ROI metrics array from project fields.
 * Returns null when no ROI fields are set — the dashboard component
 * renders its built-in defaults in that case.
 */
function buildROIMetrics(
  project: Awaited<ReturnType<typeof getPreviewProject>>
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
