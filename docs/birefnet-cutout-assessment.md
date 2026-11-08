# Assessment: local BiRefNet cutouts for the swatch/asset library (issue #1459)

Desk assessment. BiRefNet was not run on room photos; quality claims below are unverified until the small test at the end is done.

## Verdict

**Stay with the current provider-backed flow for segmentation. Do not adopt BiRefNet as a SAM replacement. Revisit it only for a future product-photo cutout feature (hybrid).** Reasons below.

## Facts

| Item | Finding | Source |
| --- | --- | --- |
| BiRefNet license | MIT | https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE |
| Runtime options | PyTorch, or ONNX / transformers.js builds (`onnx-community/BiRefNet-ONNX`, MIT) | https://huggingface.co/onnx-community/BiRefNet-ONNX |
| What it is | Dichotomous / salient-object segmentation, i.e. background removal of the main foreground object | same model cards (tags: background-removal, salient object detection) |
| fal SAM 3 price | $0.005 per request for `fal-ai/sam-3/image` (the repo calls `fal-ai/sam-3-1/image`; its price was not verified) | https://fal.ai/models/fal-ai/sam-3/image |
| Qwen-Image inpaint cost | about $0.04 per image (figure quoted in `src/app/api/inpaint/route.ts` comments) | repo |
| Segment path today | `src/lib/furnishing-detection.ts`: one text prompt ("furniture") returns one mask per detected object | repo |
| Swatch/procurement imagery | `MaterialSwatch` and `ProcurementItem` in `prisma/schema.prisma` have no image/url fields today, so no asset library exists to feed | repo |

## Analysis

1. **Task mismatch.** SAM 3.1 returns one mask per piece of furniture in a room. BiRefNet separates one salient foreground from its background. A cluttered room photo has no single foreground, so it cannot replace per-object segmentation. It suits isolated product photos (a sofa on a white or lifestyle backdrop).
2. **Cost.** SAM at about $0.005 per call is small next to the roughly $0.04 per inpaint. At the app's cap of `DAILY_SEGMENT_LIMIT=100` per user per day, worst-case SAM spend is about $0.50 per user per day, and normal use is far lower. A GPU host (6-8 GB VRAM class) would cost more than that until volume is very high. Local inference only saves money if free hardware already exists.
3. **Offloading inpaint cost is not possible.** BiRefNet does not do inpainting, so it does not touch the $0.04 per image line.
4. **Where it could fit.** If a procurement or swatch feature later adds product images, background removal there is a natural hybrid use: run once per product image, cache the PNG, no per-view cost.

## Recommendation

- Close #1459 as "stay with current flow" for segmentation.
- File a feature issue only if swatch/procurement imagery is added; evaluate BiRefNet ONNX (transformers.js, in-browser or on the server) at that point.

## Optional validation if someone wants evidence before closing

Run `onnx-community/BiRefNet-ONNX` on 10 room photos from `bake-off/befores/` plus product shots. Expect clean cutouts on isolated products and poor results on room scenes. Record in this file.
