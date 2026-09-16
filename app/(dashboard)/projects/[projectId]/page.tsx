"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import RoomCanvas from "@/components/canvas/room-canvas";

interface Room {
  id: string;
  name: string;
  beforeImageUrl: string | null;
  afterImageUrl: string | null;
}

interface Project {
  id: string;
  propertyAddress: string;
  clientName: string;
  stagingAesthetic: string;
  rooms: Room[];
}

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default function ProjectPage({ params }: PageProps) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    params.then((p) => setProjectId(p.projectId));
  }, [params]);

  useEffect(() => {
    if (!projectId) return;

    const fetchProject = async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) return;

      const response = await fetch(`/api/projects/${projectId}`);
      if (response.ok) {
        const data = await response.json();
        setProject(data);
      }
      setLoading(false);
    };

    fetchProject();
  }, [projectId]);

  if (!projectId || loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-stone-800" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-8 text-center">
        <p className="text-stone-600">Project not found.</p>
        <Link
          href="/dashboard"
          className="mt-4 inline-block text-sm text-stone-600 hover:text-stone-800"
        >
          Back to Projects
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-stone-600 hover:text-stone-800"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Projects
        </Link>
      </div>

      <div className="mb-8">
        <h1 className="font-playfair text-3xl font-bold text-stone-800">
          {project.propertyAddress}
        </h1>
        <div className="mt-2 flex items-center gap-4">
          <p className="text-sm text-stone-600">{project.clientName}</p>
          <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-700">
            {project.stagingAesthetic}
          </span>
        </div>
      </div>

      <div className="mb-8">
        <h2 className="font-playfair text-xl font-semibold text-stone-800 mb-4">
          Rooms
        </h2>
        {project.rooms.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-stone-300 p-12 text-center">
            <p className="text-stone-600">No rooms added yet.</p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {project.rooms.map((room) => (
              <div key={room.id} className="space-y-3">
                <h3 className="font-medium text-stone-800">{room.name}</h3>
                <RoomCanvas
                  roomId={room.id}
                  projectId={project.id}
                  imageUrl={room.beforeImageUrl}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
