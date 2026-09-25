# Rehearsal Plan — Issue #198

**Demo W11** — Full rehearsal ×2 + failure drills
**Date:** Sep 25 eve / Sep 26 AM
**Driver:** Alex | **Art Director:** Lauren Chapin
**Demo URL:** `https://staging-studio-kappa.vercel.app`

---

## ⚠️ Dependency: Issue #194 Blocked

**#194 is OPEN — this rehearsal CANNOT proceed until #194 is resolved.**

Issue #194 requires:
- [ ] #191 + #192 (both must be complete first)
- [ ] Project "1506 Porters Mill Ter, Midlothian" rebuilt on kappa: Living Room (hero) + Bedroom
- [ ] Hero results pre-generated through the 5A holistic flow
- [ ] Fallback variants configured for the >90s timeout choreography
- [ ] Selected variants set so the lookbook renders both room spreads

**Action required:** Complete #191 and #192 first, then rebuild the demo project via the 5A flow per #194 before scheduling the rehearsal.

---

## Pre-Rehearsal Checklist

### Dependency Verification
- [ ] **#191 complete** — confirm via `gh issue view 191`
- [ ] **#192 complete** — confirm via `gh issue view 192`
- [ ] **#194 closed** — rebuild the demo project "1506 Porters Mill Ter, Midlothian" on kappa per #194's acceptance criteria

### Physical Setup
- [ ] Laptop charged + external mouse connected
- [ ] Printer ON with letter-size paper loaded
- [ ] Production URL bookmarked (`https://staging-studio-kappa.vercel.app`)
- [ ] Logged-in session verified fresh (no stale sessions)

### Demo Artifacts
- [ ] `demo-assets/fallback-lookbook.pdf` exists and is non-trivial (>10 KB)
- [ ] Demo project "1506 Porters Mill Ter" shows Living Room + Bedroom with images loaded

### Automated Pre-Flight
Run the drill script to catch any regressions:
```bash
./scripts/rehearsal-drill.sh
```

Expected output: `RESULT: PASS — required checks green`

---

## Rehearsal Procedure

### Run 1 — Full Demo Script

Execute `docs/DEMO_SCRIPT.md` exactly, end-to-end.

| Beat | Duration | Key Action |
|------|----------|------------|
| 1. Login | 30s | Type password live (no magic link) → `/projects` |
| 2. Open project | 30s | "1506 Porters Mill Ter, Midlothian — the Hartwell house" |
| 3. Hero beat (5A holistic staging) | 2.5 min | Type directives verbatim → Stage entire room → ~35s queue |
| 4. Find & replace (SAM 3.1) | 1.5 min | Click sofa chip → click sofa → batch staging |
| 5. Brush touch-ups + variant strip | 2 min | Brush paint + Original / A / B toggle |
| 6. Copy generation | 20s | Generate Copy → read Challenge/Recommendation/Psychology |
| 7. Bedroom reveal | 1 min | Second room, already staged |
| 8. Preview lookbook | 1 min | Cover → philosophy → room spread → sign-off |
| 9. Export PDF | 45s | Export → Save to Desktop → Open → Send to printer |
| 10. Print + hand over | 2 min | Physical artifact in Lauren's hands |
| 11. Closing beat | — | Deliver credentials |

### Run 2 — Repeat Full Demo Script

Immediately repeat beats 1–11 with no changes. Both runs must complete without intervention.

---

## Failure Drill Procedures

### Drill 1: Inpaint >90s (Variant Fallback Reveal)

**Trigger:** Stage-the-room spinner passes ~90s with no result.

**Procedure:**
1. Say: *"Let me show you the finished version."*
2. Click the pre-generated variant (configured per #194)
3. Continue from beat 4 onward without missing a beat
4. Narrative: *"Same pipeline, pre-warmed for today."*

**Verification:** Variant reveal is instantaneous; Lauren sees no spinner.

---

### Drill 2: Export Error (On-Disk Fallback PDF)

**Trigger:** PDF export returns a 500 or network error.

**Procedure:**
1. Say: *"Rendering hiccup on the demo account — here's the document it produces."*
2. Open `demo-assets/fallback-lookbook.pdf` from the desktop
3. Continue from beat 10 (Print + hand over) with the fallback artifact
4. After Lauren leaves: log the error timestamp + screenshot for sweep

**Verification:** Physical fallback PDF prints and hands to Lauren.

---

### Drill 3: Any 500 Error

**Trigger:** Any unexpected 500 response during the demo.

**Procedure:**
1. Screenshot the error
2. Note the timestamp
3. Use appropriate fallback (variant for inpaint, PDF for export)
4. Continue without apology
5. Log sweep post-demo

---

## Post-Rehearsal Checklist

- [ ] Both runs completed without intervention
- [ ] Failure drills rehearsed (inpaint timeout, export error)
- [ ] Physical artifact (lookbook PDF) printed and handed to Lauren
- [ ] All errors logged with timestamps
- [ ] Any 500s documented for post-demo sweep
- [ ] Issue #198 marked resolved

---

## Reference: Key Files

| File | Purpose |
|------|---------|
| `docs/DEMO_SCRIPT.md` | Exact beat-by-beat demo script |
| `scripts/rehearsal-drill.sh` | Automated pre-flight assertions |
| `docs/ops/198-rehearsal-plan.md` | This document |

## Reference: Demo Rules

- Never say "wait" — always narrate or pivot
- The PDF in her hands is the success criterion; everything else is setting
- Pre-generated variants are the safety net — use them before the spinner hits 90s
