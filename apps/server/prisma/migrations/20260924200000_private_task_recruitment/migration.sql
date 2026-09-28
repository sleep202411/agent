ALTER TABLE crew_positions ADD COLUMN recruitment_visibility VARCHAR(16) NOT NULL DEFAULT 'public' CHECK (recruitment_visibility IN ('public','private'));
CREATE TABLE crew_position_invitations (
 id UUID PRIMARY KEY,
 position_id TEXT NOT NULL REFERENCES crew_positions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 invitee_user_id VARCHAR(64) NOT NULL,
 invited_by_user_id VARCHAR(64) NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','revoked')),
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 responded_at TIMESTAMPTZ,
 application_id TEXT REFERENCES crew_applications(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK ((status = 'accepted') = (application_id IS NOT NULL))
);
CREATE INDEX crew_position_invitations_invitee_user_id_created_at_idx ON crew_position_invitations(invitee_user_id, created_at);
CREATE INDEX crew_position_invitations_position_id_invitee_user_id_idx ON crew_position_invitations(position_id, invitee_user_id);
