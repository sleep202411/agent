CREATE TABLE crew_trust_corrections (
 id uuid PRIMARY KEY,
 submission_id uuid NOT NULL REFERENCES crew_task_submissions(id) ON DELETE RESTRICT,
 points integer NOT NULL CHECK (points IN (-200,200)),
 reviewer_id varchar(64) NOT NULL,
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX crew_trust_corrections_submission ON crew_trust_corrections(submission_id,created_at DESC,id DESC);
CREATE TABLE crew_trust_appeals (
 id uuid PRIMARY KEY,
 task_id uuid NOT NULL,
 user_id varchar(64) NOT NULL,
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
 status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','upheld','corrected')),
 reviewer_id varchar(64),
 review_reason text,
 correction_id uuid REFERENCES crew_trust_corrections(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reviewed_at timestamptz,
 FOREIGN KEY(task_id,user_id) REFERENCES crew_creator_trust_entries(task_id,user_id) ON DELETE RESTRICT,
 CHECK ((status='pending' AND reviewer_id IS NULL AND review_reason IS NULL AND reviewed_at IS NULL AND correction_id IS NULL)
 OR (status<>'pending' AND reviewer_id IS NOT NULL AND length(btrim(review_reason)) BETWEEN 1 AND 2000 AND reviewed_at IS NOT NULL AND ((status='corrected')=(correction_id IS NOT NULL))))
);
CREATE UNIQUE INDEX crew_trust_appeal_pending ON crew_trust_appeals(task_id,user_id) WHERE status='pending';
CREATE INDEX crew_trust_appeal_history ON crew_trust_appeals(task_id,user_id,created_at DESC,id DESC);
