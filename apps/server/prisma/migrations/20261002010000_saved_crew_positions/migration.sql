CREATE TABLE "crew_saved_positions" (
 "user_id" VARCHAR(64) NOT NULL,
 "position_id" TEXT NOT NULL REFERENCES "crew_positions"("id") ON DELETE CASCADE,
 "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("user_id", "position_id")
);
CREATE INDEX "crew_saved_positions_user_id_created_at_idx" ON "crew_saved_positions"("user_id", "created_at" DESC);
