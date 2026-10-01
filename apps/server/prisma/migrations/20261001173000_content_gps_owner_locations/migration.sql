CREATE TABLE "ip_content_gps_location_revisions" (
  "id" UUID NOT NULL,
  "ip_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "expected_version" INTEGER NOT NULL,
  "request_id" UUID NOT NULL,
  "locations" JSONB NOT NULL,
  "updated_by_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ip_content_gps_location_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_content_gps_location_revisions_ip_id_fkey" FOREIGN KEY ("ip_id") REFERENCES "ips"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ip_content_gps_location_revision_sequence" CHECK ("version" > 0 AND "expected_version" = "version" - 1),
  CONSTRAINT "ip_content_gps_location_array" CHECK (jsonb_typeof("locations") = 'array')
);
CREATE UNIQUE INDEX "ip_content_gps_location_revisions_ip_id_version_key" ON "ip_content_gps_location_revisions"("ip_id", "version");
CREATE UNIQUE INDEX "ip_content_gps_location_revisions_ip_id_request_id_key" ON "ip_content_gps_location_revisions"("ip_id", "request_id");
