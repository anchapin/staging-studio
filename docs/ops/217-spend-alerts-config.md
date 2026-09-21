# Provider Spend Alerts Configuration — Issue #217

Operational setup for Sep 26–27 demo. Alerts must route to an inbox Lauren and Alex actually read before the demo.

## Alert Destination

**Use the existing Circle G Designs inbox:**
- Account holder: lauren@circle g designs / alex@circle g designs (verify correct addresses)
- Confirm both Lauren and Alex have access to the inbox before configuring alerts
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

## 2. fal.ai — Spending Alert

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

## Verification Checklist

- [ ] OpenAI monthly usage alert set and test email received
- [ ] fal.ai spending alert set and test email received (or confirmed feature unavailable + ticket opened)
- [ ] Browserless usage alert set and test email received (or confirmed feature unavailable + ticket opened)
- [ ] Both Lauren and Alex confirmed they receive the alert emails
- [ ] All three providers confirmed to route to the same inbox

## Troubleshooting

| Provider | Issue | Resolution |
|---|---|---|
| OpenAI | No billing access | Verify account ownership; check if org is on a legacy billing plan |
| fal.ai | No spending alert UI | Contact fal.ai support; consider manual daily usage check |
| Browserless | No alert UI | Contact Browserless support; set up a manual usage tracking check |
