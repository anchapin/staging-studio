"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import Link from "next/link";

interface Room {
  id: string;
  name: string;
}

interface Project {
  id: string;
  propertyAddress: string;
  clientName: string;
  stagingAesthetic: string;
  createdAt: string;
  rooms: Room[];
}

async function fetchProjects(): Promise<Project[]> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const response = await fetch("/api/projects");
  if (!response.ok) {
    throw new Error("Failed to fetch projects");
  }
  return response.json();
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState(false);
  const isLoading = projects === null && !error;

  useEffect(() => {
    let cancelled = false;
    fetchProjects()
      .then((data) => {
        if (!cancelled) setProjects(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-playfair text-3xl font-bold text-stone-800">
            Projects
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            Manage your staging lookbooks
          </p>
        </div>

        <Link
          href="/projects/new"
          className="rounded-md bg-stone-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-700"
        >
          + New Project
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-stone-800" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-700">Failed to load projects.</p>
        </div>
      ) : projects?.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-stone-300 p-12 text-center">
          <p className="text-stone-600">No projects yet.</p>
          <p className="mt-1 text-sm text-stone-500">
            Create your first staging project to get started.
          </p>
          <Link
            href="/projects/new"
            className="mt-4 inline-block rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700"
          >
            Create Project
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects?.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <h3 className="font-playfair text-lg font-semibold text-stone-800">
                {project.propertyAddress}
              </h3>
              <p className="mt-1 text-sm text-stone-600">{project.clientName}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-700">
                  {project.stagingAesthetic}
                </span>
                <span className="text-xs text-stone-500">
                  {project.rooms.length} room
                  {project.rooms.length !== 1 ? "s" : ""}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
