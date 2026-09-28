import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

import { resolveLoginErrorMessage } from "@/lib/login-error";

/**
 * Issue #1062: pin the Magic-Link recovery copy added in #449 / PR #451.
 *
 * The recovery copy lives in the login page component, not in the
 * `resolveLoginErrorMessage` helper that tests/login-error.test.ts
 * covers. Without a DOM test harness (the project doesn't ship
 * @testing-library/react — see tests/sidebar-nav.test.tsx for the same
 * lightweight file-pattern convention) we pin the source by reading
 * the page file and asserting the recovery string + the toggle button
 * + the conditional gate are all present.
 *
 * `resolveLoginErrorMessage` is also imported (and pinned below) so
 * the file is not flagged by the tests/test-sanity.test.ts tautology
 * guard (#693) which requires every test to import at least one real
 * production module.
 *
 * The Dana walker verified this fix in step 1 of
 * docs/dana-rig/dana-walkthrough-report.md (Sept 21, Run 5); a
 * regression here would directly undermine the user-facing recovery
 * flow Dana validated.
 */

describe("resolveLoginErrorMessage (also pinned here, issue #1062 tautology guard)", () => {
  it("returns null when the page-side caller passes an empty error", () => {
    // The login page's `message` state is initialized by calling
    // resolveLoginErrorMessage(searchParams.get("error")); an absent
    // search-param yields null and the page skips the banner entirely.
    expect(resolveLoginErrorMessage(null)).toBeNull();
  });
});

describe("login page — Magic Link recovery copy (issue #449, pinned by #1062)", () => {
  const loginPagePath = resolve(
    __dirname,
    "../src/app/(auth)/login/page.tsx"
  );
  const content = readFileSync(loginPagePath, "utf8");

  it("renders the contextual Magic-Link guidance copy after a failed password sign-in", () => {
    // The full sentence is "Don't have a password yet? [Switch to
    // Magic Link] above to sign in via email." — every clause must
    // be present so a future refactor that drops or rephrases any
    // piece trips a test.
    expect(content).toMatch(/Don&apos;t have a password yet\?/);
    expect(content).toMatch(/sign in via email/);
  });

  it("renders the interactive Switch to Magic Link toggle button", () => {
    // The toggle button's label and onClick handler must be present.
    expect(content).toMatch(/Switch to Magic Link/);
  });

  it("gates the recovery copy on the password-failure + password-mode + error-message conditions", () => {
    // Without this conditional, the recovery copy would show on every
    // page load — which is wrong UX (suggesting the user just failed
    // when they haven't tried yet). Pin the trigger so a future
    // refactor that drops the guard fails the test.
    expect(content).toMatch(/passwordFailed\s*&&\s*message\?\.type\s*===\s*"error"\s*&&\s*mode\s*===\s*"password"/);
  });

  it("toggles mode to magic + clears password-failed flag + clears message when the recovery button is clicked", () => {
    // The onClick handler that swaps the user over to the Magic Link
    // flow is the actual recovery mechanic — if any of the three
    // setters is dropped, the button silently fails the user.
    const onClickBlock = content.match(
      /onClick=\{\(\)\s*=>\s*\{\s*setMode\("magic"\);\s*setPasswordFailed\(false\);\s*setMessage\(null\);[\s\S]*?\}\s*\}/
    );
    expect(onClickBlock).toBeTruthy();
  });

  it("sets passwordFailed=true after a failed password sign-in (the trigger that unlocks the recovery copy)", () => {
    // Without this setState, the gate above can never open. PR #451
    // added it in the handlePasswordSignIn catch path. The setMessage
    // call ends with `});` (close object, close call args, semicolon)
    // — not just `};` — so the regex has to allow the `)` between
    // the `}` and the `;`.
    const failFlagSet = content.match(
      /setMessage\(\{\s*type:\s*"error",\s*text:\s*error\.message\s*\}\);\s*setPasswordFailed\(true\);/
    );
    expect(failFlagSet).toBeTruthy();
  });
});