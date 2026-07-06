-- IP engagement foundation: public views, likes, and fast aggregate counters.
-- Events keep the audit/idempotency trail; aggregates keep list/detail reads cheap.

CREATE TYPE "IpEngagementActorKind" AS ENUM ('human', 'agent');
CREATE TYPE "IpLikeStatus" AS ENUM ('active', 'removed');

CREATE TABLE "ip_engagement_aggregates" (
  "ip_id" UUID NOT NULL,
  "human_view_count" BIGINT NOT NULL DEFAULT 0,
  "agent_view_count" BIGINT NOT NULL DEFAULT 0,
  "total_view_count" BIGINT NOT NULL DEFAULT 0,
  "human_like_count" BIGINT NOT NULL DEFAULT 0,
  "agent_like_count" BIGINT NOT NULL DEFAULT 0,
  "total_like_count" BIGINT NOT NULL DEFAULT 0,
  "last_viewed_at" TIMESTAMPTZ(6),
  "last_liked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ip_engagement_aggregates_pkey" PRIMARY KEY ("ip_id"),
  CONSTRAINT "ip_engagement_aggregates_ip_id_fkey"
    FOREIGN KEY ("ip_id") REFERENCES "ips"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ip_view_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ip_id" UUID NOT NULL,
  "user_id" VARCHAR(64),
  "actor_kind" "IpEngagementActorKind" NOT NULL DEFAULT 'human',
  "idempotency_key" VARCHAR(160),
  "source" VARCHAR(64) NOT NULL DEFAULT 'public_api',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "viewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ip_view_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_view_events_ip_id_fkey"
    FOREIGN KEY ("ip_id") REFERENCES "ips"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ip_likes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ip_id" UUID NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "actor_kind" "IpEngagementActorKind" NOT NULL DEFAULT 'human',
  "status" "IpLikeStatus" NOT NULL DEFAULT 'active',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "liked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_at" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ip_likes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_likes_ip_id_fkey"
    FOREIGN KEY ("ip_id") REFERENCES "ips"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ip_view_events_idempotency_key_unique"
  ON "ip_view_events"("idempotency_key");
CREATE INDEX "ip_view_events_ip_recent_idx"
  ON "ip_view_events"("ip_id", "viewed_at" DESC);
CREATE INDEX "ip_view_events_user_recent_idx"
  ON "ip_view_events"("user_id", "viewed_at" DESC);
CREATE INDEX "ip_view_events_actor_recent_idx"
  ON "ip_view_events"("actor_kind", "viewed_at" DESC);

CREATE UNIQUE INDEX "ip_likes_ip_user_unique"
  ON "ip_likes"("ip_id", "user_id");
CREATE INDEX "ip_likes_ip_status_idx"
  ON "ip_likes"("ip_id", "status");
CREATE INDEX "ip_likes_user_recent_idx"
  ON "ip_likes"("user_id", "status", "liked_at" DESC);
CREATE INDEX "ip_likes_actor_recent_idx"
  ON "ip_likes"("actor_kind", "status", "liked_at" DESC);

CREATE INDEX "ip_engagement_view_rank_idx"
  ON "ip_engagement_aggregates"("total_view_count" DESC, "updated_at" DESC);
CREATE INDEX "ip_engagement_like_rank_idx"
  ON "ip_engagement_aggregates"("total_like_count" DESC, "updated_at" DESC);
