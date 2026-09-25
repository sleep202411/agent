# Crew consolidated handoff — 25 September 2026

This is the current local engineering handoff for #547–#556. It supersedes older statements that Crew UI integration is wholly unapproved or absent. It does not replace historical checkpoint evidence or establish deployment acceptance. #557 remains excluded; Ric reports #559 settled by Isaac and #560 remains with Isaac for deployment verification.

## Checkpoint boundary

Worktree: `fizzdragon-crew-current`, branch `feat/crew-workflows-current-develop`. This handoff accompanies the authorized consolidated commit integrating parents `1bd4b8b78d874b0a34d1d579892e01295a62fd7f` and `65c14266d41f1fa9ec259b4fbc08d5660713ffc9`, including the subsequent approved UI, hooks, tests and contracts. Earlier references to local-only work describe the pre-commit state. The publication/reconciliation record records the resulting exact commit and remote verification; this document alone does not establish deployment acceptance.

Server checks remain explicitly skipped at Ric's request; prior server results apply to their recorded checkpoints, not this entire consolidated state. The recruitment-only task-options query changes backend filtering and authorization and is included with its client integration. No deployment or merge into main/develop is authorized by this publication step.

## Issue disposition and acceptance

| Issue | Available in current local work | Remaining decision or acceptance |
| --- | --- | --- |
| #547 | Retry-safe initialization backend; approved explicit creation in the workspace picker; current link/source refresh | Representative legacy ownership/workspace choices; verify creator/admin ownership, empty compute account, retries and existing links in each target environment |
| #548 | Explicit Studio import/linking; current-source selection and cache correction; original-media/privacy protections | Browser import → submit → revise → approve; regional media/storage permissions; automatic two-way synchronization remains deferred |
| #549 | Task-linked publication, public/private recruitment and recipient invitations; qualification enforcement | Real regional FD/skill catalog IDs and Java contract; continuing-eligibility policy after approval; publication/claim acceptance |
| #550 | Final terms, interviews, applicant controls, matching assignment fee, amendments and finance review | Confirm full reviewer/applicant/finance journey on deployment; refund/manual-settlement resolution remains unapproved |
| #551 | Shared lateness rules, 72-hour warning, overdue notice, revision-deadline control | Worker/outbox delivery and extension behavior on deployment; repeated escalation policy remains undecided |
| #552 | Versioned delivery templates, locked-work presentation, required-field validation | Authoritative delivery/qualification/price catalog; accepted-commitment locking remains backend-authoritative; verify real submissions |
| #553 | Extensions, reasoned closure, participant disputes, evidence sharing, private cases, Admin claim/discussion/resolution | Regional private-object access/retention, operations owner/response targets and financial closure rules; verify participant/Admin journeys |
| #554 | Exact cash balances, personal Crew filters, earnings/payout views, amendment correction queue/action | Real ledger/payment evidence; project receipts, gross/net costs, refunds and allocation formula remain undefined beyond approved fixed-fee corrections |
| #555 | Private evaluation, subject response/history, appeals, participant cases and Admin case handling | Rating-correction authority, wider evaluation and public effects require decisions; verify departed participants and actual reviewer/creator access |
| #556 | Existing Java distributor identity/certification identified | Distribution/partnership claim contract, evidence, reviewer authority, expiry/revocation and logo policy; no new implementation inferred |

All ten remain pending full acceptance in this local handoff. GitHub issue reconciliation is recorded separately after publication. No issue should be closed solely on these local checks.

## Connected review sequence for Isaac/Yuanzheng

1. Record exact committed/deployed revision, site/region, account roles and isolated test data. Verify the regional qualification catalog and migration inventory. Existing work includes twelve workflow migrations; migration review remains necessary.
2. Initialize one new and one existing project; explicitly link/import eligible Studio assets. Check ownership, duplicate recovery and private-media exclusion.
3. Publish a task-linked role; have a separate qualified creator apply or accept an invitation. Schedule/confirm/complete an interview as needed, propose/confirm exact terms, approve and assign the matching fee.
4. Submit required delivery fields and attachments; request revision with/without a deadline; request/decide an extension; accept a final submission. Check overdue counts and delivered reminders.
5. Record private feedback and a subject appeal; share evidence explicitly; use a site-authorized Admin to claim, discuss and resolve. Verify unrelated users cannot read cases or evidence, and former participants retain only their entitled history.
6. Review personal/Crew cash balances and Crew filtering. Exercise approved amendment consent and correction on isolated data with known ledger states. Manual settlement requests remain open pending a separately approved process; do not invent refunds or alter original allocations.

For each step record expected/actual behavior, screenshot or recording, revision, region, role, blocker and next owner. Browser/account evidence is separate from mocked component tests. Deployment responsibility remains with Isaac/Yuanzheng.

## Verification in this consolidation

The initial consolidation passed 524 tests across 32 changed Crew frontend suites and 29 tests across the two Admin case UI/proxy suites. Counts overlap earlier individual runs and must not be added to them. A subsequent shared-authority fix is described below; its final combined results will supersede the initial frontend count.

The concrete-blocker audit found cached membership permissions and workspace-link capability remained usable by the UI after failed authority refreshes. The shared permission hook now returns no member/owner/policy/permission authority on a failed membership read; the workspace header disables linking/initialization on a failed overview read. Successful refresh restores the controls. Backend permissions remain authoritative. Targeted regression coverage confirms the query may retain cached data while action authority is withdrawn. This does not change membership or revoke backend entitlements.

Reviewed the existing read-error gates in terms, finance corrections and private cases; no additional failure was established there. This audit is bounded to the inspected code and available local checks, not proof of zero remaining defects. No new product policy, backend check, live mutation or deployment was included.

Final combined frontend run after the shared-permission fix: **527 tests across 33 suites passed**. The subsequent picker-specific guard also rejects cached choices after a failed source-options read and validates selected workspace membership in the current options. **57 tests across the picker and asset-screen suites passed after that final correction**. Admin case UI/proxy: **29 tests across two suites passed**. These are overlapping snapshots, not additive counts. Changed-file lint and diff checks passed; full web typecheck passed after the final correction. Server checking remained skipped as requested. No tests were added merely to expand coverage: new cases reproduce the cached-authority failures.

Remaining blockers established in this pass are authoritative regional configuration and catalog, product-policy decisions, and connected browser/deployed acceptance listed above. No additional implementation defect was established in the inspected approved flows. This is not a guarantee that untested deployed behavior is defect-free. Continue fixing reproducible failures from those acceptance runs within scope.
