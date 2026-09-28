# Workspace storage and access contract

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
