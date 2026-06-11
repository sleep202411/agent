-- Provider bindings are route bindings, not runtime policy documents.
-- Product pricing, user-facing parameter policy, queue policy, and observability are owned by AiCanonicalModel.
-- Provider request mapping is adapter code; retries preserve the submit-time routing snapshot.
-- Existing values in these columns were never runtime-enforced; remove them to prevent false operational control.

ALTER TABLE "ai_provider_model_bindings"
  DROP COLUMN IF EXISTS "parameter_map",
  DROP COLUMN IF EXISTS "output_map",
  DROP COLUMN IF EXISTS "queue_policy",
  DROP COLUMN IF EXISTS "routing_policy",
  DROP COLUMN IF EXISTS "fallback_policy",
  DROP COLUMN IF EXISTS "observability_policy";
