---
appliesTo:
  - type: capability
    id: firm-setup
references:
  - kind: code
    role: implementation
    target: src/lib/setup-rate-limit.ts
---

# The setup flow is rate-limited per IP — 10 failed attempts per sliding hour, then lockout

The setup flow is rate-limited per client IP: 10 failed attempts within
a sliding one-hour window lock the IP out for the remainder of the
window. A successful setup resets the counter.

**Grant.** The first-run setup flow refuses to keep trying for an IP that
has failed 10 times in an hour; the IP is locked for the remainder of the
window.

**Enforcing code.** `src/lib/setup-rate-limit.ts` — a Postgres-backed
per-IP limiter. The window is one hour
(`SETUP_RATE_LIMIT_WINDOW_MS`), the maximum is 10 attempts
(`SETUP_RATE_LIMIT_MAX_ATTEMPTS`), and the lockout lasts the window
(`SETUP_LOCKOUT_MS`). A successful setup deletes the counter row (reset);
a failure upserts an increment within the window and locks when the count
reaches the limit. Client IPs are SHA-256 hashed before storage, so raw
IPs are never persisted.

**Notes.**

- `SetupRateLimit` is **not** modelled as an entity — this rule is its
  entire modelled footprint.
- The setup flow is the entry point that creates the
  [User](../entities/user.md) record
  ([firm setup capability](../capabilities/firm-setup/capability.md)).
