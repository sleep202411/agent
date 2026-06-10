# Seedance 2.0 — parameter spec (fal-verified)

ByteDance **Seedance 2.0** video generation. Verified against the fal API
(2026-06): https://fal.ai/models/bytedance/seedance-2.0/reference-to-video/api

Unified multimodal audio-video model with **native synced audio**. On fal it is
split into 3 endpoints (+ `fast` variants):

| Our generation mode              | fal endpoint                                | Extra inputs                                |
| -------------------------------- | ------------------------------------------- | ------------------------------------------- |
| `text_to_video`                  | `bytedance/seedance-2.0/text-to-video`      | — (common params only)                      |
| `image_to_video`                 | `bytedance/seedance-2.0/image-to-video`     | start frame (`image_url`)                   |
| `first_last_frame_to_video`      | `bytedance/seedance-2.0/image-to-video`     | start (`image_url`) + end (`end_image_url`) |
| `multimodal_to_video` (全能参考) | `bytedance/seedance-2.0/reference-to-video` | image/video/audio reference arrays          |

`seedance-2-0-fast` is the same shape under `bytedance/seedance-2.0/fast/*`.

---

## Common parameters (all modes)

| Param          | Type    | Allowed values                                      | Default | fal field        |
| -------------- | ------- | --------------------------------------------------- | ------- | ---------------- |
| Prompt         | string  | — (**required**)                                    | —       | `prompt`         |
| Resolution     | enum    | `480p` / `720p` / `1080p`                           | `720p`  | `resolution`     |
| Duration       | enum    | `auto`, `4`–`15` (integer seconds)                  | `auto`  | `duration`       |
| Aspect ratio   | enum    | `auto`, `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16` | `auto`  | `aspect_ratio`   |
| Generate audio | boolean | native synced audio                                 | `true`  | `generate_audio` |
| Seed           | integer | ≥ 0                                                 | —       | `seed`           |

---

## Mode-specific inputs

### text_to_video

Common params only.

### image_to_video / first_last_frame_to_video (one fal endpoint, two uses)

- **Start frame** → `image_url` (single image)
- **End frame** (optional) → `end_image_url` — providing it makes it first-last-frame.

### multimodal_to_video — 全能参考 (reference-to-video endpoint)

Prompt + up to **12 reference files total** spanning images / videos / audio.
Reference assets are cited **inside the prompt** via `@Image1` / `@Video1` / `@Audio1`.

| Reference | Max                             | Formats       | Per-file size | Combined limit                  | Resolution                         | Prompt ref | fal field    |
| --------- | ------------------------------- | ------------- | ------------- | ------------------------------- | ---------------------------------- | ---------- | ------------ |
| Images    | 9                               | JPEG/PNG/WebP | ≤ 30 MB       | —                               | no constraint                      | `@Image1`  | `image_urls` |
| Videos    | 3                               | MP4/MOV       | —             | total < 50 MB, **2–15 s** total | ~480p (640×640) – ~720p (834×1112) | `@Video1`  | `video_urls` |
| Audio     | 3                               | MP3/WAV       | ≤ 15 MB       | ≤ 15 s total                    | —                                  | `@Audio1`  | `audio_urls` |
| **Total** | **≤ 12 across all three types** |               |               |                                 |                                    |            |

**Constraints / validation (enforce client-side on upload):**

- File **format** (accept + `file.type`), **size** (`file.size`), per-type **count**.
- **Video/audio duration** — read `<video>/<audio>.duration` (combined: video 2–15 s, audio ≤ 15 s).
- **Video resolution** — read `videoWidth/videoHeight` (~480p–720p band).
- **Audio requires ≥ 1 image or video reference** (cannot be sent alone).
- **Total ≤ 12** across all types (caps even when a single type isn't maxed; 9+3+3=15 > 12).

---

## Pricing (per second, by resolution)

fal bills `video_seconds`; our pricing matches with **`per_second_matrix`**
(v2, 2026-06-11). Points/second = ceil(fal USD/s × 2.0 margin × 100)
(积分 ≡ US cent):

| Variant             | 480p | 720p | fal 720p basis |
| ------------------- | ---- | ---- | -------------- |
| `seedance-2-0`      | 37/s | 61/s | $0.3034/s      |
| `seedance-2-0-fast` | 30/s | 49/s | $0.2419/s      |

- Duration clamps to **4–15 s** (`minSeconds`/`maxSeconds`).
- **`auto` quotes at the 15 s ceiling** (`autoQuoteSeconds`) — quotes never
  undercharge; the catalog **default duration is `5`** (not `auto`) so the
  default quote isn't the maximum.
- Examples (standard / fast): 720p 5 s = 305 / 245, 10 s = 610 / 490,
  15 s & `auto` = 915 / 735; 480p 5 s = 185 / 150.
- **1080p stays ABSENT** (fal $0.682/s) until its pricing is approved.

---

## Implementation status (2026-06-11)

Implemented end to end (policy → `fal-schema.mapper` → web):

- **duration** string enum `auto` + `4–15` (default `5`); **aspect_ratio** 7-value
  enum incl. `auto/21:9/4:3/3:4`; **generate_audio** switch.
- **reference inputs** — `referenceImages`/`referenceVideos`/`referenceAudios`
  arrays (→ `image_urls`/`video_urls`/`audio_urls`) emitted for
  `multimodal_to_video`, with the constraint metadata above carried on `x-ui`
  and enforced client-side (formats/sizes/durations/resolution band/total cap/
  audio-needs-visual).
- **prompt referencing** — uploads auto-assign `@Image1/@Video1/@Audio1` labels
  wired into the composer's @-mention system.
- **per-mode dispatch** — each binding's `supported_modes` builds the runtime
  `modeEndpoints` map; submits route to the mode's endpoint.

Deliberately deferred:

- **1080p** stays absent until its pricing is approved (see Pricing above).
