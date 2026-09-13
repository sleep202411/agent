CREATE TABLE ip_production_stages (
 ip_id UUID PRIMARY KEY REFERENCES ips(id) ON DELETE CASCADE,
 stage VARCHAR(32) NOT NULL CHECK(stage IN ('testing','story_testing','production','released')),
 version INTEGER NOT NULL CHECK(version > 0),
 updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
