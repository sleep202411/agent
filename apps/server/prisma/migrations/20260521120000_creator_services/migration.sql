-- Creator-services marketplace tables.
--
-- See model comments in schema.prisma for the high-level shape:
--   creator_services  — one row per offering (status state machine)
--   service_packages  — 1-3 tier rows per service (basic/standard/premium)
--
-- Money: stored in smallest currency unit (USD cents, CNY 分, JPY
-- yen) — same convention as crew_positions.salary_min_amount. UI
-- multiplies/divides by 100 for display unless the currency is in
-- ZERO_DECIMAL_CURRENCIES (JPY).
--
-- The CHECK on service_packages.currency mirrors the same 9-currency
-- whitelist used by crew_positions; keep it in sync with both
-- apps/server/src/common/currency.ts and any future allowlist change.

-- ─── Enums ──────────────────────────────────────────────────

CREATE TYPE "creator_service_status" AS ENUM (
  'draft',
  'listed',
  'paused',
  'archived'
);

CREATE TYPE "service_tier" AS ENUM (
  'basic',
  'standard',
  'premium'
);

-- ─── creator_services ──────────────────────────────────────

CREATE TABLE "creator_services" (
  "id"           TEXT NOT NULL,
  "creator_id"   TEXT NOT NULL,

  "title"        VARCHAR(120) NOT NULL,
  "summary"      TEXT NOT NULL,
  "cover_path"   VARCHAR(512) NOT NULL DEFAULT '',

  "category"     VARCHAR(64)  NOT NULL,
  "tags"         TEXT[]       NOT NULL DEFAULT '{}',

  "status"       "creator_service_status" NOT NULL DEFAULT 'draft',
  "published_at" TIMESTAMPTZ(6),

  "version"      INTEGER NOT NULL DEFAULT 0,

  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMPTZ(6) NOT NULL,
  "deleted_at"   TIMESTAMPTZ(6),

  CONSTRAINT "creator_services_pkey" PRIMARY KEY ("id"),

  -- Domain invariants — keep DB as the last line of defense:
  --   * title / summary / category never blank
  --   * version never goes negative
  --   * tags array bounded so a runaway producer can't blow up the row
  CONSTRAINT "chk_creator_services_title_nonblank"
    CHECK (length(btrim("title")) > 0),
  CONSTRAINT "chk_creator_services_summary_nonblank"
    CHECK (length(btrim("summary")) > 0),
  CONSTRAINT "chk_creator_services_category_nonblank"
    CHECK (length(btrim("category")) > 0),
  CONSTRAINT "chk_creator_services_version_nonneg"
    CHECK ("version" >= 0),
  CONSTRAINT "chk_creator_services_tags_bounded"
    CHECK (cardinality("tags") <= 10)
);

CREATE INDEX "creator_services_by_creator_idx"
  ON "creator_services" ("creator_id", "deleted_at", "created_at" DESC);

CREATE INDEX "creator_services_feed_idx"
  ON "creator_services" ("status", "published_at" DESC);

CREATE INDEX "creator_services_category_feed_idx"
  ON "creator_services" ("category", "status", "published_at" DESC);

-- ─── service_packages ──────────────────────────────────────

CREATE TABLE "service_packages" (
  "id"            TEXT NOT NULL,
  "service_id"    TEXT NOT NULL,
  "tier"          "service_tier" NOT NULL,

  "title"         VARCHAR(80) NOT NULL,
  "description"   TEXT NOT NULL,

  "currency"      VARCHAR(3)  NOT NULL,
  "price_amount"  BIGINT      NOT NULL,

  "delivery_days" INTEGER NOT NULL,
  "revisions"     INTEGER NOT NULL DEFAULT 0,

  "scope"         TEXT[] NOT NULL DEFAULT '{}',

  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "service_packages_pkey" PRIMARY KEY ("id"),

  CONSTRAINT "service_packages_service_id_fkey"
    FOREIGN KEY ("service_id")
    REFERENCES "creator_services"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  -- Domain invariants:
  --   * title / description / currency never blank
  --   * price non-negative (free services allowed: 0)
  --   * delivery 1..365 days
  --   * revisions: -1 (unlimited) or >= 0
  --   * scope bounded (≤ 12 bullets)
  --   * currency on the 9-code whitelist (mirror of crew_positions)
  CONSTRAINT "chk_service_packages_title_nonblank"
    CHECK (length(btrim("title")) > 0),
  CONSTRAINT "chk_service_packages_description_nonblank"
    CHECK (length(btrim("description")) > 0),
  CONSTRAINT "chk_service_packages_price_nonneg"
    CHECK ("price_amount" >= 0),
  CONSTRAINT "chk_service_packages_delivery_range"
    CHECK ("delivery_days" >= 1 AND "delivery_days" <= 365),
  CONSTRAINT "chk_service_packages_revisions_range"
    CHECK ("revisions" >= -1),
  CONSTRAINT "chk_service_packages_scope_bounded"
    CHECK (cardinality("scope") <= 12),
  CONSTRAINT "chk_service_packages_currency"
    CHECK ("currency" IN
      ('CNY','USD','EUR','GBP','JPY','HKD','AUD','CAD','SGD'))
);

CREATE UNIQUE INDEX "service_packages_service_tier_unique"
  ON "service_packages" ("service_id", "tier");

CREATE INDEX "service_packages_by_service_idx"
  ON "service_packages" ("service_id");
