-- Story project frame profile becomes optional.
--
-- The project-wide frame contract is now film-only. An `interactive_film`
-- project still owns exactly one immutable profile; a text-first
-- (`text_adventure`) project sets no profile at all and any video it contains
-- plays inline at native size. Existing rows keep their value, so this is a
-- pure nullability relaxation with no backfill.
--
-- The existing "story_project_identity_guard" already compares frame_profile
-- with IS DISTINCT FROM, so a row that is created null and stays null passes
-- the immutability check unchanged.

ALTER TABLE "story_projects"
  ALTER COLUMN "frame_profile" DROP NOT NULL;
