-- Story Studio creator state is project-scoped. Immutable StoryRevision rows
-- remain build inputs, while these heads identify the current production row
-- for every stable graph node and for the optional trailer.

ALTER TABLE "story_film_clips"
  ADD CONSTRAINT "story_film_clips_id_project_unique"
  UNIQUE ("id", "story_project_id");

ALTER TABLE "story_film_trailers"
  ADD CONSTRAINT "story_film_trailers_id_project_unique"
  UNIQUE ("id", "story_project_id");

CREATE TABLE "story_film_clip_heads" (
  "story_project_id" UUID NOT NULL,
  "graph_node_id" VARCHAR(128) NOT NULL,
  "clip_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_film_clip_heads_pkey"
    PRIMARY KEY ("story_project_id", "graph_node_id"),
  CONSTRAINT "story_film_clip_heads_clip_id_key" UNIQUE ("clip_id"),
  CONSTRAINT "story_film_clip_heads_clip_project_unique"
    UNIQUE ("clip_id", "story_project_id"),
  CONSTRAINT "story_film_clip_heads_project_fkey"
    FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "story_film_clip_heads_clip_project_fkey"
    FOREIGN KEY ("clip_id", "story_project_id")
    REFERENCES "story_film_clips"("id", "story_project_id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "story_film_clip_heads_project_recent_idx"
  ON "story_film_clip_heads"("story_project_id", "updated_at" DESC);

CREATE TABLE "story_film_trailer_heads" (
  "story_project_id" UUID NOT NULL,
  "trailer_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_film_trailer_heads_pkey" PRIMARY KEY ("story_project_id"),
  CONSTRAINT "story_film_trailer_heads_trailer_id_key" UNIQUE ("trailer_id"),
  CONSTRAINT "story_film_trailer_heads_trailer_project_unique"
    UNIQUE ("trailer_id", "story_project_id"),
  CONSTRAINT "story_film_trailer_heads_project_fkey"
    FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "story_film_trailer_heads_trailer_project_fkey"
    FOREIGN KEY ("trailer_id", "story_project_id")
    REFERENCES "story_film_trailers"("id", "story_project_id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Backfill every project/node with the newest real production row. This
-- repairs existing partial creator Revisions without copying or fabricating
-- media: untouched heads point to their last persisted Clip row.
INSERT INTO "story_film_clip_heads" (
  "story_project_id",
  "graph_node_id",
  "clip_id"
)
SELECT DISTINCT ON (clip."story_project_id", clip."graph_node_id")
  clip."story_project_id",
  clip."graph_node_id",
  clip."id"
FROM "story_film_clips" AS clip
JOIN "story_revisions" AS revision ON revision."id" = clip."revision_id"
WHERE clip."archived_at" IS NULL
ORDER BY
  clip."story_project_id",
  clip."graph_node_id",
  revision."number" DESC,
  clip."updated_at" DESC,
  clip."id" DESC;

INSERT INTO "story_film_trailer_heads" (
  "story_project_id",
  "trailer_id"
)
SELECT DISTINCT ON (trailer."story_project_id")
  trailer."story_project_id",
  trailer."id"
FROM "story_film_trailers" AS trailer
JOIN "story_revisions" AS revision ON revision."id" = trailer."revision_id"
ORDER BY
  trailer."story_project_id",
  revision."number" DESC,
  trailer."updated_at" DESC,
  trailer."id" DESC;

-- Every newly materialized production row becomes the project head. This
-- keeps imports, full Revision projection and explicit generation paths under
-- the same database invariant instead of relying on each caller to remember
-- an application-side upsert.
CREATE FUNCTION "story_film_clip_head_on_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "story_film_clip_heads" (
    "story_project_id",
    "graph_node_id",
    "clip_id",
    "created_at",
    "updated_at"
  ) VALUES (
    NEW."story_project_id",
    NEW."graph_node_id",
    NEW."id",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT ("story_project_id", "graph_node_id") DO UPDATE
  SET "clip_id" = EXCLUDED."clip_id", "updated_at" = CURRENT_TIMESTAMP
  WHERE (
    SELECT revision."number"
    FROM "story_revisions" AS revision
    WHERE revision."id" = NEW."revision_id"
  ) >= (
    SELECT revision."number"
    FROM "story_film_clips" AS current_clip
    JOIN "story_revisions" AS revision
      ON revision."id" = current_clip."revision_id"
    WHERE current_clip."id" = "story_film_clip_heads"."clip_id"
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_clip_head_after_insert"
AFTER INSERT ON "story_film_clips"
FOR EACH ROW EXECUTE FUNCTION "story_film_clip_head_on_insert"();

CREATE FUNCTION "story_film_trailer_head_on_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "story_film_trailer_heads" (
    "story_project_id",
    "trailer_id",
    "created_at",
    "updated_at"
  ) VALUES (
    NEW."story_project_id",
    NEW."id",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT ("story_project_id") DO UPDATE
  SET "trailer_id" = EXCLUDED."trailer_id", "updated_at" = CURRENT_TIMESTAMP
  WHERE (
    SELECT revision."number"
    FROM "story_revisions" AS revision
    WHERE revision."id" = NEW."revision_id"
  ) >= (
    SELECT revision."number"
    FROM "story_film_trailers" AS current_trailer
    JOIN "story_revisions" AS revision
      ON revision."id" = current_trailer."revision_id"
    WHERE current_trailer."id" = "story_film_trailer_heads"."trailer_id"
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_trailer_head_after_insert"
AFTER INSERT ON "story_film_trailers"
FOR EACH ROW EXECUTE FUNCTION "story_film_trailer_head_on_insert"();
