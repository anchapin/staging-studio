"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import { updateUserSettings } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast, ToastContainer } from "@/components/ui/toast";

interface SettingsFormProps {
  email: string;
  initial: {
    firmName: string;
    ownerName: string;
    logoUrl: string | null;
    psychologyPageContent: string | null;
    signoffContent: string | null;
  };
}

/**
 * The /settings form (client island). Reachable only through the server
 * gate in `page.tsx`, which guarantees an authenticated user with an
 * existing Prisma `User` row — the form is prefilled from that row and
 * saves through the `updateUserSettings` server action, which always
 * updates (never creates) the caller's own row.
 *
 * Logo upload reuses the /setup flow's exact client-side path: direct
 * upload to the Supabase Storage `logos` bucket (bucket policies must
 * allow the authed user), filename `${email}-logo-${Date.now()}.${ext}`
 * with `upsert: true`, then the bucket's public URL is stored in
 * `logoUrl`. Choosing no file keeps the current logo untouched.
 */
export default function SettingsForm({ email, initial }: SettingsFormProps) {
  const [firmName, setFirmName] = useState(initial.firmName);
  const [ownerName, setOwnerName] = useState(initial.ownerName);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [psychologyPageContent, setPsychologyPageContent] = useState(
    initial.psychologyPageContent ?? ""
  );
  const [signoffContent, setSignoffContent] = useState(
    initial.signoffContent ?? ""
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const { toasts, showSuccess, dismissToast } = useToast();

  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
    }
  }, [error]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);

    // No new file → keep the existing logo as-is (mirrors /setup, which
    // has no "clear logo" affordance either).
    let logoUrl = initial.logoUrl ?? "";

    if (logoFile) {
      const supabase = createClient();
      const ext = logoFile.name.split(".").pop();
      const fileName = `${email}-logo-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("logos")
        .upload(fileName, logoFile, { upsert: true });

      if (uploadError) {
        setError("Failed to upload logo: " + uploadError.message);
        setSaving(false);
        return;
      }

      const { data: urlData } = supabase.storage
        .from("logos")
        .getPublicUrl(fileName);
      logoUrl = urlData.publicUrl;
    }

    const result = await updateUserSettings({
      firmName,
      ownerName,
      logoUrl,
      psychologyPageContent,
      signoffContent,
    });

    if (result.success) {
      setSaved(true);
      showSuccess("Settings saved");
    } else {
      setError(result.error || "Failed to save settings");
    }
    setSaving(false);
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-md space-y-8">
      <fieldset className="rounded-md border p-4 space-y-4">
        <legend className="text-lg font-semibold text-foreground px-1">
          Firm Branding
        </legend>

        <div>
          <label
            htmlFor="firmName"
            className="block text-sm font-medium text-foreground"
          >
            Firm Name
          </label>
          <Input
            id="firmName"
            type="text"
            value={firmName}
            onChange={(e) => setFirmName(e.target.value)}
            required
            placeholder="Circle G Designs"
          />
        </div>

        <div>
          <label
            htmlFor="ownerName"
            className="block text-sm font-medium text-foreground"
          >
            Owner Name
          </label>
          <Input
            id="ownerName"
            type="text"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            required
            placeholder="Lauren Chapin"
          />
        </div>

        <div>
          <label
            htmlFor="logo"
            className="block text-sm font-medium text-foreground"
          >
            Firm Logo <span className="text-muted-foreground">(optional)</span>
          </label>
          {initial.logoUrl ? (
            <div className="mt-1 space-y-2">
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={initial.logoUrl}
                  alt="Current firm logo"
                  className="h-10 w-auto object-contain rounded border"
                />
                <label
                  htmlFor="logo-replace"
                  className="cursor-pointer rounded-md border border-ring bg-secondary px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
                >
                  Replace
                </label>
                <input
                  id="logo-replace"
                  type="file"
                  accept="image/*"
                  onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                  className="sr-only"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Upload a new file to replace the current logo.
              </p>
            </div>
          ) : (
            <input
              id="logo"
              type="file"
              accept="image/*"
              onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
              className="mt-1 block w-full text-sm text-muted-foreground file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-secondary file:px-4 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted"
            />
          )}
        </div>
      </fieldset>

      <fieldset className="rounded-md border p-4 space-y-4">
        <legend className="text-lg font-semibold text-foreground px-1">
          Lookbook Templates
        </legend>

        <div>
          <label
            htmlFor="psychologyPageContent"
            className="block text-sm font-medium text-foreground"
          >
            Philosophy Page{" "}
            <span className="text-muted-foreground">(page 2)</span>
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Add a paragraph describing your ideal buyer and the emotional journey
            you design for them.
          </p>
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
          <label
            htmlFor="signoffContent"
            className="block text-sm font-medium text-foreground"
          >
            Closing Page
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Add your closing message to the buyer — this appears as the final
            page of every lookbook.
          </p>
          <textarea
            id="signoffContent"
            value={signoffContent}
            onChange={(e) => setSignoffContent(e.target.value)}
            rows={5}
            className="mt-1 block w-full rounded-md border border-input px-3 py-2 shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Your closing message to the buyer..."
          />
        </div>
      </fieldset>

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

      {saved && !error && (
        <div
          role="status"
          className="rounded-md bg-green-50 p-3 text-sm text-green-700"
        >
          Settings saved.
        </div>
      )}

      <Button
        type="submit"
        disabled={saving}
      >
        {saving ? "Saving..." : "Save Settings"}
      </Button>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </form>
  );
}
