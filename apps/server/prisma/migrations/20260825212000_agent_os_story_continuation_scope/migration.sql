-- The LLM resolves the creator's requested production scope once, on the
-- initial story.author call. Every later approved-stage continuation reads
-- this immutable plan instead of asking the model to infer old intent again.
ALTER TABLE "agent_os_external_handoff_registrations"
  ADD COLUMN "continuation_plan" JSONB;

ALTER TABLE "agent_os_external_handoff_registrations"
  ADD CONSTRAINT "agent_os_external_handoffs_continuation_plan_object_check"
  CHECK (
    "continuation_plan" IS NULL
    OR jsonb_typeof("continuation_plan") = 'object'
  );
