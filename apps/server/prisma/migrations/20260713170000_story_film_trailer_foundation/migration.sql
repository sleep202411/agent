-- Revision-scoped promotional trailer production. A Trailer is deliberately
-- separate from StoryFilmClip so it never changes runtime clip/path counts.

CREATE TABLE "story_film_trailers" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "revision_id" UUID NOT NULL,
  "title" VARCHAR(240) NOT NULL,
  "generation_mode" "StoryFilmGenerationMode" NOT NULL,
  "frame_mode" "StoryFilmFrameMode",
  "target_duration_ms" INTEGER NOT NULL,
  "spec_json" JSONB NOT NULL,
  "spec_hash" VARCHAR(64) NOT NULL,
  "production_input_manifest" JSONB,
  "production_input_hash" VARCHAR(64),
  "version" INTEGER NOT NULL DEFAULT 0,
  "master_take_id" UUID,
  "master_revision" INTEGER NOT NULL DEFAULT 0,
  "master_selected_by_user_id" VARCHAR(64),
  "master_selected_at" TIMESTAMPTZ(6),
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "updated_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_film_trailers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_film_trailers_title_nonempty_chk" CHECK (btrim("title") <> ''),
  CONSTRAINT "story_film_trailers_duration_chk" CHECK ("target_duration_ms" > 0),
  CONSTRAINT "story_film_trailers_spec_object_chk" CHECK (jsonb_typeof("spec_json") = 'object'),
  CONSTRAINT "story_film_trailers_hashes_chk" CHECK (
    "spec_hash" ~ '^[0-9a-f]{64}$' AND (
      ("production_input_manifest" IS NULL AND "production_input_hash" IS NULL) OR
      (
        "production_input_manifest" IS NOT NULL AND
        jsonb_typeof("production_input_manifest") = 'object' AND
        "production_input_hash" ~ '^[0-9a-f]{64}$'
      )
    )
  ),
  CONSTRAINT "story_film_trailers_counters_chk" CHECK (
    "version" >= 0 AND "master_revision" >= 0
  ),
  CONSTRAINT "story_film_trailers_master_audit_chk" CHECK (
    ("master_take_id" IS NULL AND "master_selected_by_user_id" IS NULL AND "master_selected_at" IS NULL) OR
    ("master_take_id" IS NOT NULL AND "master_selected_by_user_id" IS NOT NULL AND "master_selected_at" IS NOT NULL)
  ),
  CONSTRAINT "story_film_trailers_mode_chk" CHECK (
    ("generation_mode" = 'frame_lock' AND "frame_mode" IS NOT NULL) OR
    ("generation_mode" = 'omni_reference' AND "frame_mode" IS NULL)
  )
);

CREATE TABLE "story_film_trailer_references" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "revision_id" UUID NOT NULL,
  "trailer_id" UUID NOT NULL,
  "reference_slot_id" UUID NOT NULL,
  "role" "StoryFilmClipReferenceRole" NOT NULL,
  "position" INTEGER NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_film_trailer_references_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_film_trailer_references_position_chk" CHECK (
    "position" >= 0 AND
    ("role" NOT IN ('first_frame', 'last_frame') OR "position" = 0)
  )
);

CREATE TABLE "story_film_trailer_takes" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "revision_id" UUID NOT NULL,
  "trailer_id" UUID NOT NULL,
  "take_number" INTEGER NOT NULL,
  "submission_key" VARCHAR(240) NOT NULL,
  "status" "StoryFilmTakeStatus" NOT NULL DEFAULT 'queued',
  "trailer_spec_hash" VARCHAR(64) NOT NULL,
  "production_input_hash" VARCHAR(64) NOT NULL,
  "prompt_snapshot" JSONB NOT NULL,
  "generation_config" JSONB NOT NULL,
  "model_snapshot" JSONB NOT NULL,
  "ai_job_id" UUID NOT NULL,
  "ai_job_output_id" TEXT,
  "output_asset_id" UUID,
  "output_variant_id" UUID,
  "output_checksum_sha256" VARCHAR(64),
  "technical_checks" JSONB NOT NULL DEFAULT '[]',
  "error" JSONB,
  "review_revision" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "queued_at" TIMESTAMPTZ(6),
  "started_at" TIMESTAMPTZ(6),
  "ready_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "superseded_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_film_trailer_takes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_film_trailer_takes_number_chk" CHECK ("take_number" > 0),
  CONSTRAINT "story_film_trailer_takes_submission_nonempty_chk" CHECK (btrim("submission_key") <> ''),
  CONSTRAINT "story_film_trailer_takes_hashes_chk" CHECK (
    "trailer_spec_hash" ~ '^[0-9a-f]{64}$' AND
    "production_input_hash" ~ '^[0-9a-f]{64}$' AND
    ("output_checksum_sha256" IS NULL OR "output_checksum_sha256" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "story_film_trailer_takes_snapshots_chk" CHECK (
    jsonb_typeof("prompt_snapshot") = 'object' AND
    jsonb_typeof("generation_config") = 'object' AND
    jsonb_typeof("model_snapshot") = 'object' AND
    jsonb_typeof("technical_checks") = 'array'
  ),
  CONSTRAINT "story_film_trailer_takes_counters_chk" CHECK (
    "version" >= 0 AND "review_revision" >= 0
  ),
  CONSTRAINT "story_film_trailer_takes_ready_chk" CHECK (
    "status" <> 'ready' OR (
      "ai_job_output_id" IS NOT NULL AND "output_asset_id" IS NOT NULL AND
      "output_variant_id" IS NOT NULL AND "output_checksum_sha256" IS NOT NULL AND
      "ready_at" IS NOT NULL AND "completed_at" IS NOT NULL
    )
  ),
  CONSTRAINT "story_film_trailer_takes_failed_chk" CHECK (
    "status" <> 'failed' OR ("error" IS NOT NULL AND "completed_at" IS NOT NULL)
  ),
  CONSTRAINT "story_film_trailer_takes_cancelled_chk" CHECK (
    "status" <> 'cancelled' OR ("cancelled_at" IS NOT NULL AND "completed_at" IS NOT NULL)
  )
);

CREATE TABLE "story_film_trailer_take_references" (
  "story_project_id" UUID NOT NULL,
  "revision_id" UUID NOT NULL,
  "take_id" UUID NOT NULL,
  "reference_slot_id" UUID NOT NULL,
  "reference_version_id" UUID NOT NULL,
  "role" "StoryFilmClipReferenceRole" NOT NULL,
  "position" INTEGER NOT NULL,
  "asset_id" UUID NOT NULL,
  "checksum_sha256" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_film_trailer_take_references_pkey" PRIMARY KEY ("take_id", "role", "position"),
  CONSTRAINT "story_film_trailer_take_references_position_chk" CHECK ("position" >= 0),
  CONSTRAINT "story_film_trailer_take_references_hash_chk" CHECK (
    "checksum_sha256" ~ '^[0-9a-f]{64}$'
  )
);

CREATE TABLE "story_film_trailer_take_reviews" (
  "id" UUID NOT NULL,
  "take_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "decision" "StoryReviewDecision" NOT NULL,
  "technical_passed" BOOLEAN NOT NULL,
  "safety_passed" BOOLEAN NOT NULL,
  "checklist" JSONB NOT NULL DEFAULT '{}',
  "notes" TEXT,
  "reviewer_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_film_trailer_take_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_film_trailer_take_reviews_sequence_chk" CHECK ("sequence" > 0),
  CONSTRAINT "story_film_trailer_take_reviews_checklist_chk" CHECK (jsonb_typeof("checklist") = 'object'),
  CONSTRAINT "story_film_trailer_take_reviews_approve_chk" CHECK (
    "decision" <> 'approve' OR ("technical_passed" AND "safety_passed")
  ),
  CONSTRAINT "story_film_trailer_take_reviews_rejection_notes_chk" CHECK (
    "decision" = 'approve' OR ("notes" IS NOT NULL AND btrim("notes") <> '')
  )
);

CREATE TABLE "story_film_trailer_take_approvals" (
  "take_id" UUID NOT NULL,
  "review_id" UUID NOT NULL,
  "approved_by_user_id" VARCHAR(64) NOT NULL,
  "approved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_film_trailer_take_approvals_pkey" PRIMARY KEY ("take_id")
);

ALTER TABLE "story_film_trailers"
  ADD CONSTRAINT "story_film_trailers_revision_id_key" UNIQUE ("revision_id"),
  ADD CONSTRAINT "story_film_trailers_master_take_id_key" UNIQUE ("master_take_id"),
  ADD CONSTRAINT "story_film_trailers_scope_unique" UNIQUE ("id", "story_project_id", "revision_id");
CREATE INDEX "story_film_trailers_scope_idx"
  ON "story_film_trailers" ("story_project_id", "revision_id");

ALTER TABLE "story_film_trailer_references"
  ADD CONSTRAINT "story_film_trailer_references_trailer_role_position_unique"
    UNIQUE ("trailer_id", "role", "position"),
  ADD CONSTRAINT "story_film_trailer_references_trailer_slot_role_unique"
    UNIQUE ("trailer_id", "reference_slot_id", "role");
CREATE UNIQUE INDEX "story_film_trailer_references_one_first_frame_idx"
  ON "story_film_trailer_references" ("trailer_id") WHERE "role" = 'first_frame';
CREATE UNIQUE INDEX "story_film_trailer_references_one_last_frame_idx"
  ON "story_film_trailer_references" ("trailer_id") WHERE "role" = 'last_frame';
CREATE INDEX "story_film_trailer_references_scope_slot_idx"
  ON "story_film_trailer_references" ("story_project_id", "revision_id", "reference_slot_id");

ALTER TABLE "story_film_trailer_takes"
  ADD CONSTRAINT "story_film_trailer_takes_submission_key_key" UNIQUE ("submission_key"),
  ADD CONSTRAINT "story_film_trailer_takes_ai_job_id_key" UNIQUE ("ai_job_id"),
  ADD CONSTRAINT "story_film_trailer_takes_ai_job_output_id_key" UNIQUE ("ai_job_output_id"),
  ADD CONSTRAINT "story_film_trailer_takes_trailer_number_unique" UNIQUE ("trailer_id", "take_number"),
  ADD CONSTRAINT "story_film_trailer_takes_id_trailer_unique" UNIQUE ("id", "trailer_id"),
  ADD CONSTRAINT "story_film_trailer_takes_scope_unique" UNIQUE ("id", "story_project_id", "revision_id");
CREATE INDEX "story_film_trailer_takes_scope_status_idx"
  ON "story_film_trailer_takes" ("story_project_id", "revision_id", "status", "created_at" DESC);

CREATE INDEX "story_film_trailer_take_references_scope_version_idx"
  ON "story_film_trailer_take_references" ("story_project_id", "revision_id", "reference_version_id");

ALTER TABLE "story_film_trailer_take_reviews"
  ADD CONSTRAINT "story_film_trailer_take_reviews_take_sequence_unique" UNIQUE ("take_id", "sequence"),
  ADD CONSTRAINT "story_film_trailer_take_reviews_id_take_unique" UNIQUE ("id", "take_id");
ALTER TABLE "story_film_trailer_take_approvals"
  ADD CONSTRAINT "story_film_trailer_take_approvals_review_id_key" UNIQUE ("review_id");

ALTER TABLE "story_film_trailers"
  ADD CONSTRAINT "story_film_trailers_story_project_id_fkey"
    FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_trailers_revision_id_fkey"
    FOREIGN KEY ("revision_id") REFERENCES "story_revisions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_trailers_revision_scope_fkey"
    FOREIGN KEY ("revision_id", "story_project_id")
    REFERENCES "story_revisions"("id", "story_project_id") ON DELETE RESTRICT;

ALTER TABLE "story_film_trailer_references"
  ADD CONSTRAINT "story_film_trailer_references_story_project_id_fkey"
    FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_trailer_references_revision_id_fkey"
    FOREIGN KEY ("revision_id") REFERENCES "story_revisions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_trailer_references_trailer_id_fkey"
    FOREIGN KEY ("trailer_id") REFERENCES "story_film_trailers"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "story_film_trailer_references_trailer_scope_fkey"
    FOREIGN KEY ("trailer_id", "story_project_id", "revision_id")
    REFERENCES "story_film_trailers"("id", "story_project_id", "revision_id") ON DELETE CASCADE,
  ADD CONSTRAINT "story_film_trailer_references_reference_slot_id_fkey"
    FOREIGN KEY ("reference_slot_id") REFERENCES "story_film_reference_slots"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_trailer_references_slot_scope_fkey"
    FOREIGN KEY ("reference_slot_id", "story_project_id", "revision_id")
    REFERENCES "story_film_reference_slots"("id", "story_project_id", "revision_id") ON DELETE RESTRICT;

ALTER TABLE "story_film_trailer_takes"
  ADD CONSTRAINT "story_film_trailer_takes_story_project_id_fkey"
    FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_trailer_takes_revision_id_fkey"
    FOREIGN KEY ("revision_id") REFERENCES "story_revisions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_trailer_takes_trailer_id_fkey"
    FOREIGN KEY ("trailer_id") REFERENCES "story_film_trailers"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_trailer_takes_trailer_scope_fkey"
    FOREIGN KEY ("trailer_id", "story_project_id", "revision_id")
    REFERENCES "story_film_trailers"("id", "story_project_id", "revision_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_trailer_takes_ai_job_id_fkey"
    FOREIGN KEY ("ai_job_id") REFERENCES "ai_jobs"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_trailer_takes_ai_job_output_id_fkey"
    FOREIGN KEY ("ai_job_output_id") REFERENCES "ai_outputs"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_trailer_takes_output_asset_id_fkey"
    FOREIGN KEY ("output_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_trailer_takes_output_variant_id_fkey"
    FOREIGN KEY ("output_variant_id") REFERENCES "media_asset_variants"("id") ON DELETE RESTRICT;

ALTER TABLE "story_film_trailers"
  ADD CONSTRAINT "story_film_trailers_master_take_id_fkey"
    FOREIGN KEY ("master_take_id") REFERENCES "story_film_trailer_takes"("id") ON DELETE NO ACTION,
  ADD CONSTRAINT "story_film_trailers_master_take_scope_fkey"
    FOREIGN KEY ("master_take_id", "id")
    REFERENCES "story_film_trailer_takes"("id", "trailer_id") ON DELETE NO ACTION;

ALTER TABLE "story_film_trailer_take_references"
  ADD CONSTRAINT "story_film_trailer_take_references_story_project_id_fkey"
    FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_trailer_take_references_revision_id_fkey"
    FOREIGN KEY ("revision_id") REFERENCES "story_revisions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_trailer_take_references_take_id_fkey"
    FOREIGN KEY ("take_id") REFERENCES "story_film_trailer_takes"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_trailer_take_references_take_scope_fkey"
    FOREIGN KEY ("take_id", "story_project_id", "revision_id")
    REFERENCES "story_film_trailer_takes"("id", "story_project_id", "revision_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_trailer_take_references_reference_slot_id_fkey"
    FOREIGN KEY ("reference_slot_id") REFERENCES "story_film_reference_slots"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_trailer_take_references_slot_scope_fkey"
    FOREIGN KEY ("reference_slot_id", "story_project_id", "revision_id")
    REFERENCES "story_film_reference_slots"("id", "story_project_id", "revision_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_trailer_take_references_reference_version_id_fkey"
    FOREIGN KEY ("reference_version_id") REFERENCES "story_film_reference_versions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_trailer_take_references_version_slot_fkey"
    FOREIGN KEY ("reference_version_id", "reference_slot_id")
    REFERENCES "story_film_reference_versions"("id", "reference_slot_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_trailer_take_references_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT;

ALTER TABLE "story_film_trailer_take_reviews"
  ADD CONSTRAINT "story_film_trailer_take_reviews_take_id_fkey"
    FOREIGN KEY ("take_id") REFERENCES "story_film_trailer_takes"("id") ON DELETE RESTRICT;
ALTER TABLE "story_film_trailer_take_approvals"
  ADD CONSTRAINT "story_film_trailer_take_approvals_take_id_fkey"
    FOREIGN KEY ("take_id") REFERENCES "story_film_trailer_takes"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_trailer_take_approvals_review_id_fkey"
    FOREIGN KEY ("review_id") REFERENCES "story_film_trailer_take_reviews"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_film_trailer_take_approvals_review_scope_fkey"
    FOREIGN KEY ("review_id", "take_id")
    REFERENCES "story_film_trailer_take_reviews"("id", "take_id") ON DELETE RESTRICT;

CREATE TRIGGER "story_film_trailers_scope_guard_trg"
BEFORE INSERT OR UPDATE OF "story_project_id", "revision_id" ON "story_film_trailers"
FOR EACH ROW EXECUTE FUNCTION "story_assert_film_scope"();
CREATE TRIGGER "story_film_trailer_references_scope_guard_trg"
BEFORE INSERT OR UPDATE OF "story_project_id", "revision_id" ON "story_film_trailer_references"
FOR EACH ROW EXECUTE FUNCTION "story_assert_film_scope"();
CREATE TRIGGER "story_film_trailer_takes_scope_guard_trg"
BEFORE INSERT OR UPDATE OF "story_project_id", "revision_id" ON "story_film_trailer_takes"
FOR EACH ROW EXECUTE FUNCTION "story_assert_film_scope"();
CREATE TRIGGER "story_film_trailer_take_references_scope_guard_trg"
BEFORE INSERT OR UPDATE OF "story_project_id", "revision_id" ON "story_film_trailer_take_references"
FOR EACH ROW EXECUTE FUNCTION "story_assert_film_scope"();

CREATE FUNCTION "story_film_trailer_version_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."story_project_id" IS DISTINCT FROM OLD."story_project_id"
     OR NEW."revision_id" IS DISTINCT FROM OLD."revision_id"
     OR NEW."title" IS DISTINCT FROM OLD."title"
     OR NEW."generation_mode" IS DISTINCT FROM OLD."generation_mode"
     OR NEW."frame_mode" IS DISTINCT FROM OLD."frame_mode"
     OR NEW."target_duration_ms" IS DISTINCT FROM OLD."target_duration_ms"
     OR NEW."spec_json" IS DISTINCT FROM OLD."spec_json"
     OR NEW."spec_hash" IS DISTINCT FROM OLD."spec_hash"
     OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'StoryFilmTrailer immutable revision fields cannot change'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'StoryFilmTrailer update must increment version by exactly one'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."master_take_id" IS DISTINCT FROM OLD."master_take_id"
     AND NEW."master_revision" <> OLD."master_revision" + 1 THEN
    RAISE EXCEPTION 'StoryFilmTrailer Master change must increment masterRevision'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "story_film_trailers_version_guard_trg"
BEFORE UPDATE ON "story_film_trailers"
FOR EACH ROW EXECUTE FUNCTION "story_film_trailer_version_guard"();

CREATE FUNCTION "story_film_trailer_take_lifecycle_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  review_only_update BOOLEAN;
BEGIN
  IF NEW."story_project_id" IS DISTINCT FROM OLD."story_project_id"
     OR NEW."revision_id" IS DISTINCT FROM OLD."revision_id"
     OR NEW."trailer_id" IS DISTINCT FROM OLD."trailer_id"
     OR NEW."take_number" IS DISTINCT FROM OLD."take_number"
     OR NEW."submission_key" IS DISTINCT FROM OLD."submission_key"
     OR NEW."trailer_spec_hash" IS DISTINCT FROM OLD."trailer_spec_hash"
     OR NEW."production_input_hash" IS DISTINCT FROM OLD."production_input_hash"
     OR NEW."prompt_snapshot" IS DISTINCT FROM OLD."prompt_snapshot"
     OR NEW."generation_config" IS DISTINCT FROM OLD."generation_config"
     OR NEW."model_snapshot" IS DISTINCT FROM OLD."model_snapshot"
     OR NEW."ai_job_id" IS DISTINCT FROM OLD."ai_job_id"
     OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'StoryFilmTrailerTake frozen input fields are immutable'
      USING ERRCODE = '23514';
  END IF;

  review_only_update :=
    NEW."review_revision" = OLD."review_revision" + 1 AND
    NEW."version" IS NOT DISTINCT FROM OLD."version" AND
    NEW."status" IS NOT DISTINCT FROM OLD."status" AND
    NEW."ai_job_output_id" IS NOT DISTINCT FROM OLD."ai_job_output_id" AND
    NEW."output_asset_id" IS NOT DISTINCT FROM OLD."output_asset_id" AND
    NEW."output_variant_id" IS NOT DISTINCT FROM OLD."output_variant_id" AND
    NEW."output_checksum_sha256" IS NOT DISTINCT FROM OLD."output_checksum_sha256" AND
    NEW."technical_checks" IS NOT DISTINCT FROM OLD."technical_checks" AND
    NEW."error" IS NOT DISTINCT FROM OLD."error" AND
    NEW."queued_at" IS NOT DISTINCT FROM OLD."queued_at" AND
    NEW."started_at" IS NOT DISTINCT FROM OLD."started_at" AND
    NEW."ready_at" IS NOT DISTINCT FROM OLD."ready_at" AND
    NEW."cancelled_at" IS NOT DISTINCT FROM OLD."cancelled_at" AND
    NEW."superseded_at" IS NOT DISTINCT FROM OLD."superseded_at" AND
    NEW."completed_at" IS NOT DISTINCT FROM OLD."completed_at";
  IF review_only_update THEN
    IF pg_trigger_depth() < 2 THEN
      RAISE EXCEPTION 'StoryFilmTrailerTake reviewRevision is trigger-managed'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."review_revision" IS DISTINCT FROM OLD."review_revision" THEN
    RAISE EXCEPTION 'StoryFilmTrailerTake reviewRevision is trigger-managed'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'StoryFilmTrailerTake update must increment version by exactly one'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."status" IN ('ready', 'failed', 'cancelled') THEN
    IF NEW."status" IS DISTINCT FROM OLD."status"
       OR NEW."ai_job_output_id" IS DISTINCT FROM OLD."ai_job_output_id"
       OR NEW."output_asset_id" IS DISTINCT FROM OLD."output_asset_id"
       OR NEW."output_variant_id" IS DISTINCT FROM OLD."output_variant_id"
       OR NEW."output_checksum_sha256" IS DISTINCT FROM OLD."output_checksum_sha256"
       OR NEW."technical_checks" IS DISTINCT FROM OLD."technical_checks"
       OR NEW."error" IS DISTINCT FROM OLD."error"
       OR NEW."queued_at" IS DISTINCT FROM OLD."queued_at"
       OR NEW."started_at" IS DISTINCT FROM OLD."started_at"
       OR NEW."ready_at" IS DISTINCT FROM OLD."ready_at"
       OR NEW."cancelled_at" IS DISTINCT FROM OLD."cancelled_at"
       OR NEW."completed_at" IS DISTINCT FROM OLD."completed_at" THEN
      RAISE EXCEPTION 'Terminal StoryFilmTrailerTake output is immutable'
        USING ERRCODE = '55000';
    END IF;
  ELSIF NOT (
    NEW."status" = OLD."status" OR
    (OLD."status" = 'queued' AND NEW."status" IN ('running', 'processing', 'ready', 'failed', 'cancelled')) OR
    (OLD."status" = 'running' AND NEW."status" IN ('processing', 'ready', 'failed', 'cancelled')) OR
    (OLD."status" = 'processing' AND NEW."status" IN ('ready', 'failed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'Invalid StoryFilmTrailerTake status transition % -> %',
      OLD."status", NEW."status" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "story_film_trailer_takes_lifecycle_guard_trg"
BEFORE UPDATE ON "story_film_trailer_takes"
FOR EACH ROW EXECUTE FUNCTION "story_film_trailer_take_lifecycle_guard"();

-- The existing workspace guard is record-polymorphic and validates the same
-- AiJob/MediaAsset/Variant fields for both Clip and Trailer Takes.
CREATE TRIGGER "story_film_trailer_takes_workspace_guard_trg"
BEFORE INSERT OR UPDATE ON "story_film_trailer_takes"
FOR EACH ROW EXECUTE FUNCTION "story_take_workspace_guard"();

CREATE FUNCTION "story_film_trailer_take_review_revision_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  current_revision INTEGER;
  take_status "StoryFilmTakeStatus";
BEGIN
  SELECT "review_revision", "status" INTO current_revision, take_status
  FROM "story_film_trailer_takes" WHERE "id" = NEW."take_id" FOR UPDATE;
  IF take_status IS DISTINCT FROM 'ready'::"StoryFilmTakeStatus" THEN
    RAISE EXCEPTION 'Only a ready Trailer Take may be reviewed'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "story_film_trailer_take_approvals" WHERE "take_id" = NEW."take_id"
  ) THEN
    RAISE EXCEPTION 'Approved Trailer Take cannot receive another Review'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."sequence" <> current_revision + 1 THEN
    RAISE EXCEPTION 'Trailer Take review sequence conflict'
      USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "story_film_trailer_take_reviews_revision_guard_trg"
BEFORE INSERT ON "story_film_trailer_take_reviews"
FOR EACH ROW EXECUTE FUNCTION "story_film_trailer_take_review_revision_guard"();

CREATE FUNCTION "story_film_trailer_take_review_bump_revision"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "story_film_trailer_takes"
  SET "review_revision" = "review_revision" + 1,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE "id" = NEW."take_id";
  RETURN NULL;
END;
$$;
CREATE TRIGGER "story_film_trailer_take_reviews_bump_revision_trg"
AFTER INSERT ON "story_film_trailer_take_reviews"
FOR EACH ROW EXECUTE FUNCTION "story_film_trailer_take_review_bump_revision"();

CREATE FUNCTION "story_film_trailer_take_approval_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  review_row "story_film_trailer_take_reviews"%ROWTYPE;
  take_status "StoryFilmTakeStatus";
  current_review_revision INTEGER;
  take_creator VARCHAR(64);
  review_policy "StoryFilmReviewPolicy";
BEGIN
  SELECT * INTO review_row FROM "story_film_trailer_take_reviews"
  WHERE "id" = NEW."review_id";
  IF review_row."take_id" IS DISTINCT FROM NEW."take_id"
     OR review_row."decision" <> 'approve'
     OR NOT review_row."technical_passed"
     OR NOT review_row."safety_passed"
     OR review_row."reviewer_user_id" IS DISTINCT FROM NEW."approved_by_user_id" THEN
    RAISE EXCEPTION 'Trailer Take Approval must point to its passing approve Review'
      USING ERRCODE = '23514';
  END IF;
  SELECT t."status", t."review_revision", t."created_by_user_id", s."review_policy"
    INTO take_status, current_review_revision, take_creator, review_policy
  FROM "story_film_trailer_takes" t
  JOIN "story_film_specs" s ON s."revision_id" = t."revision_id"
  WHERE t."id" = NEW."take_id";
  IF take_status IS DISTINCT FROM 'ready'::"StoryFilmTakeStatus"
     OR review_row."sequence" IS DISTINCT FROM current_review_revision THEN
    RAISE EXCEPTION 'Trailer Take Approval requires the latest ready Take Review'
      USING ERRCODE = '23514';
  END IF;
  IF review_policy = 'four_eyes' AND take_creator = NEW."approved_by_user_id" THEN
    RAISE EXCEPTION 'four_eyes policy forbids Trailer Take self-approval'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "story_film_trailer_take_approvals_guard_trg"
BEFORE INSERT ON "story_film_trailer_take_approvals"
FOR EACH ROW EXECUTE FUNCTION "story_film_trailer_take_approval_guard"();

CREATE FUNCTION "story_film_trailer_master_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  take_row "story_film_trailer_takes"%ROWTYPE;
BEGIN
  IF NEW."master_take_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO take_row FROM "story_film_trailer_takes"
  WHERE "id" = NEW."master_take_id";
  IF take_row."trailer_id" IS DISTINCT FROM NEW."id"
     OR take_row."story_project_id" IS DISTINCT FROM NEW."story_project_id"
     OR take_row."revision_id" IS DISTINCT FROM NEW."revision_id"
     OR take_row."status" <> 'ready'
     OR take_row."superseded_at" IS NOT NULL
     OR NEW."production_input_manifest" IS NULL
     OR NEW."production_input_hash" IS NULL
     OR take_row."trailer_spec_hash" IS DISTINCT FROM NEW."spec_hash"
     OR take_row."production_input_hash" IS DISTINCT FROM NEW."production_input_hash"
     OR NOT EXISTS (
       SELECT 1 FROM "story_film_trailer_take_approvals" WHERE "take_id" = take_row."id"
     ) THEN
    RAISE EXCEPTION 'Trailer Master must be approved, ready, current and belong to the Trailer'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "story_film_trailer_references" r
    JOIN "story_film_reference_slots" s ON s."id" = r."reference_slot_id"
    LEFT JOIN "story_film_trailer_take_references" tr
      ON tr."take_id" = take_row."id"
     AND tr."reference_slot_id" = r."reference_slot_id"
     AND tr."role" = r."role"
     AND tr."position" = r."position"
     AND tr."reference_version_id" = s."approved_version_id"
    WHERE r."trailer_id" = NEW."id" AND r."required"
      AND (s."approved_version_id" IS NULL OR tr."take_id" IS NULL)
  ) THEN
    RAISE EXCEPTION 'Trailer Master does not pin every approved required reference'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "story_film_trailers_master_guard_trg"
BEFORE INSERT OR UPDATE OF "master_take_id" ON "story_film_trailers"
FOR EACH ROW EXECUTE FUNCTION "story_film_trailer_master_guard"();

CREATE FUNCTION "story_film_trailer_take_reference_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  version_row "story_film_reference_versions"%ROWTYPE;
  approved_version UUID;
  asset_workspace UUID;
  project_workspace UUID;
  take_status "StoryFilmTakeStatus";
BEGIN
  SELECT * INTO version_row FROM "story_film_reference_versions"
  WHERE "id" = NEW."reference_version_id";
  SELECT "approved_version_id" INTO approved_version
  FROM "story_film_reference_slots" WHERE "id" = NEW."reference_slot_id";
  SELECT "workspace_id" INTO project_workspace
  FROM "story_projects" WHERE "id" = NEW."story_project_id";
  SELECT "workspace_id" INTO asset_workspace
  FROM "media_assets" WHERE "id" = NEW."asset_id";
  SELECT "status" INTO take_status
  FROM "story_film_trailer_takes" WHERE "id" = NEW."take_id";
  IF take_status IS DISTINCT FROM 'queued'::"StoryFilmTakeStatus"
     OR version_row."reference_slot_id" IS DISTINCT FROM NEW."reference_slot_id"
     OR version_row."story_project_id" IS DISTINCT FROM NEW."story_project_id"
     OR version_row."revision_id" IS DISTINCT FROM NEW."revision_id"
     OR version_row."status" <> 'ready'
     OR version_row."asset_id" IS DISTINCT FROM NEW."asset_id"
     OR version_row."checksum_sha256" IS DISTINCT FROM NEW."checksum_sha256"
     OR approved_version IS DISTINCT FROM NEW."reference_version_id"
     OR asset_workspace IS NULL OR asset_workspace <> project_workspace THEN
    RAISE EXCEPTION 'TrailerTakeReference must freeze the current approved ReferenceVersion asset'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "story_film_trailer_take_references_guard_trg"
BEFORE INSERT ON "story_film_trailer_take_references"
FOR EACH ROW EXECUTE FUNCTION "story_film_trailer_take_reference_guard"();
CREATE TRIGGER "story_film_trailer_take_references_immutable_trg"
BEFORE UPDATE OR DELETE ON "story_film_trailer_take_references"
FOR EACH ROW EXECUTE FUNCTION "story_prevent_mutation"();

CREATE FUNCTION "story_film_trailer_reference_mode_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  trailer_mode "StoryFilmGenerationMode";
  trailer_frame_mode "StoryFilmFrameMode";
  slot_kind "StoryFilmReferenceKind";
BEGIN
  SELECT "generation_mode", "frame_mode" INTO trailer_mode, trailer_frame_mode
  FROM "story_film_trailers" WHERE "id" = NEW."trailer_id";
  SELECT "kind" INTO slot_kind
  FROM "story_film_reference_slots" WHERE "id" = NEW."reference_slot_id";
  IF slot_kind IS NULL OR NOT "story_clip_reference_role_matches_slot_kind"(
    NEW."role", slot_kind
  ) THEN
    RAISE EXCEPTION 'FilmTrailerReference role % is incompatible with ReferenceSlot kind %',
      NEW."role", slot_kind USING ERRCODE = '23514';
  END IF;
  IF trailer_mode = 'frame_lock' AND NEW."role" = 'omni' THEN
    RAISE EXCEPTION 'frame_lock FilmTrailer cannot bind omni references'
      USING ERRCODE = '23514';
  END IF;
  IF trailer_mode = 'omni_reference' AND NEW."role" IN ('first_frame', 'last_frame') THEN
    RAISE EXCEPTION 'omni_reference FilmTrailer cannot bind first/last frames'
      USING ERRCODE = '23514';
  END IF;
  IF trailer_frame_mode = 'first_frame' AND NEW."role" = 'last_frame' THEN
    RAISE EXCEPTION 'first_frame FilmTrailer cannot bind a last frame'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "story_film_trailer_references_mode_guard_trg"
BEFORE INSERT OR UPDATE ON "story_film_trailer_references"
FOR EACH ROW EXECUTE FUNCTION "story_film_trailer_reference_mode_guard"();

CREATE OR REPLACE FUNCTION "story_reference_slot_kind_bindings_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."kind" IS DISTINCT FROM OLD."kind" AND (
    EXISTS (
      SELECT 1 FROM "story_film_clip_references" binding
      WHERE binding."reference_slot_id" = NEW."id"
        AND NOT "story_clip_reference_role_matches_slot_kind"(
          binding."role", NEW."kind"
        )
    ) OR EXISTS (
      SELECT 1 FROM "story_film_trailer_references" binding
      WHERE binding."reference_slot_id" = NEW."id"
        AND NOT "story_clip_reference_role_matches_slot_kind"(
          binding."role", NEW."kind"
        )
    )
  ) THEN
    RAISE EXCEPTION 'ReferenceSlot kind update conflicts with an existing production binding'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Replace the Clip-only invalidation function from the reference write-plane
-- migration. Trailer changes remain isolated from runtime productionRevision.
DROP TRIGGER "story_film_reference_slots_approval_invalidate_clips_trg"
  ON "story_film_reference_slots";
DROP FUNCTION "story_reference_approval_invalidate_clips"();

CREATE FUNCTION "story_reference_approval_invalidate_production"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."approved_version_id" IS NOT DISTINCT FROM OLD."approved_version_id" THEN
    RETURN NULL;
  END IF;

  UPDATE "story_film_clips" c
  SET "production_input_manifest" = NULL,
      "production_input_hash" = NULL,
      "version" = c."version" + 1,
      "master_take_id" = NULL,
      "master_revision" = c."master_revision" +
        CASE WHEN c."master_take_id" IS NULL THEN 0 ELSE 1 END,
      "master_selected_by_user_id" = NULL,
      "master_selected_at" = NULL,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE c."archived_at" IS NULL
    AND (c."production_input_hash" IS NOT NULL OR c."master_take_id" IS NOT NULL)
    AND EXISTS (
      SELECT 1 FROM "story_film_clip_references" r
      WHERE r."clip_id" = c."id" AND r."reference_slot_id" = NEW."id"
    );

  UPDATE "story_film_trailers" t
  SET "production_input_manifest" = NULL,
      "production_input_hash" = NULL,
      "version" = t."version" + 1,
      "master_take_id" = NULL,
      "master_revision" = t."master_revision" +
        CASE WHEN t."master_take_id" IS NULL THEN 0 ELSE 1 END,
      "master_selected_by_user_id" = NULL,
      "master_selected_at" = NULL,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE (t."production_input_hash" IS NOT NULL OR t."master_take_id" IS NOT NULL)
    AND EXISTS (
      SELECT 1 FROM "story_film_trailer_references" r
      WHERE r."trailer_id" = t."id" AND r."reference_slot_id" = NEW."id"
    );
  RETURN NULL;
END;
$$;
CREATE TRIGGER "story_film_reference_slots_approval_invalidate_production_trg"
AFTER UPDATE OF "approved_version_id" ON "story_film_reference_slots"
FOR EACH ROW EXECUTE FUNCTION "story_reference_approval_invalidate_production"();
