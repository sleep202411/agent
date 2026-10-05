-- SQL-owned recovery queue: record private placement before transferring bytes.
-- Keep records when a job is removed so abandoned objects remain discoverable.
CREATE TABLE storyboard_export_outputs (
 object_key text PRIMARY KEY,
 job_id uuid REFERENCES storyboard_export_jobs(id) ON DELETE SET NULL,
 provider "MediaStorageProvider" NOT NULL CHECK(provider <> 'external_url'),
 bucket text NOT NULL, region text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','retired')),
 next_attempt_at timestamptz NOT NULL DEFAULT now() + interval '1 hour',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX storyboard_export_outputs_cleanup_idx ON storyboard_export_outputs(next_attempt_at,object_key);
CREATE INDEX storyboard_export_outputs_job_idx ON storyboard_export_outputs(job_id);
