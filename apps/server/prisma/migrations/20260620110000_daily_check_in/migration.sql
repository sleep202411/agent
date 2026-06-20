-- Daily check-in (每日签到): admin config + per-user daily records.
CREATE TABLE "check_in_configs" (
  "id" UUID NOT NULL,
  "key" VARCHAR(255) NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "rewards" INTEGER[],
  "updated_by_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "check_in_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "check_in_configs_key_key" ON "check_in_configs"("key");

CREATE TABLE "daily_check_ins" (
  "id" UUID NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "check_in_date" DATE NOT NULL,
  "streak_day" INTEGER NOT NULL,
  "amount" INTEGER NOT NULL,
  "workspace_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_check_ins_pkey" PRIMARY KEY ("id")
);

-- One check-in per user per day (atomic guard for the claim).
CREATE UNIQUE INDEX "daily_check_ins_user_date_unique" ON "daily_check_ins"("user_id", "check_in_date");
CREATE INDEX "daily_check_ins_user_idx" ON "daily_check_ins"("user_id");
