"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function SetupPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<{ user?: { email?: string } } | null>(null);
  const [firmName, setFirmName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [psychologyPageContent, setPsychologyPageContent] = useState("");
  const [signoffContent, setSignoffContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
    }
  }, [error]);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      setSession(data.user ? { user: data.user } : null);
      if (!data.user) {
        router.push("/login");
        return;
      }
      const res = await fetch("/api/setup/check");
      if (res.ok) {
        router.push("/dashboard");
      }
    });
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    let logoUrl: string | undefined;

    if (logoFile) {
      const ext = logoFile.name.split(".").pop();
      const fileName = `${session?.user?.email}-logo-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("logos")
        .upload(fileName, logoFile, { upsert: true });

      if (uploadError) {
        setError("Failed to upload logo: " + uploadError.message);
        setLoading(false);
        return;
      }

      const { data: urlData } = supabase.storage
        .from("logos")
        .getPublicUrl(fileName);
      logoUrl = urlData.publicUrl;
    }

    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firmName,
        ownerName,
        logoUrl,
        psychologyPageContent,
        signoffContent,
      }),
    });

    if (res.ok) {
      router.push("/dashboard");
    } else {
      const data = await res.json();
      setError(data.error || "Failed to save setup");
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-stone-100 to-stone-200 px-4">
      <div className="w-full max-w-lg space-y-8 rounded-xl bg-white p-8 shadow-xl">
        <div className="text-center">
          <h1 className="font-cinzel text-3xl font-bold tracking-tight text-stone-800">
            Welcome to StagingStudio
          </h1>
          <p className="mt-2 font-playfair text-sm text-stone-600">
            Let&apos;s set up your studio — just a few details to get started.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="firmName" className="block text-sm font-medium text-stone-700">
              Firm Name
            </label>
            <input
              id="firmName"
              type="text"
              value={firmName}
              onChange={(e) => setFirmName(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-stone-300 px-3 py-2 shadow-sm focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
              placeholder="Circle G Designs"
            />
          </div>

          <div>
            <label htmlFor="ownerName" className="block text-sm font-medium text-stone-700">
              Owner Name
            </label>
            <input
              id="ownerName"
              type="text"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-stone-300 px-3 py-2 shadow-sm focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
              placeholder="Lauren Chapin"
            />
          </div>

          <div>
            <label htmlFor="logo" className="block text-sm font-medium text-stone-700">
              Firm Logo <span className="text-stone-400">(optional)</span>
            </label>
            <input
              id="logo"
              type="file"
              accept="image/*"
              onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
              className="mt-1 block w-full text-sm text-stone-500 file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-stone-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-stone-700 hover:file:bg-stone-200"
            />
          </div>

          <div>
            <label htmlFor="psychologyPageContent" className="block text-sm font-medium text-stone-700">
              Psychology Page Content <span className="text-stone-400">(lookbook page 2)</span>
            </label>
            <textarea
              id="psychologyPageContent"
              value={psychologyPageContent}
              onChange={(e) => setPsychologyPageContent(e.target.value)}
              rows={5}
              className="mt-1 block w-full rounded-md border border-stone-300 px-3 py-2 shadow-sm focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
              placeholder="Describe your ideal buyer and the emotional journey you design..."
            />
          </div>

          <div>
            <label htmlFor="signoffContent" className="block text-sm font-medium text-stone-700">
              Sign-off Content <span className="text-stone-400">(final lookbook page)</span>
            </label>
            <textarea
              id="signoffContent"
              value={signoffContent}
              onChange={(e) => setSignoffContent(e.target.value)}
              rows={5}
              className="mt-1 block w-full rounded-md border border-stone-300 px-3 py-2 shadow-sm focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
              placeholder="Your closing message to the buyer..."
            />
          </div>

          {error && (
            <div
              ref={errorRef}
              role="alert"
              tabIndex={-1}
              className="rounded-md bg-red-50 p-3 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-stone-800 py-2.5 font-medium text-white transition-colors hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {loading ? "Saving..." : "Complete Setup"}
          </button>
        </form>
      </div>
    </div>
  );
}
