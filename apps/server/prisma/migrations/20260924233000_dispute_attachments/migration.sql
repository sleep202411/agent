ALTER TABLE crew_task_dispute_events ADD COLUMN attachment_ids UUID[] NOT NULL DEFAULT '{}';
CREATE TABLE crew_dispute_attachments (
 id UUID PRIMARY KEY,
 dispute_id UUID NOT NULL REFERENCES crew_task_disputes(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 uploader_user_id VARCHAR(64) NOT NULL,
 name VARCHAR(255) NOT NULL,
 content_type VARCHAR(100) NOT NULL CHECK (content_type IN ('application/pdf','image/png','image/jpeg')),
 size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
 placement JSONB NOT NULL,
 final_key TEXT NOT NULL,
 media_asset_id UUID UNIQUE REFERENCES media_assets(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX crew_dispute_attachments_dispute_id_uploader_user_id_created_at_id_idx ON crew_dispute_attachments(dispute_id,uploader_user_id,created_at,id);
