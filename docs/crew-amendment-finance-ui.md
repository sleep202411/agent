# Amendment finance review

Approved #550/#554 UI slice, implemented locally on `feat/crew-workflows-current-develop`. Crew income now includes a Crew-wide amendment queue for current earnings approvers, in English, Simplified Chinese and Traditional Chinese. It is independent of the personal/Crew ledger filter. Existing backend settlement rules are unchanged.

## Review and correction

- Queue reads use `GET /aurora/crews/:crewId/application-amendments`, with status `awaiting_settlement` or `settlement_requested`, limit 20 and the returned cursor. Recruitment-review permission is not required. Refresh restarts from the first page, including after cursor errors.
- Each record shows the application/task/amendment identity, creator and proposer, confirmed total project fee and currency, written scope, reason, revenue-share terms and consent timestamp. The target is labelled as a total project fee, not an extra payment. The API does not expose a calculated correction preview or internal financial snapshots.
- Review opens an explicit confirmation explaining replacement, supplement and manual-request outcomes. Applying calls `POST /aurora/applications/:applicationId/amendments/:id/settle`; the server chooses the applicable correction and rechecks consent, payout state and permissions. Creation/reversal permissions are enforced when required. No client-supplied replacement amount or new accounting formula is introduced.
- Manual-settlement requests are read-only. They do not imply effective amended terms, a debit or a refund. The UI provides no refund or manual-closure action.

## State and recovery

Current membership and successful queue reads gate private records and new corrections. A changed/removed record invalidates an open review. Errors retain the server's specific message; definitive rejections require a new review. Authentication/permission denial hides private records and controls until refresh.

Ambiguous writes retain the same application/amendment identity for explicit retry, blocking other corrections and filter changes. Retrying recovers the server's idempotently recorded result even if the record has left the queue. A failed queue read blocks retry until a fresh read succeeds. Recovery is in memory while mounted, not persistent across reloads or navigation; after returning, refresh both queue statuses and inspect the recorded terms/ledger before further work.

Duplicate clicks are guarded. Account/Crew changes clear the session and suppress late responses. Successful results remain recorded even if refresh fails. Completed amendments cannot be reapplied from a stale queue in the same session. Account-scoped queue, terms, application, earnings and payout views are invalidated after success; no other account's cache is refreshed by this action.

## Verification and handoff

78 tests passed across five frontend suites: finance panel, Crew income, application amendments, earnings account isolation and payout account isolation. Tests cover confirmation, exact amounts, finance-only discovery, status filters, pagination/restart, stale review, denied reads/writes, manual outcomes, identical retries, refresh failure, account/Crew changes and cache isolation. Full web typecheck, changed-file lint, translation/placeholder parity and diff checks passed. Full server checking remains skipped at Ric's request. These tests use controlled API responses; they do not establish a live financial result.

Isaac/Yuanzheng retain browser and regional acceptance. On an isolated target with the required backend/migrations, verify:

1. A finance reviewer without recruitment-review permission can discover only the authorized Crew's creator-confirmed amendments; non-finance users cannot access the queue.
2. Unpaid replacement and zero-fee reversal preserve original records; paid increases add only the difference and activate the agreed terms.
3. Paid reductions produce a visible manual request without changing balances/effective terms or issuing refunds. Manual requests have no execution or closure action.
4. Pending payouts, stale consent and missing creation/reversal permissions fail with the backend explanation and no partial correction.
5. Lost responses recover one recorded result; refreshed queues, terms and ledgers agree after success. Permission removal, account switching and departure do not expose unauthorized records.

Local and uncommitted. No production data, external payment, deployment or issue closure was performed. Manual settlement resolution, refund accounting and broader project-revenue rules remain outstanding.
