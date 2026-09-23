import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";

import { RoomsStudioClient } from "./rooms-studio-client";

interface RoomsPageProps {
  params: Promise<{ id: string }>;
}

/** Ownership-scoped fetch shared by generateMetadata and the page. */
const getOwnedRoomsProject = cache(async (projectId: string) => {
  const user = await getAuthedPrismaUser();
  if (!user) return null;

  return prisma.project.findUnique({
    where: { id: projectId, userId: user.id },
    select: {
      id: true,
      propertyAddress: true,
      clientName: true,
      stagingAesthetic: true,
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
            select: { id: true, status: true },
          },
        },
      },
    },
  });
});

export async function generateMetadata({
  params,
}: RoomsPageProps): Promise<Metadata> {
  const { id } = await params;
  const project = await getOwnedRoomsProject(id);
  return {
    title: project
      ? { absolute: `Room Batch Studio · ${project.propertyAddress}` }
      : "Room Batch Studio",
  };
}

/**
 * Step 2 of the Atelier Canvas studio workflow (issue #612): the Room
 * Batch Stage & AI Generation Studio — the workbench shell (issue #620)
 * with the collapsible Rooms & Zones hierarchy sidebar (issue #634), the
 * Global Staging Directives bar (issue #636), the room card matrix
 * (issue #622), and the persistent bottom dock whose "Send to Brush
 * Refinement" CTA advances to Step 3.
 */
export default async function RoomsStudioPage({ params }: RoomsPageProps) {
  const { id } = await params;
  const project = await getOwnedRoomsProject(id);

  if (!project) {
    notFound();
  }

  return (
    <RoomsStudioClient
      project={{
        id: project.id,
        propertyAddress: project.propertyAddress,
        clientName: project.clientName,
        stagingAesthetic: project.stagingAesthetic,
        rooms: project.rooms.map((room) => ({
          id: room.id,
          name: room.name,
          beforeImageUrl: room.beforeImageUrl,
          afterImageUrl: room.afterImageUrl,
          beforeImageUrl2: room.beforeImageUrl2,
          afterImageUrl2: room.afterImageUrl2,
          selectedVariantIndex: room.selectedVariantIndex,
          rawDirectives: room.rawDirectives,
          activeRequestCount: room.inpaintRequests.filter(
            (request) =>
              request.status === "IN_QUEUE" || request.status === "IN_PROGRESS"
          ).length,
        })),
      }}
    />
  );
}
