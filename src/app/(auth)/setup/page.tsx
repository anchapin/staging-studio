import { redirect } from "next/navigation";

import { resolveSetupPageTarget } from "@/lib/auth-redirect";
import { prisma } from "@/lib/prisma";
import { createSupabaseRequestClient } from "@/lib/supabase";

import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

/**
 * Server-side gate for `/setup`.
 *
 * Middleware passes `/setup` through for authenticated visitors because
 * the edge runtime cannot consult Postgres to tell "has a User row"
 * (bounce to /dashboard) from "doesn't" (must reach this page — the
 * password-signup recovery path, issue #94). This Server Component
 * makes that distinction. Its decision matrix is the pure, test-pinned
 * `resolveSetupPageTarget` in `src/lib/auth-redirect.ts`: no session →
 * /login, session + User row → /dashboard, session without a row →
 * render the setup form.
 */
export default async function SetupPage() {
  const supabase = await createSupabaseRequestClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    redirect("/login");
  }

  const email = user.email;
  const userRow = await prisma.user.findUnique({ where: { email } });

  // `true` is guaranteed by the redirect above; passing both flags keeps
  // this call site shaped exactly like the pinned decision matrix.
  const redirectTarget = resolveSetupPageTarget(true, userRow !== null);
  if (redirectTarget) {
    redirect(redirectTarget);
  }

  return <SetupForm email={email} />;
}
