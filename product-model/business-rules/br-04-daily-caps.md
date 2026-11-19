---
appliesTo:
  - type: capability
    id: detect-furnishings
  - type: capability
    id: select-vision-label
  - type: capability
    id: brush-mask-inpaint
  - type: capability
    id: ai-room-copy
  - type: capability
    id: pdf-export
references:
  - kind: code
    role: implementation
    target: src/lib/api-quota.ts
---

# Daily caps bound each paid inference surface per user per day

Paid inference surfaces are capped per user per server-local calendar
day: segmentation at 100 units (DAILY_SEGMENT_LIMIT) and vision labelling
at 50 units (DAILY_LABEL_LIMIT). Exceeding a cap is refused with 429.

**Grant.** A user's daily usage of each paid surface is bounded; the cap
is enforced before the paid call for the surfaces that claim atomically.

**Enforcing code.** `src/lib/api-quota.ts` — `claimDailyQuota` performs an
atomic conditional increment against the `DailyApiUsage` counter row
(`@@unique([userId, surface, dayKey])`), so a concurrent burst cannot all
read the same pre-spend count and overshoot the cap. The declared caps are:

| Surface | Constant | Default |
| --- | --- | --- |
| segmentation | `DEFAULT_DAILY_SEGMENT_LIMIT` (alias `SEGMENT_DAILY_LIMIT`; env var name `DAILY_SEGMENT_LIMIT`) | 100 |
| vision labelling | `DEFAULT_DAILY_LABEL_LIMIT` (env var name `DAILY_LABEL_LIMIT`) | 50 |
| inpainting | `DEFAULT_DAILY_INPAINT_LIMIT` (env var name `DAILY_INPAINT_LIMIT`) | 20 |
| copy generation | `DEFAULT_DAILY_COPY_LIMIT` (env var name `DAILY_COPY_LIMIT`) | 50 |
| PDF export | `DEFAULT_DAILY_EXPORT_LIMIT` (env var name `DAILY_EXPORT_LIMIT`) | 20 |

The delta names the caps `DAILY_SEGMENT_LIMIT=100` and
`DAILY_LABEL_LIMIT=50`; in the code those names are the **environment
variable names** in `DAILY_LIMIT_ENV_VAR`, while the in-code constants are
the `DEFAULT_DAILY_*_LIMIT` pair. The values match.

A "day" is the server-local calendar day (local midnight → next local
midnight).

**Notes.**

- `DailyApiUsage` and `SetupRateLimit` are **not** entities in this model.
  They appear only as rules — this rule for the counters, and
  [BR-05](br-05-setup-rate-limit.md) for the setup lockout.
- The segment cap is currently **inert** in practice — see
  [BR-15](br-15-segment-cap-inert.md).
- Inpainting's charge timing differs from the other surfaces — see
  [BR-12](br-12-inpaint-quota-after-call.md).
