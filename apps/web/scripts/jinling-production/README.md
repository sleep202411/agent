# Jinling production runner

The formal production route is `fizzdragon-reference-trial`: it uploads reviewed
references through the existing media pipeline, submits one idempotent
FizzDragon cloud job, polls no faster than every five seconds, and stages the
result as `REVIEW`. The session token and personal workspace id are accepted only
from the current process (`FIZZDRAGON_SATOKEN`, `FIZZDRAGON_WORKSPACE_ID`) and are
never read from or written to the repository.

`seedream-reference-trial` remains a direct ModelArk diagnostic path. It is not
the production route because long synchronous calls from the local network can
be closed by the transport before the provider responds.

`seedance-reference-trial` is the controlled asynchronous video review path. It
creates exactly one provider task for a confirmed content fingerprint, records
the recoverable task id, polls no faster than every five seconds, downloads from
an allowlisted provider URL, and derives the exact authored frame count. The
master must be H.264 `yuv420p` at a constant requested frame rate, start at frame
zero, match dimensions/duration/frame count/audio policy, and survive a complete
decode. If a process dies between submission and task-id persistence, that
fingerprint becomes `UNKNOWN`; the runner refuses a duplicate request.

This is the offline, manifest-driven production boundary for P00 media. It does
not use the application database and does not publish generated output directly
to the runtime asset path.

The default input is:

`apps/web/src/features/jinling-rumeng/production/manifests/s01-p00-v01.json`

Run from the repository root:

```bash
npx tsx apps/web/scripts/jinling-production/cli.ts validate
npx tsx apps/web/scripts/jinling-production/cli.ts plan --asset ASSET_ID
```

`plan` prints the stable fingerprint without printing prompts, API keys, or
environment values. A reference trial requires that exact fingerprint:

```bash
npx tsx apps/web/scripts/jinling-production/cli.ts seedream-reference-trial \
  --asset ASSET_ID \
  --confirm-fingerprint SHA256_FROM_PLAN
```

Seedance uses the same explicit confirmation boundary:

```bash
npx tsx apps/web/scripts/jinling-production/cli.ts seedance-reference-trial \
  --asset ASSET_ID \
  --confirm-fingerprint SHA256_FROM_PLAN
```

Completed Seedance journals are not trusted blindly on resume: provider source
and exact master are reopened, hash/size checked, probed, and decoded again
before `alreadyStaged: true` is returned.

## Transport wait policy

ModelArk's image generation endpoint is synchronous and does not return a
recoverable task identifier. The official SDK guidance recommends a 1,800
second timeout for long responses, while its SDK defaults allow at least 600
seconds of response waiting. The runner therefore waits 1,800 seconds by
default. An operator may explicitly choose 600–3,600 seconds without changing
the content fingerprint:

```bash
npx tsx apps/web/scripts/jinling-production/cli.ts seedream-reference-trial \
  --asset ASSET_ID \
  --confirm-fingerprint SHA256_FROM_PLAN \
  --provider-timeout-seconds 1800
```

The runner performs zero automatic retries. A deadline, remote close, network
failure, or invalid gateway response after submission remains `UNKNOWN` because
the image API documents neither an idempotency key nor a task-status lookup.
The production request path uses Node's native HTTPS transport so the explicit
deadline is not shortened by the built-in fetch client's separate 300-second
header/body defaults.
The sanitized journal records the configured timeout, elapsed time, HTTP status
when available, and a bounded transport category without persisting response
bodies, URLs, credentials, or raw exception messages.

Official references: [ModelArk SDK timeout guidance](https://docs.byteplus.com/en/docs/ModelArk/1544136)
and [image generation API](https://docs.byteplus.com/en/docs/ModelArk/1541523).

Seedream credentials are resolved from explicit process configuration first,
then the web media settings in `apps/web/.env.local`, with `apps/server/.env` as
the legacy fallback. The web `SEEDANCE_API_KEY` and `SEEDANCE_BASE_URL` values
are mapped internally to the runner's provider-neutral names; the model remains
locked to the versioned manifest endpoint.

Generated files and sanitized journals are staged under
`tmp/jinling-production/`. Downloads use HTTPS provider-host allowlists,
bounded redirects, a total timeout, byte limits, media magic/MIME checks,
`.part` plus atomic rename, SHA-256, and exact ffprobe dimension validation.

Seedream 5 Pro trials send the manifest's exact provider-source pixel size,
`output_format=png`, and `watermark=false`. Pro requests deliberately omit the
Lite-only `stream` and `sequential_image_generation` fields. The runner
preserves the provider response under `source/` using its real PNG/JPEG/WebP
magic and makes it read-only. If that actual magic does not match the declared
output format, the source remains available for diagnosis but the trial fails
before derivation. When the manifest explicitly declares a
`review-only` derivation, Sharp performs a same-aspect, no-crop Lanczos3 upscale
to the formal delivery dimensions and stages a full-colour PNG under `review/`.
This derived file remains a review artifact and cannot be promoted by this
runner. The journal records separate source/derived dimensions, paths, MIME
types, byte counts, and SHA-256 values.

The runner has no APPROVED transition. A valid trial stops at `REVIEW` and must
be promoted by a separate human-reviewed production step.

## Locked P00 + SC01 production slice

Rebuild the first dialogue-locked production package and its runnable SC01
Seedance manifest:

```bash
npm run jinling:production:build
npx tsx scripts/jinling-production/cli.ts validate \
  --manifest src/features/jinling-rumeng/production/manifests/s01-sc01-seedance-v1.json
npx tsx scripts/jinling-production/cli.ts plan \
  --manifest src/features/jinling-rumeng/production/manifests/s01-sc01-seedance-v1.json
```

The production package binds seven independent SeedAudio voice tasks and four
SC01 video tasks to dialogue lock `1.0.0`. The Daiyu reaction uses the canvas
reference lifecycle: upload and confirm the reviewed identity image, wait for
its virtual-portrait mirror to become active, then submit the multimodal
Seedance task. The other three shots remain clean picture plates so off-screen
voice tracks can be replaced without regenerating video.

### Direct Seed Audio 1.0 production

Voice production calls BytePlus Voice directly at
`/api/v3/tts/create` with `X-Api-Key`; it does not route through the Java
services. `SEED_AUDIO_API_KEY` and `SEED_AUDIO_BASE_URL` are loaded from
`apps/web/.env.local` through an explicit allowlist and are never printed or
persisted.

Plan and stage one dialogue task with a reviewed WAV voice reference:

```bash
npm run jinling:audio -- plan \
  --task S01-P00-B02-VO-01-AUDIO-V1 \
  --reference-audio /absolute/path/to/reviewed-voice.wav

npm run jinling:audio -- generate \
  --task S01-P00-B02-VO-01-AUDIO-V1 \
  --reference-audio /absolute/path/to/reviewed-voice.wav \
  --confirm-fingerprint SHA256_FROM_PLAN
```

The synchronous runner claims a journal before submission, performs no
automatic retry after an unknown result, never persists the response URL or
base64 body, and stops at `REVIEW`. Provider WAV is preserved separately from
the derived 48 kHz, 24-bit, mono production master. Reference-audio generations
may append the reference clip to the response; locked dialogue is therefore
validated against provider subtitle timings and clipped before that segment.

For stronger same-character continuity, the current P00 + SC01 review pack was
generated as one complete recording session per character, then split by exact
subtitle boundaries:

```bash
npm run jinling:audio:split-sessions
```

The splitter refuses any session whose ordered spoken text differs from the
dialogue lock. Session sources remain immutable under
`tmp/jinling-production/seedaudio-sessions/`; task masters are staged under
`tmp/jinling-production/seedaudio-session-review/`.

Runtime delivery keeps the clean video and every 48 kHz/24-bit stem, then
creates a separate H.264 + AAC playback mux for browser compatibility. This
avoids late-created audio elements being blocked by autoplay policy while
preserving complete creator-side remixability. Runtime playback starts muted;
one explicit sound control unmutes the already-playing media element.
