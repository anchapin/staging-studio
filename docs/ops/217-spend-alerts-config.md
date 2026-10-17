# Provider Spend Alerts Configuration — Issue #217

Operational setup for Sep 26–27 demo. Alerts must route to an inbox Lauren and Alex actually read before the demo.

## Alert Destination

**Use the existing Circle G Designs inbox:**
- Account holder: lauren@circlegdesigns.com (Circle G Designs owner) / Alex: a.n.chapin@gmail.com
- Confirm both Lauren and Alex have access to the inbox before configuring alerts
- (Corrected 2026-10-12 per issue #1130: the previous line listed addresses that do not exist.)
- Alternatively: create a dedicated `staging-alerts@circlegdesigns.com` alias if neither Lauren nor Alex checks a shared inbox regularly

## 1. OpenAI — Monthly Usage Alert

### Steps

1. Log in to [platform.openai.com](https://platform.openai.com) with the firm account
2. Navigate to **Settings → Billing** (or click your org avatar → Billing)
3. Under **Usage limits**, set:
   - **Monthly budget**: Set to an amount appropriate for the demo (e.g. $50–100/month for a firm user)
   - **Set alert threshold**: At 80% of the monthly budget (the alert fires before you hit the limit)
4. Enter an email address for alerts (must be a billing contact email)
5. Save

### Notes
- OpenAI bills monthly. The alert fires when cumulative API usage crosses the threshold.
- If the account uses the legacy billing plan, look under **Usage Alerts** in the dashboard.
- Alert email goes to the billing contact email registered on the account.

---

## 2. fal.ai — Spending Alert (legacy, paused)

> Paused 2026-10-12: inpaint migrated from fal.ai to Alibaba Cloud DashScope
> (issue #1240, PR #1242). fal alerts matter only if fal is re-enabled
> elsewhere. Steps kept for reference.

### Steps

1. Log in to [fal.ai](https://fal.ai) with the firm account
2. Navigate to **Settings → Subscription** or **Settings → Billing**
3. Look for **Spending limits** or **Usage alerts**:
   - Enable a **monthly spending cap** if available
   - Set an **email alert** at 80% of your expected demo spend
4. Enter the alert email (or confirm the account email is the correct inbox)
5. Save

### Notes
- fal.ai does not have a public-facing spend limit feature on all plans. If the dashboard lacks this option, contact fal.ai support or your account manager to request spending alerts be enabled.
- Alternative: set a hard cap on the account if the feature exists.

---

## 3. Browserless — Usage Alert

### Steps

1. Log in to [browserless.io](https://browserless.io) with the firm account
2. Navigate to **Settings → Billing** or **Settings → Usage**
3. Find **Usage alerts** or **Webhook alerts**:
   - Enable an alert at a threshold appropriate for the demo (e.g. 80% of expected monthly volume)
   - Set delivery method to **Email**
4. Enter the alert email (account email or dedicated inbox)
5. Save

### Notes
- Browserless sends usage summaries and alerts to the registered account email by default.
- If the dashboard lacks configurable alerts, contact Browserless support to request usage-based alerts.
- For the demo, ensure the alert threshold is set low enough to catch runaway PDF export loops.

---

## 4. Alibaba Cloud DashScope — Spending Alert (image provider since Oct 12, 2026)

### Steps

1. Log in to the Alibaba Cloud console ([dashscope.console.aliyun.com](https://dashscope.console.aliyun.com) or [console.aliyun.com](https://console.aliyun.com)) with the firm account
2. Navigate to **Expenses and Costs** (billing center) → **Budget Management**, or the DashScope model-service billing page
3. Set:
   - A **monthly budget** appropriate for image-editing volume (DashScope bills per image/token)
   - An alert threshold at 80% of the budget so it fires before the cap
4. Set the alert delivery to **Email** and enter the alert inbox above
5. Save

### Notes

- DashScope usage is visible per model under the billing center's usage/export views.
- If the account was created with a regional partition, check the correct region's console; billing is per-account, not per-region.
- The in-app quota counters (`DailyApiUsage`) are the fallback read: `npx tsx scripts/export-usage.ts` prints today's per-surface counts (issue #1130).

---

## Verification Checklist

> **Verification status as of 2026-10-13 (#1261 merge date):** code-side items
> (script `scripts/export-usage.ts` plus destination-line correction) are
> closed — PR #1261 landed on develop. Provider-alert verification (the rows
> below marked *pending — requires provider dashboard access*) must be
> completed by Alex against each provider's billing/alert dashboard. See
> issue #1130. **No box is ticked below without a real alert email received
> or a real "feature unavailable + ticket opened" note.**

- [ ] **OpenAI monthly usage alert set and test email received** —
  Status: pending — requires OpenAI billing dashboard access.
- [ ] **fal.ai spending alert set and test email received** —
  Status: pending — requires fal.ai dashboard access. *Legacy: only if fal
  is re-enabled; or confirmed feature unavailable + ticket opened.*
- [ ] **Browserless usage alert set and test email received** —
  Status: pending — requires Browserless billing dashboard access. *Or
  confirmed feature unavailable + ticket opened.*
- [ ] **Alibaba Cloud DashScope spending alert set and test email received** —
  Status: pending — requires Alibaba Cloud console (dashscope.console.aliyun.com
  or console.aliyun.com) Billing → Budget Management access. *Or confirmed
  feature unavailable + ticket opened.*
- [ ] **Destination inbox reachable** — Status: pending — requires Alex to
  confirm `a.n.chapin@gmail.com` is correct and that both Lauren and Alex
  have access to `lauren@circlegdesigns.com`. (The destination-line correction
  itself landed in PR #1261; this row tracks inbox-side confirmation, not the
  doc fix.)
- [ ] **All four providers confirmed to route to the same inbox** —
  Status: pending — depends on the four provider rows above; cannot be
  verified until those are.
- [x] **Code-side fallback in place** — Status: verified by PR #1261.
  `scripts/export-usage.ts` exists, reads `DailyApiUsage` per surface plus
  the `InpaintRequest` outcome split (today, `--date YYYY-MM-DD`,
  `--all-time`), and is referenced from the Troubleshooting table when a
  provider has no alert UI. Evidence: merge commit `547dd20` on develop
  ("feat(#1130): read-only usage report script and spend-alert doc
  corrections (#1261)") — implementation file
  `scripts/export-usage.ts`; doc reference at line 89 (DashScope notes) and the fal.ai / Browserless
  Troubleshooting rows at lines 141–142.
- [x] **Destination-line typo corrected** — Status: verified by PR #1261.
  Old line read `lauren@circle g designs / alex@circle g designs`; new line
  reads `lauren@circlegdesigns.com` / `a.n.chapin@gmail.com`. Evidence: see
  the "Corrected 2026-10-12 per issue #1130" annotation on line 10.

## Troubleshooting

| Provider | Issue | Resolution |
|---|---|---|
| OpenAI | No billing access | Verify account ownership; check if org is on a legacy billing plan |
| fal.ai | No spending alert UI | Contact fal.ai support; run `npx tsx scripts/export-usage.ts` for a manual daily usage read (issue #1130) |
| Browserless | No alert UI | Contact Browserless support; run `npx tsx scripts/export-usage.ts` for a manual daily usage read (issue #1130) |
