import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";

import { EditRoomStudioMount } from "./edit-room-studio-mount";

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

  // Issue #1345 — flag-gated mount of `<EditRoomStudio>` (#1342 / #1344).
  // When ON, the legacy `RefineStudioClient` is unreachable; the new
  // studio (single focused room via the `?room=` searchParam) takes over.
  // The room the URL selected (via `requestedRoom` / `initialRoomId`)
  // Issue #1346 — `isEditRoomRedesignEnabled` (the kill-switch
  // flag) and the legacy `RefineStudioClient` fallback are gone.
  // The new `<EditRoomStudioMount>` is the only mount; when
  // `initialRoomId` is missing the focused room, render nothing
  // (the user is expected to pick a room from the project view
  // and the URL will re-render with a valid `?room=`).
  const focusedRoomForNewStudio =
    project.rooms.find((candidate) => candidate.id === initialRoomId) ?? null;

  if (focusedRoomForNewStudio) {
    return (
      <EditRoomStudioMount
        project={{
          id: project.id,
          propertyAddress: project.propertyAddress,
        }}
        focusedRoom={{
          id: focusedRoomForNewStudio.id,
          name: focusedRoomForNewStudio.name,
          beforeImageUrl: focusedRoomForNewStudio.beforeImageUrl,
          afterImageUrl: focusedRoomForNewStudio.afterImageUrl,
          afterImageUrl2: focusedRoomForNewStudio.afterImageUrl2,
          selectedVariantIndex: focusedRoomForNewStudio.selectedVariantIndex,
          rawDirectives: focusedRoomForNewStudio.rawDirectives,
        }}
      />
    );
  }

  return null;
}
