-- Admin auth core.
--
-- Internal operators are isolated from Java users. This domain owns
-- admin accounts, role-based permissions, httpOnly sessions, and audit
-- events for production operations.

CREATE TYPE "AdminUserStatus" AS ENUM ('invited', 'active', 'suspended', 'disabled');
CREATE TYPE "AdminSiteScope" AS ENUM ('global', 'cn', 'all');
CREATE TYPE "AdminSessionStatus" AS ENUM ('active', 'revoked', 'expired');
CREATE TYPE "AdminAuditOutcome" AS ENUM ('success', 'failure');

CREATE TABLE "admin_users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" VARCHAR(320) NOT NULL,
  "display_name" VARCHAR(120) NOT NULL,
  "password_hash" VARCHAR(255),
  "status" "AdminUserStatus" NOT NULL DEFAULT 'invited',
  "site_scope" "AdminSiteScope" NOT NULL DEFAULT 'all',
  "require_mfa" BOOLEAN NOT NULL DEFAULT false,
  "mfa_secret_hash" VARCHAR(255),
  "last_login_at" TIMESTAMPTZ(6),
  "password_changed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disabled_at" TIMESTAMPTZ(6),

  CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_users_email_key" UNIQUE ("email"),
  CONSTRAINT "admin_users_email_normalized" CHECK ("email" = lower(btrim("email"))),
  CONSTRAINT "admin_users_display_name_nonempty" CHECK (btrim("display_name") <> ''),
  CONSTRAINT "admin_users_password_required_when_active"
    CHECK ("status" <> 'active' OR "password_hash" IS NOT NULL)
);

CREATE TABLE "admin_roles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(80) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500),
  "site_scope" "AdminSiteScope" NOT NULL DEFAULT 'all',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_roles_key_key" UNIQUE ("key"),
  CONSTRAINT "admin_roles_key_nonempty" CHECK (btrim("key") <> ''),
  CONSTRAINT "admin_roles_name_nonempty" CHECK (btrim("name") <> '')
);

CREATE TABLE "admin_permissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_permissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_permissions_key_key" UNIQUE ("key"),
  CONSTRAINT "admin_permissions_key_nonempty" CHECK (btrim("key") <> ''),
  CONSTRAINT "admin_permissions_description_nonempty" CHECK (btrim("description") <> '')
);

CREATE TABLE "admin_user_roles" (
  "user_id" UUID NOT NULL,
  "role_id" UUID NOT NULL,
  "granted_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_user_roles_pkey" PRIMARY KEY ("user_id", "role_id")
);

CREATE TABLE "admin_role_permissions" (
  "role_id" UUID NOT NULL,
  "permission_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id")
);

CREATE TABLE "admin_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token_hash" VARCHAR(128) NOT NULL,
  "status" "AdminSessionStatus" NOT NULL DEFAULT 'active',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(6),
  "ip_address" VARCHAR(64),
  "user_agent" VARCHAR(512),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_sessions_token_hash_key" UNIQUE ("token_hash")
);

CREATE TABLE "admin_audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actor_user_id" UUID,
  "actor_session_id" UUID,
  "site_scope" "AdminSiteScope" NOT NULL DEFAULT 'all',
  "action" VARCHAR(120) NOT NULL,
  "resource_type" VARCHAR(80) NOT NULL,
  "resource_id" VARCHAR(128),
  "outcome" "AdminAuditOutcome" NOT NULL DEFAULT 'success',
  "reason" VARCHAR(1000),
  "ip_address" VARCHAR(64),
  "user_agent" VARCHAR(512),
  "before" JSONB,
  "after" JSONB,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_audit_logs_action_nonempty" CHECK (btrim("action") <> ''),
  CONSTRAINT "admin_audit_logs_resource_type_nonempty" CHECK (btrim("resource_type") <> '')
);

CREATE INDEX "admin_users_status_recent_idx"
  ON "admin_users" ("status", "updated_at" DESC);
CREATE INDEX "admin_users_site_scope_idx"
  ON "admin_users" ("site_scope", "status");
CREATE INDEX "admin_roles_site_scope_idx"
  ON "admin_roles" ("site_scope");
CREATE INDEX "admin_user_roles_role_idx"
  ON "admin_user_roles" ("role_id");
CREATE INDEX "admin_role_permissions_permission_idx"
  ON "admin_role_permissions" ("permission_id");
CREATE INDEX "admin_sessions_user_status_idx"
  ON "admin_sessions" ("user_id", "status", "expires_at");
CREATE INDEX "admin_sessions_expiry_idx"
  ON "admin_sessions" ("expires_at", "status");
CREATE INDEX "admin_audit_actor_recent_idx"
  ON "admin_audit_logs" ("actor_user_id", "created_at" DESC);
CREATE INDEX "admin_audit_action_recent_idx"
  ON "admin_audit_logs" ("action", "created_at" DESC);
CREATE INDEX "admin_audit_resource_recent_idx"
  ON "admin_audit_logs" ("resource_type", "resource_id", "created_at" DESC);
CREATE INDEX "admin_audit_outcome_recent_idx"
  ON "admin_audit_logs" ("outcome", "created_at" DESC);

ALTER TABLE "admin_user_roles"
  ADD CONSTRAINT "admin_user_roles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "admin_users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admin_user_roles"
  ADD CONSTRAINT "admin_user_roles_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "admin_roles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admin_role_permissions"
  ADD CONSTRAINT "admin_role_permissions_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "admin_roles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admin_role_permissions"
  ADD CONSTRAINT "admin_role_permissions_permission_id_fkey"
  FOREIGN KEY ("permission_id") REFERENCES "admin_permissions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admin_sessions"
  ADD CONSTRAINT "admin_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "admin_users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admin_audit_logs"
  ADD CONSTRAINT "admin_audit_logs_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "admin_users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "admin_audit_logs"
  ADD CONSTRAINT "admin_audit_logs_actor_session_id_fkey"
  FOREIGN KEY ("actor_session_id") REFERENCES "admin_sessions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
