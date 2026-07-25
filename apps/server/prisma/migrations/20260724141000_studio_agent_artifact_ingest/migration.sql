-- One confirmed media asset has exactly one composer artifact identity inside
-- a thread. PostgreSQL permits multiple NULL media_asset_id values, preserving
-- generated text/structured artifacts while making upload registration
-- naturally idempotent under concurrent requests.
CREATE UNIQUE INDEX "studio_agent_artifacts_thread_media_unique"
ON "studio_agent_artifacts" ("thread_id", "media_asset_id");
