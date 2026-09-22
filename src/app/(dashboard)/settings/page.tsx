import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getDashboardUserWithProjects } from "@/lib/dashboard-data";
import SettingsForm from "./settings-form";

export const dynamic = "force-dynamic";

/**
 * Server-rendered settings page: lets the authed user view and update
 * their `User` row (firm branding + editable lookbook page templates).
 *
 * Auth/unprovisioned gates mirror the other (dashboard) pages: the
 * layout and this page both await the same request-cached loader, then
 * redirect to /login (no session) or /setup (no User row — provisioning
 * is the setup flow's job, and a missing row here would make the form's
 * "update the existing row" contract impossible).
 */
export default async function SettingsPage() {
  // Defensive double-check of the layout's redirect (same pattern as
  // /projects): unauthenticated → /login, no User row → /setup.
  const { sessionEmail, userRow } = await getDashboardUserWithProjects();
  if (!sessionEmail) redirect("/login");
  if (!userRow) redirect("/setup");

  // The cached loader's select doesn't include the settings fields, so
  // fetch them by the ownership-checked row id. A null result here means
  // the row vanished mid-request — fall back to the setup gate rather
  // than rendering an empty form. `sessionEmail` is passed to the form
  // for the storage filename convention shared with the /setup flow.
  const user = await prisma.user.findUnique({
    where: { id: userRow.id },
    select: {
      firmName: true,
      ownerName: true,
      logoUrl: true,
      psychologyPageContent: true,
      signoffContent: true,
      darkMode: true,
    },
  });
  if (!user) redirect("/setup");

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-playfair text-3xl font-bold text-stone-800">
          Settings
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-stone-600">
          Firm branding and lookbook page templates
        </p>
      </div>

      <SettingsForm email={sessionEmail} initial={user} />
    </div>
  );
}
