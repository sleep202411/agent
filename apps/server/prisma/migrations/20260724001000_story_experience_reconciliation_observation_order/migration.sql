BEGIN;

-- A reconciliation attempt is recorded before the Java authority lookup
-- begins. During that in-flight window the latest durable authority
-- observation is expected to predate the new attempt. The update guard still
-- makes authority_checked_at monotonic, and the service advances it only when
-- a real authority response is persisted.
ALTER TABLE "story_experience_publications"
  DROP CONSTRAINT "story_experience_publications_time_order_chk";

ALTER TABLE "story_experience_publications"
  ADD CONSTRAINT "story_experience_publications_time_order_chk" CHECK (
    "media_authorized_at" >= "created_at" AND
    (
      "media_authorization_revoked_at" IS NULL OR
      "media_authorization_revoked_at" >= "media_authorized_at"
    ) AND
    "updated_at" >= "created_at" AND
    ("first_attempt_at" IS NULL OR "first_attempt_at" >= "created_at") AND
    ("last_attempt_at" IS NULL OR "last_attempt_at" >= "first_attempt_at") AND
    ("published_at" IS NULL OR "published_at" >= "first_attempt_at") AND
    ("rejected_at" IS NULL OR "rejected_at" >= "first_attempt_at") AND
    ("last_error_at" IS NULL OR "last_error_at" >= "first_attempt_at") AND
    (
      "last_reconciliation_attempt_at" IS NULL OR
      "last_reconciliation_attempt_at" >= "created_at"
    ) AND
    (
      "last_reconciliation_error_at" IS NULL OR
      "last_reconciliation_error_at" >= "last_reconciliation_attempt_at"
    )
  );

COMMIT;
