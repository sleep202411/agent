-- Invitation history uses stable keyset pagination for both crew owners and
-- invitees. Include the unique tie-breaker in the physical order so pages
-- remain index-backed when many invitations share a timestamp.
DROP INDEX IF EXISTS "crew_invitations_crew_status_idx";
DROP INDEX IF EXISTS "crew_invitations_invitee_status_idx";

CREATE INDEX "crew_invitations_crew_status_created_idx"
ON "crew_invitations" (
  "crew_id",
  "status",
  "created_at" DESC,
  "id" DESC
);

CREATE INDEX "crew_invitations_invitee_status_created_idx"
ON "crew_invitations" (
  "invitee_user_id",
  "status",
  "created_at" DESC,
  "id" DESC
);

-- Agreements are queried either across every status or within a product view,
-- and member visibility adds a signer scope. Keep both access paths ordered
-- for stable keyset pagination.
DROP INDEX IF EXISTS "crew_agreements_crew_status_idx";
DROP INDEX IF EXISTS "crew_agreements_member_idx";

CREATE INDEX "crew_agreements_crew_status_updated_idx"
ON "crew_agreements" (
  "crew_id",
  "status",
  "updated_at" DESC,
  "id" DESC
);

CREATE INDEX "crew_agreements_crew_updated_idx"
ON "crew_agreements" (
  "crew_id",
  "updated_at" DESC,
  "id" DESC
);

CREATE INDEX "crew_agreements_member_status_updated_idx"
ON "crew_agreements" (
  "member_user_id",
  "crew_id",
  "status",
  "updated_at" DESC,
  "id" DESC
);

CREATE INDEX "crew_agreements_member_updated_idx"
ON "crew_agreements" (
  "member_user_id",
  "crew_id",
  "updated_at" DESC,
  "id" DESC
);
