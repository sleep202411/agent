CREATE TABLE ip_stage_applications (
 id UUID PRIMARY KEY,
 ip_id UUID NOT NULL REFERENCES ips(id) ON DELETE CASCADE,
 applicant_id VARCHAR(64) NOT NULL,
 target_stage VARCHAR(32) NOT NULL CHECK(target_stage IN ('story_testing','production','released')),
 stage_version INTEGER NOT NULL CHECK(stage_version >= 0),
 reason TEXT NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 reviewer_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
 review_reason TEXT,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 reviewed_at TIMESTAMPTZ(6)
);
CREATE UNIQUE INDEX ip_stage_application_pending ON ip_stage_applications(ip_id) WHERE status='pending';
CREATE INDEX ip_stage_application_history ON ip_stage_applications(ip_id,created_at DESC);
