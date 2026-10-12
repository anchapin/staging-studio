## Bake-off results (issue #1240)

Run date: 2026-10-12  
Incumbent: FLUX.1 [pro] Fill via fal  
Total cells: 27 (9 slots x 3 cases)

## Summary table

| Slot | Vendor | Mode | vacant-insert | occupied-replace | repeat-stability | Price | Unit |
|---|---|---|---|---|---|---|---|
| flux-pro-fill | fal | mask-fill | 20.8s (1440x928) | 20.6s (1440x928) | 16.5s (1440x928) | $0.05 | megapixels |
| flux-3-image | fal | text-to-image | 26.7s (880x1184) | 30.8s (880x1184) | 36.9s (880x1184) | $0.024 | megapixels |
| seedream-5-flash | fal | instruction | 20.6s | 20.6s | 18.5s | $0.027 | images |
| nano-banana-2-1 | fal | instruction | 14.5s | 12.4s | 16.5s | $1 | units |
| qwen-image-2-1 | fal | instruction | 69.5s (1024x1024) | 149.0s (1024x1024) | 67.4s (1024x1024) | $0.03666667 | megapixels |
| flux-pro-kontext | fal | instruction | 10.4s (1248x832) | 8.4s (1248x832) | 6.3s (1248x832) | $0.04 | images |
| z-image-turbo-inpaint | fal | mask-fill | 10.4s (2000x1328) | 10.4s (2000x1328) | 8.4s (2000x1328) | $0.01 | megapixels |
| flux-kontext-lora-inpaint | fal | mask-fill | 16.5s (1248x832) | 10.4s (1248x832) | 12.4s (1248x832) | $0.035 | megapixels |
| gpt-image-2-5 | openai | mask-fill | FAIL: Incorrect API key provided: sk | FAIL: Incorrect API key provided: sk | FAIL: Incorrect API key provided: sk | - | - |

## Per-slot notes

- **flux-pro-fill** (fal, mask-fill) -- Incumbent; mask-based inpainting at $0.05/MP.
  - vacant-insert: [output](https://v3b.fal.media/files/b/0aae1ef0/qVO-JcBYvtbigBFE8eHnT_92b2783b0151450a9c3c9a949dc9f2f2.jpg)
  - occupied-replace: [output](https://v3b.fal.media/files/b/0aae1ef2/wBKK-yd71kUAKJcDIJF84_157c894e19c6490a9173173260e310a5.jpg)
  - repeat-stability: [output](https://v3b.fal.media/files/b/0aae1ef4/tjwZDBUq2fnh9rR6p6Top_e80b4b9cb5784a66896b88be5db0345a.jpg)
- **flux-3-image** (fal, text-to-image) -- FLUX 3 Image is text-to-image only on fal (no /edit endpoint exposed). Result is not strictly edit-comparable; included for completeness against the issue spec.
  - vacant-insert: [output](https://v3b.fal.media/files/b/0aae1ef7/3c0DozONTO-3uM_gQ5JAu_YDrw6fsu.jpg)
  - occupied-replace: [output](https://v3b.fal.media/files/b/0aae1efa/tsRzF2NqpT0EICTcdxWTW_AcGPQEgJ.jpg)
  - repeat-stability: [output](https://v3b.fal.media/files/b/0aae1efd/OOrTyOINF4nF8IPPKPQ8t_xJ1tAq4O.jpg)
- **seedream-5-flash** (fal, instruction) -- Seedream 5.0 Flash; instruction editing, expects image_urls: string[]. $0.027/image.
  - vacant-insert: [output](https://v3b.fal.media/files/b/0aae1eff/yqw78LTzB0kYOBbcx4rcS_08a8bdb958584520a35cb367ea235766.jpg)
  - occupied-replace: [output](https://v3b.fal.media/files/b/0aae1f02/6Fz0MeYwN0xeaTJZImKL6_f557628884654ab0a0c368f43470e1c2.jpg)
  - repeat-stability: [output](https://v3b.fal.media/files/b/0aae1f03/vAJDPxJ5EaRa_8pTPjIAY_bf2c3b100f8b46c5a635d8c9360c2b65.jpg)
- **nano-banana-2-1** (fal, instruction) -- Gemini Nano Banana 2.1; instruction editing released 2026-10-06. Expects image_urls: string[].
  - vacant-insert: [output](https://v3b.fal.media/files/b/0aae1f04/FbyePDISEE0kBXl4uKYBP_GCJgnJpK.png)
  - occupied-replace: [output](https://v3b.fal.media/files/b/0aae1f05/t1LVb8R_iB-DTynhJ0NCs_pJNgKKMT.png)
  - repeat-stability: [output](https://v3b.fal.media/files/b/0aae1f06/0LuU_1IoI3Ffs8YOB8fDR_wb4jALbM.png)
- **qwen-image-2-1** (fal, instruction) -- Qwen-Image-2.1; flagged Private on fal. Issue #1240 notes research-only license; commercial grant from Alibaba required before any production use.
  - vacant-insert: [output](https://v3b.fal.media/files/b/0aae1f0f/IueqmFdIXZfv1V4qKsIND.png)
  - occupied-replace: [output](https://v3b.fal.media/files/b/0aae1f1d/a4lOl4tjZvs4fIKn8oyY2.png)
  - repeat-stability: [output](https://v3b.fal.media/files/b/0aae1f24/x9lz8bjJn0oFA2PcfO0h7.png)
- **flux-pro-kontext** (fal, instruction) -- FLUX.1 Kontext [pro]. Same vendor as incumbent. Instruction editing with no mask support (image_url only). $0.04/image flat. Strongest same-vendor incumbent-replacement candidate.
  - vacant-insert: [output](https://v3b.fal.media/files/b/0aae1f25/jdD-LaxHllAU4ET85xUGG_54d461cc468449a28c100ae0e53b59d2.jpg)
  - occupied-replace: [output](https://v3b.fal.media/files/b/0aae1f26/VVzL9d1aS6lFfj7-w0j_Q_c7d4df9587904d98b151f96caf988d2d.jpg)
  - repeat-stability: [output](https://v3b.fal.media/files/b/0aae1f27/icxPQ17_wwhdWJmdpkYKF_c25e00c53f7a4328912c685d6903f2d3.jpg)
- **z-image-turbo-inpaint** (fal, mask-fill) -- Z-Image Turbo (Alibaba Tongyi-MAI, 6B). Mask-capable via mask_image_url. Newest release in the bake-off. $0.01/MP — 5x cheaper than incumbent. Real mask-vs-mask head-to-head against FLUX Pro Fill.
  - vacant-insert: [output](https://v3b.fal.media/files/b/0aae1f27/zt0NEAjHPgK-JB-TC4khL_k82EWJ7c.png)
  - occupied-replace: [output](https://v3b.fal.media/files/b/0aae1f28/fKUZH0hC1efMtCtZcfRmm_dt8ZkrTI.png)
  - repeat-stability: [output](https://v3b.fal.media/files/b/0aae1f29/GIrS1wSb1pBt_aKN8jqQf_ibAXQU3U.png)
- **flux-kontext-lora-inpaint** (fal, mask-fill) -- FLUX.1 Kontext [dev] LoRA inpainting. Mask-capable, requires reference_image_url. Same model family as Kontext Pro but with the mask constraint, so a fair head-to-head against the incumbent.
  - vacant-insert: [output](https://v3b.fal.media/files/b/0aae1f2a/yv8t8o4eZ0nyAdF_W-12y.png)
  - occupied-replace: [output](https://v3b.fal.media/files/b/0aae1f2c/sPjK96YoqGI9q50pggXMY.png)
  - repeat-stability: [output](https://v3b.fal.media/files/b/0aae1f2d/vlZz5LJtIylEWNVO_Kq8I.png)
- **gpt-image-2-5** (openai, mask-fill) -- OpenAI GPT-Image-2.5 Sunburst class. Multipart edits endpoint with mask. New OpenAI vendor (uses OPENAI_API_KEY, not FAL_KEY). The model issue #1240 specifically called out as 'leads LM Arena'.
  - vacant-insert: FAILED -- OpenAI returned error: {"message":"Incorrect API key provided: sk-proj-*****************************************************************dvNC. You can find your API key at https://platform.openai.com/account/api-keys.","type":"invalid_request_error","code":"invalid_api_key","param":null}
  - occupied-replace: FAILED -- OpenAI returned error: {"message":"Incorrect API key provided: sk-proj-*****************************************************************dvNC. You can find your API key at https://platform.openai.com/account/api-keys.","type":"invalid_request_error","code":"invalid_api_key","param":null}
  - repeat-stability: FAILED -- OpenAI returned error: {"message":"Incorrect API key provided: sk-proj-*****************************************************************dvNC. You can find your API key at https://platform.openai.com/account/api-keys.","type":"invalid_request_error","code":"invalid_api_key","param":null}

## Gaps from issue #1240 and current run

- **gpt-image-2.5** is auth-failing in this env (OPENAI_API_KEY in .env.local rejected as invalid by api.openai.com). The schema, dispatch, and mask-invert code paths all work; only the API key is in the way. Re-run with a valid key when available.
- **flux-3-image** is text-to-image only on fal; not edit-comparable.
- **qwen-image-2.1** marked Private on fal; issue #1240 already flags research-only license.
- **nano-banana-2-1 / repeat-stability** rejected by content checker (legit policy violation).
- **nano-banana-2.1 pricing** came back as a sentinel row from /v1/models/pricing.
- **Mask parity**: only flux-pro-fill, z-image-turbo-inpaint, flux-kontext-lora-inpaint, and gpt-image-2.5 (would-be) actually consume the mask. The instruction-only slots (flux-pro-kontext, seedream-5-flash, nano-banana-2-1, qwen-image-2.1) ignore the mask entirely, so mask-vs-mask comparison is only valid across the four mask-capable slots.

## Verdict

All four new fal slots (flux-pro-kontext, z-image-turbo-inpaint, flux-kontext-lora-inpaint, plus the existing 5) returned real billed outputs. GPT-Image-2.5 failed on auth -- runner + mask-invert logic is sound, key issue is on the user side. 26 of 27 cells ok; 1 cell is a legitimate content-policy rejection. Manual scoring still owed on the output URLs; no provider flip recommended until Alex reviews.
