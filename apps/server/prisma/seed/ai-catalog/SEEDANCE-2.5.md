# Seedance 2.5 — ModelArk integration contract

Verified against the official BytePlus integration guide, create/retrieve API
references and pricing page on 2026-08-10.

## Identity and transport

- Canonical model: `seedance-2-5`
- ModelArk model ID: `dreamina-seedance-2-5-260628`
- Create: `POST /api/v3/contents/generations/tasks`
- Retrieve: `GET /api/v3/contents/generations/tasks/{id}`
- Cancel: `DELETE /api/v3/contents/generations/tasks/{id}`
- Account capacity: 600 RPM / 10 concurrent requests (enterprise)

Official references:

- [Integration guide](https://docs.byteplus.com/en/docs/ModelArk/2607688)
- [Create task](https://docs.byteplus.com/en/docs/ModelArk/1520757)
- [Retrieve task](https://docs.byteplus.com/en/docs/ModelArk/1521309)
- [Pricing](https://docs.byteplus.com/en/docs/ModelArk/1544106)

## Product modes

The canonical four modes remain text-to-video, first-frame image-to-video,
first/last-frame image-to-video and multimodal reference-to-video. Editing and
extension are prompt-intent subtypes of multimodal reference rather than
separate API roles.

References use ModelArk `content[]` roles:

- image: `reference_image` (0–30)
- video: `reference_video` (0–10)
- audio: `reference_audio` (0–10; audio-only input is supported)
- frame inputs: `first_frame` / `last_frame`

Video and audio files are individually 2–30 seconds and each kind has a
30-second combined-duration ceiling. Video files are MP4/MOV up to 200 MB;
audio files are MP3/WAV up to 15 MB. The product upload path currently accepts
the fully verified JPEG/PNG/WebP image subset (30 MB, 300–6000 px upstream)
rather than advertising formats its hardened image probe cannot yet decode.

## Output parameters

- resolution: `480p | 720p`
- ratio: `auto` (wire omission → `adaptive`) or `21:9 | 16:9 | 4:3 | 1:1 |
3:4 | 9:16`
- duration: `auto` (wire `-1`) or `4..30`
- output: `mp4 | mov`
- synchronized audio: enabled by default

Frame-guided tasks require adaptive ratio. ModelArk classifies edit/extend
intent asynchronously: edit requires adaptive ratio + duration `-1`; extension
requires adaptive ratio + duration `4..30` or `-1`. The adapter preserves
`InvalidParameter.TaskTypeConstraint` messages so the creator can correct the
request.

## Cost accounting

The retrieve response returns `usage.completion_tokens`. Provider cost is
recorded from the actual token count:

- no reference video: USD 10.70 / million tokens
- with reference video: USD 6.40 / million tokens

For video-input jobs the provider formula covers combined input-video seconds
plus output seconds. Product pricing therefore uses the same two-class meter;
it does not reuse Seedance 2.0's output-only per-second quote.
