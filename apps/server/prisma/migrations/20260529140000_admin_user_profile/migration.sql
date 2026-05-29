ALTER TABLE "admin_users"
  ADD COLUMN IF NOT EXISTS "avatar_url" VARCHAR(512);
