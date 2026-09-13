-- Historical jobs retain their original workspace after a document moves.
-- New admissions still require exact document/project/workspace agreement.
CREATE FUNCTION ai_job_document_admission_scope_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  document_project UUID;
  document_workspace UUID;
BEGIN
  IF NEW.document_id IS NULL THEN RETURN NEW; END IF;
  SELECT story_project_id INTO document_project FROM studio_documents WHERE id = NEW.document_id;
  IF document_project IS DISTINCT FROM NEW.story_project_id THEN
    RAISE EXCEPTION 'AI_JOB_DOCUMENT_SCOPE: job and document must belong to the same Story project' USING ERRCODE = '23514';
  END IF;
  -- Same lock order as movement: project, then its document.
  IF document_project IS NOT NULL THEN
    PERFORM id FROM story_projects WHERE id = document_project FOR SHARE;
  END IF;
  SELECT workspace_id INTO document_workspace FROM studio_documents WHERE id = NEW.document_id FOR SHARE;
  IF document_workspace IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'STORY_PROJECT_MOVED: job and document must belong to the same workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_jobs_document_admission_scope_trg BEFORE INSERT ON ai_jobs
FOR EACH ROW EXECUTE FUNCTION ai_job_document_admission_scope_guard();
