# Workspace release readiness

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

The owner authorized sharing COM provider accounts with separate runtime
identities. CN MiniMax credentials have been provisioned. Google Vertex uses the
same Google project with a dedicated ACK federation, Kubernetes service account
and Google service account. Run `deploy/setup-cn-vertex.sh` with an authenticated
Google operator session, then verify token exchange from an ACK pod before
release. Rerun that setup after ACK signing-key rotation: the cluster's discovery
URL is private, so Google receives its public JWKS explicitly.

`apps/server/prisma/seed/update-model-catalog.ts` replaces the GPT-only release
command. It takes explicit model slugs and defaults to offline review. `--apply`
upserts only those models/endpoints/bindings and never prunes the catalog. Runtime
images include `dist/catalog-update/prisma/seed/update-model-catalog.js`.

## Release order

1. Commit and build immutable Server, Studio, Web, Admin UI and Agent OS images.
   CN goes first; COM waits for observation. Do not merge deployment tags to the
   COM GitOps branch during the CN observation release.
2. Verify provider credentials, OSS readiness and Google federation; compare the
   rendered chart to the live release. Take a fresh RDS backup.
3. Drain Agent runs and generation work, pause admission and stop old Server
   instances before the schema migration. The old Prisma client cannot run after
   retired columns are dropped. This is a coordinated cutover, not a rolling
   schema-compatible release. Do not roll back only the application image.
4. Run the explicit backup-annotated migration Job, update the scoped model
   catalog and roll out the matching services. Resume admission only after
   readiness checks pass. Old browser pages should reload the matching client. Installed mobile clients
   keep their bootstrap URL and workspace-header contract; the HTTP boundary
   normalizes those requests into the same strict workspace DTOs.
5. Verify project access, movement, wallet grant/debit, Agent editor/viewer access
   and OSS-backed outputs. Verify all 41 models and their usable routes on CN.

Local verification includes migration wallet/payer preservation, more than 500
backend regression tests, Studio/Admin checks, browser workspace/move flows and
real PostgreSQL authorization/credit/move/concurrency integration checks. These
checks do not imply every provider has been exercised with a paid generation.
