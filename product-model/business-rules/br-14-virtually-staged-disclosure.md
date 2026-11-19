---
appliesTo:
  - type: entity
    id: project
    facts: [Virtually staged disclosure]
references:
  - kind: code
    role: implementation
    target: src/lib/virtually-staged-label.ts
---

# AI after-images carry the "Virtually staged" disclosure mark, on by default per project

A staged after-image carries a "Virtually Staged" disclosure mark. The
mark is enabled per project by default; only an explicit project-level
false turns it off, and it never appears on a before-image.

**Grant.** Every AI-staged after-image the Lookbook shows is disclosed as
virtually staged, unless the owning project explicitly opts out.

**Enforcing code.** `src/lib/virtually-staged-label.ts` — the disclosure
text is the literal `VIRTUALLY_STAGED_LABEL_TEXT = "Virtually Staged"`.
`resolveVirtuallyStagedLabelEnabled` treats `null` and `undefined` as
**enabled** (rows created before the column existed must default to the
safe behaviour, because an unlabelled staged photo is the exact thing the
disclosure exists to prevent); a project's explicit `false` is the only
way to disable it. The per-image predicate marks the **after** image of a
complete variant only — originals never receive the badge, and a room with
no complete variant has no after-image to mark. The setting is
project-scoped so the firm can match its local MLS / listing-agent
requirement per market.

**Effect on the model.** The toggle lives on
[Project](../entities/project.md)
(`virtuallyStagedLabelEnabled`, nullable, default `true`).
