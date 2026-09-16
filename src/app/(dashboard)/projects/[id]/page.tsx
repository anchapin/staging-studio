"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { ComparisonSlider } from "@/components/canvas/comparison-slider";

interface Room {
  id: string;
  name: string;
  beforeImageUrl: string | null;
  afterImageUrl: string | null;
  beforeImageUrl2: string | null;
  afterImageUrl2: string | null;
  selectedVariantIndex: number | null;
}

interface Project {
  id: string;
  propertyAddress: string;
  clientName: string;
  stagingAesthetic: string;
  rooms: Room[];
}

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProject = async () => {
      const response = await fetch(`/api/projects/${id}`);
      if (response.ok) {
        const data = await response.json();
        setProject(data);
      }
      setLoading(false);
    };

    fetchProject();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-stone-800" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-2xl font-bold text-stone-800">Project not found</h1>
        <Link href="/dashboard" className="text-stone-600 hover:underline mt-4 inline-block">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200 px-8 py-4">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/dashboard" className="text-sm text-stone-500 hover:text-stone-700">
              ← Back to Dashboard
            </Link>
            <h1 className="font-playfair text-2xl font-bold text-stone-800 mt-1">
              {project.propertyAddress}
            </h1>
            <p className="text-sm text-stone-600">{project.clientName} · {project.stagingAesthetic}</p>
          </div>
          <button className="rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700">
            Export PDF
          </button>
        </div>
      </header>

      <main className="p-8">
        <h2 className="font-playfair text-xl font-semibold text-stone-800 mb-6">Rooms</h2>
        
        {project.rooms.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-stone-300 p-12 text-center">
            <p className="text-stone-600">No rooms yet.</p>
          </div>
        ) : (
          <div className="grid gap-8 md:grid-cols-2">
            {project.rooms.map((room) => (
              <ComparisonSlider
                key={room.id}
                roomName={room.name}
                originalImage={room.beforeImageUrl || ""}
                variantImage={room.afterImageUrl || ""}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
