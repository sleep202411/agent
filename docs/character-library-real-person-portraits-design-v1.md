# Character Library & Real-Person Portraits — Design v1.1

Status: REVIEWED (4-lens adversarial review incorporated) · 2026-07-02
Scope: apps/server, apps/studio, packages/shared. Java is out of scope (external API only).
Upstream: BytePlus ModelArk **Dreamina Seedance 2.0 Advanced Creation Rights** (ACR) private asset
library. Primary sources: docs.byteplus.com/en/docs/ModelArk/{2333589,2333565,2377608,2318270-2318278,2333587,2333588,2341606}.
Review log: v1.0 → v1.1 changes are marked ⟦R⟧ and summarized in §11.

---

## 0. Product statement

One user-facing concept: **Characters (角色库)** — reusable subjects for AI video generation.
Two kinds with different trust levels:

| kind          | what it is                                       | consent gate                                                                       | providers                                                            | ownership                                                                                                                                                                                                                                      |
| ------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `virtual`     | fictional character / 3D / anime / owned artwork | ToS attestation + layered real-face controls (§5.2)                                | any (fal Seedance 2.0 r2v, Kling Elements, Vidu ref2video, byteplus) | the workspace it was created in — inside a team workspace there ARE no personal assets, only attribution (createdByUserId) ⟦R5⟧                                                                                                                |
| `real_person` | a verified real human likeness                   | BytePlus-hosted liveness (H5) + our versioned separate-consent screen + adult gate | **byteplus-modelark ONLY** (pinned)                                  | ⟦R5⟧ v1: exists ONLY in the subject's personal workspace (usable in personal projects). Team workspaces have no real_person characters until P3, where the subject enrolls INTO the team library via invite (consent scoped to that workspace) |

⟦R2⟧ Ownership plane: characters are NEVER project-scoped (cross-project consistency is the whole
feature; real_person cannot be project-copied at all — one LivenessFace group per person) and we do
NOT invent a user-direct ownership plane: the repo invariant is Workspace → Project → Asset and
every user has an auto-bootstrapped personal workspace (`/workspaces/personal/ensure`).
"Owner-only" is therefore encoded as "home workspace = enrollee's personal workspace" (its only
member is the owner), reusing the existing ACL plane instead of a NULL-workspace special case.

⟦R3⟧ Ownership vs visibility (the "assets bleeding across projects" concern): ownership lives at
the workspace LIBRARY (演员池), day-to-day visibility lives in the per-project CAST (演员表) — the
Figma team-library / enable-per-file pattern. Creating a character inside a project writes it to
the workspace library AND auto-adds it to that project's cast; every other project's picker shows
ONLY its own cast by default, with an explicit "add from library" (选角) action. Removing from a
cast never deletes the character; deletion/revocation is a library-level act. Model:
`CharacterProjectCast {projectId, characterId, addedByUserId, addedAt, grant fields below,
@@unique([projectId, characterId])}` — intent (casting), distinct from MediaAssetUsage rows (facts
of use). Creation UI states the target library explicitly (default = active workspace, switchable
to "My library").

⟦R5⟧ Personal × team interplay (supersedes v1.1's R4 cross-workspace grant bridge): **inside a team
workspace there are no personal assets — only attribution.** Every asset in a team workspace
belongs to the team; createdByUserId records who made it (same posture as MediaAsset's audit-only
createdByUserId). Consequences:

- Authorization collapses to ONE rule: caller is a member of the character's home workspace. No
  cross-workspace reads, no grant machinery, no billing/authz decoupling special case. The cast
  table is pure visibility (project cast ⊆ home-workspace library) — no grant fields.
- Bringing a personal `virtual` character to a team = explicit **import (copy)** into the team
  library: a new StudioCharacter row in the team workspace (provider mirrors re-register). Identity
  fork is the stated cost — same mental model as copying a file into the team drive.
- `real_person` v1 exists only in the subject's personal workspace; team dramas wait for P3, where
  the subject enrolls DIRECTLY into the team library via an enrollment invite — matching ModelArk's
  native QR-invitation flow ("authorizing party completes verification on mobile and authorizes
  your account to use their image"): consent is scoped to the enrolling workspace, the subject
  needs no FizzDragon account (contracted-actor scenario), and the consent copy names the team.
  Consent scope = enrollment workspace, cleanly.
  Dependency: cast rows hang on PlatformProject (server-backed); the canvas generation context gains
  projectId as part of P1.

⟦R6⟧ Extensibility contract (revised after review: "home" belongs to ENTITIES only; media has
REFERENCES): identity and authorization are separated via three planes —

1. **Media (MediaAsset)**: bound to nothing but the accounting boundary. workspaceId exists solely
   because workspace is the accounting + security unit (team generations spend the TEAM wallet;
   quota is per-workspace; createdByUserId is audit-only). Media exists because references exist;
   violations are enforced at the SOURCE (block → storage/CDN unreachable platform-wide — no
   relationship traversal needed; usage rows only drive UI fan-out).
2. **Entities (characters, projects)**: the things users name, create, and delete deliberately —
   these have exactly one home workspace (§R2/R5).
3. **References (ProjectAsset rows, CharacterMedia rows, cast rows)**: the sole carrier of
   visibility AND lifecycle. Upload-in-project auto-creates a project reference;
   upload-to-library creates a library reference and NO project references. **Default-closed in
   BOTH directions**: workspace-library uploads are not project-visible, and project uploads never
   auto-appear in the workspace library (promotion is explicit) or in sibling projects. "Can I see
   it" = "does a reference reach my current context" — one lookup. The workspace pool is an
   ACCOUNTING fact and grants zero visibility; browsing surfaces are reference-driven everywhere
   (workspace-viewer authorization on raw asset ids is the ceiling, not a browsing surface; the
   only whole-pool views are the usage/quota view, the zero-reference "unused" cleanup view, and
   admin governance). All future ACL evolution = adding/removing reference rows (audited by nature).
   Within a workspace, media flows freely across projects by reference (zero copies). Crossing a
   workspace boundary copies (accounting integrity); physical dedupe by objectKey is a storage
   optimization, not an accounting concern.
   Deletion model: deleting a project deletes its REFERENCES, never media; zero-reference media
   enters a grace window (~30d, visible in a library "unused" view for restore/purge) then GC frees
   quota — consistent with the storage-quota-foundation direction (active-only, zero-orphan) and
   ModelArk's own capacity-as-live-watermark model. Workspace deletion retires the accounting party →
   retention window → GC. real_person media: consent-revocation crypto-shred (30d) overrides all GC
   rules. Blocking is orthogonal to GC and immediate.
   Hard exception: for `real_person`, reference/grant mutability is BOUNDED by the consent ledger —
   visibility can never widen beyond consented scope; widening requires a new consent event by
   construction.

⟦R7⟧ Project-only members (repo fact: ProjectMember/ProjectInvite are a live second membership
plane, independent of WorkspaceMember — shareable even from personal workspaces). Industry-verified
resolution (Frame.io/Google Shared Drives/GitHub/Notion/Canva/Adobe, 2026-07 research): limited
members' ACCESS flows through the container they were invited to, while OWNERSHIP and STORAGE
ACCOUNTING stay at the billing entity — zero platforms account storage per-project. Therefore:

- Storage/quota stays a WORKSPACE pool (matches the workspace wallet; optional per-project
  sub-caps later, Google-style). "Lives in a project" (reference) ≠ "owned by a project".
- Visibility rule extends to the project plane: "a reference reaches a context the caller is a
  member of" must honor ProjectMember. **P1 fix**: media-access.service requireAccess currently
  checks creator-or-workspace-viewer only and never consults ProjectMember — a project-only
  collaborator cannot mint read URLs for teammates' private assets inside the very project shared
  with them. Close via the reference rows (asset referenced by project X + caller ∈ ProjectMember(X)).
- Project-only members already CAN generate in shared projects, spending the HOST workspace wallet
  (resolvePayerTx charges job.workspaceId) — kept as the GitHub/Frame.io-consistent posture
  ("guest actions bill the owner") but promoted to a conscious, surfaced product fact (host-visible
  usage; future seat-charging lever for guests on private projects, GitHub-style).
- Characters: project-only members see the project CAST (references in their container), never the
  workspace library — the Canva Brand-Kit-vs-guest behavior, confirmed as industry default-deny.

⟦R8⟧ Workspace storage-management surface (governance, not collaboration):

- Access: owner/admin only (billing role additionally sees quota numbers). Ordinary members manage
  assets inside their project contexts; keeping the pool browser admin-gated means a future
  activation of restricted projects (dormant ProjectVisibility.private) cannot leak through it.
- Organization: grouped by UPLOAD ORIGIN (each asset has exactly one — groups are exclusive and
  sum to the pool total, so the view reconciles with accounting): one folder per project, plus
  Library (direct library uploads), AI outputs (source=ai_output, sub-grouped by origin project),
  and Unused (zero-reference, in the GC grace window, restore/purge actions). Multi-reference
  assets show "also referenced by …" badges — references are a multi-valued property and therefore
  never a grouping dimension (folders would double-count capacity).

v1 enrollment for `real_person` is **self-only** (the account owner enrolls their own face).
⟦R⟧ Honesty note (review finding): the H5 liveness proves _a live human consented on that link_;
it does NOT cryptographically bind that human to our account owner. §2.1 specifies the binding
controls we add (same-session completion, no client-supplied tokens, CN identity match) and §10
records the residual risk. Third-party authorization (Synthesia-style invite links) and
celebrity/IP Lifting are explicitly out of scope for v1 (P3).

⟦R⟧ **.cn cell precondition (hard, not an open item)**: real_person does NOT ship on .cn against the
Singapore endpoint — mainland users' face data to ap-southeast-1 is a PIPL Art.38-39 sensitive-PI
export (separate cross-border consent + CAC assessment/SCC). .cn P2 requires an onshore equivalent
(火山方舟 domestic asset library + domestic liveness) or does not happen. Intl (.com) first.

Design principles applied (repo AGENTS.md §Engineering standards): target-state, decoupled domains,
required-env-fails-loud, adversarial review before build, full-fidelity UI per apps/studio DESIGN.md.

---

## 1. Domain model (Prisma, apps/server)

Four concerns, four owners. MediaAsset stays the single storage source-of-truth; everything
provider-side is a rebuildable mirror; consent evidence is append-only and outlives everything else
— ⟦R⟧ but raw face media does NOT (see revocation §5.1: biometric bytes are crypto-shredded after a
dispute window; only the ledger persists).

```
model StudioCharacter {                       // product entity — the library entry
  id            String   @id @default(uuid())
  createdByUserId String @db.VarChar(64)      // ⟦R5⟧ attribution only (audit), never ownership —
                                              // same posture as MediaAsset.createdByUserId
  subjectUserId String?  @db.VarChar(64)      // ⟦R5⟧ real_person only: the depicted person.
                                              // v1: === createdByUserId === personal-workspace owner
  workspaceId   String                        // home workspace = THE owner. virtual: creating
                                              // workspace. real_person v1: enforced personal ⟦R5⟧
  kind          CharacterKind                 // virtual | real_person
  name          String   @db.VarChar(64)      // prompt-facing label (@mention)
  description   String?  @db.VarChar(200)
  coverAssetId  String?                       // MediaAsset FK
  status        CharacterStatus               // draft | pending_verification | active | disabled | revoked
  revokedAt     DateTime?
  createdAt / updatedAt / deletedAt
}

model CharacterMedia {
  id             String @id
  characterId    String                       // FK StudioCharacter, onDelete: Cascade
  mediaAssetId   String                       // FK MediaAsset, onDelete: Restrict
  mediaKind      image | video | audio
  sortOrder      Int
  status         active | disabled
  @@unique([characterId, mediaAssetId])
}

model CharacterConsentRecord {                // APPEND-ONLY legal evidence ledger
  id            String @id
  characterId   String
  type          consent_granted | liveness_verification | revocation | admin_takedown
                // ⟦R⟧ consent_granted: appended when the user accepts OUR consent screen,
                // BEFORE any session is created. evidence = {consentVersion, consentTextSha256,
                // acceptedAt, ip, userAgent, locale, ageGateOutcome}. This — not the vendor
                // callback — is what carries our PIPL 单独同意 burden (Art.69 reversed proof).
  provider      String?
  evidence      Json
  consentVersion String
  occurredAt    DateTime
  // NO deletedAt — ledger retention survives revocation (statute-of-limitations evidence).
  // ⟦R⟧ Ledger stores hashes/metadata ONLY — never face bytes, never signed URLs.
}

model AiProviderAssetGroup {
  id              String @id
  characterId     String
  provider        String                      // 'byteplus-modelark'
  externalGroupId String
  groupType       AIGC | LivenessFace
  projectName     String
  status          active | disabled | deleted // ⟦R⟧ disabled: flipped SYNCHRONOUSLY in the revoke tx
  @@unique([characterId, provider])
}

model AiProviderExternalAsset {
  id                   String @id
  characterMediaId     String
  providerAssetGroupId String
  externalAssetId      String?
  status               pending | processing | active | failed | deleted | disabled
  statusReason         String?                // face_mismatch | multi_face | moderation | stale | ...
  providerResponse     Json?                  // ⟦R⟧ REDACTED before persist: status/ids/timings/error
                                              // codes only — signed URLs (12h TTL, face imagery)
                                              // are stripped, never stored, never shown in admin
  lastSyncedAt         DateTime?
  processingDeadline   DateTime?              // ⟦R⟧ staleness rule: processing past deadline →
                                              // failed(statusReason=stale), visible retry affordance
  @@unique([characterMediaId, providerAssetGroupId])
}

model CharacterEnrollmentSession {
  id            String @id
  characterId   String
  ownerUserId   String                        // ⟦R⟧ denormalized: complete() asserts caller match
  bytedTokenEnc String                        // envelope-encrypted via Key Vault-backed key (intl);
                                              // single-use; hard-deleted on completion/expiry ⟦R⟧
  status        pending | completed | failed | expired
  expiresAt     DateTime                      // createdAt + 30min
}
```

⟦R⟧ New `AiOutboxEventType` enum value `character_media_updated` = a Prisma migration
(hand-written minimal migration per repo practice) + a new member in the closed `AssetEvent` union
(packages/shared/src/asset-events.ts) + published on the already-allowlisted `assets-user:{ownerUserId}`
channel so gap-replay works (realtime-replay allowlist rejects unknown channel prefixes).

Upload kinds (media/dto.ts + UPLOAD_KIND_POLICY): `character_image` (30MiB), `character_video`
(50MiB, mp4/mov), `character_audio` (15MiB, wav/mp3). Client + server validate the ModelArk
constraints up front (AR (0.4,2.5), 300–6000px, video 2–15s / 24–60fps / total pixels ≤ 2,086,876,
audio 2–15s) so failures are loud at pick-time. Add these kinds to HLS_SKIP_UPLOAD_KINDS (no
transcode of reference media).

MediaAssetUsage: every character media attach writes a usage row (surface=`character_library`,
role=`reference`); every generation submit writes usage rows for ALL references (§3.2). This builds
the person→assets→outputs dependency graph that revocation and takedown fan-out require.

---

## 2. Server modules

### 2.1 `apps/server/src/characters/` (new domain module)

Routes (user, global AuthGuard):

- `POST /aurora/characters` — create draft {kind, name, description}. real_person additionally
  requires: ⟦R⟧ (a) acceptance of the versioned consent screen → append `consent_granted` record
  first; (b) adult gate (§2.4); (c) CN cell: blocked entirely until onshore path exists (§0).
- `PATCH /aurora/characters/:id` / `DELETE` (delete = revoke, §5.1)
- `POST /aurora/characters/:id/media` — attach a confirmed MediaAsset (kind constraints;
  MediaAsset.createdByUserId === caller; ⟦R5⟧ caller ∈ character's home-workspace members for
  virtual — any teammate can enrich a team character; caller === subjectUserId for real_person)
- `GET /aurora/characters` / `GET /aurora/characters/:id` — owner-scoped (+ workspace for virtual)
- `POST /aurora/characters/:id/enrollment/session` — real_person only. Calls
  CreateVisualValidateSession(CallbackURL=studio callback route). Global token-bucket rate limit
  (§6.3). Persists session (encrypted token). Returns {h5Link, expiresAt}.
- `POST /aurora/characters/:id/enrollment/complete` — ⟦R⟧ takes NO client token. Uses the
  server-stored session token only; asserts session.characterId === :id AND session.ownerUserId ===
  caller AND the session was created by this same authenticated user. Calls GetVisualValidateResult
  (server→provider pull is the SOLE completion authority) → on GroupId: create
  AiProviderAssetGroup(LivenessFace), append `liveness_verification` record, hard-delete
  bytedTokenEnc. Idempotent.
- `GET /aurora/characters/:id/enrollment/status` — studio polls after "I've completed verification".

⟦R⟧ Callback trust model: the studio callback page is a UX convenience only (it tells the tab "go
poll now"). Inbound callback parameters are NEVER trusted to mutate state — completion always goes
through the authenticated `enrollment/complete` → GetVisualValidateResult pull. A forged callback
can at most trigger a poll that finds nothing.

⟦R⟧ Self-only binding controls (v1): the enrollment wizard requires completion from the same
authenticated session (we display the H5 link in-page; the "扫码给别人做" phishing shape is broken by
requiring the completing click + status poll to come from the owner's authenticated session, and by
consent copy stating the enrollee must be the account owner). CN: cross-check the Cloudauth
verified-identity signal where the Java bridge can surface it. This is binding-by-procedure, not
biometric binding — recorded as residual risk R1 (§10) with the compensating controls (output
watermark, subject report channel, admin takedown).

Admin routes (`@Public()` + AdminAuthGuard per repo convention): list/inspect characters, consent
ledger view (hash/metadata only), force-revoke (admin_takedown), provider-sync inspect/retry
(redacted responses only).

### 2.2 Provider layer: `src/ai-generation/providers/byteplus/assets/`

- `byteplus-assets-client.ts` — separate from the inference client (different host, different
  auth): `https://ark.ap-southeast-1.byteplusapi.com/?Action=X&Version=2024-01-01`, HMAC-SHA256
  signing (X-Date, X-Content-Sha256, scope `{date}/{region}/ark/request`) via node:crypto. All 12
  documented actions.
- Config: `BYTEPLUS_ASSETS_AK` / `BYTEPLUS_ASSETS_SK` / `BYTEPLUS_ASSETS_PROJECT` (default
  `default`) / ⟦R⟧ `BYTEPLUS_ACR_EXPIRES_AT` (subscription expiry date — REQUIRED when real_person
  enabled; there is no API to query it, so it is monitored config; fails loud at boot if missing).
  Feature flags `CHARACTERS_ENABLED` / `CHARACTERS_REAL_PERSON_ENABLED`; boot-time hard failure on
  missing keys when enabled. IAM: ArkFullAccess on the project.
- `character-provider-sync.service.ts` + BullMQ queues ⟦R⟧ **two lanes**: `ai:assets`
  (register/poll) and `ai:assets-critical` (delete/disable — consent revocation and takedown must
  never queue behind an enrollment burst or a rebuild storm). Registration is eager at media-attach.
- ⟦R⟧ Rate limiting with the correct primitive: BullMQ `limiter {max, duration}` / Redis token
  bucket enforcing the ACCOUNT-WIDE caps (CreateAsset 120 QPM on ACR; CreateVisualValidateSession
  3 QPS globally — per-user cooldowns are abuse hygiene only, they cannot enforce an account-wide
  cap).
- ⟦R⟧ Enrollment UX is leave-and-notify, not block-and-spin: media rows show
  pending/processing/active/failed live via `character_media_updated`; `processingDeadline`
  (e.g. 30 min) transitions stuck rows to failed(stale) with a retry affordance. CreateAsset has no
  SLA — the wizard never hard-blocks on it.
- Typed failure surfacing: face_mismatch / multi_face / moderation rejections verbatim to the UI.

### 2.3 What we deliberately do NOT build (target-state, no hedging)

- No self-built liveness/consent-video verification — BytePlus H5 owns the biometric check; we own
  the consent LEDGER and the procedure binding.
- No `Moderation.Strategy: Skip` anywhere in v1.
- No fal fallback for real persons — ever (§3.3 pin).
- No storing provider signed URLs anywhere (12h TTL; providerResponse is redacted before persist).

### 2.4 ⟦R⟧ Adult gate (new)

real_person enrollment is adult-only in v1. CN: extend the Java KYC probe to surface an is-adult
flag from Cloudauth ID data (the boolean needsRealNameVerification is insufficient); block at
session creation. Intl: DOB attestation recorded in the consent_granted evidence + provider liveness
age signal if available; residual risk documented (R2). Minors' likeness is a hard block, not a
policy footnote (PIPL Art.31, 人脸识别办法 guardian-consent rules).

---

## 3. Generation path integration

### 3.1 Schema & catalog

- `packages/shared/src/foundry-schema.ts`: `FoundryInputControl 'character_picker'`,
  `x-ui.mediaKind 'character'`; client `FizzAiReferenceKind` gains `'character'` (ships
  client-first — referenceKindFromUi currently collapses unknown kinds to 'image').
- `AiCanonicalModel.parameterPolicy` gains `characterReferences {max, kinds:[virtual,real_person]}`.
  ⟦R⟧ Only the byteplus mapper ever emits `kinds: [real_person]`; fal-bound canonicals may emit the
  block with `kinds:[virtual]` only. Schema shape is NOT the enforcement mechanism (see §3.3).

### 3.2 Submit contract & ordering ⟦R⟧ (rewritten — review blockers #1, #3, #5)

Client sends `referenceBindings` entries `{refId, role:'character', characterId, label}` — ids, not
URLs. **Character resolution runs FIRST in submitJob, before routing.resolve**, because routing,
quota pricing, and the provider pin all consume its output:

1. **Resolve** each characterId (union of referenceBindings and any input field) → StudioCharacter.
   Enforce ⟦R5⟧ the single rule: caller is a member of the character's home workspace AND the job's
   workspace context === the character's home workspace (no cross-workspace use of any kind).
   `kind=real_person` additionally asserts subjectUserId === caller in v1 (defense in depth —
   personal-workspace membership already implies it; the assertion survives P3 team enrollment
   where it relaxes to consent-record scope). status=active, not revoked. Server-truth kind —
   client-sent kind fields are ignored.
2. **Readiness pre-check**: real_person media mirrors must be `active` NOW → otherwise typed 409
   `CHARACTER_ASSET_NOT_READY` BEFORE any wallet hold is taken (no reserved-then-spinning jobs).
3. **Expand**: virtual → ordered media URLs (our CDN); real_person → `asset://<externalAssetId>`
   items. The expansion feeds (a) routing input (so isRouteRelevantField and input-shape matching
   see true reference counts), (b) quota pricing (referenceImageCount now counts expanded refs —
   closes the character-arbitrage under-billing), (c) the provider request.
4. **Routing** with pin: `routing.resolve` (async, DI-capable — the right home, NOT the pure
   `selectProviderModelCandidate`) receives resolvedCharacterKinds; after candidate selection it
   asserts `real_person ⇒ selected.provider === 'byteplus-modelark'` else typed
   `REAL_PERSON_REQUIRES_BYTEPLUS`. The pin is a post-selection assertion on server-resolved truth —
   unreachable by any client input shape.
5. **Freeze PRE-expansion bindings** (characterId entries) in `job.referenceSnapshot`; the expansion
   is stored separately as `expandedReferences` (audit). ⟦R⟧ retryJob therefore re-runs steps 1–4 on
   every retry: a revoked character fails retry; a real_person retry re-pins byteplus. (v1.0 froze
   the expansion — revoked likenesses would have been retryable forever.)
6. Write MediaAssetUsage rows role=`reference` for every referenced media.

### 3.3 Prompt compiler workstream ⟦R⟧ (was "reuse", review says it is not)

The current compiler is strictly 1 binding = 1 image = `[Image N]`, image-only, and forwards
bindings only when `referenceImages` exists in the schema. Character mentions need: multi-media
bindings (image|video|audio with per-kind positional counters matching Seedance's "Image N/Video N"
convention), one @CharacterName → an ordered token group over its expanded media, dedupe that
doesn't double-count the character binding vs its expansion, and forwarding gated on
`characterReferences OR referenceImages`. This is a scoped compiler rework inside P1 — planned as
its own reviewed change, not incidental.

### 3.4 Worker seam ⟦R⟧ (deadline semantics added)

Optional async adapter hook `prepareReferences(model, normalizedInput, ctx)` in worker.runJob before
startGeneration. The byteplus implementation re-validates every asset:// mirror row AND ⟦R⟧
re-reads character status (revoked → hard fail `CHARACTER_REVOKED`; mirror status alone is not the
revocation source of truth). Missing/expired mirror: because §3.2 step 2 pre-checked readiness at
submit, this is rare (revocation or upstream deletion mid-flight) — fail typed
`CHARACTER_ASSET_NOT_READY` and **release the billing hold**; do NOT open-endedly requeue
(re-registration has no SLA and the wallet hold + perSubjectQueued slot must not spin). Re-register
happens out-of-band via the sync queue; user retries when the character shows active again.

ProjectName invariant asserted at client construction.

### 3.5 Billing

Per-second generation billing unchanged in mechanism; ⟦R⟧ pricing correctness now guaranteed by
§3.2 ordering (expanded counts reach estimateQuotaCost). Character creation & enrollment free; slots
are the entitlement lever (§7). Provider output risk-control interception: default posture
bill-anyway (`RISK_CONTROL_BLOCKED`, anti-probing) — flips to release only if the AE confirms
upstream doesn't bill intercepted tasks; recorded in billingPolicy.

---

## 4. Studio UX (per apps/studio DESIGN.md)

- Library surface `app/[locale]/(studio)/characters/`: card grid with real states
  (uploading/processing/failed(face_mismatch)/active/revoked), two creation paths.
- Create → Virtual: name → multi-angle upload slots (doc's full-body + face-close-up guidance) →
  usable immediately (URL refs); provider mirror syncs in background.
- Create → My likeness: consent screen (versioned copy, §5.3 clauses) → adult gate → [CN: blocked
  v1] → session → in-page H5 (same authenticated session; no QR handoff in v1 ⟦R⟧) → "I've
  completed verification" → server pull → upload media (live face-match verdicts, leave-and-notify)
  → active.
- Canvas: character entry in reference-stack picker + character chip on cards; @mention via the
  reworked compiler contract. Composers get the same picker. ⟦R3/R5⟧ Picker defaults to the current
  project's cast (演员表); "add from library" opens the CURRENT workspace's library only — personal
  characters never appear in team context (import-as-copy is the bridge for virtual).
- Revoked characters tombstone in history; picker hides them.

---

## 5. Consent, moderation, takedown

### 5.1 Revocation ⟦R⟧ (TOCTOU + retention fixed)

On revoke (self or admin): ONE transaction sets character status=revoked AND flips all its
AiProviderAssetGroup/ExternalAsset rows to `disabled` (submit-time checks and prepareReferences both
see it immediately — async provider deletion is cleanup, not the barrier); appends
`revocation` record; cancels queued/running jobs whose resolved characters include it;
`ai:assets-critical` lane issues DeleteAsset/DeleteAssetGroup upstream. Residual window: a task the
provider already accepted cannot be aborted — documented, compensated by admin takedown on outputs.

⟦R⟧ Biometric retention: after a 30-day dispute window, real_person reference MediaAssets (face
bytes, consent-era uploads) are hard-deleted/crypto-shredded; the append-only ledger (hashes,
versions, timestamps, verdicts) is what we retain long-term. PIA (个人信息保护影响评估) before P2;
subject-count metric alarmed well below the 100k face-info filing threshold; access-audit on
real_person media reads.

### 5.2 The plain-URL reference path ⟦R⟧ (review blocker: consent theater)

The character gate is meaningless while arbitrary face photos can enter as plain `referenceImages`
URLs. v1 layered posture, shipped WITH P2 (not after):

- Reference-upload face detection: uploads to video-generation reference kinds run a face-detect
  scan (first real implementation of the `moderation_scan` MediaProcessingJob); detected human faces
  on consent-sensitive models are rejected with a pointer to the character flow (Jimeng posture).
  Detection-based and bypassable — stated honestly — but it raises the bar and pairs with:
- Upstream output risk-control (Seedance intercepts unregistered-likeness generations) + our
  moderation pipeline + subject report channel (§5.4).
- Virtual characters get the same honesty: "must not resemble a real person" is enforced by
  provider pre-filter + our photoreal-face review queue + attestation + reactive takedown — not by a
  classifier we pretend is reliable.

### 5.3 Consent copy (mandatory clauses, versioned)

Purpose ("generate videos containing your likeness on FizzDragon"), data categories (face images,
liveness session), provider transfer (BytePlus, ap-southeast-1, offshore), retention (active period

- 30-day post-revocation window; ledger indefinitely), self-only usage scope, withdrawal mechanics
  (revoke button → effects), output handling on revocation. Stored as consentVersion + full-text hash
  in the `consent_granted` record.

### 5.4 Compliance gates ⟦R⟧ (re-tiered by review)

- **P0 exit criterion is SHIPPED labeling, not a plan**: (a) our implicit metadata (GB 45438
  fields: our provider name/code + content ID) injected on character-model outputs; (b) prominent
  "AI 生成" explicit label on every .cn playback/detail surface; (c) EU AI Act Art.50
  machine-readable marking for .com before 2026-08-02 (verify with AE whether BytePlus's watermark
  already carries machine-readable provenance; if not, C2PA/IPTC injection in our output pipeline);
  (d) provider watermark=true forced for characterReferences models (mapper becomes policy-driven —
  today it hardcodes watermark:false).
- **HLS rendition takedown gap** (blocked master still streamable via rendition URLs — known
  followup) is promoted to P0 prerequisite: a 48h takedown SLA over a takedown that doesn't take
  down is worthless.
- **Subject report channel + 48h NCII removal**: P2 launch gate (was P3). Note: TAKE IT DOWN duties
  already bind .com today independent of this feature — the bare notice-and-removal channel is
  recommended platform work regardless.

---

## 6. Operations

### 6.1 ACR subscription lifecycle ⟦R⟧ (hardened)

- `BYTEPLUS_ACR_EXPIRES_AT` required config, fails loud; alerts at T-30d (renewal window) and T-7d
  (paging); **new enrollments hard-blocked at T-7d** (never enroll a user into a store about to be
  wiped); grace-window (expiry+0..15d) has an explicit user-facing state: banner + typed errors on
  attach/register while existing assets keep generating.
- Blast radius accepted & documented: expiry+15d (or an upstream account suspension, which has NO
  warning window) deletes all API-created assets — virtual mirrors rebuild automatically from
  MediaAsset (rate-planned: 1M assets at 120 QPM ≈ 5.8 days — priority lanes put active users
  first), real_person LivenessFace groups are UNRECOVERABLE without user re-verification (mass
  re-enrollment comms plan in the runbook). Single-account pooling risk is accepted for v1 and
  revisited if BytePlus offers sub-accounts.

### 6.2 Observability

Register/poll/delete lifecycle → providerTraceEvents timeline per character (AI Job Observability
bar); enrollment funnel events → PostHog; queue-lag + rate-bucket saturation metrics.

### 6.3 Rate limits (account-wide, enforced globally)

CreateVisualValidateSession 3 QPS and CreateAsset 120 QPM via Redis token bucket / BullMQ limiter —
NOT per-user cooldowns, NOT concurrency caps (concurrency bounds parallelism, not rate). Per-user
cooldowns kept as abuse hygiene only. (Precedent: 30 concurrent classroom users is a real load
shape on this platform.)

### 6.4 Rollout

Flags `CHARACTERS_ENABLED` / `CHARACTERS_REAL_PERSON_ENABLED`. PoC path: Basic tier (free) —
console-created real-person group + asset, hand-wired asset:// generation validates the loop before
the $14k/yr ACR purchase.

## 7. Entitlements

Existing rails (entitlementPolicy.requiredPlan + per-option gates): virtual slots per plan;
real_person paid-plans-only, 1 slot (+N on studio/enterprise) — final matrix is a product decision
enforced in the characters module quota check.

## 8. Phasing

- **P0 (prereqs)**: labeling SHIPPED per §5.4 (incl. EU Art.50 deadline 2026-08-02), HLS rendition
  takedown fix, reference MediaAssetUsage rows, `prepareReferences` seam, realtime event plumbing.
- **P1 Virtual characters**: library + prompt-compiler rework + canvas integration + provider
  mirrors + photoreal-face review queue.
- **P2 Real person (self, .com only)**: ACR purchase, assets client + sync service (dual-lane
  queues, token buckets), enrollment flow (consent ledger, adult gate, binding controls), routing
  pin + pricing ordering, plain-URL face-detect gate, subject report channel + 48h machinery, PIA.
- **P3**: third-party invites (Synthesia request-link pattern), .cn onshore path, public API
  exposure (HeyGen enterprise shape), IP Lifting.

## 9. Rejected alternatives (recorded)

- Self-built consent verification (superseded by hosted H5; we keep the evidence ledger)
- Pin enforcement inside pure `selectProviderModelCandidate` (can't see server truth; pin lives in
  routing.resolve as post-selection assertion) ⟦R⟧
- Freezing expanded references in referenceSnapshot (breaks revocation/pin on retry) ⟦R⟧
- Lazy provider registration at first-generation (worst-moment failure; eager + leave-and-notify)
- fal routing for real_person (consent bypass; hard-pinned)
- Provider-side storage as source of truth (expiry+15d deletion makes it a cache)
- Workspace-shared real_person characters in v1 (exceeds consented scope) ⟦R⟧
- Project-scoped characters (kills cross-project consistency, the core value) ⟦R2⟧
- A user-direct ownership plane / workspaceId=NULL special case (violates the Workspace→Project→Asset
  invariant; personal workspace already encodes "owner-only") ⟦R2⟧
- Cross-workspace cast-as-grant bridge (v1.1 R4) — superseded by R5: personal assets do not exist
  inside team workspaces; import-as-copy for virtual, enrollment-into-team for real_person (P3) ⟦R5⟧
- Owner-uses-own-likeness-in-team-projects with billing/authz decoupling — superseded by R5's
  single-workspace rule; team likeness use is P3 team enrollment, consent scoped to the workspace ⟦R5⟧
- Skip pre-filter for throughput
- One merged "Portrait" table (couples independently-changing lifecycles)
- QR/mobile-handoff enrollment in v1 (breaks the only owner-binding control we have) ⟦R⟧

## 10. Residual risks (accepted, documented)

- **R1** Self-only is bound by procedure (same-session completion + consent copy + CN identity
  cross-check), not biometrics. Compensating: watermark, report channel, admin takedown.
- **R2** Intl adult gate is attestation-based unless the liveness vendor exposes an age signal.
- **R3** Provider-accepted in-flight tasks survive revocation by up to one generation duration.
- **R4** Face-detect gates on plain uploads and photoreal-virtual review are detection-based and
  bypassable; layered with upstream risk-control and reactive takedown.
- **R5** Single pooled ModelArk account: upstream suspension = platform-wide likeness outage.

## 11. Review log (v1.0 → v1.1)

4-lens adversarial review (repo-reality / security-abuse / compliance / ops-failure, 2026-07-02):
7 blockers + 12 majors confirmed and incorporated. Headlines: routing pin moved to routing.resolve
with pre-routing character resolution (pin was unimplementable where v1.0 put it, and pricing
under-billed); referenceSnapshot now freezes pre-expansion bindings (retry re-validates consent);
enrollment hardened (no client tokens, pull-only completion, same-session binding, adult gate);
real_person never workspace-shared; plain-URL face path gated at P2 (was deferred = consent
theater); labeling/HLS-takedown/NCII-channel re-tiered into P0/P2 gates; biometric media
crypto-shredded post-revocation; ops hardened (token-bucket rate limits, dual-lane queues, expiry
config fails-loud, enrollment leave-and-notify, providerResponse redaction).

⟦R2⟧ Ownership revision (same day): characters are workspace-owned per the repo's
Workspace→Project→Asset invariant — virtual in the creating workspace, real_person always in the
enrollee's personal workspace (replacing v1.1's workspaceId=NULL special case).

⟦R3⟧ Ownership vs visibility split: workspace library (演员池) vs per-project cast (演员表);
CharacterProjectCast table.

⟦R5⟧ Team-workspace principle (supersedes R4's cross-workspace grants, and R2's billing/authz
decoupling): inside a team workspace there are no personal assets — only attribution
(createdByUserId, audit posture identical to MediaAsset). Authorization collapses to
home-workspace membership with job workspace === character workspace; personal virtual reaches a
team via import-as-copy; real_person v1 is personal-workspace-only, team likeness arrives in P3 as
subject-enrolls-into-team via ModelArk's native QR-invitation flow (consent scoped to the
enrolling workspace). ownerUserId renamed createdByUserId + subjectUserId added.

⟦Shipped⟧ v1 implementation shipped (2026-07-02): the virtual-only closed loop is live
(library CRUD + media → project cast → composer attach → server-side expansion → billing).
Deviations from this doc as written: (1) reused the existing `ai_reference_*` upload kinds
instead of introducing new `character_*` kinds — same constraints, one policy row set;
(2) resolveJobContext now treats `x-fizz-workspace-id` as UI scope whenever an explicit
project/document context is pinned (review blocker fix); (3) expansion is schema-aware —
character media are filtered by the target field's kind and truncated to its `maxItems`,
with an audit record of what was dropped.

## 12. Open items

1. AE: does BytePlus watermark carry machine-readable provenance (EU Art.50 reliance)? Output
   risk-control billing semantics? Sub-account / quota isolation options?
2. 火山方舟 onshore equivalence for .cn (hard precondition for .cn P2).
3. Java KYC bridge is-adult flag feasibility (CN adult gate).
4. Voice scope wording in consent copy (Seedance reference_audio reproduces voices).
