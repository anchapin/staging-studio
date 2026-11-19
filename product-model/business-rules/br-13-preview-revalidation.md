---
appliesTo:
  - type: context
    context:
      place: print-surface
references:
  - kind: code
    role: implementation
    target: src/lib/preview-token.ts
  - kind: code
    role: implementation
    target: tests/revalidate-preview.test.ts
---

# Every action mutating a lookbook-rendered field must revalidate /preview/{projectId}

Any server action that mutates a field the Lookbook renders must
revalidate /preview/{projectId} alongside its dashboard path. A preview
token controls WHO can see the page, not whether the page is fresh.

**Grant.** The cookie-less print surface is never stale: every mutating
action that changes what the Lookbook shows must invalidate the preview
path for that project.

**Enforcing code.**

- `src/lib/preview-token.ts` — the header states the revalidation contract
  (issue #1225): *"Every server action that mutates a lookbook-rendered
  field must revalidate `/preview/{projectId}` alongside its dashboard
  path."* The preview page itself is `force-dynamic`.
- `tests/revalidate-preview.test.ts` — pins the contract statically: every
  action file that revalidates a `/projects/...` path must also revalidate
  a `/preview/...` path, and no action may revalidate `/preview/...`
  without also touching `/projects/...`. `settings.ts` is the documented
  exception (it revalidates `/settings`, not a project-scoped path).

In practice the mutating actions call `revalidatePath` for the project
path, the workspace / lookbook / refine / report paths and
`/preview/${projectId}` — for example
`src/app/actions/project.ts` (metadata, signature, virtually-staged label),
`src/app/actions/room-variants.ts` and `src/app/actions/room-batch.ts`.

**Effect on the model.** Any capability that changes a lookbook-rendered
field inherits this rule — swatch page, procurement table, room copy,
variant selection, sign-off.
