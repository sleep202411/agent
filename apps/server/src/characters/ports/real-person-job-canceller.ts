/**
 * Port the characters domain needs from the generation domain: cancel
 * in-flight generations that reference a real_person likeness when its
 * per-project authorization (or the character itself) is withdrawn.
 *
 * The consumer (characters) OWNS this narrow port so it never depends on the
 * fat AiGenerationService; the generation module binds an implementation to
 * the token. Cancellation is DEFENSE-IN-DEPTH + prompt cleanup: the worker
 * `prepareReferences` seam is the correctness barrier (a withdrawn grant
 * hard-fails a queued job before provider submit). This releases the billing
 * hold + queue slot promptly rather than waiting for the job to dequeue.
 */
export const REAL_PERSON_JOB_CANCELLER = Symbol('REAL_PERSON_JOB_CANCELLER');

export interface RealPersonJobCanceller {
  /**
   * Cancel every non-terminal job that references `characterId`, optionally
   * scoped to one `projectId` (per-project revoke) or across all projects
   * (global character revoke). Releases billing holds + provider capacity.
   * Returns the number of jobs cancelled. Never throws into the caller's
   * transaction path — best-effort by contract.
   */
  cancelJobsForCharacter(args: {
    characterId: string;
    projectId?: string;
    reason: string;
  }): Promise<number>;
}
