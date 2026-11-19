---
appliesTo:
  - type: capability
    id: detect-furnishings
references:
  - kind: code
    role: implementation
    target: src/app/api/segment/furnishings/route.ts
---

# The segment daily cap is stated but currently inert

The segmentation surface declares a daily cap (DAILY_SEGMENT_LIMIT =
100), but no wired inference provider implements SAM 3.1. The route
therefore fails fast with a classified 501 BEFORE claiming any quota
unit, so the cap is currently inert in practice.

**Grant.** The segmentation daily cap exists as a rule but is not
exercised today.

**Enforcing code.** `src/app/api/segment/furnishings/route.ts` — the
provider-capability check runs **before** `claimDailyQuota`, so a call
that could never succeed does not burn a daily cap. When the requested
logical model is unsupported, the route returns a classified **501**
(`retryable: false`, `code: "segmentation-failed"`) instead of spending a
unit. The capability table lives in
`src/lib/segment-furnishings-service.ts`
(`WIRED_PROVIDER_LOGICAL_MODELS`) and is pinned against the real provider
dispatch by `tests/segment-sam-fail-fast-seam.test.ts`.

**Why it is inert.** Neither wired provider implements SAM 3.1 (the fal.ai
adapter that served it was retired in #1240; the wired providers today
are Alibaba Cloud DashScope by default and OpenAI GPT-Image via
`INFERENCE_PROVIDER=openai`). The cap is therefore *stated* —
`DAILY_SEGMENT_LIMIT = 100` in `src/lib/api-quota.ts` — but cannot be
consumed until a SAM-capable provider is wired. Until then, brush tools
mask furnishings by hand.

**Effect on the model.** The cap rule
([BR-04](br-04-daily-caps.md)) lists `DAILY_SEGMENT_LIMIT = 100`; this
rule annotates that the surface is currently unreachable at the
inference step, not at the quota step.
