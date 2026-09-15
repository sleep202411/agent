# Crew loop integration and superseded branch cleanup

On 15 September 2026, Ric explicitly requested deleting `ric-draft264` and the superseded `fix/*`/Crew feature branches, retaining `feat/crew-workspace-asset-loop`, then merging that feature into `ric-develop-draft` while preserving its fixes.

Automatic approval review initially rejected the broader deletion because “related” did not clearly identify the other branch heads. Ric then explicitly approved the expanded list. Removed 17 local branches and seven existing remote counterparts. Other superseded remote heads were already deleted by the team. The remaining open PR is #115; deleting the old heads also closed #103, #104 and #112.

Retained local branches: `develop`, `main`, `ric-develop-draft`, `feat/crew-workspace-asset-loop`. Also retained unrelated remote `feat/mobile-2.3.0-pay` and `feat/studio-audio-story-import`.

Exact deleted references and commit IDs are in the recovery manifest outside the repository:

`/Users/ch0002ic/Documents/fizzdragon-Ric/recovery-branch-cleanup-20260915/manifest.json`

The adjacent `superseded.bundle` was verified before deletion and verified again after copying to durable storage. SHA-256: `dcfe545467f4cd39f12b665ae50009722719c72a9ac9208e4be1538643b7ebc6`.

## Integration boundary

Merge source: `feat/crew-workspace-asset-loop` at `942da1465`, based on official develop `a958f3b6e`. Destination before merge: `ric-develop-draft` at `fc5a122f2`. The merge applies cleanly, including the shared media-access file; the draft's centralized receipt prohibition remains present. Existing authentication, billing, upload replay and prior repository fixes are retained.

The user's new instruction explicitly introduces the Crew feature's workspace link, shared assets, Canvas save actions, routes and migration. The earlier “no schema/controller/layout differences” statement described the selective-transfer baseline through group 149, not this newly authorized feature integration. No other feature branch is merged. The source branch retains its review images; they are not copied into this merge tree. No new screenshots or deployed acceptance are claimed.

The workspace migration was applied only to the owned task01 PostgreSQL fixture. The retained feature's separate owned Crew fixture is used for its eight workflow cases. Validation results are recorded below once completed. No production migration, deployment or merge into official develop occurs here.

## Final layout clarification and compatibility resolution

Ric clarified that the new Crew controls may be active within the existing official page structure and styling. The feature frontend files had no overlap with the retained draft fixes and are included. Existing single-project HTTP routes, overview fields and project asset access remain supported rather than returning 410. The additive workspace controller supplies the new API; switching link types shares an admission lock and clears the alternate target. This avoids breaking existing clients while enabling the requested controls.

The initial full server run passed 3,127 tests and failed seven: six readiness fixture failures due to the newly required access-service mock, and one real pre-existing concurrent voucher wallet-creation failure. The fixture is adapted as merge compatibility work; the voucher race is queued for Update 1 after the latest develop integration. Studio passed 1,165 tests and its type check. The server type check and remaining Web checks were interrupted when Ric changed the merge scope and requested the newer official commit, so those are not claimed passed. Follow-up focused merge tests passed 115/116, exposing one obsolete overview fixture; the corrected production suite passes all 25 tests in its isolated rerun.

The final Crew PostgreSQL suite passes nine cases, including switching between the retained project-link API and the new workspace link while preserving project asset access. Log: `/tmp/ric-loop150-link-compatibility.log`.

## Latest official develop integration

Merged official `73dfc278a` after the Crew integration. Retained its workspace-name search and image/video usage columns, adapting their query to the existing full-result aggregation and posted-transaction filtering. Exact amounts, uncapped headline/member totals, refund fingerprints and account-safe administrator reads remain present. The administrator JSX structure and styles match the official update; only retained request/state handling differs.

Eight real local PostgreSQL usage cases pass, including literal wildcard-name search and image/video counts; five administrator request/recovery tests pass. Administrator type checking passes. Server test-inclusive checking with `tsconfig.eslint.json` passes under Node 22 with a 6 GB heap; the earlier 4 GB `tsconfig.spec.json` run exhausted memory. Scoped server and administrator lint pass. Removed an unused administrator import identified by lint. Logs: `/tmp/ric-develop151-*.log`. No deployment or live acceptance is claimed.

The Node 22 full Web run passed 1,292 tests and exposed 18 stale Crew fixture failures in two files. After adapting those fixtures to workspace linking and correcting the test Studio hostname, all 36 cases in those files pass. The existing project-usage link is retained for project-linked Crews. This closes the observed Web failures without claiming a new full-suite rerun.

Final Web type checking and scoped Web lint pass. Both merge parents remain in the draft history. The legacy Agent remains referenced by Helm, build scripts and CI; removal of the entire runtime is not justified by this audit.
