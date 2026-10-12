## Bake-off results (issue #1240)

Run date: 2026-10-12  
Incumbent: FLUX.1 [pro] Fill via fal  
Total cells: 15 (5 slots x 3 cases)

## Summary table

| Slot | Mode | vacant-insert | occupied-replace | repeat-stability | Unit price | Billing unit |
|---|---|---|---|---|---|---|
| flux-pro-fill | mask-fill | 18.8s (1440x928) | 20.6s (1440x928) | 18.6s (1440x928) | $0.05 | megapixels |
| flux-3-image | text-to-image | 32.8s (880x1184) | 22.7s (880x1184) | 26.7s (880x1184) | $0.024 | megapixels |
| seedream-5-flash | instruction | 18.6s | 18.6s | 18.6s | $0.027 | images |
| nano-banana-2-1 | instruction | 12.4s | 12.4s | FAILED: provider returned validation error: [{"loc":["body","prompt" | $1 | units |
| qwen-image-2-1 | instruction | 69.6s (1024x1024) | 67.5s (1024x1024) | 69.6s (1024x1024) | $0.03666667 | megapixels |

## Per-slot notes

- **flux-pro-fill** (mask-fill) -- Incumbent; mask-based inpainting at $0.05/MP.
  - vacant-insert: [output](https://v3b.fal.media/files/b/0aae1e67/4QxfDd3nyuMpCWbk66aRK_099de955889c432cb2af44763980a30e.jpg)
  - occupied-replace: [output](https://v3b.fal.media/files/b/0aae1e69/JfCCaai8SLv3mrijCRoNo_a1d78467c26f49c4b67fe82b38af5d73.jpg)
  - repeat-stability: [output](https://v3b.fal.media/files/b/0aae1e6b/WMz_PJVacDppgQnHcWERA_394b596d4ccf472e8a74a002a59f6c26.jpg)
- **flux-3-image** (text-to-image) -- FLUX 3 Image is text-to-image only on fal (no /edit endpoint exposed). Result is not strictly edit-comparable; included for completeness against the issue spec.
  - vacant-insert: [output](https://v3b.fal.media/files/b/0aae1e6e/QkUfKW4bVIQnAbSMLK7n6_MYEk6fU2.jpg)
  - occupied-replace: [output](https://v3b.fal.media/files/b/0aae1e70/tRl_d7pimCv8J8PuEaCFL_dM7CKa9E.jpg)
  - repeat-stability: [output](https://v3b.fal.media/files/b/0aae1e73/POt1EsZ9GiD6Brl52bBVV_wffbIGTC.jpg)
- **seedream-5-flash** (instruction) -- Seedream 5.0 Flash; instruction editing, expects image_urls: string[]. $0.027/image.
  - vacant-insert: [output](https://v3b.fal.media/files/b/0aae1e75/_ElT0jC8jRToCaa7MqCCP_86fddf41ccf14dc0b81e7d855195d437.jpg)
  - occupied-replace: [output](https://v3b.fal.media/files/b/0aae1e77/0hxVqqgaocccEm1kiBV1z_234857d6d34c46cd9841cfb9519dff4e.jpg)
  - repeat-stability: [output](https://v3b.fal.media/files/b/0aae1e79/yHvyvSHrP9rUaasFO9Eq4_66d38a7ef7854ef7a0d24c98457baee2.jpg)
- **nano-banana-2-1** (instruction) -- Gemini Nano Banana 2.1; instruction editing released 2026-10-06. Expects image_urls: string[].
  - vacant-insert: [output](https://v3b.fal.media/files/b/0aae1e79/HuujfQiM4dFKy4bWbTJuO_grBIAhlF.png)
  - occupied-replace: [output](https://v3b.fal.media/files/b/0aae1e7a/FywTreOYK1g10oc5yHAbf_NmHuzvw4.png)
  - repeat-stability: FAILED -- provider returned validation error: [{"loc":["body","prompt"],"msg":"The content could not be processed because it contained material flagged by a content checker.","type":"content_policy_violation","url":"https://docs.fal.ai/errors#content_policy_violation","input":{"prompt":"Add a potted fiddle-leaf fig tree in the corner near the window. Do not change anything else in the room.","num_images":1,"seed":null,"aspect_ratio":"auto","output_format":"png","safety_tolerance":"4","sync_mode":false,"image_urls":["https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?w=2000&q=80"],"system_prompt":"","resolution":"1K","video_url":null,"pdf_url":null,"limit_generations":true,"enable_web_search":false,"thinking_level":"medium"}}]
- **qwen-image-2-1** (instruction) -- Qwen-Image-2.1; flagged Private on fal. Issue #1240 notes research-only license; commercial grant from Alibaba required before any production use.
  - vacant-insert: [output](https://v3b.fal.media/files/b/0aae1e83/y89npnVAlI1-jLo1Qv7rG.png)
  - occupied-replace: [output](https://v3b.fal.media/files/b/0aae1e8a/5oLx6lFimC7JnicYXdNSs.png)
  - repeat-stability: [output](https://v3b.fal.media/files/b/0aae1e91/mRR1M3bZp9aDGgJNCclPb.png)

## Gaps from issue #1240

- **gpt-image-2.5** dropped: fal has no /edit queue application (page renders but submit says "Application not found").
- **flux-3-image** ran as text-to-image (no input image); not strictly edit-comparable. The /edit endpoint is not exposed on fal despite the issue spec describing FLUX 3 Image as instruction editing.
- **qwen-image-2.1** ran successfully but is marked Private on fal; issue #1240 already flags the research-only license.
- **nano-banana-2.1 / repeat-stability** rejected by content checker (prompt flagged for the fig tree). Other cases on this slot succeeded.
- **nano-banana-2.1 pricing** came back from /v1/models/pricing as a sentinel row; real per-image cost likely different.

## Verdict

The runner works end-to-end. Each row in bake-off/bake-off-results.json is a real, billed fal queue result (or a legitimate validation/content-policy failure). Manual scoring (edit fidelity outside the changed region, realism of inserted furniture, pixel diff between the two repeat-stability runs) is still owed on the output URLs above; no provider flip is recommended until Alex reviews.
