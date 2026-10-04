CREATE TABLE ip_channel_video_submissions (
 id uuid PRIMARY KEY,
 channel_id uuid NOT NULL REFERENCES ips(id) ON DELETE CASCADE,
 asset_id uuid NOT NULL REFERENCES media_assets(id),
 submitted_by_id varchar(64) NOT NULL,
 title varchar(200) NOT NULL,
 description text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
 version integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 reviewed_by_id varchar(64),
 CONSTRAINT channel_video_submission_unique UNIQUE(channel_id,asset_id,submitted_by_id)
);
CREATE INDEX ip_channel_video_submissions_recent ON ip_channel_video_submissions(channel_id,created_at DESC,id DESC);
