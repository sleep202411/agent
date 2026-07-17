import type {
  ExperienceReleaseResult,
  FilmBuild,
  FilmBuildDiagnostic,
  StoryRevision,
  StoryWorkbench,
} from "@/lib/story-projects-api";

export type StoryPublicationActivePhase = "saving" | "locking" | "building" | "publishing";

export type StoryPublicationErrorCode =
  | "SAVE_FAILED"
  | "LOCK_FAILED"
  | "WORKBENCH_FAILED"
  | "LOCKED_REVISION_MISMATCH"
  | "PRODUCTION_CONTRACT_MISSING"
  | "BUILD_FAILED"
  | "BUILD_NOT_READY"
  | "RUNTIME_UNAVAILABLE"
  | "PUBLISH_FAILED";

export interface StoryPublicationBuildInput {
  revisionId: string;
  expectedProductionRevision: number;
  profile: "production";
  scope: { kind: "full" };
}

export interface StoryPublicationFlowServices {
  /**
   * Save one exact mutable head, then call `onLockStart` immediately before
   * locking that saved draft revision. The caller owns the autosave barrier.
   */
  saveAndLockRevision: (onLockStart: () => void) => Promise<StoryRevision>;
  loadLockedWorkbench: (revisionId: string) => Promise<StoryWorkbench>;
  createProductionBuild: (
    input: StoryPublicationBuildInput,
    idempotencyKey: string
  ) => Promise<FilmBuild>;
  publishProductionBuild: (buildId: string) => Promise<ExperienceReleaseResult>;
  buildSubmissionKeys: {
    keyFor: (fingerprint: string) => string;
    confirm: (fingerprint: string) => void;
  };
}

export interface RunStoryPublicationOptions extends StoryPublicationFlowServices {
  onPhaseChange?: (phase: StoryPublicationActivePhase) => void;
}

export interface StoryPublicationFlowResult {
  lockedRevision: StoryRevision;
  build: FilmBuild;
  release: ExperienceReleaseResult;
}

export class StoryPublicationFlowError extends Error {
  readonly phase: StoryPublicationActivePhase;
  readonly code: StoryPublicationErrorCode;
  readonly diagnostics: FilmBuildDiagnostic[];
  readonly build: FilmBuild | null;
  readonly upstreamError: unknown;

  constructor({
    phase,
    code,
    diagnostics = [],
    build = null,
    upstreamError,
  }: {
    phase: StoryPublicationActivePhase;
    code: StoryPublicationErrorCode;
    diagnostics?: FilmBuildDiagnostic[];
    build?: FilmBuild | null;
    upstreamError?: unknown;
  }) {
    super(upstreamError instanceof Error ? upstreamError.message : "");
    this.name = "StoryPublicationFlowError";
    this.phase = phase;
    this.code = code;
    this.diagnostics = diagnostics;
    this.build = build;
    this.upstreamError = upstreamError;
  }
}

/** Identifies one immutable full-production input inside the key registry. */
export function storyPublicationBuildFingerprint(
  revisionId: string,
  productionRevision: number
): string {
  if (!revisionId.trim()) throw new Error("A locked story revision is required.");
  if (!Number.isSafeInteger(productionRevision) || productionRevision < 0) {
    throw new Error("A valid production revision is required.");
  }
  return `story-publish:${revisionId}:${productionRevision}:production:full`;
}

/**
 * Freeze the current saved story, compile its exact production projection,
 * then publish only a complete runtime. This function owns no React state and
 * is intentionally dependency-injected so every transition is deterministic
 * and independently testable.
 */
export async function runStoryPublication({
  saveAndLockRevision,
  loadLockedWorkbench,
  createProductionBuild,
  publishProductionBuild,
  buildSubmissionKeys,
  onPhaseChange,
}: RunStoryPublicationOptions): Promise<StoryPublicationFlowResult> {
  const progress: { phase: StoryPublicationActivePhase } = { phase: "saving" };
  const moveTo = (next: StoryPublicationActivePhase) => {
    progress.phase = next;
    onPhaseChange?.(next);
  };

  moveTo("saving");
  let lockedRevision: StoryRevision;
  try {
    lockedRevision = await saveAndLockRevision(() => moveTo("locking"));
  } catch (error) {
    throw new StoryPublicationFlowError({
      phase: progress.phase,
      code: progress.phase === "locking" ? "LOCK_FAILED" : "SAVE_FAILED",
      upstreamError: error,
    });
  }

  moveTo("building");
  let workbench: StoryWorkbench;
  try {
    workbench = await loadLockedWorkbench(lockedRevision.id);
  } catch (error) {
    throw new StoryPublicationFlowError({
      phase: "building",
      code: "WORKBENCH_FAILED",
      upstreamError: error,
    });
  }

  if (workbench.selectedRevision?.id !== lockedRevision.id) {
    throw new StoryPublicationFlowError({
      phase: "building",
      code: "LOCKED_REVISION_MISMATCH",
    });
  }
  if (!workbench.film) {
    throw new StoryPublicationFlowError({
      phase: "building",
      code: "PRODUCTION_CONTRACT_MISSING",
    });
  }

  const buildInput: StoryPublicationBuildInput = {
    revisionId: lockedRevision.id,
    expectedProductionRevision: workbench.film.productionRevision,
    profile: "production",
    scope: { kind: "full" },
  };
  const buildFingerprint = storyPublicationBuildFingerprint(
    buildInput.revisionId,
    buildInput.expectedProductionRevision
  );
  const idempotencyKey = buildSubmissionKeys.keyFor(buildFingerprint);

  let build: FilmBuild;
  try {
    build = await createProductionBuild(buildInput, idempotencyKey);
  } catch (error) {
    throw new StoryPublicationFlowError({
      phase: "building",
      code: "BUILD_FAILED",
      upstreamError: error,
    });
  }

  if (build.status !== "ready") {
    if (build.status === "failed" || build.status === "cancelled") {
      buildSubmissionKeys.confirm(buildFingerprint);
    }
    throw new StoryPublicationFlowError({
      phase: "building",
      code: "BUILD_NOT_READY",
      diagnostics: build.diagnostics,
      build,
    });
  }
  if (!build.runtimeJson) {
    // A ready Build without a runtime is a confirmed, terminally unusable
    // response. Rotate the key so an explicit retry can rebuild it.
    buildSubmissionKeys.confirm(buildFingerprint);
    throw new StoryPublicationFlowError({
      phase: "building",
      code: "RUNTIME_UNAVAILABLE",
      diagnostics: build.diagnostics,
      build,
    });
  }

  moveTo("publishing");
  let release: ExperienceReleaseResult;
  try {
    release = await publishProductionBuild(build.id);
  } catch (error) {
    // The Build endpoint also converges different submission keys by immutable
    // input. Rotating here lets a definitively rejected publication rebuild,
    // while an unknown/pending publication still resolves to the same Build.
    buildSubmissionKeys.confirm(buildFingerprint);
    throw new StoryPublicationFlowError({
      phase: "publishing",
      code: "PUBLISH_FAILED",
      diagnostics: build.diagnostics,
      build,
      upstreamError: error,
    });
  }

  buildSubmissionKeys.confirm(buildFingerprint);

  return { lockedRevision, build, release };
}
