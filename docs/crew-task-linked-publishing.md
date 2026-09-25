# Task-linked position publishing

Approved by Ric on 25 September 2026 for #549. The existing Create position dialog now offers an optional task selector. Editing a position cannot change its task link. Leaving the selector empty preserves ordinary recruitment.

The picker uses the existing paginated task-options endpoint with `recruitmentOnly=true`. This mode requires both `tasks.view` and `tasks.manage`, limits results to the current Crew's undeleted, unassigned tasks, and excludes submitted, approved and cancelled work. Existing task-options callers retain their behavior. The position-creation transaction remains authoritative: it rechecks `openings.manage`, `tasks.manage`, task state and assignments under the existing task-write lock.

The UI hides cached options after read errors, blocks submission of an unavailable selection or after task permission loss, and allows refreshing or removing the selection. Queries and drafts remain isolated by account and Crew. Added copy is translated into English, Simplified Chinese and Traditional Chinese. No schema migration or financial policy change.

Local verification does not establish browser or deployed acceptance. Isaac/Yuanzheng should verify publication → applicant terms/interview → approval → assignment using producer and creator accounts, including a task assigned or submitted while the publication form is open.

Verification: 103 frontend tests passed together across seven suites; the subsequent pagination run passed eight tests including the new recruitment-filter continuation scenario (overlapping coverage). All 42 task-service tests passed. Full web typecheck, changed-file lint and translation checks passed; full server typecheck was skipped at Ric’s request. The 6 GB attempt exhausted memory; the 12 GB rerun was stopped without a result. No tests or source files were excluded.
