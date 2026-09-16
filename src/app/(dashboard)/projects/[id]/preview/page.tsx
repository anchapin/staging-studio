"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { CoverPage, PhilosophyPage, RoomSpread, SignoffPage } from "@/components/lookbook";
import type { ChecklistItem, ProjectData } from "@/components/lookbook";

interface Project {
  id: string;
  propertyAddress: string;
  clientName: string;
  targetBuyer: string;
  stagingAesthetic: string;
  user: {
    firmName: string;
    ownerName: string;
    psychologyPageContent: string | null;
    signoffContent: string | null;
  };
  rooms: Room[];
}

interface Room {
  id: string;
  name: string;
  beforeImageUrl: string | null;
  afterImageUrl: string | null;
  selectedVariantIndex: number | null;
  observedChallenge: string | null;
  recommendation: string | null;
  buyerPsychology: string | null;
  checklistItems: { item: string; category: string; priority: string }[] | null;
}

interface LookbookPreviewPageProps {
  params: Promise<{ id: string }>;
}

export default function LookbookPreviewPage({ params }: LookbookPreviewPageProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState<string | null>(null);

  useEffect(() => {
    params.then((resolved) => setProjectId(resolved.id));
  }, [params]);

  useEffect(() => {
    if (!projectId) return;

    const fetchProject = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setLoading(false);
        return;
      }

      const response = await fetch(`/api/projects/${projectId}`);
      if (response.ok) {
        const data = await response.json();
        setProject(data);
      }
      setLoading(false);
    };

    fetchProject();
  }, [projectId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center no-print">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-stone-800" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center no-print">
        <div className="text-center">
          <p className="font-jakarta text-stone-600">Project not found</p>
        </div>
      </div>
    );
  }

  const projectData: ProjectData = {
    propertyAddress: project.propertyAddress,
    clientName: project.clientName,
    targetBuyer: project.targetBuyer,
    stagingAesthetic: project.stagingAesthetic,
  };

  return (
    <div className="lookbook-preview">
      <CoverPage project={projectData} user={project.user} />

      <PhilosophyPage project={projectData} user={project.user} />

      {project.rooms.map((room) => (
        <RoomSpread
          key={room.id}
          room={{
            id: room.id,
            name: room.name,
            beforeImageUrl: room.beforeImageUrl,
            afterImageUrl: room.afterImageUrl,
            observedChallenge: room.observedChallenge,
            recommendation: room.recommendation,
            buyerPsychology: room.buyerPsychology,
            checklistItems: room.checklistItems as ChecklistItem[] | null,
            project: projectData,
            user: project.user,
          }}
          user={project.user}
          project={projectData}
        />
      ))}

      <SignoffPage
        user={project.user}
        project={projectData}
        rooms={project.rooms.map((room) => ({
          id: room.id,
          name: room.name,
          beforeImageUrl: room.beforeImageUrl,
          afterImageUrl: room.afterImageUrl,
          project: projectData,
          user: project.user,
        }))}
      />
    </div>
  );
}
