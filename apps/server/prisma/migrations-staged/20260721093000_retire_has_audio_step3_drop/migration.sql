-- Retire the `has_audio` video flag — STEP 3 of 3: DROP.
--
-- NOT APPLIED YET, ON PURPOSE, AND TWICE INTERLOCKED.
--
-- Interlock 1 — location. This directory is `prisma/migrations-staged`, not
-- `prisma/migrations`. Prisma only ever reads the latter, so neither
-- `prisma migrate deploy` (what the `db-migrate` init container runs) nor
-- `prisma migrate dev` can see this file. Promotion is a deliberate `git mv` in
-- its own release; see `prisma/RETIRE-HAS-AUDIO-RUNBOOK.md`.
--
-- Interlock 2 — the unlock table below. Even once promoted, this migration
-- refuses to run unless an operator has created
-- `public.story_video_has_audio_drop_unlock` in the target database first. That
-- is the human confirming, per database, that they have checked no pod is left
-- running a pre-step-2 image. The migration drops the table on the way out, so
-- the unlock is single-use and cannot be left armed for the next database.
--
-- Every mention of that table — the check here, the DROP at the bottom, and the
-- CREATE in the runbook — is schema-qualified `public.`. `to_regclass` resolves
-- an unqualified name against `search_path` while a bare `CREATE`/`DROP TABLE`
-- resolves against its FIRST writable entry, and a connection whose search_path
-- is not plain `public` (a per-role `SET search_path`, a `?schema=` in
-- DATABASE_URL) makes those two disagree. That disagreement is the one failure
-- this interlock must never have: an unlock armed in some other schema would
-- satisfy nothing, and worse, a check that passed on `public` while the drop
-- missed would leave the unlock armed after a successful run.
--
-- ON A FAILED RUN THE UNLOCK SURVIVES, AND THAT IS FINE
--
-- Prisma runs the file in ONE transaction, so a failure anywhere rolls the DROP
-- TABLE back with everything else: the unlock is still armed afterwards. There
-- is no way to consume it regardless of outcome from inside that transaction,
-- and it is not worth reaching outside it, because the thing the unlock guards
-- against cannot happen in that state:
--
--   * The unlock exists to stop an UNATTENDED run — a promoted migration
--     reaching a database whose operator never checked the pods. After a failed
--     run there is no unattended path back here at all: Prisma has recorded the
--     migration as failed and refuses to apply anything to that database until a
--     human runs `migrate resolve`. The next attempt is necessarily deliberate.
--   * The rollback also un-drops the columns, so the state the unlock protects
--     is exactly the state it was armed for, in the same database, minutes
--     earlier. The operator's "one image tag everywhere" check has not expired.
--   * It cannot leak across databases: it was armed in this one, and the next
--     region still needs its own.
--
-- WHY IT IS A SEPARATE RELEASE FROM STEP 1
--
-- Migrations run in the new pod's `db-migrate` init container while the previous
-- image still serves traffic. Prisma names every column explicitly in its
-- SELECTs, so these four DROPs break every pod running an image that still
-- models them, from the instant they commit until the rollout finishes. Step 1
-- already relaxed the database to accept writes that omit the flag; step 2
-- shipped the code that omits it. This step only reclaims the space, and it is
-- safe exactly when no such reader is left.
--
-- NOTHING IS REPAIRED FIRST
--
-- The known-wrong rows (a direct ingest wrote `has_audio = false` over clips
-- that do contain AAC stereo) have been unread since step 2, so they are inert
-- and they leave with the columns.
--
-- ORDERING
--
-- A trigger's `UPDATE OF` column list is a recorded dependency, so
-- media_asset_variants_story_video_invalidation_trg has to be dropped before its
-- column can be, and recreated afterwards without it. plpgsql bodies carry no
-- such dependency — they would keep naming a column that no longer exists and
-- fail at runtime — so both invalidation functions are replaced explicitly.
-- These two are the only guards step 1 left referencing the flag; the other
-- three were rewritten there, because they REJECTED writes rather than merely
-- writing NULL, and a rejection could not wait for a later release.
--
-- PG16 (local dev) vs PG17 (prod)
--
-- `DROP COLUMN` removes the column's not-null catalog row itself, on both
-- versions. Nothing here enumerates, renames, or names a `pg_constraint` row, so
-- the PG17-only `contype = 'n'` behaviour is not in play. This migration is
-- version-neutral.

-- Fails the whole migration (Prisma wraps it in one transaction, so nothing is
-- partially applied) when the operator has not armed the unlock. Recovering from
-- an accidental early run is `prisma migrate resolve --rolled-back`; the runbook
-- spells it out.
DO $$
BEGIN
  IF to_regclass('"public"."story_video_has_audio_drop_unlock"') IS NULL THEN
    RAISE EXCEPTION
      'RETIRE_HAS_AUDIO_STEP3_LOCKED: dropping the has_audio columns breaks any pod still running a pre-step-2 image. Confirm every server pod runs one image tag, then arm the unlock as described in prisma/RETIRE-HAS-AUDIO-RUNBOOK.md.'
      USING ERRCODE = '55000';
  END IF;
END $$;

DROP TRIGGER "media_asset_variants_story_video_invalidation_trg"
  ON "media_asset_variants";

ALTER TABLE "story_video_build_clips"
  DROP COLUMN "has_audio";
ALTER TABLE "story_build_assets"
  DROP COLUMN "has_audio";
ALTER TABLE "story_video_selections"
  DROP COLUMN "current_has_audio";
ALTER TABLE "media_asset_variants"
  DROP COLUMN "has_audio";

CREATE OR REPLACE FUNCTION "story_video_media_asset_invalidation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" <> 'ready'
     OR NEW."moderation_status" = 'blocked'
     OR NEW."deleted_at" IS NOT NULL THEN
    UPDATE "story_video_selections"
    SET "current_asset_id" = NULL,
        "current_variant_id" = NULL,
        "current_checksum_sha256" = NULL,
        "current_content_type" = NULL,
        "current_duration_ms" = NULL,
        "current_width" = NULL,
        "current_height" = NULL,
        "current_browser_safe_mp4" = NULL,
        "version" = "version" + 1,
        "set_by_user_id" = NULL,
        "set_at" = clock_timestamp(),
        "updated_at" = clock_timestamp()
    WHERE "current_asset_id" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "story_video_media_variant_invalidation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" <> 'ready'
     OR NEW."deleted_at" IS NOT NULL
     OR NEW."checksum_sha256" IS DISTINCT FROM OLD."checksum_sha256"
     OR NEW."content_type" IS DISTINCT FROM OLD."content_type"
     OR NEW."duration_ms" IS DISTINCT FROM OLD."duration_ms"
     OR NEW."width" IS DISTINCT FROM OLD."width"
     OR NEW."height" IS DISTINCT FROM OLD."height"
     OR NEW."metadata" IS DISTINCT FROM OLD."metadata" THEN
    UPDATE "story_video_selections"
    SET "current_asset_id" = NULL,
        "current_variant_id" = NULL,
        "current_checksum_sha256" = NULL,
        "current_content_type" = NULL,
        "current_duration_ms" = NULL,
        "current_width" = NULL,
        "current_height" = NULL,
        "current_browser_safe_mp4" = NULL,
        "version" = "version" + 1,
        "set_by_user_id" = NULL,
        "set_at" = clock_timestamp(),
        "updated_at" = clock_timestamp()
    WHERE "current_variant_id" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "media_asset_variants_story_video_invalidation_trg"
AFTER UPDATE OF "status", "deleted_at", "checksum_sha256", "content_type",
  "duration_ms", "width", "height", "metadata"
ON "media_asset_variants"
FOR EACH ROW EXECUTE FUNCTION "story_video_media_variant_invalidation"();

-- Single-use: the next database needs its own operator to arm its own unlock.
-- Schema-qualified so this drops exactly the table the check above accepted,
-- whatever `search_path` the migration connection happens to carry.
DROP TABLE "public"."story_video_has_audio_drop_unlock";
