# Spike 608: pdfcn as an on-demand fallback PDF engine (issue #1172)

Date: 2026-10-12
Status: complete
Verdict: GO for the fallback path (with one config line and known risks)

## Context

The fallback lookbook (`demo-assets/fallback-lookbook.pdf`, procedure
`docs/ops/195-fallback-pdf-procedure.md`, tracked as #194) is circular today: it
is generated through Browserless.io, the same dependency whose outage is the
reason a fallback exists. [pdfcn](https://www.pdfcn.dev/)
(github.com/shadcn-labs/pdfcn) is a copy-paste React PDF component kit rendered
by a Rust/wasm engine, no browser, no headless Chrome. This spike answers the
five questions from the issue.

## 1. Image embedding (non-negotiable)

Works. `@formepdf/react` `<Image>` embeds a JPEG at native resolution with a
base64 data URI. The PoC embedded a real 1600x1412 room photo and produced a
~307 KB single-page PDF with the photo intact. No re-encoding, no server round
trip. One caveat: an invalid image is dropped **silently** (the page renders
with a gap) rather than throwing, so a fallback generator should verify image
bytes before rendering; minimal check is a magic-byte sniff (JPEG: FF D8, PNG:
89 50 4E 47). Side finding while testing: `docs/demo/issue-248-verification-living-room.jpg`
is itself a corrupt file (UTF-8-mangled JPEG), so demo screenshots taken from
it should be retaken.

## 2. Server-side, no browser, no network

Works. Rendering is plain Node: `renderDocument(React element)` from
`@formepdf/core`, inputs as inline data URIs, zero outbound requests. The PoC
rendered the full report page in 115-185 ms. This runs inside a standard Next
route handler with no Browserless dependency.

## 3. Fidelity vs the Browserless lookbook

PoC recreated the lookbook report page from the same data model (project
header, address, room section with before/after photo, challenge /
recommendation / buyer-psychology copy, ROI trio, client sign-off line) and was
verified visually against the primary export's known layout. It reads as the
same report, simplified: real selectable text (PDF-native, not a rasterized
screenshot), consistent typography, colors, and table. Does not match the
browser render's full CSS freedom (no arbitrary web fonts beyond the bundled
set, no complex flex/grid edge cases). Good enough for an offline fallback;
not a candidate to replace the primary export.

## 4. Build and bundle impact

- Install weight: @formepdf/core ~20 MB (wasm binary), fonts-standard ~5.6 MB,
  adapters ~0.5 MB. ~26 MB added to the install.
- One real integration issue: `@formepdf/core`'s wasm does **not** bundle into
  a Next.js route out of the box. During `next build`, page-data collection for
  a route importing it fails with `ENOENT /ROOT/node_modules/@formepdf/core/pkg-node/forme_bg.wasm`.
  The fix is one line in `next.config.ts`: `serverExternalPackages: ["@formepdf/core"]`.
  Verified: with that line, `npm run build` succeeds with the importing route
  present; the patch was reverted after the check (this spike does not land it).
- Takumi's renderer is also wasm/napi, same class of consideration if chosen.

## 5. Renderer choice: Forme vs Takumi

Forme (`@formepdf/*` packages) is the pick for this use case. It is PDF-native:
real text objects, small files, direct report layout with tables and image
embedding. Takumi is an HTML/CSS-to-raster-image engine aimed at OG images, so its
"PDF" output is a stack of page-sized images: no selectable text and larger
files. (Assessed from documentation reading this spike; no Takumi run was
performed, and the choice below does not depend on that unmeasured claim.)

Maturity risk, stated plainly: the whole ecosystem is very young. pdfcn is
roughly six weeks old, distributed via the shadcn CLI registry rather than npm,
@formepdf is at 0.28.0 with a small surface documented, and both renderers are
single-maintainer-lineage. MIT licensed. Mitigation: the fallback path keeps
Browserless as the primary, the copy-paste model means the generator code is
vendored in-repo rather than a deep dependency, and the API surface actually
needed (Document/Page/Text/Image/Table + render) is small enough to swap out
later.

## PoC

Throwaway, per the issue: rendered in a scratch directory on Node v22.23.3
with @formepdf/react + @formepdf/core + @formepdf/fonts-standard, all 0.28.0,
installed --no-save; not committed. It rendered a complete one-page report
(address "1506 Porters Mill Ter, Midlothian", living room photo, three-part AI
copy, ROI table: 12 days on market / 4 offers / 102.1% sale-to-list, client
sign-off placeholder) as `fallback-poc.pdf`.

Minimal render call, for the #194 implementer:

```tsx
import React from "react";
import { Document, Page, Text } from "@formepdf/react";
import { renderDocument } from "@formepdf/core";

const pdf = await renderDocument(
  React.createElement(
    Document,
    null,
    React.createElement(Page, { size: "Letter" },
      React.createElement(Text, null, "fallback lookbook"))
  )
);
```

Remember the `serverExternalPackages` line from section 4 or the Next build
fails at page-data collection.

## Go / no-go

GO for implementing the on-demand fallback PDF (#194 unblocked by this):
pdfcn's Forme renderer meets the hard requirements (real images, server-side
no-browser, acceptable fidelity) and costs one config line plus ~26 MB of
install weight. Follow-up work, out of scope here: build the actual fallback
route behind a flag, vendor the components via the shadcn CLI, wire the
procedure doc, and revisit when the renderer ecosystem matures.
