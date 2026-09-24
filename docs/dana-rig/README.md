# Dana Rig — synthetic-usability reviews for StagingStudio

What this is: the exact harness behind the Dana walkthroughs. A headless
Playwright Chromium is exposed over a tiny local HTTP relay, and an agent
playing Dana (see `persona-brief.md`) drives the real StagingStudio UI —
snapshot → screenshot → click/fill/upload/paint → narrate friction — against
a fully hermetic local stack. No real API keys, no billing, no network calls
to fal.ai/OpenAI. The "staged" result is a fixture PNG: judge the workflow,
not the image.

Since you've merged the Dana-feedback PRs, this is now a **regression rig**:
re-run Dana and confirm issues #391–#399 are actually fixed from her side
of the glass.

## Option A — one command (Docker Compose, recommended)

```bash
export UX_PROTO_REPO=$HOME/staging-studio   # your checkout
export DANA_RIG=$HOME/dana-rig              # this directory
export DANA_PHOTO_DIR=$HOME/dana-rig/photos # put a living-room.jpg inside
export GID=$(id -g)
docker compose up --build
```

That's it — one terminal, one command. Compose brings up Postgres, the mock
Supabase, the Next.js dev server (temporary test-only bypasses applied
inside the container, reverted on stop), and the Playwright relay. The relay
is at `http://127.0.0.1:39999`; point your agent at it using `dana-prompt.md`
with `__PHOTO__` → `/photos/living-room.jpg`, `__REPORT__` → report path,
`__RIG__` → `$DANA_RIG`, and `__SCREENSHOT_NOTE__` → "the driver returns
paths like `/shots/shot-001.png`; read them at
`$DANA_RIG/docker/shots/shot-001.png`".

```bash
docker compose down      # stop, keep database
docker compose down -v   # stop and wipe the database
```

Notes:

- First `up` builds images and runs `npm ci` in the app container (a few
  minutes); afterwards it's fast.
- The mock Supabase harness hardcodes `127.0.0.1:39911`, so its container
  forwards that to `:39912` for the other containers. From your laptop the
  app is still `:39901`, relay `:39999`.
- Login: `e2e@stagingstudio.test` / any password (mock auth accepts anything).

## Option B — three terminals (no Docker)

### Prerequisites

- Node 18+, npm
- A `staging-studio` checkout with `npm install` done
- Playwright's Chromium: `npx playwright install chromium`
  (If the headless-shell download stalls ~90%, the driver falls back to the
  full Chromium build — set `UX_PROTO_CHROME_PATH` if your ms-playwright
  cache lives somewhere unusual.)
- Local Postgres with role `uxproto` / password `uxproto` and database
  `staging_studio_ux` (or export `DATABASE_URL` yourself)
- `npx tsx` available (for `setup.ts`)
- Any living-room JPEG to upload as the "before" photo

## Option B — three terminals (no Docker) — run it manually

**Terminal 1 — database + mock Supabase + seed data** (stays running):

```bash
UX_PROTO_REPO=/path/to/staging-studio \
DATABASE_URL=postgresql://uxproto:uxproto@127.0.0.1:5432/staging_studio_ux \
npx tsx /path/to/dana-rig/setup.ts
```

This pushes the Prisma schema, seeds one user + the "789 Prototype Lane" /
"Living Room" project, and starts the repo's mock Supabase (GoTrue auth +
storage) on `127.0.0.1:39911`.

**Repo — apply the two TEMPORARY test-only bypasses** (never commit these):

```bash
cd /path/to/staging-studio
git apply /path/to/dana-rig/mock-fal.patch
```

Then add the localhost allowance in `src/lib/ai-route-schemas.ts`
(UX-PROTO-ONLY — the mock result URL is `http://127.0.0.1:39911/...`,
which the https-only allowlist would otherwise reject):

```ts
function isAllowlistedHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    // UX-PROTO-ONLY (revert): allow the local mock result URL.
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return true;
    return url.protocol === "https:" && IMAGE_HOST_PATTERN.test(url.hostname);
  } catch {
    return false;
  }
}
```

**Terminal 2 — the app:**

```bash
UX_PROTO_REPO=/path/to/staging-studio bash /path/to/dana-rig/start-app.sh
```

App lands on `http://127.0.0.1:39901`. Log in as
`e2e@stagingstudio.test` with **any** password (mock auth accepts anything).

**Terminal 3 — the browser driver relay:**

```bash
cd /path/to/staging-studio && node /path/to/dana-rig/driver.js
```

Relay listens on `127.0.0.1:39999`. Ops: `start`, `goto`, `url`,
`snapshot`, `screenshot`, `click {id}`, `clickText {text}`,
`fill {id, text}`, `type {id, text}`, `press {id, key}`, `check {id}`,
`select {id, value}`, `upload {clickId, path}`, `paint {id, strokes}`,
`bbox {id}`, `wait {ms}`, `waitForText {text}`, `waitForGone {text}`,
`eval {code}`, `close`. All via `POST /act` with JSON.

## Running Dana herself

There is no standalone persona runner — **the agent is the loop**.
Give your coding agent (OpenCode works well) `persona-brief.md`, the room
photo, and these instructions:

> Drive the app at http://127.0.0.1:39901 through the relay at
> http://127.0.0.1:39999 (`POST /act`). First `{"op":"start"}`, then loop:
> `snapshot` + `screenshot`, decide ONE action as Dana would, issue it,
> narrate what she tried / expected / got. You are Dana per the brief —
> nontechnical, never touch dev tools, judge the workflow not the image.
> Report back: success or give-up, ranked friction with locations, anything
> broken, and the one moment of highest confidence.

Tip: `paint` strokes are polylines in fractions of the canvas bbox, e.g.
`{"op":"paint","id":"7","strokes":[[[0.3,0.4],[0.5,0.45],[0.7,0.4]]]}`.

## Running it nightly (regression)

Yes — this is built for that. `nightly.sh` runs the whole thing unattended:
pull (optional), apply the temporary bypasses, bring up the stack, run one
headless Dana session, save a dated report, tear down, and revert the repo
to clean. It needs:

- Your machine awake at the scheduled time, with `cron` (or launchd/Task
  Scheduler) and your agent runner authenticated non-interactively
  (`opencode run "<prompt>"` is the default; override with `DANA_RUNNER`)
- The env vars at the top of `nightly.sh`: `UX_PROTO_REPO`, `DANA_RIG`,
  `DANA_PHOTO`, `DANA_REPORTS`

```bash
chmod +x nightly.sh
# test it once in the foreground before trusting cron:
UX_PROTO_REPO=$HOME/staging-studio DANA_RIG=$HOME/dana-rig \
DANA_PHOTO=$HOME/dana-rig/living-room.jpg DANA_REPORTS=$HOME/dana-reports \
bash $HOME/dana-rig/nightly.sh
```

Cron example (2:30am daily) is in the script header.

Honest caveats for nightly use:

- **Each run costs agent tokens** — roughly 17–25 browser actions, each with
  a snapshot + screenshot in context. Budget accordingly.
- **Runs vary.** Dana is an LLM persona, not a script. The regression signal
  is the *friction list* across nights, not exact step counts. If you want a
  cheap deterministic gate too, the repo's hermetic Playwright suite
  (`npm run e2e`) already covers upload/inpaint/export flows — run that
  nightly as well and let Dana be the qualitative layer.
- A run takes ~30–60 minutes wall-clock (mostly the agent thinking).

## Cleanup (important)

```bash
cd /path/to/staging-studio
git checkout -- src/app/api/inpaint/route.ts src/lib/ai-route-schemas.ts next.config.ts
git checkout -- tsconfig.json   # Next.js flips jsx on every dev run; never commit it
git status                      # must be clean
```

Then stop all three terminals. Ports used: 39901 (app), 39911 (mock
Supabase), 39999 (driver relay), 5432 (postgres).

## Files

- `driver.js` — headless Playwright Chromium + JSON relay (`UX_PROTO_APP_URL`, `UX_PROTO_CHROME_PATH`, `UX_PROTO_RELAY_HOST`, `UX_PROTO_SHOT_DIR`, `UX_PROTO_CHROMIUM_ARGS` envs)
- `setup.ts` — Postgres schema push + seed + mock Supabase (`UX_PROTO_REPO`, `DATABASE_URL` envs)
- `start-app.sh` — dev server with dummy keys + mock flags (`UX_PROTO_REPO` env)
- `mock-fal.patch` — temporary fal.ai bypass (apply → run → **revert**)
- `localhost-allow.patch` — temporary localhost URL allowance for `ai-route-schemas.ts` (**revert**)
- `persona-brief.md` — the Dana persona prompt for the driving agent
- `dana-prompt.md` — headless-runner prompt template (`__PHOTO__`/`__REPORT__`/`__RIG__`/`__SCREENSHOT_NOTE__` substituted by the nightly scripts)
- `nightly.sh` — unattended nightly regression, three-terminal stack: stack up → Dana session → dated report → teardown → repo reverted clean
- `nightly-compose.sh` — unattended nightly regression, compose stack (same, plus `down -v`)
- `docker-compose.yml` — one-command full stack (db, mock, setup, app, driver)
- `docker/` — Dockerfiles, container entrypoints, `run-mock.ts`, `shots/`
