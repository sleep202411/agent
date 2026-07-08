# Seedance 2.0 — parameter spec (ModelArk-verified)

ByteDance **Seedance 2.0** video generation, served EXCLUSIVELY by the official
**BytePlus ModelArk** API since 2026-07-02 (fal retired: ~2× the official
per-second price, no private-asset/ACR plane, no watermark compliance field).
Verified against the official docs (2026-07): ModelArk 1520757 (API reference),
1330310 (model list), 2191775 (resource packs), 2291680 (tutorial).

Unified multimodal audio-video model with **native synced audio**. One model id
serves all four generation modes — `content[]` roles select the scenario:

| Our generation mode              | content[] shape                                                        |
| -------------------------------- | ---------------------------------------------------------------------- |
| `text_to_video`                  | text only                                                              |
| `image_to_video`                 | text + image role `first_frame`                                        |
| `first_last_frame_to_video`      | text + roles `first_frame` + `last_frame`                              |
| `multimodal_to_video` (全能参考) | text + `reference_image` / `reference_video` / `reference_audio` parts |

The three image scenarios are mutually exclusive (frame roles never mix with
reference parts). API: async `POST /api/v3/contents/generations/tasks` →
poll `GET /tasks/{id}`; task records kept 7 days, output URL valid 24h.

## Model ids (bindings)

| Canonical           | ModelArk model id                   | Resolutions                       |
| ------------------- | ----------------------------------- | --------------------------------- |
| `seedance-2-0`      | `ep-20260708234913-w8kjv`           | 480p/720p/1080p/4k                |
| `seedance-2-0-fast` | `dreamina-seedance-2-0-fast-260128` | 480p/720p                         |
| (unbound)           | `dreamina-seedance-2-0-mini-260615` | 480p/720p — candidate budget tier |

`seedance-2-0` is a custom Standard endpoint (`seedance-2-0-standard-no-prefilter`)
backed by `dreamina-seedance-2-0-260128` with ModelArk Content Pre-filter disabled;
BytePlus baseline content safety still applies. The original model id remains a
provider alias for historical rows and rollback.

CN 方舟 twins exist as `doubao-seedance-2-0*` (for a future .cn cell).

## Common parameters (top-level JSON fields)

| Param          | Type    | Allowed values                                                                         | Default      | ModelArk field   |
| -------------- | ------- | -------------------------------------------------------------------------------------- | ------------ | ---------------- |
| Prompt         | string  | — (**required**, text content part)                                                    | —            | `content[].text` |
| Resolution     | enum    | `480p` / `720p` (1080p/4k exist upstream, unpriced)                                    | `720p`       | `resolution`     |
| Duration       | enum    | `auto` (→ **-1**), `4`–`15` integer seconds                                            | `5`          | `duration`       |
| Aspect ratio   | enum    | `auto` (→ omit; upstream `adaptive`), `21:9`…`9:16`                                    | `auto`       | `ratio`          |
| Generate audio | boolean | native synced audio; **upstream default true** — an explicit opt-out must send `false` | `true`       | `generate_audio` |
| Watermark      | boolean | policy-driven: character-stamped refs FORCE true                                       | outputPolicy | `watermark`      |

**NOT supported by the 2.0 series** (1.x only — never emit): `seed`
(`SEEDANCE_2_0_PARAMETER_POLICY.seed.enabled=false`), `camera_fixed`, `frames`,
`draft`, `service_tier: flex`.

## Reference inputs (multimodal_to_video)

Referenced in the prompt as `Image N` / `Video N` / `Audio N` by same-type
position in `content[]` — never by asset id.

| Reference | Max | Formats                                     | Official limits                               | fal-era client cap kept                                  |
| --------- | --- | ------------------------------------------- | --------------------------------------------- | -------------------------------------------------------- |
| Images    | 9   | jpeg/png/webp (+bmp/tiff/gif/heic upstream) | ≤30MB each, AR (0.4,2.5), px (300,6000)       | —                                                        |
| Videos    | 3   | mp4/mov                                     | each 2–15s, total ≤15s, ≤200MB each, 24–60fps | 50MB combined (conservative; also the asset-library cap) |
| Audio     | 3   | mp3/wav                                     | each 2–15s, total ≤15s, ≤15MB each            | —                                                        |

- **Audio cannot be sent alone** — needs ≥1 image or video reference.
- Combined ≤12 across all types is OUR product cap (`maxTotalFiles`) — official
  docs cap per modality only.
- Entries may be **`asset://<externalAssetId>`** — ModelArk private-library
  assets (character likenesses / ACR) ride the ordinary `url` slot. Provider
  pin: real_person jobs route exclusively to byteplus-modelark.

## Pricing

User-facing points unchanged (`per_second_matrix`, points ≡ US cents):

| Variant             | 480p | 720p |
| ------------------- | ---- | ---- |
| `seedance-2-0`      | 37/s | 61/s |
| `seedance-2-0-fast` | 30/s | 49/s |

Provider-cost basis (v2 2026-07-02, official token table): 720p ≈ 21,600
tokens/s; flagship $0.0070/K → **$0.151/s**, fast $0.0056/K → **$0.121/s**
(with-video inputs bill 0.6×; resource packs ~40% cheaper — $4.30/1M flagship).
Margin at 720p is now ≈4× (was 2× on fal) — repricing is a product decision,
deliberately not made here. `auto` still quotes at the 15s ceiling
(`autoQuoteSeconds`); default duration stays `5`. **1080p/4k stay ABSENT**
until priced.

## Implementation status (2026-07-02)

- byteplus runtime schema exposes the full surface (start/end frame, all three
  reference arrays with x-ui constraint metadata, generateAudio switch,
  policy-gated seed) — field names identical to the retired fal schema, so the
  studio composer and persisted job inputs carry over unchanged.
- Mapper emits role-tagged content parts, maps `duration:'auto'` → `-1`,
  sends `generate_audio` only on explicit user choice, forwards `asset://`
  URLs verbatim, and resolves watermark per policy (design §5.4).
- fal bindings deleted from the seed; `bytedance/seedance-2.0*` ids remain as
  lookup aliases for pre-cutover job rows. Seed prune removes the stale DB
  rows on next `prisma db seed`.
- In-flight fal seedance jobs at deploy time lose poll/cancel (runtime lookup
  by endpointId misses) — they fail and a retry re-routes to byteplus with a
  fresh quote. Accepted: video jobs run minutes; drain window is trivial.
