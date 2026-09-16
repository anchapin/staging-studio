"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import Link from "next/link";

interface Project {
  id: string;
  propertyAddress: string;
  clientName: string;
  stagingAesthetic: string;
  createdAt: string;
  rooms: { id: string; name: string }[];
}

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProjects = async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) return;

      const response = await fetch("/api/projects");
      if (response.ok) {
        const data = await response.json();
        setProjects(data);
      }
      setLoading(false);
    };

    fetchProjects();
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

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-stone-800" />
        </div>
      ) : projects.length === 0 ? (
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
          {projects.map((project) => (
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
                  {project.rooms.length} room{project.rooms.length !== 1 ? "s" : ""}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
