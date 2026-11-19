---
kind: person
acts: external
---

# Client (via preview token)

The homeowner who reviews the Lookbook on the cookie-less print surface
and signs it. The client is reached only through a short-lived preview
token scoped to one project; the token is the only credential, because
the client holds no account and no session.

The Product keeps nothing about the client: there is no Client record,
no identity and no lifecycle. The signature and consent attestation the
client produces are kept on the [SignOff](./sign-off.md), which the
Project owns. The client name typed at intake is a free string on the
[Project](./project.md), and **this model asserts no identity between
that string and the client who signs** — the two are unlinked by design.
