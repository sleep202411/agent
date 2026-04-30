/**
 * `ensureOutline` — the canonical "I need the project's story outline"
 * call site for every phase that gates on it.
 *
 * Why this exists
 * ───────────────
 * Five workflow phases (role / scene / prop / episode / script) all
 * used to do the same thing inline:
 *
 *     const record = await getOutline(projectId);
 *     if (!record) throw new Error(`xxx_phase: no story outline cached for project ${projectId}. Run story_outline first.`);
 *
 * Five copies of the same string-throw — meaning five different
 * places to update when error semantics evolve, no programmatic hook
 * for the supervisor/UI to react, and no diagnostic context if the
 * project legitimately has no outline yet (e.g. user hasn't run
 * story_outline OR parse_script).
 *
 * This helper centralizes that path:
 *   - Loads outline via `getOutline` (Redis cache → libsql artifact
 *     fallback, see `outline.ts`).
 *   - On miss, throws `MissingArtifactError` with `code: "MISSING_ARTIFACT"`,
 *     `kind: "outline"`, `requiredBy: <phase>`, and `producedBy` hints
 *     that point the recovery flow at the right upstream workflow.
 *   - Callers don't write the message text — `MissingArtifactError`
 *     formats it consistently, so log scrapers and UI handlers have a
 *     stable shape.
 *
 * Recovery hint
 * ─────────────
 * `producedBy` lists the workflows that, if run, would land an outline
 * artifact. Today both `story_outline` (real run) and `parse_script`
 * (writes a synthetic outline on commit) qualify — the supervisor
 * picks based on what the user actually wants (creative generation
 * vs. preserving the user-uploaded script).
 */

import { MissingArtifactError } from "./artifact-store";
import { getOutline, type StoryOutlineRecord } from "./outline";

export interface EnsureOutlineOptions {
  /** Phase id, embedded in the error for log/UI context. */
  requiredBy: string;
  /**
   * Override the default recovery hint. Defaults to both upstream
   * workflows that produce an outline artifact.
   */
  producedBy?: string[];
  /** Optional extra context to append to the error message. */
  detail?: string;
}

const DEFAULT_PRODUCERS = ["story_outline", "parse_script"];

/**
 * Resolve the project's outline or throw `MissingArtifactError`.
 * Always prefer this over calling `getOutline` + manual null-check —
 * it keeps the error contract uniform across all 5 dependent phases.
 */
export async function ensureOutline(
  projectId: string,
  opts: EnsureOutlineOptions
): Promise<StoryOutlineRecord> {
  const record = await getOutline(projectId);
  if (record) return record;
  throw new MissingArtifactError({
    projectId,
    kind: "outline",
    requiredBy: opts.requiredBy,
    producedBy: opts.producedBy ?? DEFAULT_PRODUCERS,
    detail: opts.detail,
  });
}
