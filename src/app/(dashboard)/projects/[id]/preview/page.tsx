import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import {
  PREVIEW_TOKEN_QUERY_PARAM,
  verifyPreviewToken,
} from "@/lib/preview-token";

import {
  LookbookPreviewView,
  type PreviewProject,
} from "./lookbook-preview-view";

interface LookbookPreviewPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Single Prisma fetch shared by generateMetadata and the page via React
 * `cache()` — deduped to one query per request, so the title adds no
 * fetch waterfall.
 */
const getPreviewProject = cache(async (id: string) =>
  prisma.project.findUnique({
    where: { id },
    include: {
      rooms: true,
      user: {
        select: {
          firmName: true,
          ownerName: true,
          psychologyPageContent: true,
          signoffContent: true,
        },
      },
    },
  })
);

/**
 * Token is verified before the address is read: an invalid, expired, or
 * mismatched token never leaks a propertyAddress into the title (the page
 * itself 404s in that case).
 */
export async function generateMetadata({
  params,
  searchParams,
}: LookbookPreviewPageProps): Promise<Metadata> {
  const [{ id }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);

  const rawToken = resolvedSearchParams[PREVIEW_TOKEN_QUERY_PARAM];
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;

  const verification = await verifyPreviewToken(token);
  if (!verification.valid || verification.projectId !== id) {
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
export default async function LookbookPreviewPage({
  params,
  searchParams,
}: LookbookPreviewPageProps) {
  const [{ id }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);

  const rawToken = resolvedSearchParams[PREVIEW_TOKEN_QUERY_PARAM];
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;

  const verification = await verifyPreviewToken(token);
  if (!verification.valid || verification.projectId !== id) {
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
    // The token is verified at this point, so re-requesting the same URL
    // (token intact) is a plain-server-render "Retry".
    const retryHref =
      typeof token === "string"
        ? `/projects/${id}/preview?${PREVIEW_TOKEN_QUERY_PARAM}=${encodeURIComponent(token)}`
        : `/projects/${id}/preview`;
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
    user: {
      firmName: project.user.firmName,
      ownerName: project.user.ownerName,
      psychologyPageContent: project.user.psychologyPageContent,
      signoffContent: project.user.signoffContent,
    },
    rooms: project.rooms.map((room) => ({
      id: room.id,
      name: room.name,
      beforeImageUrl: room.beforeImageUrl,
      afterImageUrl: room.afterImageUrl,
      selectedVariantIndex: room.selectedVariantIndex,
      observedChallenge: room.observedChallenge,
      recommendation: room.recommendation,
      buyerPsychology: room.buyerPsychology,
      // Already parsed/validated by parseChecklistItems in the view.
      checklistItems: room.checklistItems as PreviewProject["rooms"][number]["checklistItems"],
    })),
  };

  return <LookbookPreviewView project={previewProject} />;
}
