-- Certificates: final image credentials issued to users.
--
-- Operational flow for this phase:
--   1. Ops provides userId + final certificate image files.
--   2. We upload images to object storage.
--   3. A manual import script creates one row per issued certificate.
--
-- No FK to Java's user table (consistent with crew / creator-services
-- convention). No template table yet; if template rendering becomes real
-- later, add it without changing this public/profile source table.
--
-- Certificate No. format:
--   FD-{CODE}-{YYMM}-{RANDOM}
-- Example:
--   FD-OPC-2605-8K3Q7P

CREATE TABLE "user_certificates" (
  "id"              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "cert_no"         VARCHAR(32)   NOT NULL,
  "user_id"         VARCHAR(64)   NOT NULL,
  "title"           VARCHAR(128)  NOT NULL,
  "issuer"          VARCHAR(128)  NOT NULL DEFAULT 'FizzDragon',
  "image_url"       VARCHAR(512)  NOT NULL,
  "issued_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at"      TIMESTAMPTZ(6),
  "revoked_reason"  VARCHAR(255),
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_certificates_cert_no_format_chk"
    CHECK ("cert_no" ~ '^FD-[A-Z0-9]{2,12}-[0-9]{4}-[A-Z0-9]{6}$')
);

CREATE UNIQUE INDEX "user_certificates_cert_no_key"
  ON "user_certificates" ("cert_no");

-- Profile certificate wall: per-user, hide revoked, newest issued first.
CREATE INDEX "user_certificates_profile_idx"
  ON "user_certificates" ("user_id", "revoked_at", "issued_at" DESC);

CREATE INDEX "user_certificates_issued_idx"
  ON "user_certificates" ("issued_at" DESC);
