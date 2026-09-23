import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";

import { RefineStudioClient } from "./refine-studio-client";

interface RefinePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ room?: string }>;
}

/** Ownership-scoped fetch shared by generateMetadata and the page. */
const getOwnedRefineProject = cache(async (projectId: string) => {
  const user = await getAuthedPrismaUser();
  if (!user) return null;

  return prisma.project.findUnique({
    where: { id: projectId, userId: user.id },
    select: {
      id: true,
      propertyAddress: true,
      rooms: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          beforeImageUrl: true,
          afterImageUrl: true,
          beforeImageUrl2: true,
          afterImageUrl2: true,
          selectedVariantIndex: true,
          rawDirectives: true,
          inpaintRequests: {
            orderBy: { createdAt: "desc" },
            select: { id: true, status: true, resultUrl: true },
          },
        },
      },
    },
  });
});

export async function generateMetadata({
  params,
}: RefinePageProps): Promise<Metadata> {
  const { id } = await params;
  const project = await getOwnedRefineProject(id);
  return {
    title: project
      ? { absolute: `Brush Refinement · ${project.propertyAddress}` }
      : "Brush Refinement",
  };
}

/**
 * Step 3 of the Atelier Canvas studio workflow (issue #612): the Brush
 * Refinement Studio — collapsible header with room switcher, the
 * floating glassmorphic tool rail (issue #616/#627), the split
 * before/after comparison canvas with draggable divider + version
 * history (issue #618), and the collapsible 380px right inspector panel
 * (issue #617) with Cmd+B / Focus Canvas Mode (F) shortcuts.
 *
 * `?room=<id>` (appended by Step 2's "Send to Brush Refinement")
 * preselects the room under refinement.
 */
export default async function RefineStudioPage({
  params,
  searchParams,
}: RefinePageProps) {
  const { id } = await params;
  const { room } = await searchParams;
  const project = await getOwnedRefineProject(id);

  if (!project) {
    notFound();
  }

  const requestedRoom = project.rooms.find((candidate) => candidate.id === room);
  const firstRenderable = project.rooms.find(
    (candidate) =>
      candidate.beforeImageUrl !== null &&
      (candidate.afterImageUrl !== null ||
        candidate.inpaintRequests.some(
          (request) => request.status === "COMPLETED" && request.resultUrl
        ))
  );
  const initialRoomId =
    (requestedRoom && requestedRoom.beforeImageUrl ? requestedRoom.id : null) ??
    firstRenderable?.id ??
    project.rooms[0]?.id ??
    null;

  return (
    <RefineStudioClient
      projectId={project.id}
      propertyAddress={project.propertyAddress}
      initialRoomId={initialRoomId}
      rooms={project.rooms.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        beforeImageUrl: candidate.beforeImageUrl,
        afterImageUrl: candidate.afterImageUrl,
        afterImageUrl2: candidate.afterImageUrl2,
        selectedVariantIndex: candidate.selectedVariantIndex,
        rawDirectives: candidate.rawDirectives,
        completedRequestIds: candidate.inpaintRequests
          .filter(
            (request) => request.status === "COMPLETED" && request.resultUrl
          )
          .map((request) => request.id),
        variations: candidate.inpaintRequests
          .filter(
            (request) => request.status === "COMPLETED" && request.resultUrl
          )
          .map((request) => ({
            id: request.id,
            resultUrl: request.resultUrl as string,
          })),
      }))}
    />
  );
}
