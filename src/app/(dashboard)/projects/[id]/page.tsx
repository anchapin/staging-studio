import type { Metadata } from "next";
import Link from "next/link";

import { getProjectDetailForUser } from "@/lib/dashboard-data";

import ProjectDetailView from "./project-detail-view";

interface ProjectDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Both the metadata read and the page body await the same `cache()`d
 * loader (issue #83), so one navigation runs the auth check and project
 * query once — previously generateMetadata and a client fetch each did
 * their own auth round-trip plus query. The ownership scoping mirrors GET
 * /api/projects/[id]: another user's project id yields null, which
 * renders the generic metadata fallback and the not-found state, never
 * the project's data.
 */
export async function generateMetadata({
  params,
}: ProjectDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const project = await getProjectDetailForUser(id);
  return { title: project?.propertyAddress ?? "Project" };
}

export default async function ProjectDetailPage({
  params,
}: ProjectDetailPageProps) {
  const { id } = await params;
  const project = await getProjectDetailForUser(id);

  if (!project) {
    // Authenticated-but-unowned/missing id. Server-rendered so first
    // paint needs no JS; the client view's fetch states remain for
    // interactive refetches only.
    return (
      <div className="p-8 text-center">
        <h1 className="text-2xl font-bold text-stone-800">Project not found</h1>
        <Link
          href="/dashboard"
          className="text-stone-600 hover:underline mt-4 inline-block"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  return <ProjectDetailView id={id} initialProject={project} />;
}
