# Drift test (issue #1240 follow-up)

Run: 2026-10-12.
Script: `scripts/bake-off-drift-test.mts` (3 identical runs per slot,
fixed seed=42, prompt from `bake-off/vacant-insert.json`).

Diff is mean RGB delta in the **mask-complement region** — i.e. every pixel
outside the centered rectangle. Lower = more stable.

| Slot | Mean delta | Max delta | Unedited pixels compared | Verdict |
|---|---|---|---|---|
| flux-pro-fill | ~2.3-2.8 | 213 | 932,400 | essentially no drift (JPEG noise floor) |
| seedream-5-flash | 20-43 | 254 | 2,897,049 | heavy drift across full unedited region |

Seedream re-paints the whole room every run, so the "unedited" region shifts
~20-43 RGB units on average between identical submissions. Max delta 254/255
means whole regions of the supposedly-untouched area get repainted.

## Implication for the dual-model comparison UI

A user comparing "FLUX variant A" vs "Seedream variant B" cannot tell whether
Seedream looks better because of a better edit, or because it silently
repainted the rest of the room. The two outputs aren't measuring the same
thing — FLUX holds unmasked pixels stable (its product property), Seedream
doesn't. The comparison mode would be misleading and should not ship without
either (a) constraining Seedream to mask-only behavior via a different slot,
or (b) rendering side-by-side outputs that explicitly label the drift.

## Recommendation

Do NOT switch the inpaint incumbent to seedream-5-flash on its own. If a
dual-model comparison is wanted, it needs to be against another mask-fill
slot (flux-kontext-lora-inpaint or z-image-turbo-inpaint), not an
instruction-mode model.