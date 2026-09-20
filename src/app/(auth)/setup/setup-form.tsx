"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";

/**
 * The setup form (client island). Reachable only through the server
 * gate in `page.tsx`, which guarantees a valid session with no Prisma
 * `User` row yet — so no client-side session/check redirect is needed
 * here anymore.
 */
export function SetupForm({ email }: { email: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [firmName, setFirmName] = useState("");
  const [firmNameError, setFirmNameError] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState("");
  const [ownerNameError, setOwnerNameError] = useState<string | null>(null);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    let logoUrl: string | undefined;

    if (logoFile) {
      const ext = logoFile.name.split(".").pop();
      const fileName = `${email}-logo-${Date.now()}.${ext}`;
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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-muted to-secondary px-4">
      <div className="w-full max-w-lg space-y-8 rounded-xl bg-background p-8 shadow-xl">
        <div className="text-center">
          <h1 className="font-cinzel text-3xl font-bold tracking-tight text-foreground">
            Welcome to StagingStudio
          </h1>
          <p className="mt-2 font-playfair text-sm text-muted-foreground">
            Let&apos;s set up your studio — just a few details to get started.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="firmName" className="block text-sm font-medium text-foreground">
              Firm Name
            </label>
            <input
              id="firmName"
              type="text"
              value={firmName}
              onChange={(e) => {
                setFirmName(e.target.value);
                if (firmNameError && e.target.value.trim()) setFirmNameError(null);
              }}
              onBlur={(e) => {
                if (!e.target.value.trim()) setFirmNameError("Firm name is required");
              }}
              required
              className="mt-1 block w-full rounded-md border border-input px-3 py-2 shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Circle G Designs"
            />
            {firmNameError && (
              <p id="firmName-error" role="alert" className="mt-1 text-sm text-red-600">
                {firmNameError}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="ownerName" className="block text-sm font-medium text-foreground">
              Owner Name
            </label>
            <input
              id="ownerName"
              type="text"
              value={ownerName}
              onChange={(e) => {
                setOwnerName(e.target.value);
                if (ownerNameError && e.target.value.trim()) setOwnerNameError(null);
              }}
              onBlur={(e) => {
                if (!e.target.value.trim()) setOwnerNameError("Owner name is required");
              }}
              required
              className="mt-1 block w-full rounded-md border border-input px-3 py-2 shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Lauren Chapin"
            />
            {ownerNameError && (
              <p id="ownerName-error" role="alert" className="mt-1 text-sm text-red-600">
                {ownerNameError}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="logo" className="block text-sm font-medium text-foreground">
              Firm Logo <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              id="logo"
              type="file"
              accept="image/*"
              onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
              className="mt-1 block w-full text-sm text-muted-foreground file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-secondary file:px-4 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-accent"
            />
          </div>

          <div>
            <label htmlFor="psychologyPageContent" className="block text-sm font-medium text-foreground">
              Psychology Page Content <span className="text-muted-foreground">(lookbook page 2)</span>
            </label>
            <textarea
              id="psychologyPageContent"
              value={psychologyPageContent}
              onChange={(e) => setPsychologyPageContent(e.target.value)}
              rows={5}
              className="mt-1 block w-full rounded-md border border-input px-3 py-2 shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Describe your ideal buyer and the emotional journey you design..."
            />
          </div>

          <div>
            <label htmlFor="signoffContent" className="block text-sm font-medium text-foreground">
              Sign-off Content <span className="text-muted-foreground">(final lookbook page)</span>
            </label>
            <textarea
              id="signoffContent"
              value={signoffContent}
              onChange={(e) => setSignoffContent(e.target.value)}
              rows={5}
              className="mt-1 block w-full rounded-md border border-input px-3 py-2 shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Your closing message to the buyer..."
            />
          </div>

          {error && (
            <div
              ref={errorRef}
              role="alert"
              tabIndex={-1}
              className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary py-2.5 font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50"
          >
            {loading ? "Saving..." : "Complete Setup"}
          </button>
        </form>
      </div>
    </div>
  );
}
