CREATE TYPE "StoryboardExportStatus" AS ENUM ('queued','running','completed','failed','cancelled','expired');
CREATE TABLE storyboard_export_jobs (
 id uuid PRIMARY KEY, request_id uuid NOT NULL, request_hash varchar(64) NOT NULL,
 user_id varchar(64) NOT NULL, document_id uuid REFERENCES studio_documents(id) ON DELETE SET NULL,
 sequence integer NOT NULL CHECK(sequence >= 0), width integer NOT NULL CHECK(width BETWEEN 64 AND 1920 AND width % 2 = 0),
 height integer NOT NULL CHECK(height BETWEEN 64 AND 1920 AND height % 2 = 0), clips jsonb NOT NULL CHECK(jsonb_typeof(clips)='array' AND jsonb_array_length(clips) BETWEEN 1 AND 100),
 status "StoryboardExportStatus" NOT NULL DEFAULT 'queued', attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
 lease_token uuid, lease_expires_at timestamptz, cancel_requested boolean NOT NULL DEFAULT false,
 output_ref jsonb, error varchar(1000), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 CONSTRAINT storyboard_export_jobs_user_id_request_id_key UNIQUE(user_id,request_id),
 CONSTRAINT storyboard_export_lease_pair CHECK((lease_token IS NULL) = (lease_expires_at IS NULL))
);
CREATE INDEX storyboard_export_jobs_status_lease_expires_at_created_at_idx ON storyboard_export_jobs(status,lease_expires_at,created_at);
CREATE INDEX storyboard_export_jobs_expires_at_idx ON storyboard_export_jobs(expires_at);
ALTER TABLE media_asset_usages ADD COLUMN storyboard_export_job_id uuid REFERENCES storyboard_export_jobs(id) ON DELETE CASCADE;
CREATE INDEX media_asset_usages_storyboard_export_idx ON media_asset_usages(storyboard_export_job_id);
