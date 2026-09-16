"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { CoverPage, PhilosophyPage, RoomSpread, SignoffPage } from "@/components/lookbook";

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
  params: Promise<{ projectId: string }>;
}

export default function LookbookPreviewPage({ params }: LookbookPreviewPageProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState<string | null>(null);

  useEffect(() => {
    params.then((resolved) => setProjectId(resolved.projectId));
  }, [params]);

  useEffect(() => {
    if (!projectId) return;

    const fetchProject = async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
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

  return (
    <div className="lookbook-preview">
      <CoverPage
        firmName={project.user.firmName}
        propertyAddress={project.propertyAddress}
        clientName={project.clientName}
        stagingAesthetic={project.stagingAesthetic}
      />

      <PhilosophyPage
        targetBuyer={project.targetBuyer}
        psychologyPageContent={project.user.psychologyPageContent ?? undefined}
      />

      {project.rooms.map((room, index) => (
        <RoomSpread
          key={room.id}
          roomName={room.name}
          beforeImageUrl={room.beforeImageUrl}
          afterImageUrl={room.afterImageUrl}
          selectedVariantIndex={room.selectedVariantIndex}
          observedChallenge={room.observedChallenge}
          recommendation={room.recommendation}
          buyerPsychology={room.buyerPsychology}
          checklistItems={room.checklistItems}
          pageBreak={index < project.rooms.length - 1}
        />
      ))}

      <SignoffPage
        firmName={project.user.firmName}
        ownerName={project.user.ownerName}
        signoffContent={project.user.signoffContent ?? undefined}
      />
    </div>
  );
}
