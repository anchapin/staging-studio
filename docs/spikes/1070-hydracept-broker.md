# Spike 1070 — Hydracept as a broker for the inpainting step (side experiment)

Issue: [#1070](https://github.com/anchapin/staging-studio/issues/1070). No code changes.

---

## TL;DR

**No match.** Hydracept's live public catalog does not offer a mask-guided inpainting capability. Its only image capability (`image.generate.v1`) is a *generation* surface — it accepts a `prompt` (and optional references / LoRA adapters / sheet-and-slice / variants) and produces an artifact. There is no `mask_url` / `mask_image` / inpaint-class parameter anywhere in the public OpenAPI, the capability descriptors, or the image-production docs. The beta offer quoted on the cold outreach ($25 of inference credit) does not match the published billing (Free plan includes a $0.50 managed-trial allowance; BYOK is 0% markup; managed is provider+ 6%). The previous inability of FlatHub-style brokers to compensate for mask precision still stands. Close as wont-do; no follow-up issue.

## Background

Cold outreach from Hydracept founder John. Hydracept is one public API for image / audio / video / 3D / domains / DNS / compute aimed at coding agents, claiming durable jobs, expiring-result-URL handling, idempotent retries, and provider fallback. Spikes are kept short and read-only — no integration work, no live API calls against the $25 credit (which the public docs suggest may be $0.50 anyway). The predecessor — [Spike 235](./235-vendor-investigation.md) — concluded that the deciding factor for the replace step is **precise, mask-guided architectural replacement** and that this is a *model* problem, not a *broker* problem: GPT Image 2.5's prompt-based masking was disqualified and Nano Banana has no mask support. A broker cannot make a fallback model follow a binary mask better than the model itself.

The single question this spike answers: **does Hydracept's live catalog offer any mask-guided inpainting that matches FLUX.1 Fill's binary-mask precision on our staging cases?**

Production context, restated for accuracy: as of #1240 the inpaint surface runs **Alibaba Cloud DashScope** (`qwen-image-2.1-pro`) via `src/lib/alibaba-adapter.ts`. `src/lib/fal.ts` was deleted in that PR. The line "fal.ai FLUX.1 Fill stays the live incumbent" in the issue body is the framing from before the #1240 migration — the live incumbent is now `qwen-image-2.1-pro` via DashScope, not fal. The mask-precision question (binary-mask inpainting for architectural replace) is unchanged.

---

## Vendor profile: Hydracept

- **Operator**: Zencode Consulting Inc. (zencodeinc on GitHub).
- **Product**: "Execution control plane for software and agents that need external capabilities." Public API base `https://api.hydracept.com`; capability discovery at `GET /v1/capabilities`.
- **SDKs / surfaces**: Python CLI + SDK (`pip install hydracept`, current 0.5.2 at time of writing); TypeScript SDK (`@hydracept/sdk`); .NET (`Hydracept.Client`); Unity UPM; stdio MCP server for Cursor and Claude Code; MCP Registry name `com.hydracept/hydracept`.
- **Repos**: `zencodeinc/hydracept-public` (public front door; 21 commits; topics include `agent-execution`, `mcp`, `byok`, `claude-code`, `cursor`); `zencodeinc/hydracept-agent-plugins`; `zencodept/hydracept-plugin`.
- **License**: MIT (per repo and package metadata).
- **GitHub traction**: 0 stars, 0 watchers, 0 forks at time of this spike. The catalog and docs read production-grade, but the project is effectively new / unknown.

### What they say they do

From their quick-start and capability docs: "Discover capabilities, submit invoke or durable jobs, track progress, download artifacts, and keep a receipt for every run. BYOK is 0% Hydracept fee; managed inference is provider price + 6%. Eligible durable text jobs use deferred processing at 50% of standard token rates."

Capability families (their own enumeration on the marketing page): image, audio, video, 3D, text, reasoning, domains, DNS, compute. Image is one family; inpainting is not called out.

### Catalog shape

Capabilities are addressed by stable keys (e.g. `image.generate.v1`, `audio.sfx.generate.v1`, `model.generate.3d.v1`). Each capability descriptor includes `execution`, `funding`, `output`, `interaction`, and `billingModes` fields so an agent can decide whether to call it without reading several docs pages. The `GET /v1/capabilities` route is the source of truth — the docs warn explicitly against hard-coding from the doc index.

---

## Catalog snapshot: what they offer today (image)

### `image.generate.v1`

This is the **only** image capability in the public catalog. It is a generation surface, not an edit / inpaint surface.

**Input shape (per the Image production docs):**
- `prompt: string` (32,000 character cap for GPT Image 1/2 via `byModel` overlay)
- `requestTransparentOutput: boolean` — output contract (native alpha for GPT Image, chroma-key matte for others)
- `transparentRegions: "borderConnected" | "borderConnectedAndEnclosed"` — selects alpha-mask region for the matte path
- `keyColor: "#rrggbb"` — chroma key for the matte path
- `sheet: { rows, columns, slice, animation, labels, normalize }` — multi-asset generation (sprite sheets, animation frames)
- `variantCount: 1..4` — multiple takes per job (must be `1` when sheet slicing is on)
- LoRA adapter references via `adapters` (model-adapter system)
- Image *references* via `references` / LoRAs — not binary masks

**No mask input.** No `mask_url`, `mask_image`, `mask_base64`, `mask_prompt`, or alpha-channel input parameter exists in the schema or in the OpenAPI's image generation paths. The "image production" page that documents every image-related option does not mention masking at all — its three production modes are Transparent output, Sheet & Slice, and Variants. Image references are supported for style/composition guidance, not for binary-region constraints.

**Output:** PNG artifacts (with native alpha or matte-normalized alpha depending on model), downloaded via `GET /v1/jobs/{jobId}/artifacts/{artifactId}`. Hydracept runs a transparent-PNG verifier (`png-transparency.v1`) that returns a structured transparency report — useful for their game-asset / inventory-icon use case, irrelevant for masked architectural inpaint.

### Models referenced in the `image.generate.v1` example / docs

- `gpt-image-2.5-flare` — referenced in the quote example.
- `gpt-image-2` and `gpt-image-1` — referenced for native-alpha output paths.
- LoRA / adapter system allows registering LoRAs against public Hugging Face repos via `adapters/source-preview`.

GPT Image's mask behavior is the disqualifying pattern Spike 235 already documented: "masking is entirely prompt-based. The model uses the mask as guidance, but may not follow its exact shape with complete precision." Even if Hydracept exposed that mask path (it doesn't appear to), the underlying model would still be imprecise.

There is no evidence (in docs, OpenAPI, or capability descriptors) that Hydracept offers a fal.ai FLUX.1 Fill–equivalent, an SDXL-Inpaint model, a Qwen-Image-Edit-class model, or any other explicit binary-mask inpainting capability.

---

## Mask-guided inpainting assessment vs FLUX.1 Fill baseline

The "FLUX.1 Fill baseline" in the issue body is a frame from before #1240. The actual live inpaint model on the inpaint surface is Alibaba Cloud DashScope's `qwen-image-2.1-pro`, which receives an `image_url` + `mask_url` binary mask and prompt in the multimodal-conversation call (`src/lib/alibaba-adapter.ts:182-194`); the route's persistence path uploads the result to Supabase Storage within DashScope's 24-hour URL window.

Either way, the mask-precision question is the same: the receiver has to accept a binary mask and respect its pixel boundaries for the edit to land inside the mask and not bleed into the rest of the room.

| Criterion | DashScope `qwen-image-2.1-pro` (current incumbent) | Hydracept `image.generate.v1` | Verdict |
|---|---|---|---|
| **Binary-mask input** | ✅ Yes — `image_url` + `mask_url` on the DashScope multimodal-generation endpoint, prompt-defined only | ❌ does not exist | Hydracept cannot do this step |
| **Architecture preservation** | ✅ binary mask is pixel-precise; qwen-Image-Edit handles interior / render coherently | N/A — no mask path | N/A |
| **Async job lifecycle** | Synchronous (one POST returns the result); inpaint adapter wraps as queue semantics for the poller | ✅ durable jobs + receipts (`HydraceptJob` with `jobId`, poll, artifact URLs, receipts) | Hydracept wins on lifecycle ergonomics, but the lifecycle question is moot without mask support |
| **Latency** | Synchronous ~5–15s typical | Synchronous for `image.generate.v1`; quote (`/v1/capabilities/{key}/quote`) before submit is optional but does not reserve funds | Comparable |
| **Cost** | ~$0.04/image at $0.04/megapixel-equivalent DashScope (issue #1240 default `qwen-image-2.1-pro`); per-user cap at 20/day (`DAILY_INPAINT_LIMIT`) | Provider price + 6% Hydracept service fee for managed; 0% Hydracept fee for BYOK; $0.50 trial allowance for new free accounts | Comparable, not a deciding factor |
| **BYOK** | N/A — Alibaba is the only wired provider | ✅ Yes — BYOK is a first-class concept (`Connections / BYOK`, billing modes include `byok.available`); 0% Hydracept fee | Hydracept wins on multi-provider flexibility, but without a mask-capable model underneath this is a routing surface only |
| **Expiring-result-URL handling** | DashScope-hosted URL: 24h; inpaint persistence uploads to Supabase Storage in that window | ✅ Yes — durable jobs, artifacts, receipts | Hydracept wins on durability ergonomics |
| **Idempotent retries** | The inpaint route does not expose idempotency keys today | ✅ Yes — `idempotencyKey` field on job submission; "A retry always uses a new idempotency key" | Hydracept wins on retry safety |
| **Provider fallback** | ❌ Single provider (`INFERENCE_PROVIDER` selects for the deploy; `fal` and `replicate` are retired per #1240) | ✅ Marketed as a first-class feature (one capability key spans multiple providers); capability descriptors include `exchangeable` / `execution.executionModes` fields | Hydracept wins on provider-fallback ergonomics — but the second-provider-in-a-broker problem is exactly what Spike 235 already answered (a broker cannot make a model follow a mask better than the model can) |
| **Live SDK integration cost** | None (live) | Significant — new adapter file in `src/lib/`, new capability key in `src/lib/inference.ts`, new env var(s), new route handler surface | Hydracept loses on integration cost |
| **Env vars (read-only check)** | `ALIBABA_DASHSCOPE_API_KEY`, `ALIBABA_BAILIAN_WORKSPACE_ID`, `ALIBABA_INPAINT_MODEL` already exist | Would add `HYDRACEPT_API_KEY`, `HYDRACEPT_PROJECT`, `HYDRACEPT_ENVIRONMENT`, `HYDRACEPT_API_URL` per their docs | Hydracept loses on env surface |
| **Production readiness** | ✅ Live | ⚠️ No mask-capable model in catalog; ready for *generation*, not for inpaint | Hydracept loses on this use case |

The broker-shape features Hydracept wins on (durable jobs, idempotency, receipts, BYOK, provider fallback, expiring-URL handling) are real and well-implemented — they would be useful for the rest of the inpaint surface, and they map cleanly to the fal-pain-points the founder named (5-minute polls, expiring URLs, retries resubmitting paid jobs). But none of them substitute for the missing model: there is no model under any Hydracept provider in their public catalog that takes a binary mask and respects its boundaries. The broker cannot synthesize that capability.

---

## Pricing & bet math

### Hydracept pricing (per public billing docs)

- **BYOK**: 0% Hydracept inference markup. Provider-spend guardrails are a separate, optional safety budget — not an additional Hydracept charge. Eligible durable text jobs get 50% off via deferred processing (text only, not images).
- **Managed**: provider basis + 6% Hydracept service fee. New free accounts get a one-time **US$0.50** managed trial allowance (not $25 — see below).
- **Plans**: Free ($0, 2 concurrent durable jobs, 10 active, 1,000 lightweight inferences/hour, 30-day history), Builder ($19/mo, 10/40, 4,000/hr, 90-day history), Team ($149/mo, 30/150, 25,000/hr, 180-day history), Enterprise (sales-only).
- **Wallet**: prepaid, top-up via Studio or `POST /v1/billing/wallet/top-up-session`.

### Quoted beta against public docs

The issue body quotes a "$25 beta credit" offer. The public docs (and the well-known manifest at `hydracept.com/.well-known/hydracept.json`) describe a $0.50 managed trial allowance for new free accounts. This is not a fatal contradiction — it's plausible that a direct beta outreach from the founder includes an additional one-off credit beyond the standard free-plan allowance — but it is worth flagging that the quoted number does not match the public offer. Any future spike that runs real inference should ask for the credit confirmation in writing rather than assuming $25 of room.

### Cost comparison (inpaint surface only)

Not a deciding factor. DashScope `qwen-image-2.1-pro` is ~$0.04/image at the current default; `DAILY_INPAINT_LIMIT` defaults to 20 per user per day. Hydracept's managed fee would add 6% on top of whatever the underlying provider charges — for a hypothetical BYOK Fal FLUX.1 Fill call that would be ~$0.0371/image, with Hydracept adding ~$0.0022/image, totalling ~$0.0393/image. For DashScope on managed that would be ~$0.0424/image. Negligible.

### Bet math

- **Upfront**: integration cost (adapter file, env vars, capability key wiring, route handler surface). Probably 300–500 LOC and ~1–2 days, given the InferenceClient surface already abstracts provider lifecycle — mostly translates to a new capability key mapping and a `createHydraceptClient()`.
- **Ongoing**: provider-broker surface (durable jobs, receipts, idempotency, BYOK) is genuinely useful across many surfaces (image, video, 3D, audio), so a single integration has a payoff larger than inpaint alone. The dollar amounts are small.
- **Downside**: zero — this is a parallel-style addition to the existing single-track provider. No existing inpaint path is broken by adding Hydracept.

The bet would be worth making *if* Hydracept had a mask-capable model. It doesn't.

---

## Recommendation

**Close as wont-do for the inpaint surface.** Hydracept's public catalog does not offer a mask-guided inpainting capability that would replace the live `qwen-image-2.1-pro` (DashScope) surface. The broker features Hydracept does well — durable jobs, idempotency, BYOK, receipts, expiring-URL handling — would not compensate for the missing binary-mask model; that is exactly the conclusion Spike 235 reached when it disqualified GPT Image 2.5 and Nano Banana for the same reason.

**No follow-up issue.** The expected follow-up framing in the issue (file a deeper integration evaluation if a match exists) does not apply because there is no match.

**Optional future consideration** (not recommending now): if Hydracept later adds an explicit mask-guided inpainting capability in their public catalog (e.g. `image.edit.v1` with a `mask_url` field exposing FLUX.1 Fill or SDXL-Inpaint on the underlying provider), revisit this spike. Until then, the inpaint surface stays on DashScope `qwen-image-2.1-pro`.

**Disregard for now, with mild interest for non-inpaint surfaces**: Hydracept's execution-control-plane shape (durable jobs, idempotent retries, receipts, BYOK, MCP) is genuinely well-designed for an "agent that calls many capabilities" workflow, and a future spike covering non-inpaint surfaces (3D, video, sprite-sheet production) might be worth a look — but that's a different question from the one #1070 asked.

---

## Sources

- Hydracept home: <https://hydracept.com>
- Hydracept docs: <https://docs.hydracept.com/>
- Hydracept capabilities: <https://docs.hydracept.com/capabilities/>
- Hydracept image production: <https://docs.hydracept.com/image-production/>
- Hydracept billing: <https://docs.hydracept.com/billing/>
- Hydracept OpenAPI: <https://hydracept.com/openapi/hydracept-v1.json>
- Hydracept product manifest: <https://hydracept.com/.well-known/hydracept.json>
- Hydracept public repo: <https://github.com/zencodeinc/hydracept-public>
- Hydracept agent-plugins repo: <https://github.com/zencodeinc/hydracept-agent-plugins>
- PyPI: <https://pypi.org/project/hydracept>
- Issue [#1070]: <https://github.com/anchapin/staging-studio/issues/1070>
- Predecessor spike [Spike 235](./235-vendor-investigation.md) — second-generation vendor investigation; GPT Image 2.5 and Nano Banana disqualified for the same reason (no precise binary-mask inpaint).
- `src/lib/inference.ts` — provider-agnostic inference abstraction; `alibaba` is the only wired provider as of #1240.
- `src/lib/alibaba-adapter.ts` — DashScope `qwen-image-2.1-pro` adapter; synchronous POST to `/api/v1/services/aigc/multimodal-generation/generation`; 24h URL window with Supabase Storage persistence.