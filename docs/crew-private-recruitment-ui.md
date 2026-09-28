# Private task recruitment UI

Approved by Ric on 25 September 2026. Implemented locally on `feat/crew-workflows-current-develop`; not committed, pushed or deployed in this batch.

- Position creation offers public/private visibility only with a linked task. Removing that link resets visibility to public. Editing cannot change either immutable field.
- Existing position management shows a paginated recruitment-invitation panel for task-linked roles. A manager looks up a recipient by email or phone, checks the matched account, selects 1–30 days of validity, and sends or revokes an invitation. Self-invitations are blocked. The existing server remains authoritative for permission, position capacity, task state and expiry.
- The private applications page has a recipient-owned invitation inbox. Recipients can load a private role preview, submit an optional application message and HTTP(S) portfolio URL, accept and apply, or decline. Acceptance uses the recruitment API; it does not call the membership invitation API or grant task access. The applicant list refreshes after a successful operation. Existing qualification, final-terms, interview and approval gates remain in place.
- Queries and drafts are scoped by account and position. Switching invitations clears the application draft. Denied reads hide cached private records and controls. Pending writes block duplicate actions; late responses after account/position changes do not change the new session.
- An ambiguous response retains the original request for explicit retry and blocks other actions. This recovery is in memory only and does not survive unmount/reload. Existing backend acceptance recovers its application; creation reuses an existing pending, unexpired invitation for the same recipient. Creation has no durable request-key contract and must not be described as globally exactly-once delivery.
- Added copy is translated into English, Simplified Chinese and Traditional Chinese. No backend, migration, payment, public-rating or qualification policy change.

## Validation and handoff

All 55 tests across the invitation panel, publishing dialog, applicant page and position-detail suites passed. Full web typecheck, changed-file lint, locale/placeholder parity and diff checks passed after final edits. Full server typecheck remains skipped at Ric's request.

Isaac/Yuanzheng should test with manager and ordinary recipient accounts in the target region: private publication → invitation discovery → accept/apply → terms/interview → approval → assignment. Confirm real email/phone lookup and regional qualification mappings, expired/revoked invitations, lost sender authority, private/public discovery isolation, insufficient permissions and account switching. Local mocked HTTP tests do not establish deployed acceptance. No notification delivery or deployment is claimed.
