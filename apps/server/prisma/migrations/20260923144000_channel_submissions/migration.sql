CREATE TABLE ip_channel_submission_settings (
 ip_id uuid PRIMARY KEY REFERENCES ips(id) ON DELETE CASCADE,
 open boolean NOT NULL DEFAULT false,
 updated_by_id varchar(64) NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ip_channel_submissions (
 id uuid PRIMARY KEY,
 channel_id uuid NOT NULL REFERENCES ips(id) ON DELETE CASCADE,
 work_id uuid NOT NULL REFERENCES ips(id) ON DELETE CASCADE,
 submitted_by_id varchar(64) NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
 version integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by_id varchar(64),
 reviewed_at timestamptz,
 UNIQUE(channel_id,work_id),
 CHECK(channel_id <> work_id)
);
CREATE INDEX ip_channel_submissions_recent ON ip_channel_submissions(channel_id,created_at DESC,id DESC);
