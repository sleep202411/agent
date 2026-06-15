-- Invite links carry NO invitee: both invitee_user_id and invitee_email are
-- null by design (a shareable bearer-token link, accepted by whoever opens it).
-- The original "target" check (added with the dead-code WorkspaceInvite table,
-- and mirrored onto ProjectInvite) requires invitee_user_id OR invitee_email to
-- be set, so it rejects every link invite. Link invites are the only invite
-- path we implement, so drop the check on both tables. (CHECK constraints are
-- not modeled in schema.prisma — they only ever existed as raw migration SQL.)
ALTER TABLE "workspace_invites" DROP CONSTRAINT IF EXISTS "workspace_invites_target_chk";
ALTER TABLE "project_invites" DROP CONSTRAINT IF EXISTS "project_invites_target_chk";
