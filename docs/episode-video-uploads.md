# Episode source video uploads

IP Studio episode create/edit accepts MP4, WebM and MOV source videos up to
37,580,963,840 bytes (35 GiB, displayed as 35 GB). Trailers, covers and reference
uploads retain their existing limits. Saving an episode does not publish it.

The browser uploads 16 MiB parts directly to the configured object store, with
three concurrent requests, progress and transient-error retries. A failed upload
retains its preview and a Retry action. Selecting the same file after closing the
dialog or refreshing resumes confirmed parts for seven days. Per-part hashes
prevent mixing different files with identical names and metadata. Browser memory
usage is bounded by the part size, not the video size.

Nest stores one upload session, checks ownership and the provider's part list,
completes the object and checks its actual size/type. Media confirmation probes
duration and creates the ordinary media asset. Only then can the episode save.
Repeated completion returns the same asset. Playback uses the existing complete
object URL; upload parts are not a new playback format. Video encoding and HLS
processing are unchanged.

## Deployment prerequisites

1. Apply `20260909120000_episode_multipart_uploads` through the normal Prisma
   deployment procedure before starting the new server. It adds a table and enum;
   existing episodes need no backfill. Deploy server before web.
2. The selected storage credentials must support multipart initiate/list/complete/
   abort and existing HEAD/read/delete operations. Azure uses block-blob operations.
   Keep the existing region-specific storage configuration; do not route a region
   to another provider as a fallback.
3. Allow browser `PUT` from the exact frontend origin on the upload bucket. Existing
   cross-origin media reads may also need `GET`/`HEAD`. Multipart signing does not
   bypass CORS. Preserve other applications' existing rules.
4. Configure abandoned multipart cleanup at seven days on R2/OSS, covering the
   narrow crash window between provider initialization and storing its upload ID.
   The application also expires sessions and removes their incomplete objects.
   Azure's uncommitted blocks use its storage-managed expiry.

For R2, merge a rule like this into **bucket → Settings → CORS policy**, using
the exact origins for that environment. Include localhost only on buckets used
for local testing; CN OSS requires its own policy for its frontend origin.

```json
[
  {
    "AllowedOrigins": ["https://fizzdragon.com", "http://localhost:9527"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Range"],
    "MaxAgeSeconds": 3600
  }
]
```

Part ETags are listed server-side; the browser does not require exposed ETags.
Use an account with bucket-settings permissions for configuration, not an object-
only application key. See [Cloudflare's CORS documentation](https://developers.cloudflare.com/r2/buckets/cors/).

## Verification

- Server tests: `episode-upload.service.spec.ts`, `media-upload.service.spec.ts`
  and `multipart-storage.spec.ts` cover ownership, limits, malformed/missing parts,
  response loss, idempotency, cancellation, expiry and provider signing contracts.
- Web tests: `app/(site)/ip-studio/_lib/episode-upload.test.ts` covers bounded parts,
  retry/resume, different-file rejection, lost responses, abort and oversize input.
- `episode-upload.integration.spec.ts` is opt-in with
  `EPISODE_UPLOAD_INTEGRATION=1`. It requires a local `fizzdragon_*` PostgreSQL
  database on port 5433 and disposable MinIO on `127.0.0.1:19000` with test-only
  credentials `fizz-local-test` / `fizz-local-test-password`. It rejects remote
  database targets, creates a unique test bucket, uploads a real three-part MP4,
  resumes after a service restart, compares every downloaded byte and probes the
  completed video. Remove the disposable MinIO instance after running it.
- Browser acceptance: upload, save, reload and play a locally generated MP4;
  verify failed uploads retain preview/retry and cannot save incomplete media.
- Before release, repeat acceptance on each actual deployment origin/storage pair
  and transfer a full-size source. A 35 GiB boundary test is not a 35 GiB network test.

On 2026-09-09, browser upload/save/reload/play acceptance passed using local
MinIO. Production-origin checks confirmed R2 permits `https://fizzdragon.com`
and `https://studio.fizzdragon.com`; only localhost is denied. OSS permits the
CN frontend through its configured public CNAME. Each production provider also
passed a real three-part MP4 upload, resume query, merge, byte-range comparison,
duration probe and test-object cleanup.

R2 documents a default seven-day incomplete multipart expiry
([upload documentation](https://developers.cloudflare.com/r2/objects/upload-objects/)).
The application credentials cannot read bucket lifecycle settings. CN OSS had
no lifecycle rule at this check; add a seven-day incomplete-upload rule for the
`media/cn/episode-source-video/` prefix before enabling the new frontend there.

The R2 production provider also passed an actual 37,580,963,840-byte transfer:
2,240 parts, paginated part listing, completed size/type, HTTP 206 byte comparison,
and a two-second MP4 duration probe. It used a generated MP4 with a valid padded
free atom, streamed from the deployment pod; this measures storage correctness,
not an end user's residential-network upload speed. The object was deleted.
