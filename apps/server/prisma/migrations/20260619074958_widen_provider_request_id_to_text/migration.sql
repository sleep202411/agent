-- Widen provider_request_id from VARCHAR(180) to TEXT on the two tables that
-- store it. The Agnes video provider returns a `video_id` token we persist
-- verbatim as provider_request_id; it is currently ~174 chars with the length
-- set provider-side and no upper bound, so at 174/180 a longer id would fail the
-- attempt/trace INSERT with 22001 (value too long). varchar->text is binary
-- coercible: no table rewrite, existing indexes are preserved.
ALTER TABLE "ai_attempts" ALTER COLUMN "provider_request_id" SET DATA TYPE TEXT;
ALTER TABLE "ai_provider_trace_events" ALTER COLUMN "provider_request_id" SET DATA TYPE TEXT;
