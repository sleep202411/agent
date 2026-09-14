CREATE TABLE ip_game_association_revisions (
 game_id uuid NOT NULL REFERENCES story_projects(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK (version>0),
 ip_id uuid NOT NULL REFERENCES ips(id) ON DELETE RESTRICT,
 release_id uuid NOT NULL REFERENCES story_experience_game_releases(id) ON DELETE RESTRICT,
 owner_member_id uuid NOT NULL,
 actor_id varchar(64) NOT NULL,
 active boolean NOT NULL,
 request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(game_id,version),
 UNIQUE(game_id,request_id)
);
CREATE INDEX ip_game_association_ip ON ip_game_association_revisions(ip_id,game_id,version DESC);
