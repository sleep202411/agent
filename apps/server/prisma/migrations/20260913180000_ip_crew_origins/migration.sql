CREATE TABLE ip_crew_origins (
 ip_id UUID PRIMARY KEY REFERENCES ips(id) ON DELETE CASCADE,
 crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE RESTRICT,
 linked_by_id VARCHAR(64) NOT NULL,
 linked_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX ip_crew_origins_crew_idx ON ip_crew_origins(crew_id);
