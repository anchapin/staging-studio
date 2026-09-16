import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { createSupabaseRequestClient } from "@/lib/supabase";

import ProjectDetailView from "./project-detail-view";

interface ProjectDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Resolves the document title from the project's property address. Mirrors
 * the ownership semantics of GET /api/projects/[id]: the real JWT is
 * validated (fails closed), the Prisma `User` row is resolved by verified
 * email, and the project lookup is scoped to that user — so another user's
 * project id yields the generic fallback, never its address. Uses the
 * request-scoped Supabase client, whose cookie writes are swallowed in
 * Server Components (middleware performs the refresh).
 */
async function getProjectTitle(id: string): Promise<string> {
  const supabase = await createSupabaseRequestClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return "Project";

  const userRow = await prisma.user.findUnique({
    where: { email: user.email },
    select: { id: true },
  });
  if (!userRow) return "Project";

  const project = await prisma.project.findUnique({
    where: { id, userId: userRow.id },
    select: { propertyAddress: true },
  });
  return project?.propertyAddress ?? "Project";
}

export async function generateMetadata({
  params,
}: ProjectDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  return { title: await getProjectTitle(id) };
}

export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const { id } = await params;
  return <ProjectDetailView id={id} />;
}
