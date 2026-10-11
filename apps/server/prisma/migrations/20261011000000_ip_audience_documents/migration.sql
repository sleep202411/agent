ALTER TABLE "ips"
ADD COLUMN IF NOT EXISTS "audience_documents" JSONB NOT NULL DEFAULT '[]'::jsonb;
