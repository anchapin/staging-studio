# Handoff brief — post-gap-audit triage (issues #1414–#1432)

## Context

The issue-1393 track is complete and shipped. PR #1412 (`requireUser()` test-mock
helper) merged to `develop` as `0b69c6f`, issue #1393 closed, and the release train
carried it to Production as `5d50e81` (PR #1413). The post-deploy
`E2E (Playwright)` run on `main` came back green.

With the backlog empty, a five-persona `gap-issues` audit was run against the
current tree (security, test coverage, docs staleness, reliability/ops, UX/perf).
It produced **19 open issues, #1414–#1432**. Nothing in that set has been started.

Local verification at handoff time: `npm run typecheck` clean, `npm test`
**2903 tests / 232 files passed**, `npm run lint` clean (pre-existing warnings
only), `tsconfig.json` not dirty.

The next session's job is **not** to grind through all 19. It is to resolve #1418
(it gates the priority order), then fix the two issues that can lose customer work
or money, then batch the doc corrections.

## What the audit found that is worth knowing before you start

Three things a previous session verified that will otherwise be re-derived:

1. **The docs drift is systemic, not incidental.** The fal.ai→Alibaba DashScope
   migration (#1240) and the #691 component decomposition both moved code without
   updating docs. README.md, AGENTS.md, `.env.example`, and `docs/` now point at
   deleted files. Four separate agents hit this independently. It is one root
   cause, and the doc issues (#1417, #1430, #1416) are cheapest fixed as a single
   pass.
2. **The security posture is genuinely sound.** The audit found **no critical or
   high** findings. SSRF, XSS, path traversal, preview-token handling, and the
   webhook HMAC were all verified clean. #1418 is the one item that could be
   serious, and it is unresolvable from the repo alone.
3. **Coverage is much better than the old AGENTS.md counts suggested** (~132/135
   modules pinned, not "63 of 76"). Do not trust those numbers — part of #1416.

## Task list (priority order)

### 1. Resolve #1418 — verify the `logos` bucket policy

**Do this first.** It is a ~5-minute check that determines whether anything else is
urgent, and it cannot be answered by reading code.

Client-side logo uploads use the **anon** Supabase key with `upsert: true`
(`src/app/(dashboard)/settings/settings-form.tsx:71-84`,
`src/app/(auth)/setup/setup-form.tsx:44-55`), and the object path interpolates a
user-supplied email. Whether an unauthenticated visitor can write to the `logos`
bucket is decided entirely by a Supabase Storage RLS/bucket policy that is **not
in this repo**.

Check the live bucket policy for the production project:

- Deny anon INSERT on `logos`?
- Can unauthenticated callers overwrite an existing object?

Then either:

- **Policy is correct** → close #1418 with the expected policy documented in
  `docs/SUPABASE-SETUP.md`, so the invariant is reviewable in-repo rather than
  living only in a dashboard.
- **Policy is permissive** → this is an unauthenticated public-file-write
  vulnerability. Stop, treat as urgent, and move the write behind a server-side
  (service-role) upload.

Do not silently close it either way — record the finding.

### 2. Fix #1428 — silent autosave failure shows a false green "Saved"

The only issue that can **lose customer work**.

Three autosave paths exist. Only the directive controller is wired to an
observable status. The listing-copy controller
(`src/components/edit-room/EditRoomStudio.tsx:282-302`) and the FineTune
controller (`project-detail-view.tsx:617-641`) never wire `onStatusChange`, and
their only references are `_`-prefixed to silence the unused-var lint — which is
how this survived.

The TopBar "Saved" pill reads `directiveStatuses` only, so it renders **green
"Saved"** while copy or FineTune edits were never persisted.

The `AutosaveController` itself is sound (`src/lib/autosave-controller.ts`
preserves failed payloads and prevents retry-loop loss). This is purely a wiring
bug, which is good news — the fix is small.

Suggested: wire `onStatusChange` on both controllers into the same status store the
pill reads; have the pill reflect the **worst** status across all active
controllers, not just directives; remove the `_`-prefixed dead reference.

### 3. Fix #1420 + #1421 together — quota charged for work that never happened

Same root cause, real money, one pass over two files. Do them together.

- **#1420** — `src/app/actions/room-batch.ts:295-352` uses read-only
  `evaluateDailyBatchQuota` instead of the atomic `claimDailyQuota`, claims
  unconditionally before the work, and swallows per-room failures in an empty
  `catch {}`. Failed batches silently consume `DAILY_INPAINT_LIMIT`.
- **#1421** — three unrefunded paths in the inpaint flow. The sharpest: at
  `src/app/api/inpaint/route.ts:225-260`, if the `providerJobId` DB write fails
  after Alibaba has accepted the job, the firm is billed for an image that can
  never be retrieved by anyone. At ~0.1% blip rate × 20 images/day, that is
  roughly 6 invisible billed jobs per day per active user.

The correct pattern already exists in this repo — `claimDailyQuota` in
`src/lib/api-quota.ts` is genuinely atomic via upsert+increment. Copy it.

### 4. Fix #1427 + #1429 — performance, demo-visible

- **#1427** — `src/components/edit-room/MaskLayer.tsx` runs a full-canvas
  `toDataURL("image/png")` on **every pointer move** while painting (~1.5–3 MB per
  call, 30–60×/sec), re-rendering a 1600-line parent each time. Contained fix:
  throttle to one encode per frame via `requestAnimationFrame`, or snapshot on
  `onPointerUp`. **Pin the #1344 behaviour with a test so the fix does not
  regress it** — that original fix deliberately guaranteed the parent always
  holds the latest mask.
- **#1429** — `dilateMaskGrid` (`src/lib/mask-dilation.ts:180-224`) rebuilds its
  kernel offset list *per pixel*. Hoisting it is a small, safe, independently
  measurable win. A separable two-pass dilation would drop the cost by roughly an
  order of magnitude. Multi-select compounds this across up to 40 candidates with
  no progress indicator.

### 5. Batch the documentation pass — #1417, #1430, #1416

One root cause, one sitting. Details in the issue bodies; the short version:

- **#1430** — AGENTS.md's Layout section documents files that no longer exist
  (`src/components/canvas/inpaint-editor.tsx`, `inpaint-mask-canvas.tsx`,
  `src/lib/fal.ts`, `segment-mask.ts`, `operation-mode-availability.ts`) and omits
  the entire `/api/v1` tree (11 routes) plus a fourth CI job. **Highest priority of
  the three**, because AGENTS.md instructs every agent and maintainer to audit new
  endpoints "against that list" and the list is half the surface.
- **#1417** — README.md documents the pre-migration stack (fal.ai, Next 15, eslint,
  7 dead component paths, `anomalyco` in the repo link).
- **#1416** — AGENTS.md test-coverage counts are stale and the `tests/lib/`
  subdirectory (19 tests) is undocumented, which produces ~20 phantom coverage gaps
  on any naive audit.

## Deliberately not filed

Recorded so a future session does not "rediscover" and re-file them:

- The reliability audit's F3 was already tracked (#1247).
- Its F4 was explicitly **not** a finding — best-effort `VisionLabel` persistence is
  deliberate, per the inline comment. The `AutosaveController` lifecycle was also
  verified sound; the #1428 defect is in the wiring, not the controller.
- The audit's A3/A4 (inpaint and export quota-not-refunded on upstream failure)
  substantially overlap #1421 and #1424. Fold them in rather than filing separately.

## Constraints

- `develop` is the working branch; `main` is Production and is protected
  (requires `Lint · Typecheck · Unit tests`, `strict` up-to-date).
- Run `npm run typecheck`, `npm test`, and `npm run lint` before finishing. No
  formatter config, no separate build gate beyond CI.
- **Never commit the `jsx: preserve` → `react-jsx` tsconfig flip.** Next rewrites
  `tsconfig.json` on every build/dev. The committed form is authoritative: `git
  checkout HEAD -- tsconfig.json` before committing. A pre-commit hook guards this.
- Do not run `npm audit fix --force` — see the security advisories section of
  AGENTS.md (#1220).
- Keep `.env` → `.env.local` symlink intact; Prisma CLI reads only `.env`.
- If you fix a doc issue, verify each corrected claim against the code. Do not
  copy a number from one doc into another without checking it.

## Output expectations

1. **#1418 resolved and recorded** — policy verified, issue closed with the finding
   documented, or escalated as urgent.
2. **#1428 fixed with a test** pinning that the pill never shows "Saved" while any
   autosave path is in an error state.
3. **#1420 + #1421 fixed together** with tests covering the refund paths,
   including the post-submit DB-write failure.
4. **#1427 + #1429 addressed**, with the #1344 mask-freshness behaviour pinned.
5. **#1417, #1430, #1416 closed** as one documentation pass, every corrected claim
   verified against code.
6. If any item is deferred, say so explicitly with the reason — do not close an
   issue to make the list look clean.

Report what you verified versus what you took on faith. The previous session
re-verified every audit claim independently, which is how a component-drift finding
in #1430 was caught after the audit agent's file paths contradicted AGENTS.md.

Reference this brief by path. Do not restate it.