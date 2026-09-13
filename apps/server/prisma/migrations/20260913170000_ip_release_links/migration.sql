ALTER TABLE ips ADD COLUMN release_links JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(release_links) = 'array');
