# Studio Canvas → Collaborative Multi-Mode Platform — Architecture

Status: design (no-compromise target), 2026-06-13
Scope: `apps/studio` (canvas), `apps/web` (script/storyboard/timeline modes), `apps/server` (documents platform + realtime), `apps/admin-ui`
Benchmarks: **imagine.art** (Workflows node-graph) and **Higgsfield** (live multiplayer + reference Elements)
Method: 8-agent research+recon workflow (imagine.art / Higgsfield / CRDT-canvas engineering + recon of documents platform, studio canvas, web modes) → synthesis → adversarial critique. This doc folds the critique's corrections in as the authoritative plan.

---

## 1. North Star

**One `PlatformProject` is the durable creative entity. Each editing surface is a `PlatformDocument` of a `type` — `canvas` (React Flow AI node-graph), `storyboard`, `timeline`, `script`, `brief` — all living side-by-side under the same project, workspace, permissions, wallet.**

Every collaborative document is a **Yjs CRDT**: the binary `crdtState` (compacted snapshot) + `PlatformDocumentOperation.yjsUpdate` (op-log) are the **single source of truth**; `contentSnapshot` (JSON) is a **server-materialized, read-only projection** (for AI, SSR, non-collab reads, the Java bridge) — **never a write path**.

The existing NestJS documents WS gateway becomes a **real Yjs sync backend** (warm-room apply + materialize + Redis fan-out + snapshot/op-log persistence) — we **build on what we own**, we do **not** rent y-websocket / Hocuspocus / Liveblocks / PartyKit.

The bar: match Higgsfield's live multiplayer + per-node comments + version history and imagine.art's typed-handle node graph + Quick/Workflow toggle + Iterator/Storyboard pipelines — and **beat both** with a genuinely unified project=entity / document=mode model and fal-grade per-job observability.

---

## 2. Current state (verified by recon)

- **Studio canvas = 100% browser-local IndexedDB** (`apps/studio/lib/canvas-store.ts`: `fizzstudio-canvas` DB, `projects` + `images` stores). No server persistence. Lost on cache-clear / device switch; not account-scoped.
- **Web modes (剧本/分镜/时间线) persist to the OLD Java backend** (shot/shotColumn/shotValue/episode), not the documents platform.
- **Documents platform exists and is well-shaped** (`PlatformProject → PlatformDocument` + versions/operations/presence/comments/assets; WS gateway with `pg_advisory_xact_lock` per doc, monotonic `currentSequence`, `idempotencyKey` dedup, Redis `document:events:<id>` fan-out, `yjs_update` DTO + `materializedContent`). The schema/gateway already implement the snapshot+oplog+fan-out+auth that the managed providers sell.
- **`PlatformDocumentType` enum lacks `canvas`** (has brief/script/storyboard/shot_plan/timeline/asset_board/course_outline/gig_requirement).
- ⚠️ **`crdtState` write is subtly broken**: `appendOperation` writes `crdtState = <latest single update>`, not the merged doc — a new client loading the snapshot gets one op, not the document. Must be fixed before Phase 1.
- ⚠️ **Only realtime provider is Azure Web PubSub** (`realtime.module.ts` hardwires `useExisting: WebPubSubService`; no-ops without the Azure connection string); studio client imports `@azure/web-pubsub-client` directly for `ai_job_update`. **CN has no realtime transport today.**
- ⚠️ **`@xyflow/react` is NOT declared in `apps/studio/package.json`** (resolved via monorepo hoisting from apps/web) — a phantom dependency.
- ⚠️ **Zero tests** for the document service / gateway.

---

## 3. Data model

All on existing `platform_*` tables; **no new core entities** for the canvas.

1. **One required migration**: add `canvas` to `PlatformDocumentType` via a **minimal hand-written** `ALTER TYPE "PlatformDocumentType" ADD VALUE IF NOT EXISTS 'canvas';` (NOT `prisma migrate dev` — it drift-spews on this schema). All needed columns (`crdtState` Bytes, `yjsUpdate` Bytes, `contentSnapshot` Json, `currentSequence`, `collaborationRoomId`, `version`) already exist.
2. **Source-of-truth inversion** (the bold part): `crdtState` + op-log are truth; `contentSnapshot` is a derived projection recomputed by the warm-room after each applied update and written via the same `appendOperation(materializedContent)`. Nothing rehydrates a Y.Doc from JSON.
3. **Canvas `contentSnapshot` schema** (= the AI/Java-bridge contract): `{ schemaVersion, mode:"canvas", nodes: CanvasNodeJSON[], edges: CanvasEdgeJSON[], sections?: SectionJSON[] }`; media is **always a `{ mediaAssetId, url }` ref, never base64** (honors the Media Access Policy + MediaAsset-as-ledger). Maps 1:1 onto today's `StoredCanvasNode/Edge`.
4. **`ProjectAsset` becomes server-authoritative** (replaces studio's IndexedDB asset library + `images` blob store). Generated outputs (already carry `mediaAssetId`) and SAS-confirmed uploads land as `ProjectAsset` rows; canvas references by `mediaAssetId`.
5. **Close the AiJob linkage**: submit must carry `documentId` (canvas doc) + `documentBlockId` (node.id) + `projectId` (relations already exist; today they're omitted → server 404s on validation). Enables entitlement/quota/wallet gating, per-project/per-node job history, and routing `ai_job_update` to the right room.
6. **Phase 4+ optional columns**: `PlatformDocument.snapshotSequence Int` (the sequence `crdtState` covers → clients load snapshot then only ops `> snapshotSequence`) — **bring this forward to Phase 0** (see §6), `lastCompactedAt`, optional `thumbnailAssetId`.

---

## 4. CRDT canvas design (Yjs + React Flow)

- **One Y.Doc per `PlatformDocument`** (room key = `collaborationRoomId`): `nodes` (Y.Map by id), `edges` (Y.Map by id), `sections` (Y.Map), `meta` (Y.Map). Each node value is a **nested Y.Map** (`position` register + `data` nested map) so concurrent edits to position vs. caption **merge** instead of clobber; prose fields that need char-level merge get a `Y.Text`.
- **React Flow controlled-mode binding** (the official collaborative + Synergy Codes pattern): `setNodes/setEdges` are called **only** from the Yjs `observeDeep` observer; React Flow change handlers **only** write to Yjs (single write path kills feedback loops). One gesture = one `ydoc.transact(…, LOCAL_ORIGIN)` = one op = one sequence = one Redis publish. Position-while-dragging is **ephemeral (awareness ghost)**, committed to the map only on drop. select/dimensions = local React state, never the doc.
- **Echo suppression** (3 layers): origin-tagged updates (`origin !== 'remote'` → send), observer-only setState, local-UI-field merge at render. Peer ops applied with `Y.applyUpdate(doc, bytes, 'remote')`.
- **Undo**: `Y.UndoManager([nodes,edges,sections], { trackedOrigins:{LOCAL_ORIGIN} })` → Ctrl+Z undoes only this user's edits; 500ms capture grouping; viewport restored from stackItem.meta.
- **Presence/awareness**: Yjs Awareness (cursor xy, selection, ghost-drag, name/color) relayed as a separate **ephemeral** WS frame, never persisted. `PlatformDocumentPresence` stays as the coarse room roster (TTL ~45s).
- **Image-as-ref** (designed-out pitfall): node.data = `{ mediaAssetId, url }` only — keeps crdtState/ops/peer-RAM/snapshots small.
- **Materialization + server authority**: warm Y.Doc per active room; on each `yjs_update` → apply → recompute `contentSnapshot` → persist; debounced `crdtState` compaction (`Y.encodeStateAsUpdate`/`mergeUpdates`) + `snapshotSequence`. Server authority lives at the **edge** (auth, sequence ordering, idempotency, fan-out) — it does **not** transform opaque binary diffs; field-level validation (moderation/quota) runs on the materialized JSON. `baseSequence` check is correctly skipped for `yjs_update` (CRDT is commutative). Offline = `y-indexeddb` + reconnect `afterSequence=<lastAcked>` replay.

---

## 5. Collaboration backend — BUILD on the gateway, don't buy

**Decision: extend the existing NestJS documents WS gateway into a real Yjs backend. Do NOT adopt y-websocket / Hocuspocus / Liveblocks / PartyKit / Ably.** Renting any of them bypasses satoken auth, the audit log, Redis fan-out, sequence/idempotency invariants, and Postgres-of-record — all of which the gateway already owns. (See §9 for the Ably question in full.)

**Keep**: `/ws/documents?documentId&afterSequence&limit`; on-connect `document_snapshot` + `operations_sync` + `presence_state`; `appendOperation` (advisory lock, monotonic sequence, idempotency dedup, `yjs_update` DTO, `materializedContent`); Redis pub/sub with origin echo-suppression; heartbeat/zombie detection.

**Add**:

1. Install **pinned** `yjs` + `y-protocols` in apps/server (exact versions matched across studio/web/server bundles — drift mis-decodes updates).
2. **Warm-room manager**: `Map<documentId, {ydoc, lastTouched}>`; lazy-load from `crdtState`, apply each update, evict idle, cap per-process rooms.
3. On each `yjs_update`: apply → recompute `contentSnapshot` → persist → debounced `crdtState` compaction + `snapshotSequence` + prune superseded op rows (keep `PlatformDocumentVersion` checkpoints).
4. **Awareness channel**: ephemeral `awareness` WS frame + Redis subchannel; never persisted.
5. **Differential first-load** (optimization): client sends `Y.encodeStateVector`, server replies `Y.encodeStateAsUpdate(doc, vector)`.
6. Validation at the edge + on materialized JSON; never on binary diffs.

---

## 6. ⚠️ Must-fix before/within Phase 0 (from the critique — these are load-bearing)

These were found to be **unbuilt or buggy but treated as ready**. They are prerequisites, not polish:

1. **Warm-room must be the SOLE `crdtState` writer.** Remove the per-op `crdtState = <raw update>` write in `appendOperation` (it corrupts the snapshot invariant today). The warm-room writes `crdtState = Y.encodeStateAsUpdate(doc)` on debounce. **Add `snapshotSequence` in Phase 0** (not Phase 4) or first-load is O(all ops).
2. **Decouple DB-write from fan-out.** Today every op = a full PG transaction under a per-doc advisory lock → DB write amplification (the OTPM-at-60-users house failure mode). Warm-room is the in-memory serialization point: fan out to peers over Redis **immediately** (sub-100ms), assign sequence in-memory, persist op rows **async/batched** under the lock. Accept a bounded durability window recoverable from client `y-indexeddb` + replay.
3. **ONE realtime transport per region** (the single weakest part of the raw design). Today there are TWO planes: the region-portable WS gateway (collab) and **Azure-only Web PubSub** (`ai_job_update`, hardwired, studio imports the Azure client SDK directly). **CN has no realtime at all.** Fix: make the WS gateway the **canonical** plane for BOTH collab and job updates (job updates become just another frame), make the **client transport pluggable** (stop importing `@azure/web-pubsub-client` directly), and **build a real CN realtime provider** behind `REALTIME_PROVIDER`. Without this, Phase 2 multiplayer works only on .com.
4. **Pre-broadcast moderation gate for NEW media refs** (CN compliance). A new `mediaAssetId` in a `yjs_update` resolves to a public URL on every peer before server materialization/moderation — a regulatory liability in CN, not an edge case. Gate public-URL resolution of a newly-seen asset behind moderation status (cheap — media is ref-only).
5. **Reconcile offline + compaction + per-user-undo.** Never prune op rows below the oldest live client's acked sequence, OR guarantee `crdtState` can full-rehydrate any client whose `afterSequence < snapshotSequence` (implement + test the forced full-resync). Don't run `gc:true` if undo depth must survive compaction — pick a bounded undo window.
6. **Declare + pin `@xyflow/react` in `apps/studio/package.json`** (phantom hoisted dep) before anything builds.
7. **Integration test harness for the op-log/merge/compaction/reconnect path is a Phase 0 deliverable**, not a smoke script. This is the core of the inversion; it's at zero coverage in a codebase with a history of silent data-loss bugs.

---

## 6b. Phase 0 — implementation status & the one deliberate refinement (2026-06-13)

**Shipped (server only, no UX change):**

- `document-crdt.ts` — pure, I/O-free CRDT core: `DocumentStateBuilder` (memory-bounded incremental fold) + `mergeDocumentState`/`materializeSnapshot`. The single source of truth for merge + materialization.
- `document-modes.ts` — per-mode **root-type schema registry** (`rootSchemaFor`). A Y.Doc hydrated purely from binary keeps _abstract_ root types and `toJSON()` renders nothing; the server must declare each mode's roots (`canvas` → `meta`/`nodes`/`edges` maps) to materialize. Only registered modes are CRDT-backed/compactable. Promote to `@repo/shared` when the client lands so client/server can't drift.
- `document-compaction.service.ts` — `DocumentCompactionService`: the **sole writer** of `crdtState` + the derived `contentSnapshot` for CRDT docs. Fixes must-fix #1.
- `appendOperation` refactor — **op-model aware**: `patch`/`snapshot` (non-CRDT, e.g. storyboard) keep the inline client-materialized write; `yjs_update` writes neither `contentSnapshot` nor `crdtState` on the hot path and instead schedules compaction. The broken per-op `crdtState = <single update>` write is gone. `baseSequence` conflict check correctly skipped for CRDT.
- Schema: `canvas` enum + `snapshotSequence`/`lastCompactedAt` columns (2 hand-written idempotent migrations). DTO now exposes `snapshotSequence`, `lastCompactedAt`, and (detail-only) `crdtStateBase64` for client bootstrap.
- Deps pinned (single hoisted versions): server `yjs`/`y-protocols`; studio `@xyflow/react` (fixes #6) + `yjs`/`y-protocols`/`y-indexeddb`.
- Tests (fixes #7): `document-crdt.spec.ts` (merge, **compaction loss-free at every split point**, idempotency, commutativity, concurrent-edit survival, batched-builder equivalence) + `document-compaction.service.spec.ts` (full/partial/coalesced/no-op/superseded/deleted paths). 15 tests; full server suite 99/99 green; eslint + tsc clean.

**The refinement to must-fix #2 (`decouple DB-write from fan-out`):** the original sketch put a **live per-room Y.Doc** in memory as the in-process serialization point that assigns sequence in-memory and persists async. That is correct **only with sticky routing or per-doc leader election** — our server runs N pods behind Redis fan-out with **no sticky routing**, so a live per-pod Y.Doc would diverge and double-assign sequences. Phase 0 therefore makes the design **DB-authoritative**: sequence is still assigned under the brief per-doc advisory lock (now a _tiny_ txn — the expensive `crdtState`/`contentSnapshot` writes are removed from it), Redis fan-out is unchanged/immediate, and compaction **rebuilds from persisted rows** off the hot path. The persist is a **monotonic guarded update** (`WHERE snapshot_sequence < target`) so concurrent compactors across pods can only move forward — multi-pod-safe with **no sticky routing, no leader election, no in-memory drift**. The fully-async in-memory write-behind (and a live server doc for server-authored / AI co-editing) is deferred to the phase that needs sticky-routed rooms — it is a later capability, not a Phase-0 compromise. Compaction triggers: debounce (`DOCUMENT_COMPACTION_DEBOUNCE_MS=1500`) + hard cap (`…MAX_INTERVAL_MS=15000`), batched (`…BATCH_SIZE`, `…MAX_OPS_PER_RUN` with partial-run draining), bounded error retry, shutdown flush. These are tuning knobs (sensible defaults are correct); no required-secret has a silent default.

**Still open in Phase 0 before Phase 1:** must-fix #3 (one realtime transport per region + pluggable client + CN provider — see §6c), #4 (pre-broadcast moderation gate), #5 (offline + compaction + undo reconciliation — op-row pruning is intentionally NOT yet implemented, so no data-loss risk; design the forced full-resync before enabling prune).

---

## 6c. Awareness frame — SHIPPED (2026-06-13) + #3 plan

**Awareness (the must-fix gateway awareness frame) is done** — the ephemeral plane for Figma-style **live cursors** + the **active-user avatar group**:

- `document-awareness.ts` — `DocumentAwarenessRegistry`: one server-side `y-protocols/awareness` instance per active document per pod (server holds NO state of its own; it relays + caches). Tracks which awareness client-ids a socket controls so a disconnect clears its cursor instantly; multi-pod via Redis fan-out.
- Gateway: inbound `awareness` frame (base64 y-protocols update) → apply (for bootstrap + controlled-id tracking) → relay over Redis (echo-suppressed). New connections get `awareness_state` (current cursors) + emit `awareness_request` so peers on any pod re-announce. Disconnect fans an instant removal. Nothing persisted.
- 7 tests (apply/bootstrap/controlled-id tracking/instant-removal/ref-count destroy/multi-client). The visual rendering (cursor SVG + avatar stack) is pure client wiring in Phase 1 on the standard `Awareness` API.

**#3 — realtime transport: server plane SHIPPED (2026-06-13).** Recon finding: the COLLAB plane (this WS gateway) is already region-portable (runs on AKS _and_ Alibaba), so awareness/cursors already work in CN. The Azure-only plane was the **AI job-update** push, and **CN dropped job updates silently** (`values.cn-prod.yaml` has no Web PubSub connection string → no-op). The `RealtimeProvider` interface + outbox abstraction already existed. Shipped:

1. `realtime-transport-token.ts` — HMAC-SHA256 signer/verifier (`REALTIME_WS_SECRET` — REQUIRED, fails loud, no default). 5 tests.
2. `self-hosted-realtime.service.ts` — `RealtimeProvider` impl; negotiate mints a signed token for `/ws/realtime`; `publishAssetEvent`/`publishEntityToUser` fan out via Redis (`realtime:group:*`), group names/payloads byte-identical to WebPubSubService.
3. `realtime.gateway.ts` — `/ws/realtime`, token-auth (trusts signed groups), Redis pattern-sub fan-out, heartbeat/zombie, **dormant unless `REALTIME_TRANSPORT=self-hosted`**.
4. `realtime.module.ts` — factory selecting by `REALTIME_TRANSPORT` (`web-pubsub` default | `self-hosted`); throws at boot if self-hosted without the secret. `RealtimeClientAccess.transport` discriminator added so clients pick the adapter.
5. Client: all 3 `assets-realtime.ts` copies (studio canvas, web fizzstudio, web art-studio) are transport-pluggable (native WS for self-hosted with reconnect/keepalive, lazy-imported Azure SDK otherwise) — per the web app's sanctioned feature-private-duplication convention. All typecheck + lint clean.
6. Helm: `server.env.REALTIME_TRANSPORT=self-hosted` + `REALTIME_WS_SECRET` in `serverSecrets`, in **both** `values.yaml` (.com, KV-projected) and `values.cn-prod.yaml` (CN, out-of-band). `helm template` renders clean for both; `/aurora/ws/realtime` rides the existing `/aurora/*` ingress (nginx upgrades WS automatically).

**#3 is complete + UNIFIED (2026-06-13): self-hosted realtime on ALL cells.** Per user decision, .com is flipped off Azure Web PubSub too — there is no longer any CN/COM transport split (collab was always self-hosted; asset/job pushes now are as well). The readiness probe is transport-aware (`realtime` check validates `REALTIME_WS_SECRET` when self-hosted, else the WP connection string). The Azure `WebPubSubService` provider stays registered for instant rollback (`REALTIME_TRANSPORT=web-pubsub`).

**Deploy prerequisites (fail-closed by design):** create `realtime-ws-secret` in the .com **Key Vault**, and ensure it's in CN's out-of-band `fizzdragon-server-secrets`, BEFORE deploying — the CSI projection fails / readiness 503s if absent.

**Follow-up (after .com validation under load):** drop the `@azure/web-pubsub` server dependency + `WebPubSubService` + the `realtime-conn-string` KV entry + the Azure Web PubSub resource (cost). Held until the self-hosted plane is validated on .com. Scaling notes: WS is sticky/long-lived, so use a KEDA connection-count scaler (KEDA already in use) + graceful `preStop` drain rather than CPU HPA; Redis pattern pub/sub fan-out grows with pod count (sharded pub/sub `SPUBLISH` is the lever at very high scale) — both are far above current load.

---

## 6d. #5 (offline/compaction/undo) SHIPPED + #4 (moderation gate) mechanism SHIPPED (2026-06-13)

**#5 — reconcile offline + compaction + undo:**

- `document-sync.ts` `resolveSyncWindow(afterSequence, snapshotSequence)` — when a (re)connecting client is behind the compaction horizon, lift the replay floor to `snapshotSequence` and flag `resyncRequired` so it rebuilds from `crdtState` (carried in the detail DTO) instead of from op rows that may be gone. This is the safety guarantee that makes pruning sound.
- Service: `getOperationSyncWindow` (shared by initial connect + `sync_request`); `getSyncState` returns `resync`. Gateway `operations_sync` now carries `resync` + the lifted floor.
- Compaction: **bounded, opt-in op-row pruning** — `DOCUMENT_OP_PRUNE_ENABLED` (default OFF) + `DOCUMENT_OP_PRUNE_RETENTION` (default 10000). Prunes only ops fully subsumed by `crdtState`, keeping a retention margin; the forced-resync covers any client that falls behind. Default OFF per the "resync-before-prune" sequencing — enabling is a deliberate ops decision.
- Undo/gc: `DocumentStateBuilder` uses an explicit `gc:true` doc (collapses deletions in the bootstrap state, merges concurrently correctly); per-user undo is session-local on each client (does not survive reconnect), so server gc never truncates undo. Verified by a delete-survives-compaction test.
- Tests: `document-sync.spec.ts` + gc + prune cases. All green.

**#4 — pre-broadcast moderation gate (mechanism shipped; CN enablement is a product decision):**

- `media-moderation-policy.ts` — `requireModerationApproval()` (env, default OFF) + `isPeerViewable(status, isOwner, requireApproval)`: a non-owner ("peer") may view an asset only once moderation APPROVES it; the owner always sees their own pending asset; `blocked` is withheld from all (unchanged).
- Wired into `MediaAccessService.issueBrowserAccessUrl` (the `/aurora/media/assets/:id/content` path canvas/storyboard peers resolve through) — owner-aware, `ForbiddenException(MEDIA_ASSET_PENDING_MODERATION)` for gated peers. Admin evidence access is unaffected. Default OFF → no regression. Tests added (policy unit + access integration).
- **CN decision (2026-06-13): keep the gate OFF for now, revisit later.** Enabling `MEDIA_REQUIRE_MODERATION_APPROVAL=true` on CN would make peers never see shared media because CN runs `DISABLE_CONTENT_MODERATION=true` (nothing moves assets `unreviewed → approved`). Per user decision the mechanism stays default-OFF everywhere (no helm change); flip it on CN only once a real approval/review workflow exists (Java moderation hook / automated check / manual queue). Mechanism is built + tested and ready to enable.

---

## 6e. Phase 1 — canvas client wiring (in progress, 2026-06-13)

Sub-sequenced so each unit is independently verifiable and the existing (IndexedDB) canvas keeps working until the swap:

**Sub-unit 1 — collab client foundation: SHIPPED + verified (studio tsc + lint clean).**

- Server: generic mode-ensure route `POST /projects/:projectId/documents/:type/ensure` → `ensurePrimaryDocument` (the studio can now bootstrap a `canvas` document; previously only `storyboard` was exposed). Server suite still 128 green.
- `apps/studio/lib/collab/protocol.ts` — the gateway's JSON frame contract (server uses a product protocol, NOT raw y-websocket), base64 codec, `CANVAS_ROOT_SCHEMA` (must match server `rootSchemaFor('canvas')`), `declareRoots`.
- `apps/studio/lib/collab/document-provider.ts` — a custom Yjs provider: Y.Doc + y-indexeddb offline cache; connects to `/aurora/ws/documents` (same-origin cookie auth); bootstraps from `crdtState` + replays the op tail honoring the `resync` horizon; streams local edits as `yjs_update` ops; on every (re)connect pushes the **state-vector delta** of anything the server lacks (so offline edits reconcile); awareness (cursors + identity); ping keepalive + backoff reconnect. REMOTE-origin tagging prevents echo loops; idb-origin loads are synced via the delta, not re-sent.
- `apps/studio/lib/collab/use-canvas-doc.ts` — React lifecycle hook (create on documentId, destroy on unmount, live-update awareness identity without reconnecting).
- Studio has no jest; correctness of the shared CRDT primitives is covered by the server-side `document-crdt`/compaction specs. Real validation is integration (Phase-1 end-to-end).

**Sub-unit 2 (pure layer) — canvas-graph Yjs schema/conversion: SHIPPED (tsc + lint clean).**

- `apps/studio/lib/collab/canvas-doc.ts` — the Y.Doc canvas-graph schema + pure conversion: nodes/edges as Y.Maps keyed by id; node `position` is a nested Y.Map (concurrent drags merge) and `data` is a Y.Map (field-level merge: prompt vs settings); read/write/patch/seed helpers. No React/browser → verifiable in isolation.

**Adversarial review (2026-06-13):** the collab layer (provider + canvas-doc + protocol + hook) was reviewed by 3 skeptics (WS sync correctness / protocol-conversion match / Yjs semantics), each finding verified by an independent skeptic (11 false alarms dismissed). **4 confirmed bugs fixed:**

- **CRITICAL** — `pushLocalDelta` reconstructed the server state vector from a _partial_ op tail on reconnect; with no `crdtState` (uncompacted doc) it diffed against ~empty and re-uploaded the ENTIRE doc every reconnect (echo storm + unbounded op-log growth). Fix: the delta runs **only on first sync** (where the full server base IS reconstructable); reconnects flush a **queue of edits made while disconnected** instead — so an idle client sends zero ops on reconnect.
- **HIGH** (same root cause) — repeated full-doc re-sends with fresh clientMutationIds and no dedupe → duplicate op rows. Resolved by the first-sync gate.
- **MEDIUM** — awareness clock didn't advance across reconnect, so a peer/server holding the stale entry ignored the rejoin (cursor silently vanished). Fix: re-set local state to bump the clock before re-announcing.
- **MEDIUM** — `useCanvasDoc` reported a stale live status when documentId went null. Fix: derive `status` from provider presence. (Also hardened: honor `operations_sync.afterSequence` as the authoritative resume floor.)

**Sub-unit 2b (binding hook) — SHIPPED + reviewed (tsc + lint clean).**

- `apps/studio/lib/collab/use-canvas-graph.ts` — binds the canvas Y.Doc to React Flow's controlled model. Y.Doc = source of truth for committed state; three local overlays hold ephemeral UI state (selection, in-flight drag, measured dims). All writes under LOCAL_ORIGIN (streamed by the provider; tracked by UndoManager). Stable-ref cache → a remote edit re-renders only the changed node. API: nodes/edges, onNodesChange/onEdgesChange, addNode/addEdge/patchNodeData/removeNode/removeEdge, undo/redo.
- **Adversarial review (3 lenses + verify; 10 false alarms dismissed) → 9 confirmed, fixed:** measured dims now persisted to the doc (else RF can't init handle bounds → edges don't anchor on load — HIGH); cache signature is now a deterministic, lossless `stableSig` (sorted keys + undefined/non-finite encoded → no churn / no stale hits — HIGH); no-op drag-end commits skipped (avoids clobbering a concurrent remote move — HIGH); `add`/`replace` change variants handled (no silent drops); local commits no longer double-rebuild (observeDeep handles them; manual rebuild only for overlay-only batches); `addEdge` upserts by id (reconnect) + dedups parallel edges. Deferred (noted): event-driven per-id invalidation for very large canvases (perf), and an awareness drag-lock for same-node concurrent drags (currently LWW).

**Sub-unit 2c (resolution + context layer) — SHIPPED (tsc + lint clean). The full collab client foundation is now complete (8 modules in `apps/studio/lib/collab/`):**

- `projects-api.ts` — typed `/aurora/*` resolution: `ensurePersonalWorkspace`, `listProjects`, `createProject`, `getProject`, `ensureCanvasDocument` (exact server shapes verified against the controllers/DTOs).
- `use-canvas-document.ts` — `useCanvasDocument(projectId)` resolves a route projectId → its canvas document (idempotent ensure) → `documentId` for `useCanvasDoc`.
- `canvas-graph-context.tsx` — `CanvasGraphProvider`/`useCanvasGraphContext` so deep node components write through the Y.Doc (not RF's local store) without importing canvas-view.
- `use-canvas-graph.ts` — `patchNodeData` now also accepts a function updater (matches RF's `updateNodeData`, used by reference-binding sites).

**Sub-unit 2c (canvas-view surgery) — SHIPPED (6 files, tsc 0 + lint clean):**

- `canvas-view.tsx` — state layer is now `useCanvasDocument(projectId)` → `useCanvasDoc(documentId, user)` → `useCanvasGraph(doc)`; load/save effects deleted (the doc is the state); wrapped in `CanvasGraphProvider`; title lives in the Y.Doc `meta` map (live rename); fit-once-on-first-sync; a real error state when doc resolution fails; awareness identity derived from `useAuth()` (deterministic per-user cursor color).
- `note-node.tsx`, `generation-card.tsx` — `useReactFlow().updateNodeData` → `useCanvasGraphContext().patchNodeData` (function-form supported).
- `use-canvas-generation.tsx` — `patch`/moderation-cleanup/panorama-conversion `setNodes`/`setEdges` → graph mutators (collect-then-mutate); asset-library writes stay local (sub-unit 4).
- `use-panorama.ts` — `useReactFlow().addNodes/addEdges` → graph.
- Upload: `putImage` (local blob) → `uploadFileViaSignedUrl` (`ai_reference_image` → mediaAssetId + server URL) so peers resolve images; no `blob:` ever enters the doc.

**Sub-unit 4 (project list → server) — SHIPPED (tsc 0 + lint clean). The canvas is now wired END-TO-END:**

- `lib/api.ts` — added `patch`/`delete` methods.
- `projects-api.ts` — added `renameProject` (PATCH) + `deleteProject` (DELETE archive).
- `app/(studio)/canvas/_components/projects-grid.tsx` — the `/canvas` index now `ensurePersonalWorkspace` → `listProjects(ws)` / `createProject(ws, {name})` / `renameProject` / `deleteProject`; route ids are real server PlatformProjects, so `/canvas/:id` resolves its canvas document. (canvas-store's project-CRUD functions are now dead — local asset-library functions still used; cleanup when the asset library also moves server-side.)

**Flow now live (code-complete, pending browser validation):** `/canvas` → sign-in → create → server project → `/canvas/:id` → ensure canvas doc → Y.Doc over `/aurora/ws/documents` → collaborative edit (drag/add/connect/text/generation), autosaved server-side + offline-cached, multi-tab/multi-user sync.

**Sub-unit 3 (presence UI) — SHIPPED (tsc 0 + lint clean):**

- `lib/collab/use-awareness.ts` — `useAwarenessPeers(awareness, localClientId)` subscribes to the awareness `change` event → remote peers' `{ user, cursor }`.
- `app/canvas/_components/collab-presence.tsx` — `CollabCursors` (Figma-style cursors via `ViewportPortal`, so they pan/zoom in flow coordinates; per-user color = sanctioned functional exception) + `CollabAvatars` (top-right active-user stack, deduped by user id, +N overflow).
- `canvas-view.tsx` — throttled (≈45ms) pointer-move broadcasts the local cursor in flow coords to `awareness.cursor`; pointer-leave clears it; cursors render inside `<ReactFlow>`, avatars beside the credits badge.

**Phase 1 is functionally complete (code-level, all tsc + lint clean, nothing committed):** server-backed collaborative canvas — project resolution, Y.Doc graph binding, offline cache + reconnect delta, autosave/compaction, live cursors + avatar group. Local dev verified to open a canvas (after applying the two migrations to localhost:5433). Deploy follow-up: apply the `canvas` enum + `snapshot_sequence` migrations to staging/prod DBs (user-operated). Optional polish: awareness drag-lock for same-node concurrent drags; event-driven per-id rebuild for very large canvases.

---

## 6f. Phase 2 — per-node comments (real-time): SHIPPED (2026-06-14)

The user's Phase-2 pick. Figma-style per-node comments, real-time:

- Server: a generic `app_event` WS relay on `DocumentsGateway` — an opaque ephemeral signal, echo-suppressed + Redis fan-out (reusable; comments use it as a "comments changed → refetch" nudge). No persistence, no new tables (the comment tables predate this work → no migration).
- `lib/collab/document-provider.ts` — `broadcastAppEvent` / `onAppEvent`.
- `lib/collab/comments-api.ts` + `use-comments.ts` — REST over the existing comment routes (`/aurora/documents/:id/comments…`); fetch on open, refetch on a peer signal, nudge peers after this client mutates.
- `app/canvas/_components/canvas-comments.tsx` — on-canvas pins via `ViewportPortal` (a count pin per node with an open thread, plus a `+comment` pin on the selected node) opening a thread panel (conversation + reply + resolve). One ongoing thread per node in the UI.
- tsc + lint clean; server 128 tests + build green. Follow-ups: author shows "You"/"Teammate" (name resolution via `/aurora/users/by-ids` later); resolved threads are hidden (no "show resolved" toggle yet); optimistic insert (currently refetch-after).

---

## 6g. Phase 2 — ghost-drag + per-user selection rings: SHIPPED (2026-06-14)

Live multiplayer node movement (Figma-style) + selection presence, all over Yjs awareness (ephemeral, never persisted), in `lib/collab/use-canvas-graph.ts`:

- Broadcast: `onNodesChange` publishes this client's in-flight drag positions as awareness `drag = {nodeId:{x,y}}` (throttled ~40ms while moving, flushed exactly on drag-end) and its selection as `selection = string[]`. `selectNodes` (programmatic) broadcasts too.
- Render: `rebuild()` folds every peer's `drag`/`selection` (excluding own clientID) into the derived nodes — a node a teammate is dragging follows their pointer live; a node they've selected gets a `box-shadow` ring in their color (`node.style`, confirmed not to clobber RF's transform in @xyflow/react v12). Ring suppressed on any node this client is itself dragging.
- Perf: a dedicated awareness handler rebuilds only when the drag/selection signature changes — peer **cursor** movement (also on awareness, ~22/s) never re-derives the graph. The stable-ref node cache means only the moving node gets a new ref.
- **Drag-end flash fix (adversarial review):** `handleOperation` fans out the committed position only after a DB write, while the awareness clear relays immediately — so an immediate clear can beat the position to peers and flash the node backward. Fixed by lingering the committed position in the ghost ~250ms before clearing, so peers hand off to the real node with no gap.
- Abrupt-disconnect stale ghost is heartbeat-bounded: the gateway fans an awareness removal on socket disconnect (not the 30s client timeout). Live relocation (not a translucent phantom) is intentional — matches Figma/imagine.art.
- tsc + lint clean. Review verdict: echo/self-ghost, cache invalidation, listener leaks, RF style-merge all clean.

---

## 6h. Phase 2 — version checkpoints (save + restore): SHIPPED (2026-06-14)

Manual named checkpoints + restore + history panel, built on the existing `PlatformDocumentVersion` table.

- **Server** (`restoreVersion` + `POST /aurora/documents/:id/versions/:versionId/restore`, DTOs): stamps a reversible "before restore" safety checkpoint from the caller's exact pre-restore state (`createVersion` already accepts `crdtStateBase64` + `snapshot`), points `currentVersionId` at the target, audits. Stays schema-agnostic + yjs-free. If the caller omits its live state, `compaction.flush` first so the fallback checkpoint isn't behind the horizon.
- **Client-side reconcile** (`reconcileCanvasToUpdate` in canvas-doc): builds a temp Y.Doc from the target snapshot, then ONE `LOCAL_ORIGIN` transaction does a real delete-missing + replace-target diff (Yjs updates are merge-only — applying the version state directly would never delete post-version nodes). Streams as a normal `yjs_update` op → every collaborator converges via the existing fan-out (no controller↔gateway coupling, unlike a server-side diff). Exposed as `graph.restoreFromUpdate`.
- **API + hook + UI**: `versions-api.ts`, `use-versions.ts` (list + real-time `versions_changed` nudge + `createCheckpoint`/`restore`), `CanvasHistory` panel (save named checkpoints, restore w/ inline confirm, source/time/current chips) + a History button in the top bar.
- **Design**: convergent-overlay semantics (CRDT default — an un-synced peer edit survives via LWW; the safety checkpoint is the reversibility handle); `currentVersionId` = restored target; system checkpoints shown.
- **Adversarial review (4 dims × independent verify, 7 confirmed) — fixes applied:** `writeNode`/`writeEdge` now mutate node Y.Maps IN PLACE (was swapping fresh maps → orphaned concurrent peer field-edits + violated the field-merge design); `restoreVersion` `compaction.flush` fallback for the safety checkpoint; the History "current" marker advances locally on restore (server pointer doesn't push to clients). **Accepted (not fixed):** version idempotency keys (duplicate checkpoints harmless + UI busy-guard + no POST retry → not worth a migration); the POST→reconcile gap (synchronous microtask; idb-persist + offline op-queue recover it; non-corrupting).
- server 128 tests + build green; studio tsc + lint clean.

---

## 6i. Phase 2 — autosave checkpoints (compaction-driven): SHIPPED (2026-06-14)

The automatic safety-net tier of version history, so there is always a recent point to return to without saving by hand. **The three tiers, by design:** Undo/Redo (fine, within session) · **autosave (automatic, this)** · manual named checkpoints (intentional milestones). Deliberately NOT a raw per-edit timeline — wrong granularity for a canvas (every drag is an op), and undo already covers fine recovery.

- **`DocumentAutosaveService`** (Prisma-only; separate from compaction mechanics and from `DocumentsService` to avoid a circular dep). `DocumentCompactionService` calls `autosave.maybeStamp(documentId, merged, newSnapshotSequence)` ONLY after a run that actually advanced the state (`result.count > 0 && exhausted`), passing the just-merged state so the checkpoint costs no re-read.
- **Gated** so it doesn't pile up: stamps only when something changed since the last autosave AND ≥ `minInterval` (default 5 min). Activity-driven (no edits → no autosave). Best-effort: wrapped in try/catch so it can never break a compaction run.
- **Multi-pod safe**: the stamp gate + insert run under the same per-document advisory lock (`platform-document:${id}`) as `appendOperation`/`createVersion`/`restoreVersion`, so concurrent compactors can't double-stamp and `versionNumber` can't collide.
- **Retention** "near-dense, far-sparse" (`planAutosaveRetention`, pure + unit-tested, 8 cases): keep all < 1h, one per hour < 24h, one per day older, hard cap (default 200). Only touches `source=autosave`; never the just-stamped one; prune excludes `currentVersionId` and is `source`-constrained at the SQL level (belt-and-suspenders).
- Autosave never sets `currentVersionId` (that tracks explicit manual/restore pointers only). Tunables via `DOCUMENT_AUTOSAVE_*` env (sensible defaults; feature on by default).
- **Adversarial review:** concurrency, gating, retention races, failure isolation, state correctness all cleared; the one defensible point (prune relying on the never-currentVersionId invariant) hardened with the exclusion + source guard above.
- server 135 tests (+7) + build green; tsc + lint clean.

---

## 6j. Canvas completeness — asset multiplayer (P0) + tidy/minimap/snap: SHIPPED (2026-06-14)

From a canvas feature audit, the only **broken** item was the asset library being per-device IndexedDB (collaborators saw divergent libraries). Fixed + 3 requested controls added.

- **Asset library → synced doc (P0):** new `assets` Y.Map root on the canvas doc (client `CANVAS_ROOT_SCHEMA` + server `rootSchemaFor(canvas)` both updated → additive, safe for old docs). `canvas-doc` gains `CanvasAsset` + assetsMap/readAllAssets/addAssets(dedupe)/removeAsset/removeAssetsByMediaAssetId; `useCanvasGraph` binds the root (state + observe + mutators). Generated outputs + **uploads** both register durable-URL-only assets (the "Uploaded" tab is now real + shared); moderation removes across peers. The per-device `lib/canvas-store.ts` is **deleted** (its project-CRUD was already dead since the canvas went Yjs-backed).
- **Library = cumulative inventory (adversarial-review fix):** restore reconciles canvas **content** (nodes/edges/meta) only — NOT assets — so restoring an old version never wipes assets made since. The assets map is excluded from the UndoManager (generating/uploading is not an undo step); restore stays consistent because it no longer touches assets.
- **Tidy / Minimap / Snap controls** (bottom-right bar): `computeTidyLayout` = dependency-free **bounded longest-path relaxation** (cycle-safe — review fix; O(N·E), every node placed) committed via `onNodesChange` as one undoable + synced transaction, then fit-to-view; toggleable React Flow `MiniMap` (dark, above the controls); `snapToGrid` on the 24px grid.
- studio build + tsc + lint green; server 135 tests + build green.

### 6k. Canvas P1 — quick-wiring of existing backends: SHIPPED (2026-06-14)

The audit's P1 tier (backends already existed; only UI/wiring missing):

- **Undo / redo**: `useCanvasGraph` exposes `canUndo`/`canRedo` (tracked via UndoManager `stack-item-*` events); bottom-left buttons (disabled when empty) + `Ctrl/⌘+Z` / `Ctrl/⌘+Shift+Z` / `Ctrl+Y`. A single window keydown handler also drives the add-node shortcuts; it bails inside inputs/textareas/contentEditable and behind an open `[role=dialog]`.
- **Cancel generation**: `useGeneration` gains `cancel(nodeId)` → `cancelFizzAiJob` + optimistic `status:'cancelled'` (realtime confirms); the card's busy button is now a Cancel (✕) instead of an inert spinner.
- **Add-node shortcuts**: `U`/`I`/`V`/`N` (upload / image / video / note) now actually add a node (the menu already showed the hints); plain keys only (modifiers left alone, e.g. Ctrl+V paste).
- **Connection status**: a top-right pill appears when not synced — "Connecting…" (pulsing) / "Offline" (red dot, the one justified warning accent).
- **"Enhance" stub removed** (faked an absent backend → deleted per the bar).
- studio build + tsc + lint green.
- **Still deferred:** P2 — copy/paste/duplicate, multi-select bulk ops + marquee, video drag-to-canvas. Benchmark extras — templates, board export/share, grouping/frames, alignment, layers, 2D crop/mask, inpaint/outpaint/upscale UX, @mentions, mobile.

---

## 7. Multi-mode + convergence

### 7a. Multi-mode shell + Brief mode: SHIPPED (2026-06-14)

The project-workspace shell + mode registry landed, turning a project from "a canvas" into an entity with switchable mode-documents over the same Yjs collab platform. Honest slice: canvas + a real second CRDT mode (Brief); storyboard/timeline deferred (multi-week web ports) and additive later.

- **Routing**: `/project/[projectId]/[mode]` (workspace) + `/project/[projectId]` → default-mode redirect (server); `app/project/[projectId]/[mode]/page.tsx` is a server component (`getMode(slug) || notFound()` — canonical, not client-side notFound). Grid relinked to `/project/[id]`; legacy `/canvas/[id]` → courtesy redirect.
- **Shell** (`app/project/[projectId]/layout.tsx`, client): owns project identity + chrome — back, editable **project name** (authoritative `project.name`, unified with the grid; controlled input + dirty-guard so async load can't clobber typing; revert+toast on rename failure) and a **mode switcher** pill (active mode from `useParams().mode`). Switching is sibling-route nav — shell never remounts.
- **Mode registry** (`app/project/_modes/registry.ts`): the SINGLE wiring point — `slug → {type, label, Icon, Editor}`. Only real editors registered (no fake tabs). Adding storyboard/timeline later = one entry + an editor, zero shell/routing rework.
- **Generalized collab hooks**: `useModeDocument(projectId, type)` (over `ensureModeDocument` → `POST /aurora/projects/:id/documents/:type/ensure`) + `useCollabDoc(documentId, user, rootSchema)` — the provider was already schema-agnostic, so this is pure extraction. `useCanvasDoc`/`useCanvasDocument` are now thin canvas-bound aliases (canvas behavior identical). Shared `toCollabUser`.
- **Canvas** split into a chrome-free editor (back/name/switcher moved to the shell; its zoom/dock/assets/comments/cursors/avatars/version-history stay). Removed the doc `meta.title` name path — `project.name` is now the single source.
- **Brief mode** (real 2nd CRDT mode): collaborative plain-text over `Y.Text` (`TEXT_DOC_ROOT_SCHEMA = {meta:'map', content:'text'}`); server `ROOT_SCHEMAS[brief]` added (no migration — reuses the existing `brief` type → now CRDT/compacted). Textarea bound via a minimal prefix/suffix diff under a `LOCAL_EDIT` origin; **diff baseline is the rendered `value`, not `ytext.toString()`** (adversarial-review fix — diffing the CRDT state would delete an unrendered remote edit). Caret can transiently lag the doc under simultaneous remote+local keystrokes (non-destructive, self-heals) — proper caret binding deferred with rich text/@mentions.
- **Adversarial review (4 dims × verify):** confirmed + fixed — Brief data-loss diff baseline, client-component `notFound`, project-name remount-on-load, silent rename failure. studio build/tsc/lint + server 135 tests/build green.
- **Known follow-up**: in-editor canvas `meta.title` renames on pre-existing projects don't carry into `project.name` (grid always showed `project.name`); rename once via the shell to unify.

### 7b. Convergence (future — storyboard / timeline / script)

**Project=entity, document=mode.** UI mode switcher = `listProjectDocuments(projectId)` grouped by type + ensure-on-first-open (`ensurePrimaryStoryboard` generalizes to `ensurePrimaryDocument(projectId, type)`). Canvas/storyboard/timeline/script are tabs/views over one project — the differentiator neither benchmark has (imagine.art bolts these on as nodes; Higgsfield as separate studios).

**Convergence**: both apps/studio (canvas) and apps/web (modes) read/write the SAME `/aurora/projects/:id/documents` platform.

- storyboard → `PlatformDocument(type=storyboard)`: rows/columns/values JSON, editable as a Yjs grid (live collab + comments). Replaces Java shot endpoints.
- script → `PlatformDocument(type=script)`: `Y.XmlFragment` prose CRDT (TipTap), `contentSnapshot` HTML for DOCX export.
- timeline → `PlatformDocument(type=timeline)`: tracks/clips JSON referencing `ProjectAsset`; Mediabunny export unchanged.
- **Cross-mode shared Elements** (characters/locations/props/moodboards) referenced by id across modes — the Higgsfield @tag Elements differentiator + the real Storyboard→canvas→timeline pipeline.

**Migration discipline (critique)**: web-mode Java→CRDT migration is the **highest-risk, lowest-headline** work and the codebase's repeated break point (Storyboard-Missing-Fields, targetEpisodeCount, Episode-Summary-500). Do it **last, behind a shadow / dual-read period, NOT a hard cutover** of live prod-com data, per-mode sequenced.

---

## 8. UX targets (极致丝滑)

Adopt from **imagine.art**: typed left-in/right-out handles with invalid-wire rejection; Quick-Mode/Workflow-Mode bottom prompt-bar toggle on one canvas; Iterator nodes (1 prompt × N refs → N outputs) + multi-output gallery cards (`numOutputs` already in schema, today only `outputs[0]` shows); built-in Storyboard→Split→Generate-Video pipeline; Sections (Shift+S, colored named groups, Ctrl+Tab); rich node-spawn (double-click list, Cmd+K palette, single-key I/V/P/U, Space menu, Shift+1 zoom-to-fit); App-Builder-style "graph as form app" (later).
Adopt from **Higgsfield**: reusable @tag Elements + Moodboards + preset tile libraries.
**Beat both**: live multiplayer (cursors/ghost-drag/presence avatars — imagine.art has only share-links) + per-node comments + autosaved version history; **inline fal-grade per-job observability** on cards (timing/queue/ETA/cost-in-积分/error) via the AiJob→document linkage; pay-on-generate (free to wire, credits only on generate).
Perf: drag commits on drop only; one gesture = one op; optimistic local apply = zero perceived latency; reconnect replays only `afterSequence`; media refs (never base64) keep big boards light.

---

## 9. Realtime: Ably vs self-host — conclusion

**Self-host (build on the existing WS+Redis documents gateway). Not Ably.**

- The gateway already implements snapshot + op-log + Redis fan-out + satoken auth + sequence/idempotency + Postgres-of-record — i.e. what Ably/Liveblocks/Hocuspocus sell. Renting bypasses all of it.
- The dominant constraint is **two clouds + CN-no-cross-border**. A global managed provider doesn't cleanly serve CN; you'd self-host for CN anyway → two stacks. One self-hosted stack per region (Azure AKS for .com, Alibaba for CN), each terminating its own WS + Redis + warm-rooms + Postgres, is the clean answer. Collaboration is region-pinned (same as data residency).
- "Self-host" ≠ hand-roll CRDT sync: use Yjs + y-protocols for the merge/encoding; the gateway provides transport/auth/order/persistence/fan-out. Don't reinvent Yjs.
- **Critical caveat the recon surfaced**: today's realtime is split across TWO planes — the region-portable WS gateway AND Azure-only Web PubSub for job updates (studio imports the Azure SDK directly). The no-compromise move is to **unify on the WS gateway as the single transport per region** (route `ai_job_update` through it too) and **build a real CN provider** behind `REALTIME_PROVIDER`, with a **pluggable client transport**. This is §6 item 3 and the prerequisite for CN parity.
- Would flip to Ably/Liveblocks only if CN were not a hard constraint.

---

## 10. Phased plan (critique-resequenced to ship the differentiator first)

- **Phase 0 — foundation (no UX change).** Add `canvas` enum (hand-written migration). Install pinned `yjs`+`y-protocols`. Build warm-room (lazy-load from crdtState, apply, materialize, persist). **Fix the crdtState writer + add snapshotSequence.** Generalize `ensurePrimaryDocument`. **Declare/pin `@xyflow/react` in studio.** **Decide ONE realtime transport per region + start the CN provider / unify the plane.** **Write the op-log/merge/compaction/reconnect integration test harness.**
- **Phase 1 — canvas server-backed (single-writer).** Swap `canvas-store.ts` internals to the documents platform behind its existing function surface. `PlatformDocument(type=canvas)` per project; bind React Flow ↔ Yjs; write `yjs_update` via gateway; `y-indexeddb` offline. Move ProjectAsset + uploads to the server model. **Populate + server-validate the AiJob submit contract** (projectId/documentId/blockId — note generation-api already has these optional, so it's populate-not-build). Media = refs only. Scrap the IndexedDB images store + local ProjectAsset.
- **Phase 2 — live multiplayer (BEAT imagine.art) + unified realtime plane.** Awareness frame + Redis subchannel; cursors/ghost-drag/presence avatars; per-node comments + resolve; version checkpoints + restore; crdtState compaction + op prune (reconciled with offline). Unify job-updates onto the gateway; CN provider live. **STOP, ship, measure against imagine.art/Higgsfield.**
- **Phase 3 — 极致丝滑 UX parity+** (large; can split): typed handles, Cmd+K/double-click/Space/single-key spawns, Quick/Workflow toggle, Iterator + multi-output gallery, Sections, inline job observability, reusable Elements + presets.
- **Phase 4 — storyboard mode on the platform** (migrate web off Java, shadow/dual-read period).
- **Phase 5 — script + timeline modes + full unification** (shared project shell + cross-mode pipelines).

---

## 11. Open decisions (need product/eng sign-off)

1. **Warm-room placement**: API process vs **dedicated collab worker** (recommended — RAM isolation + independent scale; changes deploy topology). Decide before Phase 1.
2. **One realtime transport**: make the WS gateway canonical for jobs+collab in both regions (recommended), and which Alibaba pub/sub backs CN fan-out.
3. **Storyboard/timeline `contentSnapshot` schemas** — the migration's hardest contract; sign off before Phase 4/5.
4. **Java cutover for web modes**: shadow/dual-read period vs hard cutover (critique strongly favors shadow for live prod data, despite the no-legacy-hedging default).
5. **Reusable Elements**: own tables vs a project-level `elements` document.
6. **Region-pinned collaboration** (a CN project can't be co-edited from a .com session) — confirm acceptable.
7. Op-log retention/pruning policy.

---

## 12. Risks (top)

Warm-room RAM (evict/cap/dedicated worker); op-log/history bloat (compaction + prune + version checkpoints); Yjs GC vs version-restore tension; dangling edges / orphan data on concurrent delete (drop at render + server GC); **yjs/y-protocols/@xyflow version drift** across bundles (pin + single source); storyboard relational→JSON serialization fragility; can't validate binary diffs (validate materialized JSON + pre-broadcast media gate); **CN region parity** (every realtime piece in-region, no Azure coupling); migration dual-write divergence (sequence per-mode cutovers).
