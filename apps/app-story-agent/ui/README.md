# Story Agent conversation

`apps/app-story-agent` owns this App-only H5 surface. Official DeepSeek Harness 0.2.0-rc.2 supplies the
Conversation controller, Lexical input, Chat messages, Markdown and scroll
restoration. Product extensions supply creation progress, recovery controls,
live image generation cards, one aggregate video-production card and playable results. Models are deployment config;
the conversation has no model picker or developer configuration. Official
copy, branching, Markdown, turn navigation, attachments, context/token/cache
meters and General preferences remain. The workspace sidebar is omitted for
this embedded single-project surface; settings stay in the header.

`../scripts/build-ui.mjs` bundles the published client factories without
forking vendor source. Large Markdown language grammars load on demand. Only the
canonical `agent` and `experiencePlayer` translations from Web's three catalogues enter this bundle.
Generated assets in `../dist/ui` are ignored and recreated by
`npm run build:ui -w app-story-agent`. Worker compilation has its own
`tsconfig.json`; this React client uses `tsconfig.ui.json` and no Next.js runtime.

Local `npm run dev:h5 -w app-story-agent` serves these assets at port 8085
through the loopback test-account bridge, without a login screen. It serves the
player theme from this app’s `ui/assets` and needs no Studio process. The test
identity stays server-side; native clients continue to call the same Server API.

Server queries remain authoritative in TanStack Query. `session.ts` adapts the
typed story API to Harness's public Session interface; `events.ts` projects
history into official message and Turn events. Neither executes a model loop. Media uses an official live Chat node keyed by the run and generation item. Image placeholders keep their identity through completion. Video generation is one progress/preview card, then one playable result; individual videos stay in the media panel. Its progress sums ready clips' frozen timeline durations across all confirmed video targets, including branches, and never guesses partial provider rendering. Retries count a target only once. Unconfirmed batches never count as progress; video references are labeled as previews, and failed/stopped work retains earlier results. The existing outputs endpoint accepts an optional `runId` to read exact receipts, including after target archival, without re-generating media.
Submission IDs also identify pending message echoes. Lost responses reuse that
receipt after reload; session storage contains a hash and receipt metadata, never
message text or credentials. Definitive rejection releases the receipt for a
corrected request. A confirmed late admission clears an unchanged restored draft.

Native clients can use `packages/app-story-protocol` with these endpoints beneath
`/aurora/app-story-agent/projects/:projectId`:

| Method   | Path                                             | Result                                                        |
| -------- | ------------------------------------------------ | ------------------------------------------------------------- |
| GET      | `history`                                        | Conversation, run versions and authorization limit            |
| POST     | `runs`                                           | Idempotent admission using `submissionId` and `chapterId`     |
| POST     | `runs/:runId/cancel`                             | Stop while retaining completed work                           |
| POST     | `runs/:runId/resume`                             | Resume or confirm the displayed batch ID, version and points  |
| POST     | `documents`                                      | Source upload with `x-submission-id`                          |
| GET/POST | `conversations`                                  | Chapter-backed conversation metadata and message-prefix forks |
| POST     | `chapters/:chapterId/conversation`               | Rename, order, pin or archive personal conversation metadata  |
| POST/GET | `chapters/:chapterId/attachments[/attachmentId]` | Scoped immutable uploads and downloads                        |
| GET      | `chapters/:chapterId/script`                     | Saved canonical screenplay document                           |
| GET      | `chapters/:chapterId/outputs`                    | Current readable selected images/videos                       |
| GET      | `chapters/:chapterId/preview`                    | Validated canonical runtime for the shared player             |

HTTP success alone is insufficient: the API envelope must also have `code=200`.
Clients poll versioned history while a run is active, refresh on foregrounding,
and preserve the original submission ID until admission is known. Images/videos
are chapter selections; they do not imply the work is playable. Only a completed
run with a verified result exposes its player.
The official right panel displays the chapter's saved screenplay, selected
images/videos and verified player through product tabs. It reads the canonical collaborative document through Server,
including pending document operations; it never reconstructs a script from a run
summary. A later conversational reply keeps the saved script available.
The H5 renders verified video and interactive results with the shared
`@repo/experience-player-react` player in the right panel. Server checks chapter access and
compiles the canonical working preview; an invalid or incomplete preview stays
an error. Local playback does not require a separate Studio development server.

Native UI development remains separate. The API does not require a WebView;
embedding the exact Harness browser components does. Provider qualification and
full regional media production must be verified before release.

Text messages and script stages need no compute authorization. Each new media
batch pauses with its actual image/video counts and points. An explicit
`confirmedQuote: {batchId, version, points}` must match the saved estimate before
Server admits generation. A higher prior ceiling does not approve another batch.
Expired or changed estimates require fresh confirmation. The official attachment
UI reports upload progress and errors and supports removal before sending.
Documents are extracted and scoped to the submitting actor/chapter; the fixed
text-only planner receives their text and image metadata, not image pixels.
Images can be previewed, but that is not vision-model interpretation.
