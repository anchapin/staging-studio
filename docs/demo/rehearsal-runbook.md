# Rehearsal Runbook — PoC Demo T10 (Fri or Sat AM)

The gate that must pass **before** the demo (issue #163). The demo choreography itself
lives in [`docs/DEMO_SCRIPT.md`](../DEMO_SCRIPT.md) — this runbook tells you how to
**rehearse it end-to-end twice** and how to **drill the two failure modes** so the
live moves are muscle memory, not improvisation.

Driver: Alex. Audience: nobody (this is a rehearsal) — narrate out loud anyway.

Production URL: `https://staging-studio-kappa.vercel.app` (exact, no trailing slash).
Helper assertions: `bash scripts/rehearsal-drill.sh` (see §6).

---

## 1. Pre-flight checklist (before each rehearsal run)

### Laptop
- [ ] Plugged in or ≥ 90% battery (`scripts/rehearsal-drill.sh` reports battery status on Linux; verify manually on macOS via the battery icon)
- [ ] External mouse connected and cursor visible
- [ ] Screen lock / sleep disabled for the next 30 minutes (`caffeinate` / `systemsettings` — anything that blanks mid-demo is a fail)
- [ ] Browser: only the demo tab open; other tabs/windows closed
- [ ] Notifications silenced (Do Not Disturb ON)

### Network
- [ ] Connected to the demo-time network (the one the demo will actually use)
- [ ] `curl -fsS https://staging-studio-kappa.vercel.app/login > /dev/null` returns clean (or let the helper script check it)

### Production app state
- [ ] Logged-in state fresh: open the bookmarked URL → land on `/projects` without re-auth gymnastics (type-the-password beat still rehearsed in §2 step 1)
- [ ] Demo project "1506 Porters Mill Ter, Midlothian" opens: Living Room has a hero before-photo; second room present with images
- [ ] Saved staging directives present for the Living Room (Beat 3–4 pre-load)

### Printer
- [ ] Printer ON and online (`lpstat -p -d` on Linux/macOS, or print a test page from the OS)
- [ ] Letter paper loaded
- [ ] A test print of **anything** succeeded once this morning

### Fallback PDF
- [ ] `demo-assets/fallback-lookbook.pdf` exists, opens in the default viewer, looks right (see §5 for prep)
- [ ] Helper script passes the `%PDF` magic-bytes check

---

## 2. Rehearsal run 1 — full script end-to-end, no intervention

Execute every beat of `docs/DEMO_SCRIPT.md` in order, **as if Lauren were watching**.
The pass condition: all 10 beats complete without intervention. Check off as you go.

- [ ] **Beat 1 — Login.** Typed the password live (no saved form fill), landed on `/projects`
- [ ] **Beat 2 — Open project.** "1506 Porters Mill Ter" open; narrated client profile + **Vintage Modern** aesthetic
- [ ] **Beat 3 — 5A hero beat.** Opened **Edit staging**; typed staging directives (as Lauren will dictate); clicked **Stage entire room**, narrated during the queue wait; **result appeared (live or pre-generated variant)**
- [ ] **Beat 4 — Brush touch-ups + variant strip.** Painted a touch-up zone with the brush; flipped **Original / Variant A / Variant B**; selected state landed on the chosen take
- [ ] **Beat 5 — Generate Copy.** Read **Challenge → Recommendation → Psychology** aloud
- [ ] **Beat 6 — Second room reveal.** Bedroom/second room shown; "document, not a one-off" line delivered
- [ ] **Beat 7 — Preview Lookbook.** Cover → philosophy → room spread → sign-off scrolled
- [ ] **Beat 8 — Export PDF.** Export completed; file saved + opened
- [ ] **Beat 9 — Print.** Sent to printer; **physical page in hand**
- [ ] **Beat 10 — Closing beat.** Password-handoff line delivered

Notes from run 1 (timing per beat, anything rough):

```
beat 1: ___s   beat 2: ___s   beat 3: ___s (queue: ___s — live / fallback)
beat 4: ___s
beat 5: ___s   beat 6: ___s   beat 7: ___s
beat 8: ___s   beat 9: ___s   beat 10: ___s
rough spots:
```

---

## 3. Rehearsal run 2 — second pass, same rules

Reset anything run 1 changed (e.g. re-select the before-image, clear the copy field
if the flow allows — otherwise narrate the delta). Run all 10 beats again.

- [ ] **Run 2 complete, all beats, without intervention**

The acceptance criterion is **two clean passes on the production URL**. If a run
needed rescue, note why and run it again:

```
run 2 verdict: clean / needed rescue because: ___________
```

---

## 4. Failure-mode drills (after the two clean passes)

### Drill A — inpaint timeout (> 90 s) → fallback reveal path

**Goal:** prove you can hit the pre-generated after-image within one sentence of
narration, whether or not the live queue is actually slow.

1. [ ] Rehearse the **reveal action itself** (deterministic, no API needed): open the Living Room, click through to the **variant** holding the pre-generated after-image (same directive as the live one), and say the line — "let me show you the finished version" / "same pipeline, pre-warmed for today." You should be able to do this in < 5 s of dead air.
2. [ ] **Live-fire attempt:** click **Stage entire room** and let the queue run. If it returns ≤ 90 s, note the timing and treat step 1 as the drill (the production queue is warm; a real stall may not reproduce on demand). If it stalls > 90 s: **do not cancel** — execute the fallback reveal exactly as in step 1, leave the live result to land in the background.
3. [ ] Confirm: after the fallback reveal, the demo continues (Beat 5) without waiting on the spinner; if the live result lands later, the selected after-image is still correct.
4. [ ] Rule check: at no point did you wait on a spinner in silence.

```
drill A: reveal < 5s? __   live queue timing: ___s (live / stalled → fallback used)
```

### Drill B — export error → on-disk fallback PDF

**Goal:** prove the printed Hero Artifact survives a live export failure, using a
**local-only** simulation — never touch the production deployment's env config.

1. [ ] **Simulate locally:** `cp .env.example .env.local` (if not already present), set `BROWSERLESS_API_KEY` to a deliberately invalid value in `.env.local`, run `npm run dev`, open a local preview of the demo project, click **Export PDF**, and observe the error path (the route 500s when Browserless rejects the key). Confirm this never touches production: the simulation runs on `localhost`, `.env.local` is gitignored.
2. [ ] **Rehearse the human fallback, timed:** the moment export fails, open `demo-assets/fallback-lookbook.pdf` from disk, and deliver the honest one-liner — "rendering hiccup on the demo account — here's the document it produces." Dead air < 5 s.
3. [ ] Send the fallback PDF to the printer. Confirm the printed page is the real Lookbook (cover, room spread, sign-off).
4. [ ] **Restore:** revert `BROWSERLESS_API_KEY` in `.env.local` (or restore from `.env.example` conventions) and `rm` nothing else. Verify `git status` shows no stray changes from the drill.
5. [ ] On production: confirm one **successful** live export still works after the drill (Beat 8 pass) so you know the real path is healthy.

```
drill B: fallback open < 5s? __   printed page correct? __   env restored? __
```

### General 500 drill (from the demo script)
- [ ] Rehearse the reaction only: screenshot → note timestamp → fallback → keep moving. No debugging on stage.

---

## 5. Pre-exported fallback PDF — prep steps

Do this once, after branding (T8) + demo content (T9) are final; re-run if anything
upstream changes.

1. [ ] Open the production URL → demo project → **Preview Lookbook**.
2. [ ] Click **Export PDF** (the same live path) and save the result to
       `demo-assets/fallback-lookbook.pdf`
       (absolute: `/home/alex/Projects/stagingstudio/demo-assets/fallback-lookbook.pdf`).
3. [ ] Open the file: Circle-G branding on the cover, **Vintage Modern** headline, before/after spread, sign-off — all present.
4. [ ] Verify integrity: `head -c 4 demo-assets/fallback-lookbook.pdf` prints `%PDF` (the helper script does this too).
5. [ ] Keep the file **on the demo laptop's disk** (not cloud-only) and confirm the exact path from the browser's file-open dialog once, so the fallback open is one click on demo day.

---

## 6. Helper script (automatable assertions)

```bash
bash scripts/rehearsal-drill.sh
```

Checks, in order: production URL reachable → `/login` responds → fallback PDF exists
with `%PDF` magic bytes → battery status/capacity (warn-only) → printer detection via
CUPS (warn-only). Required checks failing = non-zero exit; warnings never fail the
run. Physical checks (paper, mouse, bookmarks, screen lock) stay human — they're in §1.

---

## 7. Gate checklist (all must be checked before declaring T10 passed)

- [ ] Pre-flight checklist clean (§1)
- [ ] Run 1: end-to-end, no intervention (§2)
- [ ] Run 2: end-to-end, no intervention (§3)
- [ ] Drill A: fallback reveal path proven (§4 Drill A)
- [ ] Drill B: on-disk fallback PDF proven + printed (§4 Drill B)
- [ ] Fallback PDF pre-exported, verified, on the demo laptop (§5)
- [ ] Helper script exits 0 (§6)
- [ ] Printer + paper verified with a physical test print (§1)

Issue #163 stays **open** until a human executes this runbook for real; this commit
delivers the assets, the drill closes the issue.
