# Studio Generation Platform Architecture Notes

> **Update 2026-06-25:** realtime is now the self-hosted WebSocket gateway (Redis
> pub/sub fan-out); **Azure Web PubSub was decommissioned**. Where this note says
> "Web PubSub" for the realtime transport, read it as the self-hosted gateway
> behind the same provider abstraction — see `docs/studio-realtime-architecture.md`.

Status: implementation in progress
Owner: FizzDragon platform
Date: 2026-06-12
Scope: `apps/studio`, `apps/web` FizzStudio, `apps/server`, `apps/admin-ui`

This note records the current architecture discussion around generation
queues, compute-credit billing, realtime delivery, media asset governance, and
multi-cloud storage. It is intentionally broader than one implementation task:
use it as a decision log and backlog seed before schema or product changes.

## 1. Product Invariants

- Generation jobs are durable server-side records, not client-only tasks.
- Compute-credit balance checks are authoritative on the server.
- A job must not enter the queue unless its chargeable credits are reserved.
- User-facing generation histories are scoped by creation surface.
- Billing usage is account-wide and should not be confused with asset history.
- Business surfaces reference media by `assetId`, not by raw provider URLs.
- Realtime delivery is the primary update path; polling is only a fallback.
- Realtime, media storage, and CDN providers must be replaceable by adapter.
- China and global deployments may use different storage/realtime providers.

## 2. Queue And Per-User Concurrency

Current shape:

- Submit-time limits exist:
  - `perUserQueued` limits queued jobs per user.
  - `perUserRunning` limits running jobs per user and modality.
- Worker runtime is mostly governed by BullMQ queue concurrency and provider
  capacity gates.
- `perUserRunning` is not currently a strict worker-claim-time scheduler.

Target shape:

- Keep submit-time limits to prevent users from stockpiling too many jobs.
- Add worker claim-time per-user running checks before a queued job becomes
  `in_progress`.
- If the running limit is full, requeue or defer the job without calling the
  provider.
- Consider user-level fair scheduling or round-robin if one user can otherwise
  occupy the front of the queue.

Decision direction:

- BullMQ/global concurrency protects system throughput.
- Per-user running guards protect product fairness.
- Both are required for production behavior.

## 3. Compute Credits, Holds, And Submit UX

Current server behavior:

- `POST /aurora/ai/jobs` resolves route and pricing.
- Before `AiJob` creation, the server reserves compute credits in the same DB
  transaction.
- Insufficient balance returns `INSUFFICIENT_COMPUTE_POINTS`.
- If balance is insufficient, no job row is created and no queue entry is
  published.

Current UX gap:

- Some generation surfaces optimistically insert a queued/submitting card before
  the server accepts the job.
- On insufficient credits, that local row becomes failed even though no server
  job exists.
- Header/account UI mostly shows available balance, not held/frozen balance.

Target UX:

- Frontend may do a lightweight pre-check using visible available balance and
  model price estimate.
- Frontend pre-check is only a UX optimization, never a security boundary.
- On click, the generate button enters loading while the server validates and
  reserves credits.
- Insert a result card only after the server returns a real `request_id`.
- On insufficient credits, do not create a result card; show recharge or
  insufficient-credit UI.
- Account UI should distinguish:
  - available compute credits
  - held/frozen compute credits
  - total compute credits

## 4. Generation History Scope

Current shape:

- Jobs carry `sourceSurface`, for example:
  - `fizzstudio-canvas`
  - `fizzstudio-image-studio`
  - `fizzstudio-video-studio`
- Public job listing currently filters by `type` and optional workspace/project
  context, but not by `sourceSurface`.
- As a result, canvas/project generations can appear in the standalone image or
  video history lists.

Target shape:

- Standalone image history lists only `sourceSurface=fizzstudio-image-studio`.
- Standalone video history lists only `sourceSurface=fizzstudio-video-studio`.
- Canvas/project generations appear in the project asset library and canvas
  context, not in one-off generation histories.
- User-facing billing usage remains account-wide and shows wallet ledger events:
  hold, settle, release, top-up, refund, and admin adjustment.
- Admin can keep a global request list for operations, moderation, and
  debugging.

Principle:

- Asset history is scoped by creation context.
- Billing usage is global by account or workspace billing scope.

## 5. Realtime And Polling

Current `apps/studio` behavior:

- Generation feed uses Web PubSub realtime for job updates.
- The same feed also polls active jobs every 2.5 seconds as a missed-push
  backstop.
- Canvas asset library polls project assets every 2.5 seconds while open.
- Compute-credit badge refetches every 60 seconds.
- One-second intervals in cards are mostly local countdown UI, not HTTP polling.

Target shape:

- Realtime is the primary path for job state, wallet balance, and asset library
  updates.
- Polling is low-frequency reconciliation or only active when realtime is
  disconnected.
- Active job fallback polling should be closer to 15-30 seconds, not 2.5
  seconds, unless disconnected from realtime.
- Asset library should fetch on open and update from asset/job events.
- Wallet balance should refresh from wallet events or precise query
  invalidation after submit, settle, release, top-up, and refund.

## 6. Realtime Provider Abstraction

Do not couple business code directly to Azure Web PubSub, Ably, or a raw
WebSocket server.

Required abstraction:

```ts
interface RealtimeProvider {
  negotiate(input: {
    userId: string;
    workspaceId?: string;
    projectId?: string;
    scopes: string[];
  }): Promise<{ url: string; token?: string; expiresAt: string }>;

  publish(input: { channel: string; event: RealtimeEvent; idempotencyKey: string }): Promise<void>;

  publishUser(userId: string, event: RealtimeEvent): Promise<void>;
  publishWorkspace(workspaceId: string, event: RealtimeEvent): Promise<void>;
}
```

Provider direction:

- `.com` can continue using Azure Web PubSub in the near term.
- Ably can be evaluated as a global managed realtime provider.
- Self-hosted `ws` is viable only as a dedicated realtime gateway, not random
  `socket.send()` calls inside business services.
- CN deployment should not rely on cross-border realtime. Use a China-local
  provider or self-hosted gateway with a local backplane.

Production realtime requirements:

- Durable domain outbox.
- Idempotent event IDs.
- Sequence or version data for client merge.
- Channel ACL by user, workspace, and project.
- Reconnect with `lastEventId` replay or a mandatory reconcile API.
- Backpressure and rate limits.
- Pod drain behavior.
- Metrics for connections, publish latency, dropped events, reconnects, and
  fallback polling.

Self-hosted WS shape, if needed:

```text
API Server
  writes domain event -> Outbox

Outbox Dispatcher
  reads outbox -> publishes to backplane

Realtime Gateway
  holds WebSocket connections
  subscribes to backplane channels
  pushes events to clients

Client
  reconnects with lastEventId
  calls reconcile API when gaps are suspected
```

## 7. Media Asset Governance

Current `MediaAsset` is a useful MVP identity, but it is not enough for a
production media platform.

Problems to address:

- A blocked DB row does not automatically make old CDN URLs inaccessible.
- Long-lived public URLs can bypass moderation takedown.
- Original files, thumbnails, posters, HLS manifests, HLS segments, preview
  videos, and sprites need first-class lifecycle tracking.
- Product surfaces need to know every place an asset is used.
- Moderation targets are broader than assets: prompts, jobs, IP titles,
  episodes, comments, profiles, and projects can all be targets.
- `ready` is too coarse to represent upload, scan, transcode, thumbnail, CDN
  publish, and purge state.

Recommended core model:

```text
MediaAsset
  logical asset identity, owner/workspace/source/kind/intrinsic metadata

MediaAssetVariant
  thumbnail, poster, blurhash, preview_mp4, hls_manifest, hls_segment,
  transcode_720p, original_proxy, etc.

MediaAssetUsage
  ai_job_output, canvas_node, project_library, ip_episode, profile_avatar,
  discovery_banner, certificate_image, etc.

MediaProcessingJob
  thumbnail, transcode, moderation_scan, cdn_publish, cdn_purge

ModerationCase
  target_type, target_id, status, severity, reason, reporter/admin context

ModerationAction
  flag, approve, block, restore, purge, with full audit fields

AssetAccessPolicy
  visibility, workspace scope, entitlement, geo, expiry, download policy
```

Production takedown flow:

1. Mark asset and all variants blocked or quarantined.
2. Record moderation action with actor, reason, evidence, and target.
3. Resolve all usages and hide or degrade affected business surfaces.
4. Purge CDN paths for original and variants.
5. Make playback manifests and signed URL issuance return 404/410.
6. Push realtime events to connected clients so blocked media disappears.
7. Remove or suppress search/recommendation/feed entries.

Principle:

- Business surfaces reference `assetId`.
- The media service decides whether the asset is visible, which variant to
  serve, and how to generate the URL.

Implemented in this branch:

- `MediaAssetVariant`, `MediaObjectPlacement`, `MediaAssetUsage`,
  `MediaModerationCase`, `MediaModerationAction`, and `MediaProcessingJob` are
  now first-class Prisma models.
- AI output and direct upload writes create an `original` variant and primary
  placement for new media.
- AI job output usage is recorded in `MediaAssetUsage`, including standalone vs
  canvas/project source surface.
- User media access is centralized behind
  `GET /aurora/media/assets/:assetId/access` and renderable redirect
  `GET /aurora/media/assets/:assetId/content`.
- AI job outputs now include `accessUrl`; `apps/studio` renders generated
  images/videos through that controlled URL when available.
- Manual block actions create purge tasks for CDN-backed placements and mark
  placements `purging`.
- `CdnPurgeWorkerService` claims purge tasks with `lockedAt/lockedBy`, retries
  with backoff, and sends exhausted rows to DLQ.
- `MediaProcessingWorkerService` is the queue boundary for thumbnail,
  transcode, probe, moderation scan, and backfill jobs. Only
  `backfill_original_placement` is implemented today; derivative handlers fail
  visibly instead of producing fake assets.
- `apps/admin-ui /media` now exposes asset inventory, purge queue, processing
  queue, retry actions, and original-placement backfill.
- `npm run media:backfill-original-placements -w server -- --limit=N` dry-runs
  historical original variant/placement backfill and refuses non-local DBs by
  default.

Still required before claiming the full media platform is complete:

- Wire a real CDN purge gateway/provider for `.com` and `.cn`
  (`MEDIA_CDN_PURGE_HTTP_ENDPOINT` or provider SDK workers).
- Add image/video processing providers for thumbnails, posters, HLS/transcode,
  sprites, and streaming manifests.
- Add moderation scan provider and realtime takedown events for every surface
  that caches project/canvas assets locally.
- Move long-lived public playback to signed/private URLs where provider support
  allows it.

## 8. Multi-Provider Storage And Legacy OSS

Aliyun OSS already contains significant legacy data. A one-time full migration
is not realistic.

Problem with the current long-term model:

- `MediaAsset.storageProvider/bucket/objectKey` binds a logical asset to a
  single physical object.
- This does not scale to multi-cloud, multi-region, multi-CDN, replicas,
  archive tiers, or lazy migration.

Recommended split:

```text
MediaAsset
  logical asset identity

MediaObjectPlacement
  assetId
  variantId?
  provider: aliyun_oss | azure_blob | s3_compatible | external_url
  providerAccountId
  region/cell
  bucket/container
  objectKey
  cdnBaseUrl/cacheKey
  role: primary | replica | archive | legacy
  status: available | copying | failed | deleted | blocked
  checksumSha256
  sizeBytes
  createdAt
  lastVerifiedAt
```

Migration strategy:

- Build an index of existing OSS objects as legacy placements before moving
  bytes.
- New uploads and generation outputs write through the new placement model.
- Read resolver chooses placement by site cell, user region, status, and role.
- High-value or high-traffic assets lazy-copy to the preferred provider.
- Cold assets migrate slowly in background batches.
- Read-path cutover and write-path cutover are separate switches.
- Legacy deletion requires checksum verification, usage confirmation, and a
  recovery window.

Principle:

- Migrate asset identity and placement metadata first.
- Move bytes later, by priority and evidence.
- Business code never binds directly to a provider URL.

## 9. Implementation Progress

Updated 2026-06-12:

- Submit UX:
  - `apps/studio` standalone image/video generation now pre-checks visible
    available compute credits.
  - Standalone feeds only add a card after `/aurora/ai/jobs` returns a real
    server `request_id`.
  - Canvas generation uses a local `submitting` state before server acceptance
    instead of pretending the job is already queued.
- Credit display:
  - `apps/studio` account surfaces distinguish available, held, and total
    compute credits.
  - Query invalidation now runs after submit acceptance and terminal job
    realtime events.
- History scope:
  - `/aurora/ai/jobs` accepts `sourceSurface`.
  - `apps/studio` and legacy `apps/web` FizzStudio standalone histories filter
    by source surface and ignore mismatched realtime events.
- Queue fairness:
  - Membership entitlement policy carries queued and running concurrency
    limits.
  - Submit-time queued limits and worker claim-time running guards are both
    implemented server-side.
- Realtime:
  - `apps/studio` generation feed is realtime-first; connected fallback
    polling is low-frequency, disconnected fallback is faster.
  - Canvas asset library reconciles from local asset events plus low-frequency
    polling.
  - Server realtime consumers now depend on `RealtimeProvider`, with the
    current Azure Web PubSub implementation bound behind that provider.
  - Asset event outbox now receives publish failures instead of Web PubSub
    swallowing them, so retries/DLQ can work as intended.
- Media asset platform:
  - `MediaAssetVariant` records original/thumbnail/poster/transcode/stream
    variants.
  - `MediaObjectPlacement` records provider/bucket/object/CDN placement for
    multi-cloud and legacy OSS coexistence.
  - `MediaAssetUsage` records where an asset is used by surface, project,
    AI job, and output row.
  - New user uploads and AI generation outputs create an `original` variant
    and primary placement.
  - AI output replacement writes output usage rows with `sourceSurface`
    attribution.
  - Admin asset listing now returns variants and placements.
  - Admin moderation writes moderation cases/actions and creates pending CDN
    purge actions for CDN-backed placements when an asset is blocked.

Remaining production follow-ups:

- Add a media processing worker for thumbnails/posters/transcodes/HLS and CDN
  purge execution.
- Add a public media access gateway or signed URL issuer that enforces
  moderation, workspace access, geo/cell, and expiry at request time.
- Backfill `original` variants, placements, and usage rows for existing
  historical media assets.
- Add client realtime event kinds for wallet changes and asset library changes
  beyond AI job updates.
- Add admin UI screens for moderation case queues, purge failures, placement
  health, and processing jobs.

## 10. Suggested Backlog Order

1. Done — adjust generation submit UX so insufficient credits do not create failed
   local cards.
2. Done — show available, held/frozen, and total compute credits in account surfaces.
3. Done — add `sourceSurface` filtering to `/aurora/ai/jobs` and scope standalone
   generation histories.
4. Done — add worker claim-time per-user running guard.
5. Done — make studio generation surfaces realtime-first with lower-frequency fallback
   polling.
6. Done — introduce a `RealtimeProvider` abstraction around the current realtime code.
7. Started — design and migrate toward `MediaAssetVariant` and `MediaAssetUsage`.
8. Started — design `MediaObjectPlacement` for multi-provider storage and legacy OSS.
9. Started — add moderation case/action plus CDN purge and playback-gateway enforcement.

## 11. Open Questions

- Should `MediaAsset` retain legacy `storageProvider/bucket/objectKey` columns
  during transition, or should all new reads go through placements immediately?
- Which provider should CN realtime use: a managed China-local service or
  self-hosted gateway?
- What event retention window do clients need for reconnect replay?
- Should blocked assets be hard-deleted from storage, quarantined, or retained
  with access denied?
- Should media access URLs be fully signed, CDN-tokenized, or gateway proxied
  for each asset class?
- Which moderation targets are mandatory for v1: AI output, prompt, project,
  IP title, episode, user upload?
