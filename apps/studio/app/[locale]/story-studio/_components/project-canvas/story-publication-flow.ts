import type { ExperienceReleaseRequest } from "@repo/shared/experience-runtime";
import type { InteractiveFilmPublication } from "@/lib/interactive-film-api";

export type StoryPublicationActivePhase = "saving" | "preparing" | "submitting";

export type StoryPublicationErrorCode =
  | "SAVE_FAILED"
  | "PREPARE_FAILED"
  | "SUBMIT_FAILED"
  | "SUBMIT_STATUS_INVALID";

export interface StoryPublicationFlowServices {
  saveDraftSnapshot: () => Promise<number>;
  prepareRelease: (sourceDraftRevision: number) => Promise<ExperienceReleaseRequest>;
  submitRelease: (release: ExperienceReleaseRequest) => Promise<InteractiveFilmPublication>;
}

export interface RunStoryPublicationOptions extends StoryPublicationFlowServices {
  onPhaseChange?: (phase: StoryPublicationActivePhase) => void;
}

export interface StoryPublicationFlowResult {
  publication: InteractiveFilmPublication;
}

export class StoryPublicationFlowError extends Error {
  readonly phase: StoryPublicationActivePhase;
  readonly code: StoryPublicationErrorCode;
  readonly upstreamError: unknown;

  constructor({
    phase,
    code,
    upstreamError,
  }: {
    phase: StoryPublicationActivePhase;
    code: StoryPublicationErrorCode;
    upstreamError?: unknown;
  }) {
    super(upstreamError instanceof Error ? upstreamError.message : "");
    this.name = "StoryPublicationFlowError";
    this.phase = phase;
    this.code = code;
    this.upstreamError = upstreamError;
  }
}

export async function runStoryPublication({
  saveDraftSnapshot,
  prepareRelease,
  submitRelease,
  onPhaseChange,
}: RunStoryPublicationOptions): Promise<StoryPublicationFlowResult> {
  onPhaseChange?.("saving");
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

  onPhaseChange?.("preparing");
  let release: ExperienceReleaseRequest;
  try {
    release = await prepareRelease(sourceDraftRevision);
  } catch (error) {
    throw new StoryPublicationFlowError({
      phase: "preparing",
      code: "PREPARE_FAILED",
      upstreamError: error,
    });
  }

  onPhaseChange?.("submitting");
  let publication: InteractiveFilmPublication;
  try {
    publication = await submitRelease(release);
  } catch (error) {
    throw new StoryPublicationFlowError({
      phase: "submitting",
      code: "SUBMIT_FAILED",
      upstreamError: error,
    });
  }
  if (publication.status !== "reviewing" && publication.status !== "published") {
    throw new StoryPublicationFlowError({
      phase: "submitting",
      code: "SUBMIT_STATUS_INVALID",
    });
  }
  return { publication };
}
