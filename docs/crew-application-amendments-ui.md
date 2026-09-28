# Application amendment controls

Implemented locally on `feat/crew-workflows-current-develop` for the approved #550 slice. The existing reviewer dialog and private application page expose post-approval amendments for task-linked applications, with English, Simplified Chinese and Traditional Chinese copy. Backend contracts and accounting rules are unchanged.

## Controls and authority

- Current reviewers with both application-review and task-management permission can propose amendments to confirmed project-fee terms. Self-proposals are blocked. Currency remains the agreed currency; exact decimal input is converted to integer minor units.
- The creator can confirm or reject a pending proposal, and reject one awaiting finance. An authorized original proposer can withdraw a pending or awaiting-finance proposal. Terminal records have no decision controls.
- Effective terms appear separately from amendment history. Pending, activated, awaiting-finance, manual-settlement-requested, rejected and withdrawn records have distinct labels. Historical activation does not imply that version remains current.
- History uses the existing private cursor API in pages of 20. Applicant access does not require Crew membership or restore task access after departure. The server remains authoritative for every read and write.

## Drafts, retries and refresh

Proposal drafts capture the reviewed terms version and task version. Collapsing the form preserves them. A changed version requires explicit discard and restart from current terms. Scope, reason, fee and optional revenue-share basis retain the backend limits; these controls do not establish a profit-allocation formula.

Ambiguous responses retain the exact UUID and payload for explicit retry while the component remains mounted. Other writes are blocked during recovery. This recovery is in memory, not guaranteed after navigation, reload or another browser. Duplicate clicks and late responses after account/application changes are guarded. Failed history reads hide private records and decisions until recovery.

Successful writes refresh the initiating account's history, effective terms, application and Crew data. A refresh failure does not turn a confirmed write into a failed purchase or request. Subsequent server history takes precedence over the saved response, including decisions made by another participant.

## Verification and remaining acceptance

62 tests passed across the amendment panel, application review dialog, private application page and final-terms panel suites. Coverage includes stale drafts, exact money/share bounds, permissions, departure, status-specific decisions, identical retries, pagination, denied reads, account changes and refreshed decisions. Full web typecheck, changed-file lint, translation/placeholder parity and diff checks passed. Server checking was skipped at Ric's request.

Isaac/Yuanzheng should verify in the target regional deployment:

1. Reviewer proposes; creator reads and confirms; eligible unposted terms become effective and the task fee updates.
2. Posted earnings or other settlement-required conditions retain existing effective terms and show awaiting-finance status.
3. Creator rejection and proposer withdrawal remain correctly authorized; stale drafts require explicit restart.
4. Another participant's decision appears after refresh; pagination and personal history continue after departure.
5. Lost responses, expired sessions and permission removal do not duplicate proposals or expose another account's data.

Changes are local and uncommitted. No deployment, issue closure or browser acceptance is claimed. Finance execution controls remain outside this application-screen slice; a subsequent, separately approved [Crew income finance slice](crew-amendment-finance-ui.md) adds that queue and correction action. Refunds and manual-settlement closure remain excluded.
