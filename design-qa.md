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
