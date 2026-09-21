# Issue #195 — Fallback PDF Re-export and Branding Validation

## Status
Blocked by #194 (must be completed first).

## Context

The fallback PDF (`demo-assets/fallback-lookbook.pdf`) is the demo failure drill artifact. If live PDF export errors during a demo, this file is opened instead — so it must pixel-match what the live export path produces. Issue #194 rebuilds the demo project through the 5A flow and configures pre-generated variants; only after #194 is complete should the fallback PDF be re-exported.

---

## Step 1 — Confirm #194 Is Complete

```bash
gh issue view 194
```

Verify all acceptance criteria are checked:
- [ ] Project "1506 Porters Mill Ter, Midlothian" rebuilt on kappa
- [ ] Hero results pre-generated through the 5A holistic flow
- [ ] Fallback variants configured for the >90s timeout choreography
- [ ] Selected variants set so the lookbook renders both room spreads

Only proceed when #194 is fully resolved.

---

## Step 2 — Re-export the Fallback PDF

### Prerequisites

- Dev server running locally (`npm run dev`)
- `scripts/dev-tunnel.sh` set up so `NEXT_PUBLIC_APP_URL` points to the public tunnel
- Browserless.io API key present in `.env.local`
- Both rooms (Living Room + Bedroom) fully staged with selected variants

### Procedure

1. **Open the demo project in the browser**
   ```
   https://staging-studio-kappa.vercel.app/projects
   ```
   Log in and open "1506 Porters Mill Ter, Midlothian".

2. **Navigate to the lookbook preview**
   - Click **Preview Lookbook** on the project
   - Scroll through all pages to confirm both room spreads render (Living Room + Bedroom)

3. **Trigger PDF export**
   ```bash
   # From the project root:
   npm run scripts/dev-tunnel.sh reset  # ensure localhost tunnel is active
   # Then in the browser: click "Export PDF" on the preview page
   ```
   - Save the exported PDF to `../demo-assets/fallback-lookbook.pdf`

4. **Verify the export succeeded**
   - Confirm the file size is reasonable (typically 1–3 MB)
   - Open the PDF and verify pages render

---

## Step 3 — Branding Verification

### Cover: Circle G Submark on bg-stone-50

| Check | Expected | How to Verify |
|---|---|---|
| Submark color | Black (`#1A1A1A` or equivalent) | Visual inspection of cover page |
| Background | Stone-50 (`#FAF9F6` or equivalent) | Matches the bg-stone-50 design token |
| Submark visibility | Crisp, high contrast | Submark must not blend into or clash with background |
| Placement | Centered or per layout spec | Consistent with DESIGN_SYSTEM.md |

**Test**: Export the PDF and open the cover page. The black submark on stone-50 background must be immediately legible. If the submark appears washed out or the background reads warm-white instead of stone-50, the branding tokens are misapplied.

### Philosophy Page

- [ ] Heading font matches Circle G brand (Cinzel or as specified in DESIGN_SYSTEM.md)
- [ ] Body copy reads in Circle G voice — professional, warm, staging-forward
- [ ] No generic placeholder text ("Lorem ipsum", "Your philosophy here")
- [ ] Contact info or firm tagline present and accurate

### Sign-off Page

- [ ] Firm name "Circle G Designs" present
- [ ] Submark/logo appears correctly
- [ ] Sign-off copy in Circle G voice (not generic "Thank you for your business")
- [ ] Contact details match current Supabase project settings

---

## Step 4 — Throwaway Lookbook Branding Validation

Run a full export of a throwaway test project (not the demo project) and validate:

1. **Create** a minimal test project with one room
2. **Stage** it with any variant
3. **Generate copy** to confirm AI copy pipeline works
4. **Export PDF** — validate the same branding checklist as above
5. **Delete** the test project after validation

This validates the branding is correct in the general export path, not just the demo data path.

---

## Step 5 — Commit and Push

```bash
git add docs/ops/195-fallback-pdf-procedure.md
git commit -m "docs: resolve #195 — fallback PDF re-export and branding validation procedure"
git push -u origin fix/issue-195-fallback-pdf --force-with-lease
```

Verify on GitHub that the branch exists and the file is present.

---

## Troubleshooting

### PDF export fails (500 error)
- Check Browserless.io API key is valid
- Verify `NEXT_PUBLIC_APP_URL` is publicly reachable
- Check `api/export-pdf` route logs in Vercel dashboard

### Submark renders incorrectly on cover
- Verify `bg-stone-50` CSS variable is applied to the cover page container
- Confirm `circle-g-submark-black.png` is the correct asset (not clay or social-share variant)
- Check DESIGN_SYSTEM.md for any recent changes to the cover layout

### Philosophy/signoff copy not in Circle G voice
- Check `prompts.ts` for any copywriting system prompts
- Verify `src/components/lookbook/` page components are using the correct copy variants
- Review `docs/DESIGN_SYSTEM.md` for the approved brand voice guidelines
