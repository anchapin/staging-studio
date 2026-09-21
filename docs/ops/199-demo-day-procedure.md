# Demo Day Procedure — Issue #199

## Overview

This document captures the complete demo day procedure for the Circle G Designs lookbook demo. The demo is driven by Alex (operator) with Lauren Chapin (art director/decision-maker). Total planned content: ~12.5 minutes.

**URL:** `https://staging-studio-kappa.vercel.app`

---

## Pre-Flight Checklist (Morning Of)

### Automated Checks — Run `scripts/rehearsal-drill.sh`

```bash
PROD_URL=https://staging-studio-kappa.vercel.app ./scripts/rehearsal-drill.sh
```

Automated assertions:
- [ ] Production URL root responds 2xx/3xx
- [ ] `/login` route responds 2xx/3xx
- [ ] Fallback PDF exists on disk (`demo-assets/fallback-lookbook.pdf`) and is a valid PDF

### Physical / Manual Checks

- [ ] Laptop charged + external mouse connected
- [ ] Printer is ON with letter-size paper loaded
- [ ] Production URL bookmarked in browser
- [ ] Browser logged in (session fresh)
- [ ] Demo project "1506 Porters Mill Ter" verified to show Living Room + Bedroom with images
- [ ] Fallback PDF on disk: `demo-assets/fallback-lookbook.pdf`
- [ ] Screen lock disabled / timeout disabled
- [ ] Notifications silenced

### Pre-Demo Confirmation

- [ ] Sat vs Sun confirmed with Lauren
- [ ] Lauren has been briefed on demo flow (no surprises)
- [ ] Conference room / demo space reserved

---

## Demo Script Steps

### Beat 1: Login (~30s)
Type the password live — no magic link. Land on `/projects`.

### Beat 2: Open the Project (~30s)
Open "1506 Porters Mill Ter, Midlothian — the Hartwell house."
Narrate: client profile (empty-nesters downsizing) and aesthetic (**Vintage Modern**) — this drives every AI choice that follows.

### Beat 3: THE HERO BEAT — 5A Holistic Staging Flow (~2.5 min)
1. Open **Edit staging** on the Living Room.
2. Lauren dictates the look (mood, pieces, what stays and what goes).
3. Type her words into *Staging directives* verbatim — this is the "AI follows HER" moment.
4. One click: **Stage entire room**. The AI re-stages the whole room at once.
5. Narrate during queue wait (~35s): *"It's reading her intent and staging the entire room around how the house actually is — this used to be a half-day of Photoshop."*

**Timing fallback:**
- ≤90s: live result appears as the after-image.
- >90s: click the variant to reveal the pre-generated after-image (identical directive). Say: *"Same pipeline, pre-warmed for today."*

### Beat 4: Find & Replace — SAM 3.1 Concept Pass (~1.5 min)
1. Room furnishings were detected the moment the editor opened — no waiting.
2. Click the **sofa** concept chip.
3. Click the tinted sofa on the photo to select it (second click un-selects).
4. The **Batch staging** panel appears with prompt pre-filled: `"Replace the sofa with "`
5. Lauren finishes the sentence (e.g., "a warm oatmeal boucle").
6. Switch to **A separate prompt per object**, click **Run batch**.
7. The sofa is swapped inside the same variant.

Line: *"She names the object, the AI replaces it — no Photoshop lasso, no hand-masking."*

### Beat 5: Brush Touch-Ups + Variant Strip (~2 min)
1. Paint one small zone with the **brush** for a targeted touch-up — *"The room came back whole; now we fine-tune, like a highlighter."*
2. Use the **variant strip — Original / Variant A / Variant B**: flip between takes; selected state follows the toggle.
3. Ask Lauren to call the winner.
4. *"Three takes of her room, one click apart."*

### Beat 6: Copy Generation Live (~20s)
1. Click **Generate Copy**.
2. Read the *Challenge → Recommendation → Psychology* trio aloud.
3. *"This is the client-ready language, in our voice, in seconds."*

### Beat 7: Bedroom Reveal (~1 min)
Second room — already staged.
Narrative: *"The sellers were using it as an office; buyers need to see the bedroom."*
Shows depth: the lookbook is a *document*, not a one-off trick.

### Beat 8: Preview Lookbook (~1 min)
1. Open **Preview Lookbook**.
2. Scroll through: cover (logo + firm name), philosophy page, room spread with before/after, sign-off.
3. *"This is the deliverable."*

### Beat 9: Export PDF Live (~45s)
1. Click **Export PDF**.
2. Save to Desktop.
3. Open the file to confirm.
4. Send to printer.

**If export errors:** Open `demo-assets/fallback-lookbook.pdf` — same artifact, pre-rendered. Diagnose after Lauren leaves.

### Beat 10: Print + Handover (~2 min)
The Hero Artifact, physical, in her hands.

---

## Failure Drills

### Stage-the-Room Stall
If the spinner passes ~90s: say *"Let me show you the finished version,"* open the pre-generated variant, continue. **Never wait on a spinner in silence.**

### Export Error
On-disk fallback PDF. The printed artifact is the demo; the live export is the proof.
If live fails → fallback + honest one-liner: *"Rendering hiccup on the demo account — here's the document it produces."*

### Any 500 Error
Screenshot, note the timestamp, fallback, keep moving. Log sweep afterward.

---

## Password Handoff Closing Beat

After the lookbook is in Lauren's hands:

> *"This is your account — here's the password. It's your tool now."*

Deliver credentials cleanly. Do not apologize or hedge. This is the closing moment — confident, direct handoff.

---

## Post-Demo

- [ ] Log any errors with timestamps
- [ ] Note any beat that ran long or short
- [ ] Follow up on any 500 errors with engineering
- [ ] Confirm Sat/Sun scheduling for follow-up if needed
