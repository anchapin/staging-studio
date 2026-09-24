"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";

/**
 * Client-side sign-out control for the dashboard sidebar.
 *
 * Purpose: ends the Supabase session (revokes the refresh token via the
 * auth server and clears the session cookies) and navigates to /login.
 * Replaces the previous dead link to /api/auth/signout, which had no
 * route and rendered a 404 page instead of signing out.
 *
 * Sign-out is intentionally performed on the client to mirror the
 * client-side sign-in path used by the login and setup forms: the
 * browser-owned Supabase session cookies are what middleware and the
 * server components consult.
 *
 * Side effects: revokes the Supabase session, clears auth cookies,
 * performs a full-page navigation to /login.
 */
export function SignOutButton() {
  const [signingOut, setSigningOut] = useState(false);

  return (
    <button
      type="button"
      disabled={signingOut}
      onClick={async () => {
        setSigningOut(true);
        try {
          await createClient().auth.signOut();
        } catch {
          // Even if the network call fails, clear local state by
          // navigating — middleware will re-gate protected routes.
        } finally {
          window.location.href = "/login";
        }
      }}
      className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-stone-400 transition-colors hover:bg-stone-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {signingOut ? "Signing out…" : "Sign Out"}
    </button>
  );
}
