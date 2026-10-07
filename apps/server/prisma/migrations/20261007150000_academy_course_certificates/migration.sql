CREATE TABLE "academy_course_certificates" (
    "course_id" VARCHAR(128) PRIMARY KEY,
    "certificate_id" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "academy_certificate_positive" CHECK ("certificate_id" IS NULL OR "certificate_id" > 0),
    CONSTRAINT "academy_mapping_version_positive" CHECK ("version" > 0)
);
CREATE INDEX "academy_course_certificate_idx" ON "academy_course_certificates"("certificate_id");
