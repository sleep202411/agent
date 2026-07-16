# Story Experience Platform RFC v1

Status: **Accepted product direction; contract implementation in progress**
Date: 2026-07-15
Owners: Story Studio, Web Runtime, Java Release/Player Data

## 1. Decision

FizzDragon Story Studio is an AI-native authoring platform for interactive
narratives and light games. It is not limited to branching video, and it is
not a general-purpose replacement for Unity or Unreal.

The platform treats text, image, video, audio, UI, spatial interaction, and
approved 2D/3D extensions as first-class experience material. Creators author
one project and publish a deterministic, versioned Runtime Manifest consumed
by the Web player and other platform runtimes.

This RFC supersedes earlier Story Studio ownership notes wherever they assign
published Runtime Manifest storage, player sessions, saves, or durable player
telemetry to NestJS. Those responsibilities belong to the external Java
platform defined in section 5.

No mobile implementation is part of this RFC's current delivery scope. The
contracts remain platform-neutral so the separate mobile owner can implement
the same semantics later without changing published content.

## 2. Product boundary

### In scope

- branching narrative and routing;
- text-first interactive fiction, dialogue, chat, and visual-novel surfaces;
- image, video, subtitle, voice, music, ambience, SFX, and UI audio;
- state variables, conditions, deterministic actions, and save points;
- tap, click, press-and-hold, charge, rapid tap, swipe, drag, pan, pinch,
  rotate, and spatial hotspots;
- interaction regions anchored to authored media coordinates;
- fixed, keyframed, and tracked spatial anchors;
- responsive landscape and portrait presentation;
- themes, renderer style slots, transitions, cursors, sound packs, and motion;
- versioned Experience SDK extensions with declared capabilities;
- immutable release versions, player sessions, saves, and durable telemetry;
- creator templates, visual authoring, AI agents, and MCP authoring tools.

### Not part of the core engine

- large open worlds;
- a general physics engine;
- frame-critical combat simulation;
- multiplayer state replication;
- arbitrary JavaScript, CSS, or executable code inside a Runtime Manifest;
- unreviewed extension code downloaded and executed by a player.

These capabilities may be provided by reviewed Experience SDK extensions,
provided every target runtime has an explicit implementation.

## 3. Product surfaces

### 3.1 Main story canvas

The main canvas communicates narrative topology. A complex interaction is a
compound Experience node with typed inputs and outcomes. Its internal UI,
timeline, and logic do not expand into the main graph.

### 3.2 Experience editor

Opening a compound Experience exposes five projections of one Authoring
Document:

1. **Flow** — scenes, routers, and transitions.
2. **Stage** — renderer instances, layout, media, anchors, and hit regions.
3. **Timeline** — time cues, media, animation, subtitles, and audio tracks.
4. **Logic** — event, condition, and action routing.
5. **Data** — typed state definitions, bindings, defaults, and persistence.

These are editor views, not separate storage models.

### 3.3 Creation levels

- Standard creators use templates and built-in renderers without code.
- Interaction designers compose state, events, gestures, and timelines.
- Developers and approved agents add capabilities through the Experience SDK.

AI and MCP clients mutate the same Authoring Document through the same
validated authoring commands as the visual editor. They do not create a second
manifest dialect.

## 4. Canonical artifacts

The system has four intentionally separate artifacts.

### 4.1 Authoring Document

Mutable creator source containing semantic content, editor layout, drafts,
references, and authoring-only metadata. It is never sent directly to a
player.

### 4.2 Runtime Manifest v2

Deterministic compiled content containing only runtime state, scenes,
renderer requirements, assets, themes, events, actions, timelines, audio, and
capabilities. It contains no editor layout and no executable extension code.

### 4.3 Asset catalog

Immutable media identities and variants. A scene references one current asset;
replaced generated assets remain in project history and may be reused. Release
assets are frozen by identity and checksum.

### 4.4 Player data

Session state, checkpoints, preferences, player profiles, and telemetry. This
data is never embedded back into an immutable Runtime Manifest.

## 5. System ownership

### Studio

- edits the Authoring Document;
- previews draft content;
- invokes validation and compilation;
- submits a release candidate to Java;
- exposes authoring commands to approved agents and MCP tools.

### NestJS Story domain

- owns Story Studio authoring APIs currently implemented in this repository;
- locks and validates drafts and production inputs;
- compiles the Authoring Document into Runtime Manifest v2;
- resolves immutable release assets and checksums before publication;
- fully materializes and validates the Runtime Manifest before transport;
- submits the exact Java release v1 request keyed by `gameId` and
  `contentVersion`;
- does not become the source of truth for published manifests or player data.

Local `StoryRelease`, review, approval, and `StoryDeployment` persistence was
removed when the Java release contract was integrated. Nest retains only the
reproducible immutable `StoryBuild`; it validates a publishable production
Build and submits it to Java without creating a competing publication record.

### Java platform

- accepts `POST {prefix}/releases` with caller-owned immutable
  `(gameId, contentVersion)` identity;
- treats the nested Runtime Manifest as opaque JSON and does not parse,
  normalize, materialize, or interpret it;
- stores the Manifest body in object storage/CDN and returns `manifestUrl`;
- maintains game discovery metadata and the mutable `currentVersion` pointer;
- exposes `GET {prefix}/games` and `GET {prefix}/games/{gameId}`;
- controls activation and rollback by changing `currentVersion`;
- stores player sessions, checkpoints, preferences, and profiles;
- ingests idempotent player events;
- produces durable statistics and reporting.

The last three player-data responsibilities are product ownership decisions;
their endpoint contract is separate from the agreed release/query API v1.
Java neither validates renderer requirements nor executes renderer-specific UI
behavior in the release path.

### Runtime

- fetches a published Manifest from Java;
- runs the deterministic state/event/action processor;
- resolves registered renderers and platform adapters;
- sends checkpoints and semantic telemetry to Java;
- never accesses a database directly.

## 6. Runtime architecture

The core runtime understands only generic primitives:

- Scene and Router;
- typed State;
- Renderer Instance;
- Event;
- Condition;
- Action;
- Timeline Cue;
- Asset Reference;
- Spatial Anchor and Hit Region;
- Gesture;
- Audio Bus, Cue, and Snapshot;
- Theme Reference;
- Ending;
- Capability Requirement.

The fundamental rule is:

```text
Event -> first matching Condition route -> ordered Actions
```

At most one navigation action may commit during one event dispatch. Renderers
cannot mutate state or navigate directly; they emit declared outcomes that the
runtime routes through the same rule system.

Emitted semantic events are drained by the shared bounded event queue. Web and
Studio hosts do not implement their own recursion or ordering rules. A cyclic
event graph that exceeds the processing budget fails loudly as a runtime
invariant violation.

State is stored in three explicit lifecycle buckets. `scene` resets on every
scene transition, including re-entry; `session` persists for one play session;
`player` is versioned independently for cross-session persistence. State scope
comes from its definition and is never inferred from a naming prefix.

## 7. Spatial and continuous interaction

Spatial elements bind to a named coordinate space, never to manually computed
browser pixels. Media interactions use normalized source-content coordinates
so presentation and hit testing share one transform under contain, cover,
cropping, orientation, and resizing.

An interaction such as hold-to-light is composed from generic primitives:

```text
media anchor + hit region + semantic input action + press-hold gesture
+ charge behavior + feedback renderer + completion event
```

The content listens to a semantic input such as `interact.primary`. Platform
input maps may bind it to keyboard, pointer, touch, controller, or an
accessible alternative.

Continuous pointer/gesture progress is ephemeral runtime data. Durable state
and telemetry record meaningful boundaries such as started, cancelled,
completed, timed out, duration, and maximum progress; they do not log every
pointer frame.

## 8. Audio

Audio is independent from video and is organized into buses:

```text
Master
|- Music
|- Ambience
|- Dialogue
|- SFX
|- UI
`- Media
```

Content references semantic Audio Cues rather than physical filenames.
Timeline and event actions can play, stop, fade, crossfade, duck, parameterize,
or spatialize cues. Player preferences persist per bus through the Java player
data API.

Themes may supply compatible sound packs. Theme replacement must not change
gameplay behavior.

Random cue selection and playback-rate variation are resolved by the shared
runtime from a persisted session seed and per-cue playback cursor. Resolved
asset identity and rate are emitted to the audio adapter. Web and Studio must
therefore produce the same playback sequence for the same snapshot.

## 9. Theme and Experience SDK

Themes are declarative immutable configuration: tokens, typography, spacing,
textures, icons, motion, transitions, cursors, sound mappings, and renderer
style slots. A theme cannot contain executable behavior.

The Experience SDK is the open extension boundary. Each extension declares:

- stable renderer/behavior ID and API version;
- configuration schema version;
- input bindings and finite output outcomes;
- required platform capabilities;
- accessible fallback contract;
- editor descriptor and preview fixtures;
- runtime implementation supplied by each supported platform;
- migrations between extension configuration versions.

The core runtime must never branch on project or game identity. A condition
such as `gameId === "jinling"` is an architecture failure.

## 10. Compilation and publication

```text
Authoring Document
  -> structural validation
  -> semantic validation
  -> capability validation
  -> reference and path analysis
  -> deterministic lowering
  -> Runtime Manifest v2
  -> fully materialized JSON
  -> publisher-side structural, semantic, and capability validation
  -> POST {prefix}/releases
  -> Java stores the exact manifest JSON in object storage/CDN
  -> immutable (gameId, contentVersion) release
```

The compiler expands authoring sugar into runtime primitives. For example,
domain-friendly authoring conditions compile to generic state comparisons,
and media reaction shortcuts compile to explicit scenes and events.

Java release API v1 does not parse or validate Runtime Manifest semantics. The
publisher is solely responsible for compiling, fully materializing, and
validating the Manifest before transport. The agreed cross-team HTTP source is
`contracts/experience-runtime/v2/java-release-api-v1.openapi.yaml` plus its
release and discovery JSON Schemas.

The request contains `gameId`, caller-owned immutable `contentVersion`,
optional discovery metadata, opaque `manifest`, `status`, and `setCurrent`.
For a published release, `setCurrent` defaults to true and advances the game's
current pointer. Repeating the same `(gameId, contentVersion)` is idempotent.
The response returns `gameId`, `contentVersion`, `status`, and `manifestUrl`;
there is no Java-assigned `publicationId`, numeric `releaseVersion`, or
integrity wrapper.

The Nest publication boundary is
`POST /story-projects/{projectId}/builds/{buildId}/publish`. It requires
`story.release`, accepts only a ready `production/full` Runtime Manifest v2
Build whose frozen media remains deliverable, and forwards the fully
materialized body to
`{JAVA_STUDIO_URL}/api/player/interactive-film/releases`. Java's
`{code,msg,data}` envelope is unwrapped at this boundary; non-200 application
codes and upstream messages remain visible to Studio.

RFC 8785 JCS plus SHA-256 remains the local reproducible-build hash algorithm.
It is not transmitted in release API v1 and Java is not required to recompute
it.

## 11. Player protocol

Every published session is pinned to an immutable `(gameId, contentVersion)`
runtime version.
An active deployment may change for new sessions without silently migrating an
existing save.

Durable telemetry uses a standard envelope containing at least:

- event ID and sequence number;
- event schema version;
- project, game, content version, runtime build, and session identity;
- scene, renderer, interaction, and asset identity where applicable;
- client timestamp and platform;
- validated typed payload.

Events are sent in batches and are idempotent. Standard runtime events include
experience/session lifecycle, scene entry, choice, media lifecycle,
interaction completion/cancellation, ending, checkpoint, and runtime error.
Creator-defined semantic events must be declared and type-checked at compile
time. Sensitive or unrestricted payload collection is forbidden.

Authenticated player identity is derived by Java from the session/auth
principal and is not accepted as a trusted client event field. A telemetry
batch contains exactly one session, game, content version, and runtime build;
event IDs are unique and sequence numbers strictly increase. The concrete
player-data endpoints and transport fields remain pending separate agreement
with Java and are not part of release/query API v1.

Checkpoint writes carry an independent `clientWriteId`, authored
`checkpointId`, expected session version, and expected player-state version.
Java commits session and player buckets atomically under compare-and-swap and
returns the original result when the same `clientWriteId` is retried.
`checkpointId` identifies a story location and is never used as the request
idempotency key. Snapshots persist terminal status, completed ending, scoped
state, and deterministic runtime cursors so resume cannot reopen a completed
experience or change random playback history.

## 12. Versioning

- Authoring schema, Runtime Manifest schema, Experience API, renderer API,
  player event schema, and Java API are versioned independently.
- Published `(gameId, contentVersion)` releases are immutable; `currentVersion`
  is the mutable deployment pointer.
- Runtime compatibility is explicit through required capabilities and minimum
  engine API versions.
- Unsupported capabilities fail publication; the player does not silently
  degrade gameplay.
- Development migration is explicit and one-way. The target runtime does not
  retain permanent v1/v2 fallback branches.

## 13. Acceptance experiences

The architecture is accepted only when the same contracts can represent:

1. a text-first branching experience with variables and save/resume;
2. a video scene with a correctly anchored press-and-hold charge interaction,
   audio feedback, cancellation, completion, and telemetry;
3. the Jinling opening with archive selection, profile creation, timed bound
   overlays, audio, confirmation, and transition into the story;
4. a non-Jinling visual direction such as pixel exploration or contemporary
   mystery UI without core schema changes.

The first implementation slice is item 2 because it exercises media space,
input abstraction, continuous state, audio, actions, responsive presentation,
and Java telemetry without introducing project-specific semantics.

## 14. Delivery sequence

1. Publish this accepted RFC and remove ownership ambiguity in older docs.
2. Define Runtime Manifest v2 and shared player protocol schemas.
3. Define Authoring Document v2 and deterministic compiler lowering.
4. Publish Runtime JSON Schema and the agreed Java release/query OpenAPI.
5. Implement a headless Web/Studio runtime core and renderer registry.
6. Deliver the spatial hold + audio vertical slice in Studio preview and Web.
7. Integrate Java release storage, sessions, saves, and telemetry.
8. Migrate Jinling as a reference experience, not a special runtime.
9. Remove the v1 runtime path after all persisted development fixtures migrate.
