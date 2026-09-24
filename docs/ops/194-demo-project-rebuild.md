# Ops Procedure: #194 — Demo Project Rebuild

## Prerequisites

- [ ] **#191** closed — "Stage entire room" preset shipped; holistic run lands in a variant slot end-to-end on kappa
- [ ] **#192** closed — Variant legibility (thumbnails, editing indicator, delete-per-variant) confirmed
- [ ] Operator has kappa environment access (Vercel dashboard or `vercel CLI`)
- [ ] `demo-assets/fallback-lookbook.pdf` pre-rendered and on disk (from prior demo run)

## Demo Project Target

**Project:** `1506 Porters Mill Ter, Midlothian`
**Rooms:** Living Room (hero, primary focus) + Bedroom (secondary, pre-staged)

---

## Step-by-Step Procedure

### Phase 1: Access Kappa Environment

1. Log into Vercel dashboard → select `staging-studio-kappa` project
2. Open Supabase dashboard for the kappa database
3. Identify the existing `1506 Porters Mill Ter` project (if it exists from prior runs) — confirm it has Living Room + Bedroom rooms

### Phase 2: Create / Reset Demo Project

If project does not exist or is corrupted:

1. Navigate to `/projects/new` on kappa
2. Create project: **1506 Porters Mill Ter, Midlothian**
3. Add rooms:
   - **Living Room** (primary, hero room)
   - **Bedroom** (secondary)
4. Upload "before" photos for each room (original empty/dated staging state)

### Phase 3: Pre-Generate Hero Results via 5A Holistic Flow

The Living Room is the **hero room**. Its staged result must be pre-generated BEFORE the demo so it is available as the fallback variant if the >90s timeout fires.

#### Living Room — Hero Run (5A Holistic Flow)

1. Open the Living Room editor
2. Verify **stagingAesthetic** is set to `Vintage Modern` (project-level setting)
3. In *Staging directives*, enter a full holistic directive derived from the demo script persona (seller empty-nester, downsizing, Vintage Modern):
   > "Replace all furniture and décor with Vintage Modern alternatives — warm oatmeal boucle sofa, brass accent lighting, curated vintage art, remove clutter, brighten walls, natural wool rug"
4. Click **Stage entire room** (the #191 preset)
5. Wait for result (target: ≤90s, ideal ≤35s)
6. On success: result auto-populates the selected variant slot
7. **Capture the result URL** — this is the pre-generated fallback for the >90s choreography

#### Bedroom — Pre-Staged Run

1. Open the Bedroom editor
2. Enter a proportionate holistic directive:
   > "Stage as primary bedroom — Vintage Modern queen bed, nightstands, brass lamps, remove office equipment, light airy feel"
3. Click **Stage entire room**
4. Wait for result
5. On success: result populates the selected variant slot

### Phase 4: Configure Fallback Variants for Timeout Choreography

The **>90s timeout choreography** is a demo-script beat: if the holistic run takes longer than 90s, the operator clicks the variant strip to reveal a pre-generated after-image instead of waiting.

#### Variant Slot Strategy

- **Variant A** — primary slot: the live holistic run result (when ≤90s)
- **Variant B** — fallback/pre-generated slot: the pre-generated after-image (identical directive, rendered ahead of time)

#### To configure Variant B as the fallback:

1. After the hero run completes, **save the result image URL**
2. Run a **second holistic run with the same directive** and **do not wait** — let it queue; or:
3. If a second run is not feasible pre-demo, use the **Variant B** slot to store a prior successful render by:
   - Opening the Living Room editor
   - Navigating to the **Variant B** thumbnail slot
   - Using the brush tool to re-confirm the same mask, or
   - Pasting the pre-generated result URL into the Variant B slot via the inpaint persistence layer

**Indicator behavior** (per #192): the variant strip shows `Original / Variant A / Variant B` with `editing Variant X · n touch-ups` indicator. When the operator clicks Variant B, the fallback image is revealed immediately.

### Phase 5: Set Selected Variants for Lookbook Rendering

The lookbook must render **both room spreads** — each room needs a selected variant that is not null.

1. Open the **1506 Porters Mill Ter** project dashboard
2. For each room:
   - **Living Room**: ensure `selectedVariantIndex` points to the slot with the hero result (Variant A if live, Variant B if fallback was used)
   - **Bedroom**: ensure `selectedVariantIndex` points to the staged result
3. Navigate to **Preview Lookbook** (`/preview/[projectId]`)
4. Scroll through all pages — both room spreads must show before/after imagery
5. If a spread is blank, the `selectedVariantIndex` is null or pointing to the wrong slot; fix and re-render

### Phase 6: Verify the Rebuild

Pre-demo checklist (match DEMO_SCRIPT.md T10 pre-flight):

- [ ] Project "1506 Porters Mill Ter, Midlothian" loads on kappa with Living Room + Bedroom
- [ ] Living Room: hero result pre-generated and visible as a variant option
- [ ] Variant B is populated as the timeout fallback (if >90s event fires)
- [ ] Both rooms have non-null `selectedVariantIndex` — lookbook renders both spreads
- [ ] **Generate Copy** produces Challenge → Recommendation → Psychology trio for each room
- [ ] **Export PDF** completes without error
- [ ] Fallback PDF `demo-assets/fallback-lookbook.pdf` is on disk as last-resort backup

---

## Fallback Timeout Choreography (Scripted)

When the Stage entire room spinner passes ~90s during the demo:

1. Operator says: "Let me show you the finished version"
2. Operator clicks the **Variant B** thumbnail in the variant strip
3. Pre-generated after-image is revealed instantly
4. Operator narrates: "Same pipeline, pre-warmed for today"
5. Continue to next beat — no dead air on a spinner

---

## Key File References

| File | Purpose |
|------|---------|
| `docs/DEMO_SCRIPT.md` | Demo beats, pre-flight checklist, failure drills |
| `docs/ops/194-demo-project-rebuild.md` | This document |
| `src/lib/ai-route-schemas.ts` | 5A flow request/response schemas |
| `src/lib/inpaint-persistence.ts` | Variant slot persistence logic |
| `src/lib/staged-result.ts` | Selected variant index logic |

---

## Post-Demo

After the demo session, commit any delta (new variant images, updated project state) back to the repo if the operator captured configuration changes. Diagnose any >90s events in the `scripts/rehearsal-drill.sh` against live `PROD_URL`.
