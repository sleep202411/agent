# Private task evaluation UI

Ric approved this narrow #555 UI extension on 25 September 2026. Implemented locally on `feat/crew-workflows-current-develop`; no deployment or live acceptance is claimed.

- Approved task details derive the counterpart from the latest submission's actual submitter and reviewer. The reviewer supplies production ability, understanding and communication ratings; the creator supplies a management ability rating. Each score must be explicitly selected from 1–5 and the comment must contain 3–2,000 trimmed characters. Self-review and arbitrary subject selection are unavailable.
- Task history uses the existing participant-only task endpoint. The new My evaluations destination at `/crews/feedback` uses the personal endpoint, allowing authored/received records to remain available after departure without restoring task access. Both histories are paginated. Failed reads hide cached records; account/task changes clear drafts and isolate late writes.
- Only the subject can submit the single immutable response. Confirmed feedback and responses cannot be edited. Successful writes refresh the account's feedback queries; a failed refresh cannot re-enable a confirmed write in the mounted panel.
- Ambiguous write failures retain the exact payload for explicit retry while mounted. Other writes are disabled during recovery. The backend's identical-payload retry rules remain authoritative. This is not persistent recovery across reloads or browsers.
- English, Simplified Chinese and Traditional Chinese copy is included. Public ratings, correction policy and wider team evaluation are outside this slice. Appeal controls were subsequently approved and implemented in the [private cases extension](crew-private-cases-ui.md). No backend/schema changes were made for these controls.

Verification: 85 tests passed across five affected frontend suites (82 in the combined task/navigation batch and three personal-page checks). Full web typecheck, changed-file lint, translation/placeholder parity and diff checks passed after the final edits. Full server checking was skipped at Ric's request.

Isaac/Yuanzheng acceptance: use a real approved submission with distinct creator/reviewer accounts; submit both rating directions, read each participant's history, submit one subject response and check it cannot be changed. Verify unrelated members cannot read the records, departed participants retain personal history without task access, and pagination/account switching do not mix records. Confirm all three languages and actual backend error handling in the deployed regional environment. Record the tested revision and environment; local tests do not complete issue acceptance.

[Backend history contract](crew-task-feedback-history.md).
