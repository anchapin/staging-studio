## Bake-off results (issue #1240)

Run date: 2026-10-12  
Incumbent: FLUX.1 [pro] Fill via fal  
Total cells: 27 (9 slots x 3 cases)

## Summary table

| Slot | Vendor | Mode | vacant-insert | occupied-replace | repeat-stability | Price | Unit |
|---|---|---|---|---|---|---|---|
| flux-pro-fill | fal | mask-fill | 16.7s (1440x928) | 20.6s (1440x928) | 22.7s (1440x928) | $0.05 | megapixels |
| flux-3-image | fal | text-to-image | 30.9s (880x1184) | 24.7s (880x1184) | 24.7s (880x1184) | $0.024 | megapixels |
| seedream-5-flash | fal | instruction | 145.1s | 22.6s | 20.6s | $0.027 | images |
| nano-banana-2-1 | fal | instruction | 18.6s | 18.5s | 14.6s | $1 | units |
| qwen-image-2-1 | alibaba | instruction | 38.0s (2048x1536) | 32.1s (2048x1536) | 33.7s (2048x1536) | $0.04 | images |
| flux-pro-kontext | fal | instruction | 6.3s (1248x832) | 12.4s (1248x832) | 6.3s (1248x832) | $0.04 | images |
| z-image-turbo-inpaint | fal | mask-fill | 8.4s (2000x1328) | 8.4s (2000x1328) | 8.4s (2000x1328) | $0.01 | megapixels |
| flux-kontext-lora-inpaint | fal | mask-fill | 18.6s (1248x832) | 16.5s (1248x832) | 16.5s (1248x832) | $0.035 | megapixels |
| gpt-image-2-5 | openai | mask-fill | 31.3s | 29.2s | 30.0s | 2887 tok | - |

## Per-slot notes

- **flux-pro-fill** (fal, mask-fill) -- Incumbent; mask-based inpainting at $0.05/MP.
  - vacant-insert: [output](https://v3b.fal.media/files/b/0aae2126/yS6_-CwpuLP_sfCIQS-c0_7d49daca31db43acafae1f5a43f6928c.jpg)
  - occupied-replace: [output](https://v3b.fal.media/files/b/0aae2128/aQO00vBii0aEpCBTiSKMi_d6aab1aa507f48b8884f29b9c155f15a.jpg)
  - repeat-stability: [output](https://v3b.fal.media/files/b/0aae212b/hH3eiMvRNr3STXBe8nrN7_34a61b0222fb4af4adefd7a4045ede0d.jpg)
- **flux-3-image** (fal, text-to-image) -- FLUX 3 Image is text-to-image only on fal (no /edit endpoint exposed). Result is not strictly edit-comparable; included for completeness against the issue spec.
  - vacant-insert: [output](https://v3b.fal.media/files/b/0aae212e/mCJKb9XpDgeHdbLPQ4cU5_I9YUADNQ.jpg)
  - occupied-replace: [output](https://v3b.fal.media/files/b/0aae2130/6SwZJjteyhI3dtbMDWg1l_fCCXX8Un.jpg)
  - repeat-stability: [output](https://v3b.fal.media/files/b/0aae2133/3o0KL29UPrRxCeY-NokHh_AZHp6Sqj.jpg)
- **seedream-5-flash** (fal, instruction) -- Seedream 5.0 Flash; instruction editing, expects image_urls: string[]. $0.027/image.
  - vacant-insert: [output](https://v3b.fal.media/files/b/0aae2141/hPc4HhEosnAVyik7rcR_X_30083c0f8c534f6ebd767ea8b5a5a30e.jpg)
  - occupied-replace: [output](https://v3b.fal.media/files/b/0aae2143/IbDpCXRq6IEQP8mwTHCPU_c88ee970ac3641ac9b697eb5f37625d3.jpg)
  - repeat-stability: [output](https://v3b.fal.media/files/b/0aae2145/CvpTtOi0f9B_5pDhQwBeD_a452020346cd4ee6bd70094bcfb03371.jpg)
- **nano-banana-2-1** (fal, instruction) -- Gemini Nano Banana 2.1; instruction editing released 2026-10-06. Expects image_urls: string[].
  - vacant-insert: [output](https://v3b.fal.media/files/b/0aae2146/kNTmBC1EvD-A1ECQCzqMC_lBsTPZ1J.png)
  - occupied-replace: [output](https://v3b.fal.media/files/b/0aae2148/Stm5wWuNo-MXVRABDXL1T_Q0bBg1b8.png)
  - repeat-stability: [output](https://v3b.fal.media/files/b/0aae2149/1778INeaF4n_0f9D9RJC8_AieXeulp.png)
- **qwen-image-2-1** (alibaba, instruction) -- Qwen-Image-2.1 Pro routed via Alibaba Cloud Model Studio Singapore endpoint. Commercial terms bundled with Alibaba Cloud account ($0.04/image per Alibaba pricing). Replaces the fal-hosted slot which was flagged Private/research-only. Uses DashScope multimodal-conversation endpoint with image+text content; instruction-mode only (no mask on the wire).
  - vacant-insert: [output](bake-off/outputs/qwen-image-2-1__vacant-insert__37931ms.png)
  - occupied-replace: [output](bake-off/outputs/qwen-image-2-1__occupied-replace__32096ms.png)
  - repeat-stability: [output](bake-off/outputs/qwen-image-2-1__repeat-stability__33718ms.png)
- **flux-pro-kontext** (fal, instruction) -- FLUX.1 Kontext [pro]. Same vendor as incumbent. Instruction editing with no mask support (image_url only). $0.04/image flat. Strongest same-vendor incumbent-replacement candidate.
  - vacant-insert: [output](https://v3b.fal.media/files/b/0aae2150/guKluiSuIRNeDQ0GpTSKy_841ee0eae773470f8734bad9dfaa9de1.jpg)
  - occupied-replace: [output](https://v3b.fal.media/files/b/0aae2151/1egZXZKy3e8WUHb-sU-rR_a76552c76fa14e638b18398004dd42e8.jpg)
  - repeat-stability: [output](https://v3b.fal.media/files/b/0aae2152/5PKimUl6oacK9s4l9nP4R_5c69c21c19c24206bdefbafb4c506a74.jpg)
- **z-image-turbo-inpaint** (fal, mask-fill) -- Z-Image Turbo (Alibaba Tongyi-MAI, 6B). Mask-capable via mask_image_url. Newest release in the bake-off. $0.01/MP — 5x cheaper than incumbent. Real mask-vs-mask head-to-head against FLUX Pro Fill.
  - vacant-insert: [output](https://v3b.fal.media/files/b/0aae2152/bjgdqwrq31C4wStuyS1Yt_Qu82jSSH.png)
  - occupied-replace: [output](https://v3b.fal.media/files/b/0aae2153/0aZYNpR3xdKXKH7Dw-uN__kS5pxs9Y.png)
  - repeat-stability: [output](https://v3b.fal.media/files/b/0aae2154/R45GzXJaA1h4K_NfLMGDa_k2nldrnv.png)
- **flux-kontext-lora-inpaint** (fal, mask-fill) -- FLUX.1 Kontext [dev] LoRA inpainting. Mask-capable, requires reference_image_url. $imageUrl placeholder resolved to caseInput.imageUrl so the model sees the source as the reference (not a stock horse photo).
  - vacant-insert: [output](https://v3b.fal.media/files/b/0aae2154/-Sci4zQ_4K_esOb0VBCyF.png)
  - occupied-replace: [output](https://v3b.fal.media/files/b/0aae2157/E1yusbIQ9ir06qS6A6ijJ.png)
  - repeat-stability: [output](https://v3b.fal.media/files/b/0aae2158/SXWoVLiP8i2DApyDk9Zl2.png)
- **gpt-image-2-5** (openai, mask-fill) -- OpenAI GPT-Image-2.5 Sunburst class. Multipart edits endpoint with mask. New OpenAI vendor (uses OPENAI_API_KEY, not FAL_KEY). The model issue #1240 specifically called out as 'leads LM Arena'.
  - vacant-insert: [output](bake-off/outputs/gpt-image-2-5__vacant-insert__31313ms.png)
  - occupied-replace: [output](bake-off/outputs/gpt-image-2-5__occupied-replace__29195ms.png)
  - repeat-stability: [output](bake-off/outputs/gpt-image-2-5__repeat-stability__29972ms.png)

## Notes

- **Mask convention**: fal = white = edit, black = preserve. OpenAI = alpha=0 transparent = edit. Corrected in scripts/bake-off-prep-masks.mts and scripts/bake-off-mask-invert.mts.
- **Prompt alignment**: prompts target the center rectangle (which is the mask edit region). Earlier occupied-replace and repeat-stability prompts mentioned "add to corner" -- corrected to stay inside the mask.
- **Qwen-Image-2.1 routing**: routed through Alibaba Cloud Model Studio (Singapore endpoint, workspace llm-x83c15vnd001kxij, model qwen-image-2.1-pro, $0.04/image). The fal-hosted slot was flagged Private; commercial terms are bundled with the Alibaba Cloud account.
- **nano-banana-2-1** ran cleanly across all 3 cases after prompt fix (no more content-policy rejection).
