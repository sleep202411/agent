/**
 * Port the characters domain needs from the generation domain for a subject's
 * compliance controls over their own likeness (design v2 §6): SEE every output
 * generated from their face, and TAKE DOWN those outputs. Outputs live in the
 * generation/media domains; the characters domain owns only consent + grants,
 * so it consumes this narrow port (resolved via ModuleRef, like the job
 * canceller) rather than importing those modules.
 */
export const REAL_PERSON_LIKENESS_OUTPUTS = Symbol(
  'REAL_PERSON_LIKENESS_OUTPUTS',
);

export interface LikenessOutputItem {
  jobId: string;
  projectId: string | null;
  status: string;
  createdAt: string;
  outputs: Array<{
    assetId: string | null;
    url: string | null;
    mimeType: string | null;
    moderationStatus: string;
  }>;
}

export interface RealPersonLikenessOutputs {
  /** Every output generated from `characterId`'s likeness (optionally one project). */
  listForCharacter(args: {
    characterId: string;
    projectId?: string;
  }): Promise<LikenessOutputItem[]>;

  /**
   * Block (physical takedown) the output assets generated from `characterId`'s
   * likeness, optionally scoped to one project or one job. Returns the count
   * blocked. `byUserId` = the subject requesting it (recorded on the action).
   */
  takedownForCharacter(args: {
    characterId: string;
    projectId?: string;
    jobId?: string;
    byUserId: string;
  }): Promise<number>;
}
