-- Formal publication is owned by the Java release service. Nest keeps the
-- reproducible StoryBuild artifact and must not maintain a competing release,
-- approval, or deployment authority.

BEGIN;

DROP TABLE "story_release_approvals";
DROP TABLE "story_deployments";
DROP TABLE "story_release_reviews";
DROP TABLE "story_release_assets";
DROP TABLE "story_releases";

ALTER TABLE "story_projects"
  DROP COLUMN "next_release_version",
  DROP COLUMN "publish_revision";

DROP TYPE "StoryDeploymentEnvironment";
DROP TYPE "StoryDeploymentStatus";
DROP TYPE "StoryReleaseChannel";

COMMIT;
