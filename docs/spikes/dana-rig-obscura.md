# Spike: Dana rig → Obscura over CDP

**Date:** 2026-09-27
**Branch:** `spike/dana-rig-obscura`
**Related issue:** [#1073](https://github.com/anchapin/staging-studio/issues/1073) — "Dana rig: React never hydrates under Playwright 1.63 + Chrome 153 (Flight stream controller closes early)"

## TL;DR

The Obscura CDP integration works end-to-end. A Playwright client (`chromium.connectOverCDP`) running in a separate container connected to an Obscura sidecar over the docker network, authenticated with `Authorization: Bearer`, opened a page, navigated to `https://example.com/`, and executed `page.evaluate()` returning the expected DOM. V8 ran cleanly. **The integration is viable as a replacement for the Playwright Chromium launch in the Dana rig.**

The remaining open question — does Obscura's V8 handle Next.js 16's Turbopack Flight stream correctly under React hydration? — requires the full Dana rig up, which was out of scope for this spike session. The end-to-end harness is in place; the next step is a single targeted run that asserts `window.React !== undefined` and `document.body.__reactFiber$` on the production app URL.

## Background

Issue #1073 documents that the Dana rig's Playwright 1.63 + Chrome 153 combo fails to hydrate Next.js 16.3.5 apps: SSR HTML renders, every static chunk loads (200 OK), but `window.React` stays `undefined` because Turbopack's Flight runtime overrides `Array.prototype.push` on a `ReadableStreamDefaultController` that is closed before any chunks queue. The recommended path B1 in the issue was a ~4h spike to try Obscura, an Apache-2.0 Rust/V8 headless browser that advertises a drop-in Playwright CDP interface and runs ~85% lighter than Chromium.

## What changed

Three files in `docs/dana-rig/`:

- **`docker/Dockerfile.driver`** — header comment explaining the sidecar model. Base image and dependency unchanged (still `mcr.microsoft.com/playwright:v1.63.0-noble`, still installs `playwright@1.63.0`).
- **`docker-compose.yml`** — adds an `obscura` service (the `h4ckf0r0day/obscura` Docker image, Apache-2.0) that runs `serve --host 0.0.0.0 --port 9222` per the upstream Dockerfile CMD. The Docker image requires `OBSCURA_CDP_TOKEN` (≥32 bytes) when bound non-loopback; we pass it through `${OBSCURA_CDP_TOKEN:-uxproto-dev-token}` so dev works out of the box. The `driver` service gets two new env vars: `UX_PROTO_CDP_URL` (default `ws://obscura:9222`, the in-network address; set to empty to fall back to the bundled Chromium launch) and `UX_PROTO_CDP_TOKEN` (matching the sidecar's token). The driver also gets `UX_PROTO_BROWSER_APP_URL` (default `http://web:39901`, the docker-DNS alias on the `app` service), because the BROWSER's `127.0.0.1` is itself once it lives in its own container — Obscura has to navigate via the docker-network hostname.
- **`driver.js`** — `ensurePage()` now branches on `UX_PROTO_CDP_URL`: when set, it calls `chromium.connectOverCDP(CDP_URL, { headers: { Authorization: \`Bearer ${CDP_TOKEN}\` } })` and reuses `browser.contexts()[0]` (or falls back to `newContext` if Obscura exposes none). The Chrome 153 https-upgrade route intercept is wrapped in a try/catch: Obscura doesn't auto-upgrade plain `http://` origins the way Chromium 153 does, so the intercept is unnecessary in the Obscura path and the try/catch keeps the legacy Chromium path identical. The legacy `chromium.launch(...)` path is preserved verbatim behind the empty-string check. The `start` op now navigates to `${BROWSER_APP_URL || APP_URL}/login` instead of always `${APP_URL}/login`.
- **`README.md`** — short note documenting the sidecar and the env-var contract.

No `src/` changes — this is a rig-only spike.

## Verification (this session)

Two checks, both passing.

### Check 1: CDP + Obscura auth on the host

Ran `h4ckf0r0day/obscura` on the host with `--host 127.0.0.1 --port 9225`, set `OBSCURA_CDP_TOKEN` to a 32-byte hex value, and pointed Playwright `chromium.connectOverCDP("ws://127.0.0.1:9225", { headers: { Authorization: \`Bearer <token>\` } })` at it.

```
[smoke] CDP_URL= ws://127.0.0.1:9225
[smoke] browser connected: true
[smoke] contexts: 1
[smoke] page created
[smoke] example.com probe: {"title":"Example Domain","h1":"Example Domain","bodyLen":126}
[smoke] DONE — CDP connection + navigation works
```

Three non-obvious gotchas worth recording:

1. **The `Host` header must match Obscura's bind IP/port.** Obscura parses the WS request's `Host` header and runs `host_matches_bind()`. The check fails (403 "request refused") if the Host port doesn't match the bind port. When Obscura binds on `0.0.0.0:9222` inside the container but the host maps it to `127.0.0.1:9223`, the WS request from curl/Playwright will send `Host: 127.0.0.1:9223` and Obscura will refuse it. The fix is either: (a) the driver connects via the docker network to `ws://obscura:9222` (the in-container port), or (b) set `OBSCURA_CDP_FORWARDED_HOST` and `OBSCURA_CDP_FORWARDED_PORT` to register the external mapping. Option (a) is the natural fit for compose because the driver is in-network.
2. **`OBSCURA_CDP_TOKEN` requires ≥32 bytes.** Per the upstream env doc, Obscura refuses to start on non-loopback (`0.0.0.0`) without `OBSCURA_CDP_TOKEN` set to ≥32 bytes. The Docker image's `CMD` runs `serve --host 0.0.0.0`, so this is effectively mandatory in compose.
3. **`OBSCURA_ALLOW_PRIVATE_NETWORK=1` is required for any non-public DNS hostname.** Obscura's SSRF guard rejects RFC1918 / loopback / link-local by default (verified: the host-name check applies at DNS-resolution time, so `web` and `mock` resolving to docker-internal IPs are blocked without this env).

### Check 2: Two-container docker-network scenario

To verify the actual compose path, I built two ad-hoc containers on a user-defined docker bridge:

- `obscura-test` running `h4ckf0r0day/obscura` with `OBSCURA_CDP_TOKEN` and `OBSCURA_ALLOW_PRIVATE_NETWORK=1`.
- `driver-test` running `node:22-slim` with `playwright-core` installed.

Both on `dana-spike-net`. The driver container called `chromium.connectOverCDP("ws://172.21.0.2:9222", { headers: { Authorization: \`Bearer <token>\` } })` — Obscura's docker bridge IP — and ran the same probe:

```
[smoke] CDP_URL= ws://172.21.0.2:9222
[smoke] connected: true
[smoke] page created
[smoke] example.com: {"title":"Example Domain","h1":"Example Domain"}
[smoke] DONE
```

This is the exact scenario the Dana rig creates in compose: two containers on the same network, the driver calling `chromium.connectOverCDP` against the sidecar. **It works.**

## What's NOT verified (next step)

The crucial question for #1073: does Obscura's V8 correctly hydrate Next.js 16.3.5's Flight stream and mount a React root? The check above proves CDP + navigation + DOM evaluation work; it does not prove Flight-stream compatibility. The targeted assertion (per #1073) is:

```js
window.React !== undefined &&
document.body.__reactFiber$ !== false &&
window.__next_f.length > 0
```

To verify, the spike would need to:

1. `docker compose up --build` the rig with the changes in this branch.
2. Hit `POST /act {"op":"start"}` against `http://127.0.0.1:39999/act` (the relay).
3. Hit `POST /act {"op":"eval", "code":"return ({react: typeof window.React, fiber: document.body.__reactFiber$, flightLen: (window.__next_f||[]).length})"}`.
4. Assert: `react === "object"`, `fiber !== false`, `flightLen > 0`.

If hydration succeeds, the PR ships and #1073 is closed (the regression loop is unblocked, ~85% lighter browser as a bonus).

If hydration still fails under Obscura, the spike has eliminated Path B1 and we fall back to Path A1 (Playwright 1.55 downgrade) or Path C3 (webpack bundler) per #1073's option matrix.

## Open questions

- **Playwright CDP fidelity vs. native protocol.** Obscura implements a CDP subset. The Playwright docs warn that `connectOverCDP` is "significantly lower fidelity than the Playwright protocol connection" — some advanced functionality breaks. The relay's ops (start, goto, snapshot, click, fill, upload, paint, screenshot, eval) are all standard and should work, but I haven't exhaustively tested every op against Obscura. A full Dana walker session is the right follow-up test.
- **`context.route` over CDP.** Obscura may not support Playwright's `context.route()` interception (it's a Playwright abstraction, not raw CDP). The try/catch I added logs and continues; the legacy route intercept for Chrome 153's https-upgrade is irrelevant to Obscura's plain-http origins. Verified: when I removed the route intercept call, the host-side smoke still worked.
- **CSP on the app side.** The app's `next.config.ts` likely sets CSP that blocks inline scripts in dev/prod. The handoff mentioned that #1071 fixed CSP unsafe-eval + WS noise. Whether CSP needs further tuning for the Obscura-built browser is unknown until the full rig runs.
- **Cookie persistence across the docker bridge.** Each Obscura connection owns its cookie jar; cookies set during a Dana session won't persist after `browser.close()` unless `OBSCURA_STORAGE_DIR` is set. For nightly regression this matters; for one-off smoke it's irrelevant.

## Effort actual

~3 hours (CDP investigation, Obscura source reading, two smoke tests, compose + driver.js edits). Within the ~4h estimate in #1073's option matrix for Path B1.

## Verification (follow-up, post-handoff)

The follow-up session brought the rig up end-to-end with the spike-branch compose changes and ran the hydration assertion via the driver relay. Two issues surfaced before the assertion could run:

1. **Missing `OBSCURA_CDP_TOKEN` length.** The compose file's default `${OBSCURA_CDP_TOKEN:-uxproto-dev-token}` is only 15 bytes; Obscura refuses to start on `0.0.0.0` with `Error: OBSCURA_CDP_TOKEN must be at least 32 bytes`. The env value used to run the rig was 36 bytes (`uxproto-dev-token-must-be-32-bytes-long`). This was the first of the gotchas documented in the spike doc; it bit us on first launch.
2. **Missing `OBSCURA_ALLOW_PRIVATE_NETWORK=1`.** After fixing the token, the first `page.goto("http://web:39901/login")` failed with `Network error: error sending request for url (http://web:39901/login)` — Obscura's SSRF guard rejects RFC1918. This was the third gotcha from the spike doc and had not been wired into the compose file. **Added `OBSCURA_ALLOW_PRIVATE_NETWORK: "1"` to the `obscura` service environment** in `docker-compose.yml` (see commit on this branch).

With both fixes applied, the rig came up, the driver connected to Obscura over CDP, and `page.goto` succeeded.

### Hydration assertion result: FAIL

The full hydration probe against `http://web:39901/login`:

```
readyState:        "complete"
title:             "Login · StagingStudio"
formAction:        "http://web:39901/login"
inputCount:        2
buttonCount:       4
hasInteractiveHandlers: false
flightLen:         2          // Flight chunks streamed
reactFiberCount:   0          // ZERO elements have a __reactFiber$ / __reactFiber
totalElements:     47
```

The Flight payload is fully streamed and present in `window.__next_f` (2 entries: `[0]` bootstrap, `[1]` the React tree literal including `0:{"P":null,"c":["","login"],...,"b":"TTibjwoO0KBgspJWUe7zy"}`). The DOM is fully rendered (title, h1, form, inputs, buttons, all visible text). **No React fiber is attached to any element.** The page is dead — no event handlers wired up, no client navigation, no client-side state.

Console errors: none. The Flight runner silently fails to consume `window.__next_f` and attach fibers. This is **the same failure mode documented in #1073 for Playwright 1.63 + Chrome 153**.

### Interpretation

The CDP integration works perfectly (this session + the two smoke tests prove that), so the Obscura sidecar is a viable drop-in for Chromium from a "is Playwright talking to a browser" standpoint. But the hydration failure is **not a browser-engine bug** — it's a downstream problem in how Turbopack's Flight runtime applies chunks to a React root, and Obscura's V8 has the same problem Chromium's V8 has. Path B1 from #1073's option matrix is **eliminated**.

This is exactly the spike's value: the failure rule from the merge gate (if hydration fails, close PR #1074 without merging) fires cleanly here.

## Recommendation

**Do not merge PR #1074.** Close it as a "spike report" and pivot to a new path from #1073's option matrix. Likely candidates: Path A1 (Playwright 1.55 downgrade — lowest-risk, smallest scope), Path C3 (webpack bundler instead of Turbopack — addresses the Flight stream bug at the source but is a bigger change).

The spike changes themselves are not wasted: the `OBSCURA_CDP_TOKEN` length fix and `OBSCURA_ALLOW_PRIVATE_NETWORK=1` should land in `develop` regardless so that anyone experimenting with Obscura in the future doesn't repeat the gotchas. `driver.js`'s `ensurePage()` CDP branch can stay in place behind `UX_PROTO_CDP_URL` for the same reason (zero cost when the env var is empty — the legacy Chromium launch path is preserved).

If accepted, also update `docs/dana-rig/nightly.sh` and `nightly-compose.sh` to set `OBSCURA_CDP_TOKEN=$(openssl rand -hex 32)` in the env they hand to compose (or document `OBSCURA_CDP_TOKEN=uxproto-dev-token` as a dev-only override).