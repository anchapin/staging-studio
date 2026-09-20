"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { resolveLoginErrorMessage } from "@/lib/login-error";

function LoginForm() {
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [loading, setLoading] = useState(false);
  // A failed /auth/callback exchange lands back here with
  // ?error=auth_callback_failed — surface it in the same banner used for
  // client-side sign-in errors instead of a silent form (issue #91).
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(
    () => {
      if (!errorParam) return null;
      const text = resolveLoginErrorMessage(errorParam);
      return text ? { type: "error" as const, text } : null;
    }
  );
  const messageRef = useRef<HTMLDivElement>(null);

  const supabase = createClient();

  useEffect(() => {
    if (message) {
      messageRef.current?.focus();
    }
  }, [message]);

  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMessage({ type: "error", text: error.message });
    } else {
      window.location.href = "/dashboard";
    }
    setLoading(false);
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setMessage({ type: "error", text: error.message });
    } else {
      setMessage({ type: "success", text: "Check your email for the magic link!" });
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-secondary to-muted px-4">
      <div className="w-full max-w-md space-y-8 rounded-xl bg-background p-8 shadow-xl">
        <div className="text-center">
          <h1 className="font-cinzel text-3xl font-bold tracking-tight text-foreground">
            StagingStudio
          </h1>
          <p className="mt-2 font-playfair text-sm text-muted-foreground">
            AI-Assisted Home Staging Lookbooks
          </p>
        </div>

        <div
          className="flex gap-2 rounded-lg bg-secondary p-1"
          role="group"
          aria-label="Sign-in method"
          aria-live="polite"
        >
          <button
            type="button"
            onClick={() => setMode("password")}
            aria-pressed={mode === "password"}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
              mode === "password"
                ? "bg-background shadow text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Password
          </button>
          <button
            type="button"
            onClick={() => setMode("magic")}
            aria-pressed={mode === "magic"}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
              mode === "magic"
                ? "bg-background shadow text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Magic Link
          </button>
        </div>

        <form onSubmit={mode === "password" ? handlePasswordSignIn : handleMagicLink} className="space-y-6">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-foreground">
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-input px-3 py-2 shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="you@example.com"
            />
          </div>

          {mode === "password" && (
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="mt-1 block w-full rounded-md border border-input px-3 py-2 shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="••••••••"
              />
            </div>
          )}

          {message && (
            <div
              ref={messageRef}
              role="alert"
              tabIndex={-1}
              className={`rounded-md p-3 text-sm ${
                message.type === "error"
                  ? "bg-red-50 text-red-700"
                  : "bg-green-50 text-green-700"
              }`}
            >
              {message.text}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary py-2.5 font-medium text-primary-foreground transition-colors hover:bg-primary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50"
          >
            {loading ? "Please wait..." : mode === "password" ? "Sign In" : "Send Magic Link"}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          For Circle G Designs — Lauren Chapin
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams requires a Suspense boundary for the prerendered
  // client shell; the form mounts inside it once the URL is available.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
