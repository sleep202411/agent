import type {
  ExperienceReleaseResult,
  StoryBuild,
  StoryBuildDiagnostic,
  StoryWorkbench,
} from "@/lib/story-projects-api";

export type StoryPublicationActivePhase = "saving" | "building" | "publishing";

export type StoryPublicationErrorCode =
  | "SAVE_FAILED"
  | "WORKBENCH_FAILED"
  | "DRAFT_REVISION_MISMATCH"
  | "BUILD_FAILED"
  | "BUILD_NOT_READY"
  | "RUNTIME_UNAVAILABLE"
  | "PUBLISH_FAILED";

export interface StoryPublicationBuildInput {
  expectedDraftRevision: number;
  expectedVideoSnapshotHash: string;
  scope: { kind: "full" };
}

export interface StoryPublicationFlowServices {
  saveDraftSnapshot: () => Promise<number>;
  loadWorkbench: () => Promise<StoryWorkbench>;
  createProductionBuild: (
    input: StoryPublicationBuildInput,
    idempotencyKey: string
  ) => Promise<StoryBuild>;
  publishProductionBuild: (buildId: string) => Promise<ExperienceReleaseResult>;
  buildSubmissionKeys: {
    keyFor: (fingerprint: string) => Promise<string>;
    confirm: (fingerprint: string) => Promise<void>;
  };
}

export interface RunStoryPublicationOptions extends StoryPublicationFlowServices {
  onPhaseChange?: (phase: StoryPublicationActivePhase) => void;
}

export interface StoryPublicationFlowResult {
  sourceDraftRevision: number;
  build: StoryBuild;
  release: ExperienceReleaseResult;
}

export class StoryPublicationFlowError extends Error {
  readonly phase: StoryPublicationActivePhase;
  readonly code: StoryPublicationErrorCode;
  readonly diagnostics: StoryBuildDiagnostic[];
  readonly build: StoryBuild | null;
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
    diagnostics?: StoryBuildDiagnostic[];
    build?: StoryBuild | null;
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

export function storyPublicationBuildFingerprint(
  draftRevision: number,
  videoSnapshotHash: string
): string {
  if (!Number.isSafeInteger(draftRevision) || draftRevision < 0) {
    throw new Error("A valid saved draft revision is required.");
  }
  if (!/^[a-f0-9]{64}$/.test(videoSnapshotHash)) {
    throw new Error("A valid video snapshot hash is required.");
  }
  return `story-publish:${draftRevision}:${videoSnapshotHash}:full`;
}

export async function runStoryPublication({
  saveDraftSnapshot,
  loadWorkbench,
  createProductionBuild,
  publishProductionBuild,
  buildSubmissionKeys,
  onPhaseChange,
}: RunStoryPublicationOptions): Promise<StoryPublicationFlowResult> {
  const moveTo = (phase: StoryPublicationActivePhase) => onPhaseChange?.(phase);

  moveTo("saving");
  let sourceDraftRevision: number;
  try {
    sourceDraftRevision = await saveDraftSnapshot();
  } catch (error) {
    throw new StoryPublicationFlowError({
      phase: "saving",
      code: "SAVE_FAILED",
      upstreamError: error,
    });
  }

  moveTo("building");
  let workbench: StoryWorkbench;
  try {
    workbench = await loadWorkbench();
  } catch (error) {
    throw new StoryPublicationFlowError({
      phase: "building",
      code: "WORKBENCH_FAILED",
      upstreamError: error,
    });
  }
  if (workbench.draft.revision !== sourceDraftRevision) {
    throw new StoryPublicationFlowError({
      phase: "building",
      code: "DRAFT_REVISION_MISMATCH",
    });
  }

  const buildInput: StoryPublicationBuildInput = {
    expectedDraftRevision: sourceDraftRevision,
    expectedVideoSnapshotHash: workbench.video.snapshotHash,
    scope: { kind: "full" },
  };
  const fingerprint = storyPublicationBuildFingerprint(
    sourceDraftRevision,
    workbench.video.snapshotHash
  );
  const idempotencyKey = await buildSubmissionKeys.keyFor(fingerprint);

  let build: StoryBuild;
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
      await buildSubmissionKeys.confirm(fingerprint);
    }
    throw new StoryPublicationFlowError({
      phase: "building",
      code: "BUILD_NOT_READY",
      diagnostics: build.diagnostics,
      build,
    });
  }
  if (!build.runtimeJson) {
    await buildSubmissionKeys.confirm(fingerprint);
    throw new StoryPublicationFlowError({
      phase: "building",
      code: "RUNTIME_UNAVAILABLE",
      diagnostics: build.diagnostics,
      build,
    });
  }

  moveTo("publishing");
  try {
    const release = await publishProductionBuild(build.id);
    await buildSubmissionKeys.confirm(fingerprint);
    return { sourceDraftRevision, build, release };
  } catch (error) {
    await buildSubmissionKeys.confirm(fingerprint);
    throw new StoryPublicationFlowError({
      phase: "publishing",
      code: "PUBLISH_FAILED",
      diagnostics: build.diagnostics,
      build,
      upstreamError: error,
    });
  }
}
