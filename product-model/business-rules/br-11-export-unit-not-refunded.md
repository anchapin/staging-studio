---
appliesTo:
  - type: capability
    id: pdf-export
  - type: context
    context:
      place: print-surface
references:
  - kind: code
    role: implementation
    target: src/app/api/export-pdf/route.ts
---

# An export quota unit is not refunded when the upstream returns a non-PDF body

When the PDF export's upstream answers 2xx with a body that is not a
PDF, the claimed export quota unit stays claimed: the export attempt
consumed a real render, so it is not refunded. The route answers 502.

**Grant.** A failed export attempt that reached the upstream is charged.

**Enforcing code.** `src/app/api/export-pdf/route.ts` — the unit is
claimed atomically before the render (issue #1132) and *stays claimed on
every post-dispatch outcome* (issue #1124). When the fetch result is
`kind === "nonPdfResponse"`, the route logs
`export_pdf_non_pdf_response` and answers **502** with
`retryable: true` and code `API_ERROR_PDF_GENERATION_FAILED` — and does
**not** refund the unit.

Contrast: a timeout *is* refunded (504 with `Retry-After: 5`, "No quota
was consumed — retry in a moment"), because the render never produced a
document. The distinction is whether the upstream produced a body.

**Effect on the model.** The export unit is spent on dispatch, not on
successful delivery — see [PDF export capability](../capabilities/pdf-export/capability.md).
