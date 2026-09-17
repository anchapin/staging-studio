# PoC Demo Script — Lauren Chapin (Sep 19–20)

Total planned content: **~12 minutes** (under the 15-minute cap). Driver: Alex. Lauren art-directs.
URL: `https://staging-studio-kappa.vercel.app` (bookmarked; exact URL, no trailing slash).

## Pre-flight (before she arrives — see T10)

- [ ] Laptop charged + external mouse; printer ON with paper (letter)
- [ ] Production URL bookmarked and logged-in state fresh
- [ ] Fallback PDF on disk: `demo-assets/fallback-lookbook.pdf`
- [ ] Demo project open check: "1506 Porters Mill Ter" shows Living Room + Kitchen with images

## Beats

**1. Login (30s).** Type the password live — no magic link. Land on `/projects`.

**2. Open the project (30s).** "1506 Porters Mill Ter, Midlothian — the Hartwell house."
Narrate: client profile (empty-nesters downsizing) and aesthetic (**Vintage Modern**) — this drives every AI choice that follows.

**3. Living Room — Lauren dictates (2 min).** Open **Edit staging**. She says what she'd do with the room. Type her words into *Staging directives* verbatim — this is the "AI follows HER" moment. If her direction matches the saved one, even better: it's pre-loaded.

**4. Mask + inpaint live (90s hard timeout).** Paint the furniture zone with the brush (or reuse the saved mask). Click **Apply Inpainting**.
Narrate during the queue wait (~35s measured): "it's reading her intent, re-staging around the actual architecture — this used to be a half-day of Photoshop."
- **≤90s:** live result appears as the after-image.
- **>90s:** click the variant — reveal the **pre-generated** after-image (identical directive). Line: "same pipeline, pre-warmed for today."

**5. Copy generation live (20s).** Click **Generate Copy**. Read the *Challenge → Recommendation → Psychology* trio aloud — "this is the client-ready language, in our voice, in seconds."

**6. Kitchen reveal (1 min).** Second room — already staged. Shows depth: the lookbook is a *document*, not a one-off trick.

**7. Preview lookbook (1 min).** Open **Preview Lookbook**. Scroll: cover (logo + firm name), philosophy page, room spread with before/after, sign-off. "This is the deliverable."

**8. Export PDF live (45s, non-negotiable).** Click **Export PDF**. Save to Desktop. Open it. Send to printer.
- If export errors: open `demo-assets/fallback-lookbook.pdf` — same artifact, pre-rendered. (Diagnose after she leaves.)

**9. Print + hand over (2 min).** The Hero Artifact, physical, in her hands.

**10. Closing beat.** "This is your account — here's the password. It's your tool now."

## Failure drills (T10 — rehearse both)

- **Inpaint stall:** if the spinner passes ~90s, say "let me show you the finished version," open the variant/pre-generated image, continue. Never wait on a spinner in silence.
- **Export error:** on-disk fallback PDF. The printed artifact is the demo; the live export is the proof. If live fails → fallback + honest one-liner: "rendering hiccup on the demo account — here's the document it produces."
- **Any 500:** screenshot, note the timestamp, fallback, keep moving. Log sweep afterward.

## Rules

- Never say "wait" — always narrate or pivot.
- The PDF in her hands is the success criterion; everything else is setting.
