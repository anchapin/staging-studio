import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Issue #1543 (Modern Web Guidance — login autofill): the sign-in form must
 * tell password managers which field holds the account name and which one
 * holds the current password, otherwise the browser cannot autofill them.
 */

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: async () => ({ error: null }),
      signInWithOtp: async () => ({ error: null }),
      resetPasswordForEmail: async () => ({ error: null }),
    },
  }),
}));

const { default: LoginPage } = await import("@/app/(auth)/login/page");

describe("login form autofill attributes (issue #1543)", () => {
  it("marks the email field as the username for password managers", () => {
    const html = renderToStaticMarkup(createElement(LoginPage));
    expect(html).toMatch(/id="email"[^>]*autoComplete="username"/);
  });

  it("marks the password field as the current password", () => {
    const html = renderToStaticMarkup(createElement(LoginPage));
    expect(html).toMatch(/id="password"[^>]*autoComplete="current-password"/);
  });
});
