---
references:
  - kind: code
    role: implementation
    target: prisma/schema.prisma
---

# InpaintRequest

One persisted AI inpainting run against a room's variant slot. Persisting
the request is what lets a queued job survive a serverless deadline and
lets a page refresh resume polling. Persisted as the Prisma model
`InpaintRequest` (`prisma/schema.prisma`), owned by its `Room`
(`InpaintRequest.room`, cascade on delete).

## Information kept

- **Request identity** — `id`: the provider's own request id
- **Variant slot** — `variantSlot`: `0` or `1` — which "after" slot this run targets
- **Source slot** — `sourceSlot`: `null` = the run edits the original before photo; `0`/`1` = the run edits that variant's staged result in place
- **Result image** — `resultUrl`: the stored staged image URL
- **Provider result image** — `falResultUrl`: the provider's own result URL, memoized so a persistence retry never re-fetches (and never re-bills) it
- **Persistence attempts** — `persistenceAttempts`: provider-touching persistence attempts since entering Persistence failed; caps the retry loop
- **Last persistence attempt** — `lastPersistenceAttemptAt`: when the last persistence retry ran
- **Provider job** — `providerJobId`: the provider-side job handle

## States

### In queue

`IN_QUEUE` — accepted, provider work pending.

### In progress

`IN_PROGRESS` — the provider is running the job.

### Completed

`COMPLETED` — the provider returned an image; `resultUrl` is filled.

### Error

`ERROR` — the run failed.

### Persistence failed

`PERSISTENCE_FAILED` — the provider succeeded but persisting the result
failed; the provider's own result URL is memoized in `falResultUrl` so a
retry never re-fetches (and never re-bills) it.

## Notes

- The inpaint quota unit is charged **after** the provider call, so
  in-flight runs can overshoot the daily cap
  ([BR-12](../business-rules/br-12-inpaint-quota-after-call.md)).
- `INFERENCE_PROVIDER` (the deployment switch between Alibaba DashScope
  and OpenAI GPT-Image) is deployment configuration, **not** a variation.
