# Existing Crew workspace initialization UI

Ric approved this #547 control on 25 September 2026. The existing workspace picker now offers Create Studio workspace in all three languages for an authorized administrator when neither a workspace nor a legacy project is linked. A successful options read is required; pending/failed reads block confirmation.

The separate confirmation explains that the acting administrator owns the new workspace and its compute account starts empty with no issued credits. Confirming calls `POST /crews/:crewId/studio-workspace/initialize`. Existing-workspace selection remains available. No auto-initialization occurs on opening the picker.

The unchanged backend serializes initialization, returns an existing active workspace on retry and rejects unavailable links or legacy projects requiring explicit selection. Frontend guards prevent duplicate requests and ignore abandoned-session results; cancellation does not undo a server write already accepted. Retrying after an ambiguous error uses the same Crew endpoint and its backend recovery behavior.

After a confirmed response, the UI exposes the returned Studio link and suppresses another creation even if refresh fails. Asset queries for that account/Crew, workspace options and production overview refresh. Account, Crew, authority and linked-project changes reset confirmation and local result state.

55 tests passed across two frontend suites. Full web typecheck, changed-file lint, translation/placeholder parity and diff checks passed. Server checking remains skipped at Ric's request. No backend/schema change; local and uncommitted, not deployed.

Isaac/Yuanzheng should verify an authorized unlinked Crew can create once, open the correct Studio workspace and discover its projects; cancel does not create; repeated/concurrent requests recover one workspace; legacy and unavailable links remain protected; non-admins cannot initialize. Verify ownership and the empty compute account in the target regional environment. Local frontend tests do not establish deployment acceptance.
