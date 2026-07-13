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

| Canonical           | ModelArk model id                   | Resolutions        |
| ------------------- | ----------------------------------- | ------------------ |
| `seedance-2-0`      | `ep-20260708234913-w8kjv`           | 480p/720p/1080p/4k |
| `seedance-2-0-fast` | `dreamina-seedance-2-0-fast-260128` | 480p/720p          |
| `seedance-2-0-mini` | `dreamina-seedance-2-0-mini-260615` | 480p/720p          |

`seedance-2-0` is a custom Standard endpoint (`seedance-2-0-standard-no-prefilter`)
backed by `dreamina-seedance-2-0-260128` with ModelArk Content Pre-filter disabled;
BytePlus baseline content safety still applies. The original model id remains a
provider alias for historical rows and rollback.

CN 方舟 twins exist as `doubao-seedance-2-0*` (for a future .cn cell).

## Common parameters (top-level JSON fields)

| Param          | Type    | Allowed values                                                                         | Default      | ModelArk field   |
| -------------- | ------- | -------------------------------------------------------------------------------------- | ------------ | ---------------- |
| Prompt         | string  | — (**required**, text content part)                                                    | —            | `content[].text` |
| Resolution     | enum    | `480p` / `720p` / `1080p` / `4k` (flagship; fast/mini cap at `720p`)                   | `720p`       | `resolution`     |
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

`per_second_matrix`, points ≡ US cents (flagship v5 2026-07-12, fast v3,
mini v1):

| Variant             | 480p | 720p | 1080p | 4k    |
| ------------------- | ---- | ---- | ----- | ----- |
| `seedance-2-0`      | 12/s | 25/s | 45/s  | 180/s |
| `seedance-2-0-fast` | 10/s | 20/s | —     | —     |
| `seedance-2-0-mini` | 8/s  | 12/s | —     | —     |

Provider-cost basis (official token table, tokens/s = W×H×24/1024, flagship
$0.0070/K exclude-video): 720p 21,600 t/s → **$0.151/s**; 1080p 48,600 t/s →
**$0.34/s**; 4k 194,400 t/s → **$1.36/s** list, ~$0.82/s on resource packs
(with-video inputs bill 0.6×). Points follow the pixel ladder with a designed
cap-down at the top: 1080p 45 (raw ×1.65 would be ~56), 4k 180 = exactly
4× the 1080p point (~1.3× list margin, ~2.2× on packs). `auto` quotes at the
15s ceiling (`autoQuoteSeconds`) — 4k `auto` holds 2,700 points; default
duration stays `5`.

## 4k operational caveats (flagship only)

- Upstream lane limits: **15 RPM, concurrency 1** (non-4k: 600 RPM / 10),
  and the ModelArk account is SHARED with the .cn cell. Handled by a
  per-resolution capacity tier (`catalogSnapshot.capacityTiers` on the
  flagship endpoint → `selectProviderCapacity` stamps `tierKey` into the
  routing snapshot → the capacity runtime buckets the 4k lane separately at
  concurrency 1 / 15 RPM). Contending 4k jobs queue politely
  (`deferForProviderCapacity`, 30s re-check, no retry burn, no refund-fail);
  non-4k resolutions keep an ungated lane.
- Output is **10-bit H.265/HEVC** (native dims 16:9 3840×2160 … 21:9
  4398×1886): Safari plays it; Chrome needs hardware HEVC decode; Firefox
  generally cannot. Studio surfaces show a download-to-view fallback on
  decode failure (`video-playback-fallback.tsx`); a server-side H.264
  preview rendition is the fast-follow.
- A 15s 4k clip is a ~300MB-class artifact. Video outputs stream provider →
  disk spool → staged/multipart upload (`spoolProviderUrlToFile` +
  `uploadFromFile`) with a 10-min transfer timeout and 2GB ceiling — never
  buffered whole in worker memory. Provider cost accounting is
  resolution-aware (pixel-ratio multiplier, `byteplus-provider.adapter.ts`).

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
