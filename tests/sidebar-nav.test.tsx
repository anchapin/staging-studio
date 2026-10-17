import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SidebarNav } from "@/components/dashboard/sidebar-nav";

// next/navigation hooks need the App Router; pin a pathname instead.
vi.mock("next/navigation", () => ({ usePathname: () => "/projects/p1" }));

// SignOutButton pulls a Supabase client — irrelevant to nav rendering.
vi.mock("@/components/dashboard/sign-out-button", () => ({
  SignOutButton: () => null,
}));

const PROJECTS = [
  { id: "p1", clientName: "Acme Corp", propertyAddress: "123 Main St" },
  { id: "p2", clientName: "Beta LLC", propertyAddress: "456 Oak Ave" },
];

describe("SidebarNav title attributes (issue #490)", () => {
  it("clientName span has a title attribute for tooltip on truncation", () => {
    const html = renderToStaticMarkup(createElement(SidebarNav, { projects: PROJECTS }));
    expect(html).toContain('title="Acme Corp"');
    expect(html).toContain('title="Beta LLC"');
  });

  it("propertyAddress span has a title attribute for tooltip on truncation", () => {
    const html = renderToStaticMarkup(createElement(SidebarNav, { projects: PROJECTS }));
    expect(html).toContain('title="123 Main St"');
    expect(html).toContain('title="456 Oak Ave"');
  });

  it("clientName span keeps the truncate/block/w-full classes that make truncation work", () => {
    const html = renderToStaticMarkup(createElement(SidebarNav, { projects: PROJECTS }));
    // The title-bearing span must also carry the truncation classes —
    // a title without truncation (or vice versa) reintroduces #490.
    const spanPattern =
      /<span[^>]*class="[^"]*truncate[^"]*block[^"]*w-full[^"]*"[^>]*title="Acme Corp"/;
    expect(html).toMatch(spanPattern);
  });

  it('renders "No projects yet" when the projects array is empty', () => {
    const html = renderToStaticMarkup(createElement(SidebarNav, { projects: [] }));
    expect(html).toContain("No projects yet");
    expect(html).not.toContain("title=");
  });
});
