---
domain: intake
availability:
  - place: web-app
references:
  - kind: code
    role: implementation
    target: src/app/(auth)/setup/page.tsx
  - kind: code
    role: implementation
    target: src/app/api/setup/route.ts
  - kind: code
    role: implementation
    target: src/app/api/setup/check/route.ts
---

# Firm setup

An authenticated visitor without a User row captures the firm's name and logo, creating the firm's branding record.
