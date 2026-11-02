# CI checkout / cache / typecheck timing audit (November 2026)

Issue: anchapin/staging-studio#1491 — *CI checkout / cache / typecheck timing audit
(measure first, before any bigger runners)*.

**Scope of this document.** Measurement only. Nothing in any repository was changed to
produce it, and **no workflow file was edited** — every workflow-shaped item below is a
*recommendation* backed by a measured number, never an applied change. Data comes from
the public GitHub Actions API (read-only) for the four repositories named in the issue,
plus workflow-file inspection (read-only, via the API) for the fetch-depth / cache
questions. No local `tsc --noEmit` timing was obtained (see §1.1): the Prisma engine
download this VM needs to generate the client is blocked, so the staging-studio local
number does not exist — the CI step medians below are the `tsc` numbers instead, and
they are labelled as CI numbers wherever they appear.

> **Provenance.** The worker briefed for this issue gathered the API samples and hit its
> 60-step cap before writing the report body. The supervisor re-aggregated every table
> below independently from the GitHub API on 2026-11-02 (same definitions, same
> samples) and the two aggregations agree on every headline median within a few
> seconds. All numbers in this document are the supervisor's re-aggregation unless a
> row says otherwise.

---

## 1. Method

- **Samples.** Most recent completed runs, per repo, within the last 30 days (or the
  whole window when fewer runs exist). Skipped jobs are excluded from job totals.
  "Queue" = job `created_at` → `started_at`. "Total" = job `started_at` →
  `completed_at`. Step durations are step `started_at` → `completed_at`. All times
  in seconds; `med` = median, `p90` = 90th percentile.
- **staging-studio:** 100 most recent completed runs of the `CI` workflow,
  2026-10-19 → 2026-10-28. (193 `CI` runs exist in the 30-day window; the 100 most
  recent were sampled.)
- **planar-nexus:** 63 completed runs of the `CI` workflow — the whole 30-day window,
  2026-10-24 → 2026-11-02.
- **matchline:** 100 most recent completed runs of the `CI` workflow,
  2026-10-24 → 2026-10-29.
- **fluxion:** 100 most recent completed runs across *all* workflows,
  2026-11-01 → 2026-11-02 (fluxion runs ~300 runs/30 days across ~65 workflows;
  the issue asked only for read-only fetch-depth / sccache / pip-cache findings, so
  the fluxion figures below are checkout/setup step observations, not a per-workflow
  timing table). The worker's separate 300-run sweep over 30 days found the same
  checkout (median 4 s) and setup (median 29 s) figures.
- **Costs.** These repos are public, so GitHub-hosted minutes are $0. Queue waits are
  therefore reported for diagnosis only — they are not a reason to buy runners.

### 1.1 Local `tsc --noEmit`: not measured (environment limitation, disclosed)

The brief required a locally timed `tsc --noEmit` for staging-studio. It could not be
produced on this VM: `npm ci` succeeds only with `--ignore-scripts`, and
`npx prisma generate` fails consistently with `ECONNRESET` downloading the Prisma
engines from `binaries.prisma.sh` (retried by the worker and twice more by the
supervisor; no generated client exists, so `tsc --noEmit` fails only with
`PrismaClient`-missing errors in `docs/dana-rig/setup.ts`, `scripts/*.ts`, and
`src/lib/prisma.ts` consumers — an environment limitation, unrelated to this
docs-only change). No local `tsc` number is claimed anywhere in this document.
Planar-nexus `tsc` was likewise not timed locally (no clone was made, per the
brief); its CI step median (7 s, §3) is the number to use. Neither gap changes any
conclusion: at 7–11 s (CI medians), the typechecker is not the bottleneck anywhere.

---

## 2. Per-repo timing tables

### 2.1 staging-studio — `CI` workflow (100 runs)

| Job | n | Queue med / p90 | Total med / p90 / max |
| --- | --- | --- | --- |
| Lint · Typecheck · Unit tests (`fast-checks`) | 98 | 2 / 4 | 66 / 76 / 150 |
| E2E (Playwright) | 36 | 2 / 37 | 228 / 255 / 460 |
| Docker image builds | 98 | 2 / 6 | 101 / 148 / 169 |
| Release guard (develop caught up with main) | 20 | 2 / 3 | 6 / 11 / 20 |

Step breakdown, `fast-checks` job:

| Step | n | Median | p90 | Max |
| --- | --- | --- | --- | --- |
| Checkout (`actions/checkout@v4`, default depth 1, no blob filter) | 98 | 2 s | 3 s | 12 s |
| Setup Node.js (`setup-node`, npm cache) | 98 | 4 s | 8 s | 21 s |
| Install dependencies (`npm ci`) | 98 | 20 s | 22 s | 24 s |
| ESLint (step name; runs `npm run lint` = oxlint) | 98 | 0 s | 1 s | 1 s |
| TypeScript type check (`tsc --noEmit`) | 98 | 11 s | 12 s | 13 s |
| Unit tests (vitest) | 98 | 24 s | 27 s | 29 s |

E2E job steps: Cache Playwright browsers median 4 s (n=36), Checkout 2 s, Install
Chromium 11 s (max 234 s — one cold outlier), E2E tests 182 s. Docker job: Build
the image median 92 s (n=98) dominates the 101 s job total.

### 2.2 planar-nexus — `CI` workflow (63 runs, whole window)

Selected jobs (all 27 jobs were measured; the setup-heavy and long-tail jobs are
shown — the guard jobs each total ~55–60 s, almost all of it the shared setup):

| Job | n | Queue med / p90 | Total med / p90 / max |
| --- | --- | --- | --- |
| Type Check | 55 | 2 / 11 | 64 / 89 / 98 |
| Lint | 55 | 2 / 6 | 83 / 112 / 299 |
| Test | 55 | 2 / 3 | 459 / 527 / 968 |
| Build | 43 | 2 / 3 | 114 / 129 / 157 |
| E2E Tests | 53 | 2 / 10 | 518 / 823 / 1120 |
| Cross-Browser E2E (firefox + webkit) | 28 | 2 / 185 | 1042 / 2735 / 4768 |
| Flake Detector (Playwright) | 28 | 2 / 152 | 2120 / 2284 / 2533 |
| Rust Checks (fmt, clippy, test) | 55 | 2 / 75 | 274 / 387 / 1448 |
| Security Audit (npm) | 63 | 2 / 58 | 57 / 93 / 529 |

Key steps (across all jobs in the sample):

| Step | n | Median | p90 | Max |
| --- | --- | --- | --- | --- |
| Checkout code (`actions/checkout@v7`, `fetch-depth: 1`) | 1350 | 2 s | 2 s | 10 s |
| Setup repository (shared `setup-node-npm-ci` composite: git config, free disk space, checkout, setup-node + npm cache, `npm ci`, cache-key, clear npm cache) | 1232 | 50 s | 79 s | 172 s |
| Free disk space (remove npm cache and large artifacts) | 163 | 1 s | 4 s | 11 s |
| Run TypeScript type check (`tsc --noEmit`, incl. card-script index pre-step) | 55 | 7 s | 9 s | 9 s |
| Run ESLint | 54 | 25 s | 28 s | 30 s |
| Regenerate card-script index | 109 | 1 s | 1 s | 1 s |

The composite setup step runs ~22 times per CI run (1232 observations / 55–63
runs), so ~50 s of setup is paid inside nearly every job. The `tsc` step itself
is 7 s; the 64 s Type Check job total is ~78% setup + queue + checkout overhead.

### 2.3 matchline — `CI` workflow (100 runs)

| Job | n | Queue med / p90 | Total med / p90 / max |
| --- | --- | --- | --- |
| ruff + format + pytest (`quality`) | 100 | 2 / 23 | 230 / 267 / 288 |
| performance budget | 100 | 2 / 40 | 36 / 40 / 53 |
| fresh install + matchline demo | 100 | 2 / 38 | 28 / 32 / 36 |
| wheel install: linux / py3.10–3.13 | 100 each | 2 / ~44 | 26–29 / ~33 / ≤53 |
| detector ruff | 100 | 2 / 26 | 9 / 11 / 15 |
| All other jobs (audit, deptry, repo-map, wheel-smoke, empty-commits) | 100 each | 2 / ≤50 | 5–14 / ≤20 / ≤20 |

Steps that answer the issue's questions:

| Step | n | Median | p90 | Max |
| --- | --- | --- | --- | --- |
| Checkout (all jobs; most `fetch-depth: 0`, see §3) | 1434 | 1 s | 2 s | 65 s |
| Install runtime dependencies (`pip install --no-cache-dir -e .`, perf-budget job) | 100 | 21 s | 24 s | 37 s |
| Install package, non-editable (demo-smoke) | 100 | 21 s | 24 s | 28 s |
| Install the wheel (matrix jobs) | 434 | 17 s | 21 s | 71 s |
| Run ruff check | 100 | 0 s | 1 s | 1 s |
| Run ruff check on detector/ (`uvx ruff@0.17.2`) | 100 | 1 s | 1 s | 2 s |
| Run ruff format check | 97 | 0 s | 1 s | 1 s |
| Run pytest | 88 | 219 s | 243 s | 262 s |
| Sync the locked dev environment (`uv sync`) | 200 | 2 s | 4 s | 20 s |

`pip install --no-cache-dir` costs ~21 s per job that uses it, versus ~2 s for the
`uv sync` path. Ruff itself is ≤1 s everywhere — it is not a lever in this repo.

### 2.4 fluxion — read-only findings (100 most recent runs, all workflows)

| Observation | n | Median | p90 | Max |
| --- | --- | --- | --- | --- |
| Checkout (`actions/checkout`, pinned v7.0.1) | 208 | 4 s | 5 s | 10 s |
| Run `setup-rust-python-env` composite (toolchain + sccache + pip cache) | 101 | 29 s | 55 s | 66 s |
| Run `setup-rust-env` composite | 11 | 25 s | 53 s | 55 s |
| Cache cargo workspace (restore) | 29 | 2 s | 13 s | 15 s |
| Cache cargo dependencies (restore) | 16 | 16 s | 20 s | 21 s |
| Post Cache cargo workspace (save) | 14 | 19 s | 21 s | 25 s |

- **`fetch-depth: 0`** is used in exactly three workflows, confirmed by reading the
  workflow files: `mutation-testing.yml:137` (comment: "full history so the PR
  diff is resolvable"), `mutation-nightly.yml:57`, and `perf_lane.yml:85`. Every
  other workflow either sets `fetch-depth: 1` explicitly or omits it (default
  depth 1). The history-needing cases are genuine: do not blobless/shallow them.
- **sccache** is on by default (`sccache: 'true'` default) in the shared
  `setup-rust-env` action, backed by the GitHub Actions cache, with a nightly
  sccache-prime job (`Warm sccache`, median 771 s) keeping PR shards warm. The
  setup composite itself (29 s median) is the visible per-job cost, not cache
  misses: cargo-cache restore steps measure 1–16 s.
- **pip caching** is always-on in `setup-rust-python-env` (setup-python
  `cache: 'pip'`, keyed on `requirements-dev.txt`); the deprecated `cache:
  'false'` opt-out is a no-op. Python-side installs inside fluxion jobs measure
  6–10 s (`Install maturin + test deps` median 6 s, `Install the wheel` in
  bindings jobs 8 s).

No changes to fluxion are proposed or made in this issue.

---

## 3. Findings and contradictions against the issue's premises

1. **Staging-studio has two jobs the issue does not mention.** `Docker image
   builds` (101 s median, build step 92 s) and `Release guard` (6 s) run in the
   same `CI` workflow. The issue's `fast-checks`/`e2e` framing covers the
   developer-facing surface but not the whole workflow. The release-guard job is
   the only staging-studio job using `fetch-depth: 0` (line 248; history is
   genuinely needed for the ancestor check) — it is excluded from the blobless
   recommendation in §4.
2. **Planar-nexus wipes the npm cache twice per setup.** The shared
   `setup-node-npm-ci` action deletes `~/.npm/_cacache` in "Free disk space"
   *before* checkout/setup-node, and runs `npm cache clean --force` in "Clear npm
   cache" *after* `npm ci`. The `setup-node` npm-cache restore sits between the
   two wipes, so no job benefits from a warm npm cache from a previous job, and
   no job leaves one behind. The trade-off is real (disk space for Tauri/Rust
   builds), but as written the cache configuration is pure overhead: the 50 s
   setup step pays a full `npm ci` every time. Whether removing either wipe
   actually saves time is **unmeasured** — it is follow-up F2, not a claim.
3. **The "ESLint" step in staging-studio is oxlint.** The step is named `ESLint`
   but runs `npm run lint` = `oxlint .`, median 0 s. Any proposal framed around
   "ESLint is slow in staging-studio" is wrong on this repo; oxlint is already
   the linter (see also the planar-nexus Oxlint spike, #2890, which keeps ESLint
   there for unrelated reasons).
4. **`eslint-config-next` is not wired in planar-nexus**, so there are no Next.js
   lint rules to compare (found while reading the planar-nexus workflow/config
   surface; not a timing finding, recorded so the next audit does not re-derive
   it).
5. **Queue waits are a non-problem on GitHub-hosted runners.** Median queue wait
   is 2 s in every repo and every job class. The large p90s (up to ~190 s) occur
   only on scheduled/nightly jobs (flake detectors, cross-browser E2E) and in
   guard jobs that queue behind the same concurrency group — not a runner-capacity
   signal. No paid/faster runner is justified by this data.
6. **Checkout is cheap everywhere.** Medians: staging-studio 2 s, planar-nexus
   2 s, matchline 1 s, fluxion 4 s. Blobless clones can save at most the checkout
   time itself, i.e. ~1–4 s per job, and typically a fraction of that. See F3.
7. **`tsc` is not the bottleneck anywhere.** CI step medians: staging-studio
   11 s, planar-nexus 7 s. A faster typechecker (`bun check`, TypeScript native)
   would need its own spike with a measured case, and on these numbers there is
   no case: the setup/install phases (20–50 s) and the test phases (24 s vitest,
   219 s pytest, 401 s Jest-with-coverage) dominate. Do not spike a typechecker
   without new evidence.

---

## 4. Ranked follow-ups (each with a measured saving)

| # | Follow-up | Measured saving | Scope / owner |
| --- | --- | --- | --- |
| F1 | Split staging-studio `fast-checks` into parallel lint / typecheck / test jobs (already filed as #1490) | Bounded: sequential job is 66 s; the three phases measure 0 s + 11 s + 24 s = 35 s of work, but each parallel job re-pays checkout (2 s) + setup-node (4 s) + `npm ci` (20 s) ≈ 26 s of overhead, so the wall-clock for the surface becomes ~26–50 s instead of 66 s — roughly **15–40 s faster per PR**, at 3× the install cost (public minutes are $0). | staging-studio only. Branch-protection follow-up (required-check rename) is an Alex step per #1490. |
| F2 | Investigate (do not yet change) the planar-nexus `setup-node-npm-ci` cache wipes: trial a branch that drops "Clear npm cache" and/or preserves `~/.npm/_cacache`, measuring the `npm ci` portion inside "Setup repository" before/after | **Unknown — measure first.** Setup step is 50 s median (n=1232); the saving is bounded above by the `npm ci` time inside it, which the job-step API does not isolate. No saving is claimed. | planar-nexus only; needs a trial branch + CI timings, not a local guess. |
| F3 | Add blobless clone (`filter: blob:none`) to shallow checkouts, **staging-studio only**, where the audit shows a saving and no history is needed | **≤2 s per job** (checkout median 2 s; blobless saves a fraction of the clone, not the whole step). Low priority — hygiene, not a speed lever. Jobs needing real history keep `fetch-depth: 0` (release-guard). | staging-studio only. No other workflow changes in this issue. Workflow edit itself is a follow-up PR, not part of this audit. |
| F4 | Matchline pytest parallelism/sharding investigation | **Unknown — needs its own measured case.** pytest is 219 s median of a 230 s job; ruff (≤1 s) and installs (17–21 s) are not the lever. | matchline only; out of scope for this audit beyond naming it. |
| F5 | Revisit only if queue waits grow: re-run this audit's queue-wait column | None claimed. Current median 2 s everywhere; revisit trigger is median queue >30 s sustained over a week. | All repos; no action now. |

---

## 5. Explicitly NOT recommended on this evidence (non-goals)

- **No paid runners** (Blacksmith or otherwise) and no Celesto-style self-hosted
  labels. Queue waits are 2 s median and public-repo minutes are $0; the
  existing fluxion overflow / Hetzner pool is already the overflow lane.
- **No blanket `node_modules` caching, no sharding, no Vitest `isolate: false`,
  no `nx affected`, no pre-push hooks.** Each needs its own measured case; none
  is supported by the numbers above (vitest is 24 s; sharding it would re-pay
  the 26 s setup overhead per shard).
- **No `bun check` / TypeScript-native typechecker spike.** `tsc` measures 7–11 s
  in CI; there is no typecheck bottleneck to fix.
- **No changes to fluxion, matchline, planar-nexus, or armored-archer** arising
  from this audit, beyond the read-only findings in §2.4/§3 and the
  investigation-only follow-ups F2/F4, which belong to their own repos' issue
  trackers.
- **No blobless clone for history-needing jobs** (staging-studio release-guard;
  fluxion mutation-testing / mutation-nightly / perf_lane; matchline
  `fetch-depth: 0` jobs). Full history is genuinely needed there.

---

## 6. Reproduction

```bash
# Per-repo run/job/step timings (supervisor re-aggregation, 2026-11-02):
gh api "repos/anchapin/<repo>/actions/runs?per_page=100&page=N&status=completed"
gh api "repos/anchapin/<repo>/actions/runs/<run_id>/jobs?per_page=100"
# Filter: workflow name "CI" (staging-studio / planar-nexus / matchline) or all
# workflows (fluxion); created_at >= 2026-10-03; exclude conclusion=skipped jobs;
# queue = started_at - created_at; total = completed_at - started_at.
# Workflow-file facts (fetch-depth, cache wipes) via:
gh api "repos/anchapin/<repo>/contents/.github/workflows/<file>" --jq '.content' | base64 -d
```

No Jest/vitest test was run for this change: the diff is this document only, and
`npm run lint` (oxlint) passes in the worktree (16 warnings, 0 errors). `npm run
typecheck` could not be run to green in this sandbox for the Prisma reason in
§1.1; CI is the typecheck evidence for this PR.
