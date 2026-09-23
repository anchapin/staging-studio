import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { StudioWorkflowStepper } from "@/components/dashboard/studio-workflow-stepper";

import { SetupStudioClient } from "./setup-studio-client";

interface SetupPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Single ownership-scoped fetch shared by generateMetadata and the page
 * (same `cache()` pattern as the lookbook page): another user's project
 * id resolves to null → not-found, never the project's data.
 */
const getOwnedSetupProject = cache(async (projectId: string) => {
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
    },
  });
});

export async function generateMetadata({
  params,
}: SetupPageProps): Promise<Metadata> {
  const { id } = await params;
  const project = await getOwnedSetupProject(id);
  return {
    title: project
      ? { absolute: `Client Setup · ${project.propertyAddress}` }
      : "Client Setup",
  };
}

/**
 * Step 1 of the Atelier Canvas studio workflow (issue #612): the Client
 * Project Setup screen — property & client intake, Staging Scope Matrix,
 * consultation goal, the moodboard selector (issue #621) with its AI
 * micro-parameter sliders, and the sticky bottom consultation action bar
 * (issue #619).
 */
export default async function SetupPage({ params }: SetupPageProps) {
  const { id } = await params;
  const project = await getOwnedSetupProject(id);

  if (!project) {
    notFound();
  }

  return (
    <div className="min-h-full bg-surface-container-low pb-24">
      <header className="border-b border-outline-variant/30 bg-surface-container-lowest/95 px-6 py-4 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1560px] flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground font-jakarta">
              Step 1 of 4 — Client Project Setup
            </p>
            <h1 className="font-playfair text-2xl font-semibold text-foreground">
              {project.propertyAddress}
            </h1>
          </div>
          <StudioWorkflowStepper projectId={project.id} activeStep="setup" />
        </div>
      </header>

      <SetupStudioClient
        project={{
          id: project.id,
          propertyAddress: project.propertyAddress,
          clientName: project.clientName,
          targetBuyer: project.targetBuyer,
          stagingAesthetic: project.stagingAesthetic,
          stagingDirectives: project.stagingDirectives,
        }}
      />
    </div>
  );
}
