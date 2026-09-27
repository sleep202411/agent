# Studio import selection — 25 September 2026

Issue #548: the existing Studio media dialog retained selected IDs when switching the canvas/story project filter. Submitting then paired old IDs with the newly selected source. The server rejects that mismatch, interrupting explicit import/linking.

The dialog now clears selection on each project-filter change, and submits only selections still present in the current successful source result. Loading/refetching, failed reads, missing workspaces and removed selected media block submission. Existing source permissions and restricted-media rules remain server-controlled.

Source and selection controls lock during a write; synchronous duplicate clicks produce one request. Successful writes close the dialog; failed writes retain selection for explicit retry and show the upstream error. Account, Crew, destination folder, target asset and close/reopen changes start a fresh session. Late success/error responses from an old session cannot toast or close the replacement dialog. Source reads consume the query cancellation signal. An already submitted mutation may still finish on the server; a session change does not undo it.

No new UI controls, copy, import policy or backend/schema changes. The same correction applies to importing references and binding an existing Crew asset to Studio media. Original media preservation and backend deduplication remain unchanged.

Verification: 50 tests passed across the new dialog and existing Crew asset-screen suites. Full web typecheck, changed-file lint and diff checks passed. Server checking remains skipped at Ric's request. Changes are local and uncommitted, with no deployment or issue closure.

Isaac/Yuanzheng should verify canvas → story → all-project switching, a failed source refresh, explicit retry, import into the intended folder, existing-asset binding, close/reopen and account switching in the deployed regional environment. Local component tests do not establish live Studio/storage acceptance.

## Workspace-link refresh correction

The workspace picker previously invalidated the production overview and workspace choices after a successful link/unlink, but left Crew asset queries cached. It now invalidates the affected Crew's asset queries for the acting account, including Studio media options, so the next import uses refreshed source data. Other Crews/accounts are unaffected. Rejected link changes do not invalidate this cache. Existing cancellation guards stop follow-up refreshes after the review session is abandoned.

57 tests passed across the workspace-picker, asset-screen and Studio-import dialog suites. Checks include source-cache invalidation on linking and legacy unlinking, isolation from other Crews/accounts, rejected-link preservation and abandoned-session behavior. Full web typecheck, changed-file lint and diff checks passed. These counts overlap previous coverage. No backend, schema, new controls or copy changes; server checking remains skipped. Local and uncommitted.

Deployed acceptance: open Studio import, close it, change the linked workspace, and reopen import to verify the new source. Repeat after unlinking and after a rejected link. Isaac/Yuanzheng retain browser/regional verification; no live link was changed during this work.
