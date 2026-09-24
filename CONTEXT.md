# StagingStudio

AI-assisted home staging lookbook generator for Circle G Designs (single tenant, one firm). Exists to turn a "before" room photo into a client-ready staging proposal — staged imagery plus persuasive copy — in minutes.

## Language

**PoC Demo**:
A single live walkthrough of the product shown to Lauren Chapin (owner, Circle G Designs); her acceptance decides whether the firm adopts it.
_Avoid_: Launch, production release (the PoC Demo is not a launch)

**Hero Artifact**:
The finished, Circle-G-branded PDF Lookbook — the tangible output the PoC Demo must produce convincingly.
_Avoid_: Money shot (internal slang)

**Lookbook**:
A printable, branded document presenting a Project's staged rooms with their staging recommendations and buyer psychology.
_Avoid_: Proposal, deck, report

**Target Buyer**:
The profile of homeowner a staged property is meant to attract (e.g. "growing family") — drives copy tone and furniture choices.
_Avoid_: Demographic, persona

**Staging Aesthetic**:
The named design style of a Project (e.g. "Vintage Modern") — it headlines the Lookbook cover.
_Avoid_: Style, theme, vibe

## Service contexts (Circle G's offerings)

**Vacant Staging**:
Staging an empty property with the firm's curated inventory — the room goes from bare walls to furnished.
_Avoid_: Model home furnishing

**Occupied Staging Consultation**:
Advising on furniture removal and adjustment in a homeowner-furnished room — in StagingStudio, the AI replaces visible existing furniture with recommended pieces.
_Avoid_: Redecorating (the client's furniture is being replaced, not rearranged)

## Relationships

- A **PoC Demo** succeeds or fails on the quality of its **Hero Artifact**
- A **Lookbook** presents one **Project** (which contains Rooms)

## Example dialogue

> **Dev:** "Should we harden auth for the demo?"
> **Domain expert:** "No — the PoC Demo is Lauren watching a Lookbook get made. Polish the Hero Artifact, not the perimeter."

## Flagged ambiguities

- "plan" was ambiguous at session start (feature work vs. launch) — resolved: the current plan is the **PoC Demo**, not a production launch.
- "the firm's account" was ambiguous about whose email owns the **User** row — resolved for the PoC: the account runs under the developer's email (demo-day pragmatics); migrating it to Lauren's email is deferred to adoption-time work.
