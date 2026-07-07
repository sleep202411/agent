-- IP ACL: owner-managed edit grants. Contributors stay presentation/revenue
-- metadata; this table is the authorization source of truth.

CREATE TYPE "IpAclPermission" AS ENUM ('edit');

CREATE TABLE "ip_acl_grants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ip_id" UUID NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "permission" "IpAclPermission" NOT NULL,
  "granted_by_id" VARCHAR(64) NOT NULL,
  "revoked_by_id" VARCHAR(64),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(6),

  CONSTRAINT "ip_acl_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_acl_grants_ip_id_fkey"
    FOREIGN KEY ("ip_id") REFERENCES "ips"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ip_acl_grants_ip_permission_idx"
  ON "ip_acl_grants"("ip_id", "permission", "revoked_at");

CREATE INDEX "ip_acl_grants_user_permission_idx"
  ON "ip_acl_grants"("user_id", "permission", "revoked_at");

CREATE UNIQUE INDEX "ip_acl_grants_active_unique"
  ON "ip_acl_grants"("ip_id", "user_id", "permission")
  WHERE "revoked_at" IS NULL;
