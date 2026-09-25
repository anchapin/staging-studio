import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("SidebarNav title attributes (issue #490)", () => {
  const sidebarNavPath = resolve(
    __dirname,
    "../src/components/dashboard/sidebar-nav.tsx"
  );
  const content = readFileSync(sidebarNavPath, "utf8");

  it("clientName span should have title attribute for tooltip on truncation", () => {
    const clientNameSpanMatch = content.match(
      /<span[^>]*title=\{project\.clientName\}[^>]*>/
    );
    expect(clientNameSpanMatch).toBeTruthy();
  });

  it("propertyAddress span should have title attribute for tooltip on truncation", () => {
    const addressSpanMatch = content.match(
      /<span[^>]*title=\{project\.propertyAddress\}[^>]*>/
    );
    expect(addressSpanMatch).toBeTruthy();
  });

  it("clientName span should have block display and full width for truncation to work", () => {
    const clientNameBlockMatch = content.match(
      /<span[^>]*className="[^"]*truncate[^"]*block[^"]*w-full[^"]*"[^>]*title=\{project\.clientName\}/
    );
    expect(clientNameBlockMatch).toBeTruthy();
  });
});
