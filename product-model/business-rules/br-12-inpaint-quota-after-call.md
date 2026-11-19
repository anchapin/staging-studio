---
appliesTo:
  - type: capability
    id: brush-mask-inpaint
  - type: capability
    id: select-vision-label
  - type: capability
    id: room-finish-reuse
  - type: capability
    id: finetune-controls
references:
  - kind: code
    role: implementation
    target: src/lib/api-quota.ts
  - kind: code
    role: implementation
    target: src/app/api/inpaint/route.ts
---

# The inpaint quota unit is charged after the provider call; in-flight runs can overshoot the cap

The inpainting surface's daily unit is charged only after the provider
call returns. A request still in flight is not yet counted, so
concurrent in-flight submissions can overshoot the daily cap.

**Grant.** The cap on inpainting is a guardrail, not an accounting ledger:
it is checked before the call but charged after it.

**Enforcing code.**

- `src/lib/api-quota.ts` — the header states the known remaining race
  (tracked as #1111 / #1132): the `inpaint` charge is written **after**
  the provider call returns, so a request in flight concurrently is not yet
  counted and the cap can be overshot by in-flight submissions. The same
  check-then-act window exists on every surface. It is *"acceptable for a
  guardrail, not an accounting ledger."*
- `src/app/api/inpaint/route.ts` — the route follows the same shape:
  the unit is claimed, the provider is called, and the charge is written
  on completion. The one refund path is a **pre-write failure** — when the
  `InpaintRequest` row cannot be written, `refundInpaintQuota` returns the
  unit. A background submit failing after the claim does **not** refund,
  because the provider call was already paid for.

**Effect on the model.** The inpaint surface differs from copy / label /
segment / export, which claim atomically *before* the paid call and refund
on provider failure. That difference is a rule, not an entity.
