CREATE TYPE "IpPublisherStatus" AS ENUM ('active', 'inactive');

CREATE TABLE "ip_publishers" (
  "id" UUID NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "status" "IpPublisherStatus" NOT NULL DEFAULT 'active',
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "names" JSONB NOT NULL DEFAULT '{}',
  "logo_url" VARCHAR(1024) NOT NULL,
  "website_url" VARCHAR(1024),
  "notes" VARCHAR(500),
  "created_by_id" VARCHAR(64),
  "updated_by_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ip_publishers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ip_publishers_code_key" ON "ip_publishers" ("code");
CREATE INDEX "ip_publishers_status_order_idx" ON "ip_publishers" ("status", "display_order");

CREATE TABLE "ip_publisher_assignments" (
  "id" UUID NOT NULL,
  "ip_id" UUID NOT NULL,
  "publisher_id" UUID NOT NULL,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ip_publisher_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ip_publisher_assignments_ip_publisher_unique"
  ON "ip_publisher_assignments" ("ip_id", "publisher_id");
CREATE INDEX "ip_publisher_assignments_ip_order_idx"
  ON "ip_publisher_assignments" ("ip_id", "display_order");
CREATE INDEX "ip_publisher_assignments_publisher_ip_idx"
  ON "ip_publisher_assignments" ("publisher_id", "ip_id");

ALTER TABLE "ip_publisher_assignments"
  ADD CONSTRAINT "ip_publisher_assignments_ip_fkey"
  FOREIGN KEY ("ip_id") REFERENCES "ips"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ip_publisher_assignments"
  ADD CONSTRAINT "ip_publisher_assignments_publisher_fkey"
  FOREIGN KEY ("publisher_id") REFERENCES "ip_publishers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
