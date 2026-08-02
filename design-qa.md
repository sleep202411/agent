# Crew Asset Center Design QA

## Source visual truth

- User-approved file-manager direction:
  `/var/folders/23/12w602gn55b1d801mymktkch0000gn/T/codex-clipboard-ab102dcd-26dd-43ba-abd1-1759f94cd362.png`
- Product direction: a compact Frame.io-style workbench shell with Google
  Drive-style file management. List view is the default, card view is optional,
  and file preview occupies a persistent in-page right region rather than a
  modal, centered overlay, drawer, or review player.
- State under test:
  `/zh-CN/crews/281FUpPcQawL/workspace?tab=assets`

## Implementation evidence

- Live list view: `/private/tmp/crew-assets-live-final.png`
- Side-by-side source comparison:
  `/private/tmp/crew-assets-live-comparison.png`
- Browser viewport: `1202 × 969` CSS px
- Browser: connected in-app browser using the existing signed-in localhost
  session and the local PostgreSQL database

## Resolved findings

- [Resolved P1 — behavior] Assets previously opened the parked production-review
  viewer. The assets route now mounts the file manager directly; review remains
  outside this slice.
- [Resolved P1 — layout] The production tree and asset tree competed for the
  same hierarchy. The workspace keeps its global icon rail while the file
  manager owns the source/folder rail.
- [Resolved P1 — fidelity] The embedded rounded page card was replaced with a
  viewport-height workbench layout, independent scrolling regions, square
  boundaries, and an optional fixed inspector column.
- [Resolved P1 — data honesty] Preview fixtures, fake task relations, fake
  versions, fake review controls, fake quota, fake comments, and fake permission
  controls were removed from the live asset surface.
- [Resolved P1 — file-system semantics] Moving a folder to Trash now marks its
  active descendants with one operation timestamp. Trash shows the top-level
  removed node only, and restore revives only descendants removed in the same
  operation.
- [Resolved P1 — storage readiness] The asset center now resolves its regional
  provider before upload. An unavailable R2/OSS provider is shown explicitly,
  upload is disabled, and the rest of the file manager remains usable.
- [Resolved P1 — irreversible deletion] Permanent deletion is admin-only,
  requires a destructive confirmation, removes the selected metadata subtree,
  retires owned media-ledger rows, and deletes deduplicated R2/OSS objects.
- [Resolved P1 — capability honesty] Create, upload, organize, Trash, restore,
  and permanent-delete actions render from server-issued role capabilities.
  The service repeats authorization on every mutation.
- [Resolved P2 — density] The list now shows only Name, Type, Modified by,
  Modified, Size (wide desktop), and Favorite. Task columns were removed until
  task linking has a real backend contract.
- [Resolved P2 — identity] Modifier IDs are batch-resolved through the existing
  FizzDragon user-display endpoint, with a truthful user-ID fallback.
- [Resolved P2 — copy] Search now says “files and folders”; task-oriented copy
  no longer appears in the file manager.

## Fidelity review

- Typography: passed. Compact `10–13 px` hierarchy is consistent across the
  source rail, toolbar, table, inspector, and status bar.
- Spacing and layout: passed. The shell maintains a dense production-tool rhythm
  without decorative cards, floating containers, or excess padding.
- Colors and tokens: passed. The surface is zero-chroma dark; brand red is
  limited to primary actions, active selection, active navigation, and
  favorites.
- Shapes and icons: passed. Controls use the existing Tabler icon family,
  restrained radii, thin dividers, and no substitute SVG/CSS artwork.
- Copy and localization: passed. New behavior is present in `en-US`, `zh-CN`,
  and `zh-HK`, with no hardcoded Chinese UI strings.
- Content difference from the source is intentional: the source contains
  designed sample assets, while the implementation screenshot contains the two
  folders actually present in the local database.

## Interaction verification

- Passed: empty, loading, error, retry, and populated states.
- Passed: real folder creation, nested navigation, breadcrumbs, and parent
  navigation.
- Passed: rename and move, including moving a folder back to the crew root.
- Passed: folder subtree Trash and restore behavior against the local database.
- Passed: permanent-delete confirmation and cleanup of a disposable browser-QA
  folder against the local database.
- Passed: Favorites source and per-user favorite state.
- Passed: default list view and list/card switching.
- Passed: search, type filters, and sort controls.
- Passed: file selection opens the persistent right preview region.
- Passed: image, video, audio, and PDF use native media-aware preview elements.
- Passed: browser console had no warning or error entries during the final pass.

## Storage and access verification

- Global and `.com` crew uploads resolve explicitly to
  `MediaStorageProvider.s3_compatible` (Cloudflare R2).
- `.cn` crew uploads resolve explicitly to
  `MediaStorageProvider.aliyun_oss`.
- The context endpoint reports the selected provider, health, upload ceiling,
  crew role, and executable capabilities without exposing storage credentials.
- A provider health-probe failure returns `storageAvailable: false` instead of
  turning the file manager into a loading/500 loop.
- Upload keys are bound to the authenticated user and crew, and attach verifies
  that the ready `MediaAsset` belongs to that same user and crew.
- Asset reads are limited to the founder or active crew members.
- The current access model is crew-role inheritance. Per-file external sharing
  or arbitrary ACL overrides are not exposed or implied.

## Automated verification

- `npm run check-types -w web`: passed.
- `npm run check-types -w server`: passed.
- Targeted web ESLint: passed.
- Targeted server ESLint: passed.
- Targeted Vitest: 2 files, 20 tests passed.
- Targeted Jest: 3 suites, 38 tests passed.
- `npm run build -w web`: passed.
- `npm run build -w server`: passed.
- Local Prisma migration deploy: passed without resetting the database.
- `git diff --check`: passed.

## Environment boundary

- The local server does not currently contain R2 or OSS credentials, so the
  signed upload was verified by routing/policy tests rather than writing a real
  object from localhost. Required storage configuration fails loudly; there is
  no fallback from global crew files to Azure or from the CN cell to R2.
- Browser QA confirmed that this environment renders “Cloudflare R2 / storage
  not configured”, keeps Upload disabled, completes folder create → Trash →
  permanent-confirmation → cleanup, and emits no console warnings or errors.

final result: passed

---

# Crew Group Chat Design QA

## Source visual truth

- Approved Discord / Frame.io production-chat direction:
  `/Users/isaac/.codex/generated_images/019fa06b-79db-7113-9fc9-bf415a771d7a/call_iszAVCXRcGV2cVca4Zi68tnv.png`
- Source pixels: `1487 × 1058`.
- Product state under test:
  `/zh-CN/crews/281FUpPcQawL/workspace?tab=chat`
- The source contains a dense illustrative crew with pinned announcements,
  review decisions, reactions, threads, and multiple media attachments. The
  implementation evidence uses the real local crew, whose current durable
  timeline has one text message, one system event, and one task-card message.
  Layout, hierarchy, message density, and available core interactions were
  compared; sample-data volume was not treated as a fidelity defect.

## Implementation evidence

- Browser-rendered implementation:
  `/private/tmp/fizzdragon-crew-chat-qa/crew-chat-final.png`
- Full-view side-by-side comparison:
  `/private/tmp/fizzdragon-crew-chat-qa/crew-chat-comparison.png`
- Focused navigation comparison:
  `/private/tmp/fizzdragon-crew-chat-qa/crew-chat-nav-comparison.png`
- Focused timeline/card comparison:
  `/private/tmp/fizzdragon-crew-chat-qa/crew-chat-timeline-comparison.png`
- Browser viewport and implementation pixels: `1202 × 969` CSS px at DPR `2`;
  the browser screenshot is `1202 × 969` pixels.
- Full-view normalization: source resized to `1362 × 969`; implementation
  retained at `1202 × 969`; both were placed in the same `2588 × 969`
  comparison image without stretching.
- State: dark zh-CN crew workspace, signed-in founder, task card sent with a
  structured self-mention, storage provider unavailable in the local
  environment.

## Comparison history

- [Resolved P1 — behavior] The composer previously exposed rich-looking chat
  affordances without a complete mention contract. `@成员` now carries a
  durable user ID + display label, validates against the live crew roster,
  persists in message payloads, highlights on render, and creates an
  idempotent inbox/outbox notification for every mentioned member except the
  author.
- [Resolved P1 — state honesty] Direct upload was silently disabled when local
  R2/OSS health was unavailable. The composer now shows checking state and a
  visible provider/permission explanation while preserving existing-asset and
  task sharing.
- [Resolved P2 — density and legibility] The first render used `8–11 px` text
  across author names, timestamps, message bodies, and cards, and task cards
  were capped at `620 px`. Post-fix evidence uses `9–13 px` hierarchy and an
  `820 px` card lane, matching the source's readable production-tool density.
- [Resolved P2 — data honesty] The production pulse originally drew progress
  from the number of active tasks. It now derives the percentage from real
  approved/total tasks and omits the bar when no task denominator exists.
- [Resolved P2 — broken affordance] The sidebar contained a non-functional
  “mentions” smart view. It was removed until a real filtered inbox exists;
  sending mentions and receiving durable mention notifications remain fully
  functional.

## Required fidelity surfaces

- Fonts and typography: passed. The implementation uses the product's existing
  sans stack and a compact `9–13 px` hierarchy with stronger optical weight for
  authors, channel identity, and task titles. Body copy and system events remain
  readable without losing Frame.io/Discord density.
- Spacing and layout rhythm: passed. The global rail, `232 px` channel sidebar,
  flexible timeline, bottom composer, and optional `292 px` context inspector
  reproduce the source's nested production-workspace proportions. The measured
  desktop state has no horizontal overflow.
- Colors and tokens: passed. The UI stays zero-chroma dark with thin
  low-opacity dividers; FizzDragon red is limited to selected navigation,
  mentions, status emphasis, and primary actions.
- Image quality and asset fidelity: passed for this state. No fake imagery,
  handcrafted SVG art, emoji icons, or placeholder production assets were
  introduced. Crew/member imagery uses existing product avatar/logo sources;
  asset cards resolve durable media IDs and native image/video/audio/file
  preview elements. The local crew had no file rows, so a populated attachment
  crop was not available for visual comparison.
- Copy and content: passed. Channel, assistant, picker, context, storage,
  mention, empty, loading, and error copy is present in `en-US`, `zh-CN`, and
  `zh-HK`; backend errors remain visible verbatim.
- Icons and surfaces: passed. All visible controls use the existing Tabler
  family, restrained radii, square workbench boundaries, and no decorative
  gradients or ornamental artwork.

## Interaction and browser verification

- Passed: real task-card send through the local frontend, NestJS server,
  PostgreSQL persistence, React Query cache, and realtime conversation update.
- Passed: `@` picker open, keyboard-ready listbox semantics, structured mention
  composition, mention highlighting, and server roster validation.
- Passed: task picker, durable task card, and direct right-side task context
  inspector with deep link.
- Passed: existing-asset picker loading and honest empty state.
- Passed: unavailable storage/permission state is visible and direct upload is
  disabled; non-upload collaboration controls remain usable.
- Passed: failed-send copy, retry with the same idempotency key, edited-draft
  re-keying, IME-safe Enter behavior, and in-flight draft preservation via
  targeted tests.
- Passed: access revocation removes private history/composer and surfaces the
  server reason.
- Passed: final clean browser reload produced no new console warnings or errors.
- Passed: viewport `1202 × 969` had document/body `scrollWidth === clientWidth`.

## Residual P3 follow-up polish

- The visual source also explores pinned announcements, reactions, reply
  threads, channel-level search, and a dedicated “mentions” history. These are
  coherent later enhancements, but were not exposed as inert UI in this
  milestone. The current committed product loop is group messaging, rich
  task/asset cards, file ingestion, system events, and member mentions.

## Automated verification

- Web targeted Vitest: 2 files, 24 tests passed.
- Server targeted Jest: 3 suites, 64 tests passed.
- `npm run check-types -w web`: passed.
- `npm run check-types -w server`: passed.
- Targeted web ESLint: passed.
- Targeted server ESLint: passed.
- `npm run build -w web`: passed.
- `npm run build -w server`: passed on the final isolated run (an overlapping
  parallel build first contended on Nest's `dist` cleanup).
- Locale JSON parse and `git diff --check`: passed.

final result: passed

---

# Design QA — Crew project Overview metadata

## Source and implementation evidence

- Source visual truth: the authenticated Linear project Overview and its live
  status, date, resource, member, label, and update interactions, inspected in
  the user-provided reference project.
- Source baseline: `/private/tmp/fizzdragon-linear-overview-interaction-audit/01-overview-baseline.png`
  at `1280 × 720` pixels.
- Implementation:
  `http://localhost:9527/zh-CN/crews/X6Ni2ONDkcoW/workspace?tab=tasks`.
- Browser-rendered implementation:
  `/private/tmp/fizzdragon-overview-local-final-v3.png` at `1202 × 969` CSS px,
  DPR `2`; the browser capture is `1202 × 969` pixels.
- Full-view combined comparison:
  `/private/tmp/fizzdragon-overview-linear-vs-local-v2.png`.
- Focused combined comparisons:
  `/private/tmp/fizzdragon-overview-status-linear-vs-local.png`,
  `/private/tmp/fizzdragon-overview-date-linear-vs-local-v2.png`,
  `/private/tmp/fizzdragon-overview-resource-linear-vs-local-v2.png`, and
  `/private/tmp/fizzdragon-overview-update-linear-vs-local-v2.png`.
- Normalization: the `1280 × 720` Linear captures were downsampled to
  `1202 × 676`; the implementation was retained at its native width and cropped
  to its top `1202 × 676` content region. Each pair was placed in one
  `2404 × 676` comparison image without stretching the implementation.
- State: zh-CN dark workspace, authenticated founder, Overview selected,
  project status Planned, exact start date, no attached resources, and one
  persisted project update.

## Required fidelity surfaces

- Typography: passed. The product sans stack, compact `10–25 px` hierarchy,
  title/summary contrast, and muted property labels preserve Linear's optical
  density without reducing legibility in the dark workbench.
- Spacing and layout rhythm: passed. Project identity, properties, labels,
  resources, update entry point, and Tiptap description follow the reference
  order and constrained-width rhythm. The final `1202 × 969` state has zero
  document and body horizontal overflow.
- Colors and visual tokens: passed. FizzDragon keeps its zero-chroma studio
  palette and uses brand red only for deliberate primary actions; neutral
  surfaces, thin borders, selected states, and status colors map cleanly to the
  Linear interaction hierarchy.
- Image quality and asset fidelity: passed. Crew and member imagery uses the
  existing production avatar/logo components. All action glyphs come from the
  existing Tabler family; no replacement SVG, emoji, CSS illustration, or fake
  project artwork was introduced.
- Copy and localization: passed. New status, date-granularity, resource,
  validation, empty, and action copy exists in `en-US`, `zh-CN`, and `zh-HK`;
  backend errors remain visible verbatim.
- Accessibility and semantics: passed. Project name/summary are named textboxes;
  property menus are searchable listboxes; date granularity is a tablist;
  calendars are semantic grids; the resource flow is a modal dialog; no native
  `select` remains in the Overview main region.

## Comparison history

- [Resolved P1 — interaction] The first implementation rendered the project
  name as a static `h2`, so it looked like Linear but did not support Linear's
  direct-edit behavior. It is now a named inline textbox that writes the
  canonical crew name; the adjacent summary writes the canonical crew tagline.
- [Resolved P1 — consistency] Crew updates previously returned no concurrency
  token. `CrewDTO.version` is now present on every mapped response, inline edits
  send `expectedVersion`, and the detail cache updates optimistically with
  rollback on failure. Sidebar, workspace header, and Overview therefore update
  together instead of maintaining a duplicate project title.
- [Resolved P1 — contract] The first structured-property pass treated labels as
  display-only and dates as two loose strings. Project labels now have a
  normalized assignment table; status, priority, lead, start date, target date,
  labels, and metadata version share one guarded transaction and optimistic
  cache contract.
- [Resolved P2 — date fidelity] The first date picker exposed Today/Tomorrow
  shortcuts and could store only an exact day. Linear's picker supports day,
  month, quarter, half-year, and year. The database, DTO, API validation,
  optimistic cache, display formatting, direct input, period grids, and
  start/target interval validation now preserve those five granularities.
  Post-fix evidence is
  `/private/tmp/fizzdragon-overview-date-linear-vs-local-v2.png`.
- [Resolved P2 — resource fidelity] The first resource flow used a small
  anchored popover. It now uses the centered modal hierarchy visible in Linear,
  while retaining the real FizzDragon extension for choosing an existing Crew
  Asset. Link titles remain optional and are derived server-side when omitted.
- [Resolved P2 — perceived latency] Project property edits, link/asset attach,
  resource removal, and project update publication now write optimistic cache
  state immediately and roll back on failure instead of waiting for a refetch.

## Architecture verification

- `crew_production_pages` owns the generic document and an independent document
  version used for optimistic saves.
- Project metadata has an independent optimistic version, so a document save
  and a status/lead/date edit do not create false conflicts.
- `crew_production_resources` stores normalized project links and Crew Asset
  references; asset membership is validated before attachment.
- Date values are canonical period starts plus an explicit
  `CrewProductionDateGranularity`; target-period comparison uses the period end,
  so an exact start date can validly fall inside a monthly/quarterly target.
- `crew_production_activity` stores the canonical project stream: comments,
  health/progress updates, project creation, property changes, label changes,
  and resource changes. Task-local events remain in the task detail stream and
  no longer leak into the project Activity surface.
- Successful document, project, resource, and update mutations publish distinct
  realtime events and invalidate only their relevant query surfaces.
- Required permissions are enforced in the service as well as reflected by the
  server-issued Overview capabilities; the UI does not infer authorization.

## Automated verification

- `npm run check-types` in `apps/server`: passed.
- `npm run check-types` in `apps/web`: passed.
- Targeted server ESLint: passed.
- Targeted web ESLint: passed.
- Targeted server Jest: 1 suite, 14 tests passed, including exact/coarse date
  interval validation and canonical period enforcement.
- Targeted web Vitest: 2 files, 6 tests passed for inline identity editing and
  Overview document behavior.
- `npx prisma validate --schema prisma/schema.prisma`: passed from `apps/server`.
- Local migrations `20260802110000_crew_project_overview_contract` and
  `20260802114500_crew_project_date_granularity` were deployed through the
  local-database guard to PostgreSQL at `localhost:5433`; no remote database was
  touched.

## Browser interaction verification

- Passed: direct project identity inputs are writable, Enter/blur save, and
  Escape restores without layout shift.
- Passed: status menu opens as one searchable listbox with five options,
  keyboard focus, visible current-state checkmark, and numeric shortcuts.
- Passed: day/month/quarter/half-year/year date tabs, direct-input field,
  calendar grid, coarse-period grids, localized display, optimistic save, reload
  persistence, and restoration to the exact original date.
- Passed: centered resource dialog, real URL validation, optional title
  derivation, immediate optimistic attachment, persisted result, and cleanup of
  the disposable QA link.
- Passed: Overview update CTA switches to Activity and opens its real
  health/progress composer; close returns to Overview without losing state.
- Passed: the final clean reload produced no new browser console errors.
- Passed: final Overview has zero native selects and zero horizontal overflow.

## Intentional product boundary

- Comment and project-update modes, health selection, automatic property/label/
  resource audit entries, progress summaries, and optimistic posting all use
  durable FizzDragon contracts. Linear's attachment and “Write with Agent”
  actions are intentionally absent until a real project-activity attachment and
  agent contract exists; no inert control is rendered.

## Severity review

- P0: none.
- P1: none.
- P2: none remaining in the selected metadata region.

final result: passed

## Crew project Activity fidelity pass — 2026-08-02

### Source and prototype

- Source: authenticated Linear project Activity view captured at `1202 × 969`.
- Source evidence:
  `/private/tmp/fizzdragon-linear-activity-update-reference.png`.
- Prototype evidence:
  `/private/tmp/fizzdragon-local-activity-final.png`.
- Same-canvas comparison:
  `/private/tmp/fizzdragon-activity-linear-vs-local.png`.
- Focused rich-editor source evidence:
  `/private/tmp/fizzdragon-linear-activity-tiptap-reference.png`.
- Focused rich-editor prototype evidence:
  `/private/tmp/fizzdragon-local-activity-tiptap-final.png`.
- Focused same-canvas comparison:
  `/private/tmp/fizzdragon-activity-tiptap-comparison.png`.

### Visual and interaction review

- Layout: passed. The persistent composer, compact segmented mode control,
  health chip, large borderless writing area, change summary, right-aligned
  submit action, and narrow event rail match the Linear hierarchy and density.
- Project/event separation: passed. Project comments, updates, and structural
  changes are shown here; task activity remains attached to its task.
- Comment flow: passed. Switching to Comment changes the placeholder and action,
  posts optimistically, persists through reload, clears the composer, and
  renders an avatar-backed comment entry.
- Update flow: passed. Managers can select On track / At risk / Off track, see
  the start-date and progress delta, and publish a durable update. View-only
  members retain the comment path without receiving update authority.
- Audit stream: passed. Project creation, start-date changes, labels, and
  resources use compact icon-led timeline rows; authored comments and updates
  use readable content entries.
- Accessibility: passed. Comment/Update is a tablist, the health selector is an
  expanded named control with three semantic options, the composer is a named
  textbox, and there are zero native selects.
- Responsive integrity: passed. At `1202 × 969` both body and document report
  zero horizontal overflow.
- Runtime integrity: passed. A clean reload followed by Activity navigation
  produced zero new browser warnings or errors.
- Editor engine: passed. Linear exposes a `contenteditable` element with the
  `ProseMirror editor` classes; FizzDragon now exposes a real
  `tiptap ProseMirror production-activity-prosemirror` editor rather than a
  styled textarea. The compact editor reuses the installed Tiptap slash menu,
  floating selection toolbar, Placeholder, StarterKit, and UniqueID
  extensions.
- Rich-content persistence: passed. Comment/update requests carry the canonical
  Tiptap JSON document, the server derives searchable `plain_text`, PostgreSQL
  stores JSONB plus derived text under shape constraints, and the activity feed
  renders JSON through Tiptap Static Renderer without creating an editor per
  item. A level-two heading was inserted through the slash menu, published,
  reloaded, and remained an `h2` with its stable node id.
- Focus behavior: passed. Editing reveals Cancel and the active FizzDragon-red
  publication action; cancel clears the JSON document and closes the slash
  menu without remounting the page. `Cmd/Ctrl + Enter` publishes from the
  editor.

### Automated verification

- Shared, server, and web typechecks: passed.
- Web Vitest: 3 files, 8 tests passed.
- Server Jest: 1 suite, 15 tests passed.
- Targeted server and web ESLint: passed.
- Prisma schema validation and local guarded migration deployment: passed.
- Local migrations `20260802150000_crew_activity_rich_text` and
  `20260802151000_crew_activity_content_ids` were deployed to PostgreSQL at
  `localhost:5433`; no remote database was touched.
- `git diff --check`: passed.

### Severity review

- P0: none.
- P1: none.
- P2: none remaining in the selected Activity region.

final result: passed
