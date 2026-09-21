"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { resolveLoginErrorMessage } from "@/lib/login-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function LoginForm() {
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [loading, setLoading] = useState(false);
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);
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
  // Tracks whether the most recent password sign-in attempt produced a failure
  // so we can surface the Magic Link hint.
  const [passwordFailed, setPasswordFailed] = useState(false);
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
      setPasswordFailed(true);
    } else {
      window.location.href = "/dashboard";
    }
    setLoading(false);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setEmailError("Email is required");
      return;
    }
    setForgotPasswordLoading(true);
    setMessage(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback`,
    });
    if (error) {
      setMessage({ type: "error", text: error.message });
    } else {
      setMessage({
        type: "success",
        text: "Password reset email sent! Check your inbox to set a new password.",
      });
      setPasswordFailed(false);
    }
    setForgotPasswordLoading(false);
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
            onClick={() => {
              setMode("password");
              setEmailError(null);
              setPasswordError(null);
              setMessage(null);
            }}
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
            onClick={() => {
              setMode("magic");
              setEmailError(null);
              setPasswordError(null);
              setMessage(null);
            }}
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
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError && e.target.value.trim()) setEmailError(null);
              }}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (!value) {
                  setEmailError("Email is required");
                } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                  setEmailError("Please enter a valid email address");
                }
              }}
              required
              aria-invalid={!!emailError}
              aria-describedby={emailError ? "email-error" : undefined}
              error={!!emailError}
              placeholder="you@example.com"
            />
            {emailError && (
              <p id="email-error" role="alert" className="mt-1 text-sm text-red-600">
                {emailError}
              </p>
            )}
          </div>

          {mode === "password" && (
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground">
                Password
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (passwordError && e.target.value) setPasswordError(null);
                }}
                onBlur={(e) => {
                  if (!e.target.value) setPasswordError("Password is required");
                }}
                required
                aria-invalid={!!passwordError}
                aria-describedby={passwordError ? "password-error" : undefined}
                error={!!passwordError}
                placeholder="Enter your password"
              />
              {passwordError && (
                <p id="password-error" role="alert" className="mt-1 text-sm text-red-600">
                  {passwordError}
                </p>
              )}
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={forgotPasswordLoading}
                className="mt-2 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
              >
                {forgotPasswordLoading ? "Please wait..." : "Forgot password?"}
              </button>
            </div>
          )}

          {message && (
            <div
              ref={messageRef}
              role="alert"
              tabIndex={-1}
              className={`rounded-md p-3 text-sm ${
                message.type === "error"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-green-500/10 text-green-600 dark:text-green-400"
              }`}
            >
              {message.text}
            </div>
          )}

          {passwordFailed && message?.type === "error" && mode === "password" && (
            <p className="text-sm text-muted-foreground">
              Don&apos;t have a password yet?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("magic");
                  setPasswordFailed(false);
                  setMessage(null);
                }}
                className="underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              >
                Switch to Magic Link
              </button>{" "}
              above to sign in via email.
            </p>
          )}

          <Button
            type="submit"
            disabled={loading}
className="w-full"
          >
            {loading ? "Please wait..." : mode === "password" ? "Sign In" : "Send Magic Link"}
          </Button>
        </form>

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
