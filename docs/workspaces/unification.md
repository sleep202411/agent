# Workspace unification

All workspaces support collaboration. There is no personal/team workspace type.
A project's workspace owns its compute wallet; the acting user remains the audit
actor. Community points and creator earnings remain user-owned.

## Implemented foundation

- `Workspace.defaultForUserId` preserves the old personal workspace as the stable
  destination for account credits and the initial workspace selection. Existing
  workspace IDs, wallets, grants and balances are retained.
- Provisioning uses `POST /workspaces/default/ensure`; creating an additional
  workspace uses `POST /workspaces`.
- Story creation and listing require an explicit `workspaceId`. Existing project
  URLs authorize by project identity, independently of the active UI workspace.
- Full workspace members inherit Story access. Project invitations still grant
  only access to that project, using the existing `project_only` directory entry.
- Generation admission records the workspace payer. Existing jobs, batches,
  holds and refunds keep their previously recorded payer.
- Workspace settings, billing and administration no longer branch on workspace
  type. Creator seats remain unlimited. Existing plan prices are unchanged.

## Moving a Story project

`POST /story-projects/:projectId/move` accepts `targetWorkspaceId`,
`expectedWorkspaceId` and `expectedProjectVersion`. The actual project owner
must administer the destination workspace. The project menu exposes this action
using a derived `canMove` flag; inherited workspace administrators are not
mistaken for project owners.

One transaction moves the project and live documents/layouts/skills/worlds,
retains direct collaborators through project-only destination memberships,
cleans up unused source directory entries and records the move audit. Project
IDs, URLs, content and ownership stay stable. Full destination members inherit
access; source workspace membership alone no longer grants project access.
Live project/document subscriptions are revoked after commit.

Existing media references continue to authorize access through canonical
project references. Shared library assets stay in their original workspace;
there is no copying, new grants table or rewritten immutable media identity.
Adding new candidate media requires existing media access, including the
existing canvas-reference grant.

Generation, Agent execution, build and active world sessions block movement.
Admission and movement serialize on the same project row. New work must match
the current workspace; old job/batch retry state cannot revive an old payer.
Historical jobs, batches, audits, balances and wallet holds retain their original
workspace. Future work uses the destination workspace wallet.

Project-owner transfer is deliberately separate and remains to be implemented.
Ownership stays in the existing owner membership, without a second owner field
or a new transfer workflow.

## Verification and deployment

`npm run test:workspace-migration -w server` runs the real migration against an
isolated PostgreSQL engine with the full pre-cutover schema. It verifies stable
wallets/defaults, historical payer attribution and uniqueness.

`npm run test:workspace-permissions -w server` executes the actual Story
transactional permission queries in isolated PostgreSQL, including project-only
membership, viewers, billing roles, removed members and deleted workspaces.

The schema cutover is not compatible with an older server: deploy the matching
Studio, Web, Mobile and Admin clients with Server as one release, with admission traffic paused
while old Server instances are replaced. Snapshot the database first. Do not
roll back only the application image after dropping the old columns.

No production database changes or deployments have been performed for this phase.

## Local verification — 2026-09-13

The independent local PostgreSQL preview database was initialized with all 316
migrations, including this cutover. The existing local development database was
preserved.

Browser checks passed for workspace creation and automatic selection, Story
creation in the selected workspace, isolation of the Story library after a
workspace switch, distinct workspace balances, opening a Story URL while another
workspace was selected, and the Story balance button opening its owning
workspace's billing settings. The browser checks exposed two stale labels; the
switcher and Story library copy now describe workspaces and the selected scope.

A separate HTTP test harness used the real Story controller, validation pipes,
services and PostgreSQL, with a test actor supplied at the authentication
boundary. It verified required workspace IDs; denial of an unrelated workspace;
viewer/billing read access without create, edit or generate privileges; inherited
editor creation/editing; project-only list and direct-URL isolation; and access
revocation. The running preview retained its normal authentication.

Real wallet services against the preview database passed hold, release and
settlement checks, including duplicate calls and a changed workspace after the
hold. The actor's default wallet remained unchanged. Test balances were restored
after settlement. No AI provider call or real checkout was made.

The browser session was restored. The actual move flow moved the local Story
from Workspace E2E A to Isaac's Workspace, switched the library automatically,
and reopened the unchanged canvas URL with destination credits (1,100).

`NEXT_PUBLIC_SITE_REGION=global DATABASE_URL=<local-preview-url> npm run test:story-project-move -w server`
executes the real services against the migrated local preview database. The
script refuses non-local URLs and databases not ending in `_workspace_preview`.
It verifies ownership and CAS checks, busy rejection, full rollback, documents,
direct/inherited access, private referenced media, unchanged historical wallet
context, future payer scope, duplicate calls and both concurrent admission/move
orders. Fixtures are restricted to the isolated preview database.

Agent OS worker was not running, so actual AI generation was not part of this
verification. No production deployment or production data change was performed.

## Admin operations

Compute adjustments enter through `/billing/workspace-wallet` or the user
directory's Workspaces drawer. Both reuse `WorkspaceGrantDialog` with an
explicit workspace ID, name and balance. The user directory no longer displays
legacy per-user score balances or offers an implicit default-wallet grant.
The obsolete user-credit dialog and Admin UI proxy route have been removed.

Check-in, campaign and voucher copy names the user's default workspace as the
actual destination. User memberships and community points keep their existing
ownership semantics. Read-only administrators cannot invoke adjustment controls.

The old user-points ledger page and unused legacy grant/records/ledger proxies
are removed from Admin UI; historical backend records are unchanged. Referral
compute rewards also name the default workspace destination. Catalog compute
packages display workspace credit ownership and do not expose a user-wallet
choice. Their price payload retains the existing user-scoped SKU contract;
`resolveTopupSubject` resolves the actual workspace when the order is created.

## Cross-surface billing verification

Removed the unused backend user-credit routes, schemas and services after
checking repository callers. Admin grants use an explicit workspace ID. Admin
workspace lists reuse the creator balance reader, including expired-grant
settlement, and count only active, non-removed members.

The local project-move verification also runs the real admin credit service,
wallet ledger, creator balance service and AI billing service: grant retries,
expiry, debit rollback, membership access, post-move holds, duplicate settlement,
unchanged source balance, and transactionally enqueued wallet events. This is a
service/database integration check, not a logged-in Admin UI browser test or a
real provider generation. Live event delivery to the browser remains unverified.
