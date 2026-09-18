# PoC Demo Script — Lauren Chapin (Sep 26–27)

Total planned content: **~11 minutes** (under the 15-minute cap). Driver: Alex. Lauren art-directs.
URL: `https://staging-studio-kappa.vercel.app` (bookmarked; exact URL, no trailing slash).

## Pre-flight (before she arrives — see T10)

- [ ] Laptop charged + external mouse; printer ON with paper (letter)
- [ ] Production URL bookmarked and logged-in state fresh
- [ ] Fallback PDF on disk: `demo-assets/fallback-lookbook.pdf`
- [ ] Demo project open check: "1506 Porters Mill Ter" shows Living Room + Bedroom with images

## Beats

**1. Login (30s).** Type the password live — no magic link. Land on `/projects`.

**2. Open the project (30s).** "1506 Porters Mill Ter, Midlothian — the Hartwell house."
Narrate: client profile (empty-nesters downsizing) and aesthetic (**Vintage Modern**) — this drives every AI choice that follows.

**3. THE HERO BEAT — the 5A holistic staging flow (2.5 min).** Open **Edit staging** on the Living Room. She dictates the look, top to bottom — the mood, the pieces, what stays and what goes. Type her words into *Staging directives* verbatim — this is the "AI follows HER" moment. Then one click: **Stage entire room**. The AI re-stages the whole room at once — walls, floors, lighting, layout — composed around the actual architecture, from her direction.
Narrate during the queue wait (~35s measured): "it's reading her intent and staging the entire room around how the house actually is — this used to be a half-day of Photoshop."
- **≤90s:** live result appears as the after-image.
- **>90s:** click the variant — reveal the **pre-generated** after-image (identical directive). Line: "same pipeline, pre-warmed for today."

**4. Brush touch-ups + variant strip (2 min).** Precision pass on top of the holistic result: paint one small zone with the **brush** for a targeted touch-up — "the room came back whole; now we fine-tune, like a highlighter." Then the **variant strip — Original / Variant A / Variant B**: flip between takes; the selected state follows the toggle. Ask HER to call the winner. "Three takes of her room, one click apart."

**5. Copy generation live (20s).** Click **Generate Copy**. Read the *Challenge → Recommendation → Psychology* trio aloud — "this is the client-ready language, in our voice, in seconds."

**6. Bedroom reveal (1 min).** Second room — already staged. Narrative: "the sellers were using it as an office; buyers need to see the bedroom." Shows depth: the lookbook is a *document*, not a one-off trick.

**7. Preview lookbook (1 min).** Open **Preview Lookbook**. Scroll: cover (logo + firm name), philosophy page, room spread with before/after, sign-off. "This is the deliverable."

**8. Export PDF live (45s, non-negotiable).** Click **Export PDF**. Save to Desktop. Open it. Send to printer.
- If export errors: open `demo-assets/fallback-lookbook.pdf` — same artifact, pre-rendered. (Diagnose after she leaves.)

**9. Print + hand over (2 min).** The Hero Artifact, physical, in her hands.

**10. Closing beat.** "This is your account — here's the password. It's your tool now."

## Failure drills (T10 — rehearse both)

- **Stage-the-room stall:** if the spinner passes ~90s, say "let me show you the finished version," open the pre-generated variant, continue. Never wait on a spinner in silence.
- **Export error:** on-disk fallback PDF. The printed artifact is the demo; the live export is the proof. If live fails → fallback + honest one-liner: "rendering hiccup on the demo account — here's the document it produces."
- **Any 500:** screenshot, note the timestamp, fallback, keep moving. Log sweep afterward.

## Rules

- Never say "wait" — always narrate or pivot.
- The PDF in her hands is the success criterion; everything else is setting.
