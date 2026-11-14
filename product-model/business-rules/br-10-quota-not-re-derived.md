---
appliesTo:
  - type: capability
    id: brush-mask-inpaint
  - type: capability
    id: pdf-export
  - type: capability
    id: select-vision-label
  - type: capability
    id: detect-furnishings
references:
  - kind: code
    role: implementation
    target: src/lib/api-quota.ts
---

# Daily quota units are never re-derived from a deletable domain table

A daily cap may only be read from the dedicated counter ledger. No
surface may re-derive usage by counting rows in a deletable domain
table, because deleting those rows would hand the cap back for free.

**Grant.** Daily usage counters are authoritative and non-refundable by
any in-app delete.

**Enforcing code.** `src/lib/api-quota.ts` — the module header states the
rule and its reason: the `inpaint` surface used to be metered by counting
today's `InpaintRequest` rows, but those rows **cascade-delete with their
room**, so deleting the rooms staged today dropped the count back to zero
and handed the user their whole cap back — repeatably, for free. A
counter row is not a child of any user content, so no delete in the app can
refund it. The header states: *"Nothing in `src/` may re-derive a daily
cap from a deletable table."* `tests/api-quota-ledger.test.ts` pins that.

**Effect on the model.** `DailyApiUsage` is not an entity; the counter is
the mechanism behind [BR-04](br-04-daily-caps.md),
[BR-11](br-11-export-unit-not-refunded.md) and
[BR-12](br-12-inpaint-quota-after-call.md).
