# Lookbook print-styling audit (issue #1222)

One-time audit of the lookbook print CSS (`src/app/globals.css`, the
`@media print` block around line 367) that drives both the web preview's
manual printing and the `/api/export-pdf` → Browserless → `/preview/[id]`
PDF pipeline. Scope was the four audit points in the issue: page-break
behavior, bleed/margin, high-DPI legibility, and image fit. The
"Virtually Staged" disclosure is tracked separately by #1186; the
Browserless-vs-pdfcn engine switch by #1172.

## The @page rule graph (after the audit)

```text
:root                          --print-margin: 6mm        ← safe-area token (new)
html.pdf-capture               --print-margin: 0mm        ← capture path (new)
@media print
├─ .page-break                 page-break-after: always   (unchanged)
├─ .avoid-break                page-break-inside: avoid   (unchanged)
├─ nav, .no-print              display: none              (unchanged)
├─ .lookbook-page              width: 100%                (was 100vw)
│                              margin: 0
│                              page-break-after: always
├─ .lookbook-page:last-child   page-break-after: auto     (unchanged)
├─ .proposal-footer            display: none              (unchanged)
└─ @page
   ├─ size: letter portrait                               (unchanged)
   ├─ margin: var(--print-margin, 6mm)                   (was 0mm)
   └─ @bottom-center          content, 6pt footer, hairline  (unchanged here)
@media print and (min-resolution: 300dpi)                 (new block)
├─ .lookbook-page .text-xs     font-size: 0.83rem  (~+11%)
├─ .lookbook-page .text-sm     font-size: 1rem     (~+14%)
└─ @page @bottom-center        font-size: 7pt      (~+17%)
```

## How the Browserless path stays full-bleed

`@page` margins cannot be scoped to an element, but they resolve custom
properties from the root. The capture path therefore marks itself:

- `src/app/api/export-pdf/route.ts` appends `capture=pdf` (the
  `PREVIEW_CAPTURE_QUERY_PARAM` literal exported from
  `src/lib/preview-token.ts`) to the signed preview URL it hands
  Browserless. Additive to the token; access checks unchanged.
- `src/app/(print)/preview/[id]/page.tsx` adds `pdf-capture` to `<html>`
  via an inline script when the param is present (`@page` resolves
  `var()` against the root element, so the class must live on `<html>`).
- `html.pdf-capture { --print-margin: 0mm }` pins the capture to the
  same full-bleed geometry as `buildBrowserlessPdfBody`'s zero margins
  (`src/lib/browserless.ts`, pinned by `tests/browserless.test.ts`).
- A human printing the preview from a browser (no capture param) gets
  the 6mm safe area.

## Per-rule before/after

| Rule | Before | After | Why |
| --- | --- | --- | --- |
| `@page { margin }` | `0mm` | `var(--print-margin, 6mm)` | real printers get a safe area; capture path pinned to 0 via `html.pdf-capture` |
| `.lookbook-page { width }` | `100vw` | `100%` | with a non-zero page margin, a 100vw element overflows the printable area; `100%` fills the content box in both paths |
| footer `@bottom-center` font | `6pt` | `6pt` (7pt at ≥300dpi) | screen/Browserless rendering is vector and fine; paper needs more |
| small text (`.text-xs`, `.text-sm`) | 0.75rem / 0.875rem | 0.83rem / 1rem at ≥300dpi | Tailwind sizes are rem-based, so the bump targets those utilities inside `.lookbook-page` instead of scaling the root font, which would rescale spacing and risk reflowing pages past the safe area |

## Page-break audit (avoid-break coverage)

Every long-form page component now keeps its content block off a page
boundary with an explicit comment citing this doc:

- `cover-page.tsx` (content block), `philosophy-page.tsx` (prose
  container), `buyer-persona-page.tsx` (persona cards + traits),
  `investment-summary-page.tsx`, `roi-metrics-dashboard.tsx`,
  `material-swatch-page.tsx`, `signoff-page.tsx`.
- Already covered before the audit: `room-spread.tsx` (4 sites: text
  panel, before/after grid, feature/amenity panels) and
  `furniture-procurement-table.tsx` (controls row, content block).
- Deliberate partials, documented: `consultation-furniture-table.tsx`
  rows are sized as `text-sm` table rows; the table body may break
  between rows (acceptable, row-level integrity preserved) and the
  component has no single content root. `signature-canvas.tsx` renders
  only in the interactive signing flow (`.no-print`-adjacent), never in
  the printed tree.

The test is the issue's own: open the exported PDF, scroll through, no
paragraph or table row is split mid-comprehension. `avoid-break` is a
preference, not a guarantee; an overfull block still breaks, but it
breaks after trying to move.

## Image-fit audit

All 5 `<Image>` uses in the lookbook tree were checked:

- `room-spread.tsx` before/after: `fill` + `object-cover` inside
  explicit `aspect-[4/3]` containers. Compliant: a 4000×3000 source
  cannot push the page past the safe area.
- `cover-page.tsx` and `signoff-page.tsx` logos: fixed `w-auto
  object-contain` with explicit width/height. Compliant.
- `signoff-page.tsx` client signature: `object-contain max-h-20` with
  explicit width/height. Compliant.
- No raw `<img>` tags exist in `src/components/lookbook/` or the
  `(print)` route.

## Baseline capture

`tests/e2e/specs/lookbook-print-baseline.spec.ts` runs the real
`/api/export-pdf` handler and saves the bytes to
`test-results/lookbook-print-baseline.pdf`, asserting only the `%PDF`
header and a non-zero page count so it stays stable across pure-CSS
changes. Honest caveat: in the hermetic e2e environment the provider is
the local mock Browserless (`tests/e2e/mock-browserless.ts`), so the
saved baseline there is the mock's fixture PDF, not a real render. In an
environment with a real `BROWSERLESS_API_KEY` the same spec captures the
real render unchanged; this working environment has no Browserless key,
so no real-render screenshots are embedded here. The known-good CSS
reference is the rule graph and table above; the captured PDF is the
artifact-level baseline.
