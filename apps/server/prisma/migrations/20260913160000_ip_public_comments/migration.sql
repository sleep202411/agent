CREATE TABLE ip_public_comments (
 id UUID PRIMARY KEY,
 ip_id UUID NOT NULL REFERENCES ips(id) ON DELETE CASCADE,
 user_id VARCHAR(64) NOT NULL,
 author_name VARCHAR(160),
 body VARCHAR(2000) NOT NULL CHECK (length(trim(body)) > 0),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
 removed_at TIMESTAMPTZ(6),
 removal_actor VARCHAR(80),
 removal_reason VARCHAR(1000)
);
CREATE INDEX ip_public_comments_feed_idx ON ip_public_comments(ip_id, created_at DESC, id DESC) WHERE removed_at IS NULL;
