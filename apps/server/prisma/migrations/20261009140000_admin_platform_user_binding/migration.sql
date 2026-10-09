-- Bind an admin console account to a Web/Java platform user so course teachers
-- can review homework as themselves after logging into admin-ui.
ALTER TABLE "admin_users" ADD COLUMN "platform_user_id" VARCHAR(64);

CREATE UNIQUE INDEX "admin_users_platform_user_id_key" ON "admin_users"("platform_user_id");
