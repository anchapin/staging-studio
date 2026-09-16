"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const supabase = createClient();

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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-stone-100 to-stone-200 px-4">
      <div className="w-full max-w-md space-y-8 rounded-xl bg-white p-8 shadow-xl">
        <div className="text-center">
          <h1 className="font-cinzel text-3xl font-bold tracking-tight text-stone-800">
            StagingStudio
          </h1>
          <p className="mt-2 font-playfair text-sm text-stone-600">
            AI-Assisted Home Staging Lookbooks
          </p>
        </div>

        <div className="flex gap-2 rounded-lg bg-stone-100 p-1">
          <button
            onClick={() => setMode("password")}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
              mode === "password"
                ? "bg-white shadow text-stone-900"
                : "text-stone-600 hover:text-stone-900"
            }`}
          >
            Password
          </button>
          <button
            onClick={() => setMode("magic")}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
              mode === "magic"
                ? "bg-white shadow text-stone-900"
                : "text-stone-600 hover:text-stone-900"
            }`}
          >
            Magic Link
          </button>
        </div>

        <form onSubmit={mode === "password" ? handlePasswordSignIn : handleMagicLink} className="space-y-6">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-stone-700">
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-stone-300 px-3 py-2 shadow-sm focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
              placeholder="you@example.com"
            />
          </div>

          {mode === "password" && (
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-stone-700">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="mt-1 block w-full rounded-md border border-stone-300 px-3 py-2 shadow-sm focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
                placeholder="••••••••"
              />
            </div>
          )}

          {message && (
            <div
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
            className="w-full rounded-md bg-stone-800 py-2.5 font-medium text-white transition-colors hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {loading ? "Please wait..." : mode === "password" ? "Sign In" : "Send Magic Link"}
          </button>
        </form>

        <p className="text-center text-xs text-stone-500">
          For Circle G Designs — Lauren Chapin
        </p>
      </div>
    </div>
  );
}
