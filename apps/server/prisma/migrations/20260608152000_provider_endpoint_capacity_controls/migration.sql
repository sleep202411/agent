-- Provider endpoints should describe provider facts and typed operational
-- controls. Free-form docs/capability/quota JSON made runtime behavior
-- ambiguous and duplicated canonical-model policy.

ALTER TABLE "ai_provider_endpoints"
  DROP COLUMN IF EXISTS "capabilities",
  DROP COLUMN IF EXISTS "provider_quota_policy",
  DROP COLUMN IF EXISTS "documentation",
  ADD COLUMN "max_concurrent_requests" INTEGER,
  ADD COLUMN "max_requests_per_minute" INTEGER,
  ADD COLUMN "request_timeout_seconds" INTEGER,
  ADD COLUMN "cooldown_seconds" INTEGER,
  ADD COLUMN "failure_threshold" INTEGER;

ALTER TABLE "ai_provider_model_bindings"
  DROP COLUMN IF EXISTS "documentation";

ALTER TABLE "ai_provider_endpoints"
  ADD CONSTRAINT "ai_provider_endpoints_max_concurrent_requests_check"
    CHECK ("max_concurrent_requests" IS NULL OR ("max_concurrent_requests" >= 1 AND "max_concurrent_requests" <= 1000)),
  ADD CONSTRAINT "ai_provider_endpoints_max_requests_per_minute_check"
    CHECK ("max_requests_per_minute" IS NULL OR ("max_requests_per_minute" >= 1 AND "max_requests_per_minute" <= 100000)),
  ADD CONSTRAINT "ai_provider_endpoints_request_timeout_seconds_check"
    CHECK ("request_timeout_seconds" IS NULL OR ("request_timeout_seconds" >= 1 AND "request_timeout_seconds" <= 86400)),
  ADD CONSTRAINT "ai_provider_endpoints_cooldown_seconds_check"
    CHECK ("cooldown_seconds" IS NULL OR ("cooldown_seconds" >= 0 AND "cooldown_seconds" <= 86400)),
  ADD CONSTRAINT "ai_provider_endpoints_failure_threshold_check"
    CHECK ("failure_threshold" IS NULL OR ("failure_threshold" >= 1 AND "failure_threshold" <= 100));
