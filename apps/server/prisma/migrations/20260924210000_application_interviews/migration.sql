CREATE TABLE crew_application_interview_events (
 id UUID PRIMARY KEY,
 application_id TEXT NOT NULL REFERENCES crew_applications(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 version INTEGER NOT NULL CHECK (version > 0),
 request_key UUID NOT NULL,
 fingerprint VARCHAR(64) NOT NULL,
 actor_user_id VARCHAR(64) NOT NULL,
 action VARCHAR(16) NOT NULL CHECK (action IN ('schedule','confirm','complete','cancel','message')),
 state VARCHAR(16) NOT NULL CHECK (state IN ('not_started','proposed','confirmed','completed','cancelled')),
 scheduled_at TIMESTAMPTZ,
 message TEXT NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 4000),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(application_id,version),
 UNIQUE(application_id,request_key),
 CHECK (state NOT IN ('proposed','confirmed','completed') OR scheduled_at IS NOT NULL)
);
