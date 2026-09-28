# Private feedback appeals and cases UI

Ric approved this #555/#553 extension on 25 September 2026. Implemented locally on `feat/crew-workflows-current-develop`; not committed or deployed.

## Participant journey

- Task and personal feedback history expose Request feedback review only to the subject. A required 3–1,000-character reason opens the existing feedback appeal endpoint with a generated UUID. The server determines the respondent and captures the original feedback/submission evidence. Success links to the resulting case.
- My cases (`/crews/cases`) lists the signed-in participant's cases with cursor pagination. `/crews/cases/:caseId` shows status, parties, operations owner and paginated immutable event history. No current Crew membership is required; neither page restores task or file access.
- Either recorded party can discuss unresolved cases. Resolved cases offer an explicit Appeal and reopen case action with a reason. No claim or resolve controls are exposed to participants. Existing-case conflicts surface the server's message; feedback users can navigate to My cases and add their request to the existing case.
- Case events show submission references as text. Private attachment counts are acknowledged. Uploading, explicit sharing and authorized downloads were subsequently approved and implemented in the [private evidence extension](crew-dispute-evidence-ui.md). Operations resolution UI, rating corrections and financial actions remain outside scope. [General task-dispute creation](crew-task-dispute-creation-ui.md) was subsequently approved and implemented locally in task details.
- All new copy is translated into English, Simplified Chinese and Traditional Chinese. Operations ownership/response targets and deployed regional acceptance remain outstanding.

## Concurrency and privacy

Each case draft retains the version and action first displayed. A changed case disables new submission until the user discards the old draft. Background read failures hide case history and controls but preserve the mounted draft version and uncertain request for recovery. Account or case navigation clears the session; late writes cannot update a replacement session.

Ambiguous writes retain the same UUID and payload for explicit retry while mounted, even after the displayed version advances. Other writes are blocked until recovery. Confirmed success remains complete if a cache refresh fails; another update becomes available only after a readable version reaches the returned version. No retry persistence across reloads, navigation or browsers is claimed. Existing backend checks remain authoritative.

## Verification and handoff

60 tests passed across six affected frontend suites, covering subject-only appeal controls, participant privacy, both pagination contracts, discussion versus reopening, duplicate clicks, stale drafts, account/case switches, exact retries, read denial, existing-case conflicts and successful writes followed by failed refresh. Earlier 57-test results overlap. Full web typecheck, changed-file lint, translation/placeholder parity and diff checks passed after final edits. Full server checking remains skipped at Ric's request. No backend/schema changes.

Isaac/Yuanzheng should test an actual subject appeal and resulting case as both parties, repeat after departure, confirm unrelated viewers are denied, and record operations ownership/resolution using the existing authorized operations surface. Reopen a resolved case, verify previous evidence remains visible and ratings/balances remain unchanged, and check all three languages. Record deployed revision and region; local tests do not establish live acceptance.

Contracts: [feedback appeals](crew-task-feedback-appeals.md), [task disputes](crew-task-disputes.md).
