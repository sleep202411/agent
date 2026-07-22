-- Story Studio chapter pages.
--
-- The canonical draft graph remains project-wide so existing build, video and
-- runtime identities stay stable. Chapters partition that graph by globally
-- unique node id and own their canvas projection. Every existing project is
-- migrated losslessly into one first chapter.

CREATE TABLE "story_chapters" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "rank" INTEGER NOT NULL,
  "node_ids" JSONB NOT NULL DEFAULT '[]'::JSONB,
  "entry_node_id" VARCHAR(120),
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_chapters_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_chapters_story_project_id_fkey"
    FOREIGN KEY ("story_project_id")
    REFERENCES "story_projects" ("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "story_chapters_title_nonempty_chk"
    CHECK (btrim("title") <> ''),
  CONSTRAINT "story_chapters_rank_nonnegative_chk"
    CHECK ("rank" >= 0),
  CONSTRAINT "story_chapters_node_ids_array_chk"
    CHECK (jsonb_typeof("node_ids") = 'array'),
  CONSTRAINT "story_chapters_entry_node_nonempty_chk"
    CHECK ("entry_node_id" IS NULL OR btrim("entry_node_id") <> '')
);

CREATE UNIQUE INDEX "story_chapters_id_project_unique"
  ON "story_chapters" ("id", "story_project_id");

CREATE UNIQUE INDEX "story_chapters_project_active_rank_unique"
  ON "story_chapters" ("story_project_id", "rank")
  WHERE "archived_at" IS NULL;

CREATE INDEX "story_chapters_project_rank_idx"
  ON "story_chapters" ("story_project_id", "rank");

INSERT INTO "story_chapters" (
  "id",
  "story_project_id",
  "title",
  "rank",
  "node_ids",
  "entry_node_id",
  "created_by_user_id",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  project."id",
  CASE
    WHEN LOWER(project."default_locale") LIKE 'zh%' THEN '第 1 章'
    ELSE 'Chapter 1'
  END,
  0,
  COALESCE(
    (
      SELECT jsonb_agg(node.value ->> 'nodeId' ORDER BY node.ordinality)
      FROM jsonb_array_elements(
        COALESCE(draft."content" #> '{graph,nodes}', '[]'::JSONB)
      ) WITH ORDINALITY AS node(value, ordinality)
      WHERE jsonb_typeof(node.value -> 'nodeId') = 'string'
    ),
    '[]'::JSONB
  ),
  NULLIF(draft."content" #>> '{graph,entryNodeId}', ''),
  project."created_by_user_id",
  project."created_at",
  CURRENT_TIMESTAMP
FROM "story_projects" AS project
JOIN "story_drafts" AS draft
  ON draft."story_project_id" = project."id";

ALTER TABLE "story_canvas_layouts"
  ADD COLUMN "story_chapter_id" UUID;

UPDATE "story_canvas_layouts" AS layout
SET "story_chapter_id" = chapter."id"
FROM "story_chapters" AS chapter
WHERE chapter."story_project_id" = layout."story_project_id"
  AND chapter."rank" = 0;

ALTER TABLE "story_canvas_layouts"
  ALTER COLUMN "story_chapter_id" SET NOT NULL;

ALTER TABLE "story_canvas_layouts"
  DROP CONSTRAINT "story_canvas_layouts_pkey";

ALTER TABLE "story_canvas_layouts"
  ADD CONSTRAINT "story_canvas_layouts_pkey"
  PRIMARY KEY ("story_chapter_id");

ALTER TABLE "story_canvas_layouts"
  ADD CONSTRAINT "story_canvas_layouts_chapter_project_fkey"
  FOREIGN KEY ("story_chapter_id", "story_project_id")
  REFERENCES "story_chapters" ("id", "story_project_id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

CREATE UNIQUE INDEX "story_canvas_layouts_chapter_project_unique"
  ON "story_canvas_layouts" (
    "story_chapter_id",
    "story_project_id"
  );

CREATE INDEX "story_canvas_layouts_project_recent_idx"
  ON "story_canvas_layouts" ("story_project_id", "updated_at" DESC);

ALTER TABLE "story_agent_runs"
  ADD COLUMN "story_chapter_id" UUID;

UPDATE "story_agent_runs" AS runs
SET "story_chapter_id" = (
  SELECT chapter."id"
  FROM "story_chapters" AS chapter
  WHERE chapter."story_project_id" = runs."story_project_id"
    AND chapter."archived_at" IS NULL
  ORDER BY chapter."rank" ASC, chapter."id" ASC
  LIMIT 1
);

ALTER TABLE "story_agent_runs"
  ALTER COLUMN "story_chapter_id" SET NOT NULL;

CREATE INDEX "story_agent_runs_chapter_status_recent_idx"
  ON "story_agent_runs" ("story_chapter_id", "status", "created_at" DESC);

ALTER TABLE "story_agent_runs"
  ADD CONSTRAINT "story_agent_runs_story_chapter_id_story_project_id_fkey"
  FOREIGN KEY ("story_chapter_id", "story_project_id")
  REFERENCES "story_chapters" ("id", "story_project_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
