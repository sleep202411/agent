ALTER TABLE "ips" ADD COLUMN "creation_key" VARCHAR(128), ADD COLUMN "creation_fingerprint" VARCHAR(64);
CREATE UNIQUE INDEX "ips_creator_creation_key_unique" ON "ips" ("created_by_id", "creation_key");
ALTER TABLE "ips" ADD CONSTRAINT "ips_creation_request_pair" CHECK ((creation_key IS NULL) = (creation_fingerprint IS NULL));
