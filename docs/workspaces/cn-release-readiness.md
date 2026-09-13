# Workspace release readiness

## CN follow-up prepared — 2026-09-13

The pending Server/Studio release removes manual prompt saves. Asset and clip
editors autosave after 400 ms; generation flushes the clicked draft and serializes
admission against subsequent edits. Failed generation records retain a new-run
entry point. Image-only fal routes require their input frames before admission.

Story permission snapshots refresh on window focus and membership mutations.
Read-only production checks confirmed H (3212) is both project and workspace
owner of `01a098b6-5d63-70ce-854c-164763d3630c`, with all Story capabilities;
the screenshot does not establish the logged-in identity. Direct editors and
viewer also resolve correctly. No membership data was changed.

Regression coverage includes autosave ordering/error recovery, generation controls,
provider mode selection, missing credentials and permission-cache refresh. Types
and scoped lint pass. This release requires no migration or catalog reseed.
Authenticated production generation has not been exercised for every model.

## CN Bailian credential correction — 2026-09-13

After release, a Story generation failed with `BAILIAN_API_KEY unset`. The CN
Server Secret still supplied the legacy `DASHSCOPE_API_KEY`; the provider client
requires `BAILIAN_API_KEY`. Catalog assembly and the readiness endpoint did not
detect this missing credential.

The existing CN credential was validated through the provider's read-only model
list, then provisioned as `BAILIAN_API_KEY` in `fizzdragon-server-secrets`. The
legacy SDK variable remains for its existing consumers. No active AI jobs were
present at the pre-restart check. The Server rolled out with the same image;
the new instance authenticated with the canonical key (HTTP 200, 165 provider
models) and returned readiness HTTP 200. No paid generation was submitted.

The follow-up adds Bailian, fal and BytePlus startup credential guards and a CN
deployment preflight Bailian credential check. These code changes are prepared
for the next Server release. Existing
failed job records remain unchanged.

## CN observation release — 2026-09-13

CN Helm revision 73 was deployed at 17:09 Asia/Shanghai. Server uses
`96338190a133e4a76fae6cca35ce52574cf11eba`; Studio, Web, Admin UI and Agent OS use
`d90af4a4afa5a52613eaf52205b9d50de3337224`. COM is unchanged and awaits observation.

Manual RDS backup `3158134887` completed successfully before migration. The three
workspace migrations completed (316 total); before/after checks confirmed all
12 Story project identities/scopes and all 2,171 wallet balances were unchanged.
An in-flight video was allowed to complete and settle before old services stopped.

The live CN Server resolves 37 enabled models after the scoped catalog update and
COM product-policy sync. Google Vertex remains disabled. Public creator, web and
admin routes return 200; readiness confirms OSS, Postgres, Redis and realtime.
This verifies deployment, configuration and catalog assembly, not a paid
generation on every model or authenticated production UI flows. Local workflow,
authorization, movement and billing regression evidence remains listed below.

The temporary release-tools Job and build SSH rule were removed; the build ECS
was stopped. The migration Job retains its backup annotation for release audit.

## Product contract

Existing projects, content, URLs, owners, direct collaborators and wallet balances
are preserved. New Story generation spends the project's workspace credits;
historical jobs keep their admitted payer. Full workspace membership grants the
corresponding project capabilities. Project-only membership does not grant access
to other projects. Moving a project is explicit and owner-only; it never moves
wallet balances. Owner transfer is outside this release.

The creator UI no longer distinguishes personal/team workspaces. Admin adjusts
workspace wallets through the workspace page or a user's workspace list. User
membership and community points remain separate products.

## Storage and access fixes

CN selects Alibaba OSS for new generation outputs and chapter manifests. All
writers, storage metadata and readiness checks use the same selected provider.
Missing required storage credentials/domains fail startup. Existing placements
and completed jobs retain their recorded provider. A failed job previously
pinned to S3 needs an explicit replacement retry.

Story summaries and transactional authorization share one capability resolver.
Direct roles add to full workspace access, so an old direct viewer grant cannot
mask an inherited editor role. Read-only Agent input, attachments and approval
controls are disabled; the server remains authoritative.

## Production comparison — 2026-09-13

| Service  | CN                                         | COM                                        |
| -------- | ------------------------------------------ | ------------------------------------------ |
| Server   | `2165e677aeba044a43e28e081580ac47abc0c15b` | `40bff0d0d`                                |
| Agent OS | `6d7d0fbfe92c052f97bc25530c7ce0680cd12f00` | `5dcd40836fe856bbf215085dcbac93c36a3b3614` |

Read-only database inspection found 33 canonical models on CN and 41 on COM.
CN lacks GPT Image 2.5 Flare/Sunburst, Veo 3.1/fast/lite, Seedance 2.5,
MiniMax H3 and Gemini Omni Flash Preview. Several existing models also differ in
queue limits; GPT Image 2 differs in parameters/pricing. The code seed is not an
authority for existing production overrides: preserve COM's current product
policies when synchronizing the catalog rather than resetting them to defaults.

CN deliberately excludes Google Vertex: the three Veo variants and Gemini Omni
are not release targets. Its expected catalog after sync is 37 models. Existing
models delivered through other providers, including Nano Banana via fal, stay
available. The four additions are GPT Image 2.5 Flare/Sunburst, Seedance 2.5 and
MiniMax H3.

The provider accounts used by those additions are shared with COM. CN MiniMax
credentials have been provisioned and verified from ACK by querying an existing
completed task (HTTP 200, succeeded; no new generation). Google login, federation
and a Google network exit are not required for this release.

`apps/server/prisma/seed/update-model-catalog.ts` replaces the GPT-only release
command. It takes explicit model slugs and defaults to offline review. `--apply`
upserts only those models/endpoints/bindings and never prunes the catalog. Runtime
images include `dist/catalog-update/prisma/seed/update-model-catalog.js`.

## Release order

1. Commit and build immutable Server, Studio, Web, Admin UI and Agent OS images.
   CN goes first; COM waits for observation. Do not merge deployment tags to the
   COM GitOps branch during the CN observation release.
2. Verify provider credentials and OSS readiness; compare the
   rendered chart to the live release. Take a fresh RDS backup.
3. Drain Agent runs and generation work, pause admission and stop old Server
   instances before the schema migration. The old Prisma client cannot run after
   retired columns are dropped. This is a coordinated cutover, not a rolling
   schema-compatible release. Do not roll back only the application image.
   Use a forward-only Helm upgrade for this cutover, without `--atomic`: an
   automatic rollback would restore an old Prisma client against the new schema.
4. Run the explicit backup-annotated migration Job, update the scoped model
   catalog and roll out the matching services. Resume admission only after
   readiness checks pass. Old browser pages should reload the matching client. Installed mobile clients
   keep their bootstrap URL and workspace-header contract; the HTTP boundary
   normalizes those requests into the same strict workspace DTOs.
5. Verify project access, movement, wallet grant/debit, Agent editor/viewer access
   and OSS-backed outputs. Verify the 37 intended models and their usable routes on CN; Google Vertex
   must remain disabled.

Local verification includes migration wallet/payer preservation, more than 500
backend regression tests, Studio/Admin checks, browser workspace/move flows and
real PostgreSQL authorization/credit/move/concurrency integration checks. These
checks do not imply every provider has been exercised with a paid generation.
