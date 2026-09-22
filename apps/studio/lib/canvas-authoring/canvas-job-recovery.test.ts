import { describe, expect, it } from "vitest";
import { ApiRequestError } from "@/lib/api";
import type { CanvasNodeShape } from "@/lib/canvas-core/types";
import type { FizzAiJobView, GenerationState } from "./generation-api";
import {
  acceptsSubmissionResponse,
  isUncertainSubmission,
  matchesCanvasJob,
  needsJobRecovery,
} from "./canvas-job-recovery";

const job = {
  id: "job-1",
  idempotencyKey: "receipt-1",
  documentBlockId: "node-1",
  modelId: "wan",
} as FizzAiJobView;
const completedVideoJob = {
  ...job,
  type: "video",
  status: "completed",
  stage: "completed",
  outputs: [{ type: "video", url: "https://cdn.test/video.mp4" }],
} as FizzAiJobView;
function node(generation: GenerationState): CanvasNodeShape {
  return {
    id: "node-1",
    type: "video",
    position: { x: 0, y: 0 },
    data: { modelId: "wan", generation },
  };
}
function emptyNode(overrides: Partial<CanvasNodeShape["data"]> = {}): CanvasNodeShape {
  return {
    id: "node-1",
    type: "video",
    position: { x: 0, y: 0 },
    data: { modelId: "wan", ...overrides },
  };
}

describe("canvas generation recovery", () => {
  it("finds a task after losing its submission response", () => {
    expect(matchesCanvasJob(node({ status: "uncertain", submissionKey: "receipt-1" }), job)).toBe(
      true
    );
    expect(matchesCanvasJob(node({ status: "submitting", submissionKey: "receipt-2" }), job)).toBe(
      false
    );
  });
  it("recovers the existing stuck card without choosing a different model or settled run", () => {
    expect(matchesCanvasJob(node({ status: "submitting" }), job)).toBe(true);
    expect(matchesCanvasJob(node({ status: "submitting" }), { ...job, modelId: "veo" })).toBe(
      false
    );
    expect(matchesCanvasJob(node({ status: "failed" }), job)).toBe(false);
    expect(matchesCanvasJob(node({ status: "generating", jobId: "new-job" }), job)).toBe(false);
  });
  it("recovers an erased generation projection only with exact block, type, and model", () => {
    expect(matchesCanvasJob(emptyNode(), completedVideoJob)).toBe(true);
    expect(matchesCanvasJob(emptyNode({ modelId: "veo" }), completedVideoJob)).toBe(false);
    expect(matchesCanvasJob({ ...emptyNode(), type: "audio" }, completedVideoJob)).toBe(false);
    expect(matchesCanvasJob({ ...emptyNode(), id: "other-node" }, completedVideoJob)).toBe(false);
  });
  it("rechecks a completed card that has no persisted output", () => {
    expect(needsJobRecovery({ status: "done", jobId: "job-1" })).toBe(true);
    expect(
      needsJobRecovery({
        status: "done",
        jobId: "job-1",
        outputs: [{ type: "video", url: "https://cdn.test/video.mp4" }],
      })
    ).toBe(false);
  });
  it("ignores late acknowledgements after a newer submission or completion", () => {
    expect(
      acceptsSubmissionResponse({ status: "done", submissionKey: "receipt-1" }, "receipt-1")
    ).toBe(false);
    expect(
      acceptsSubmissionResponse({ status: "submitting", submissionKey: "receipt-2" }, "receipt-1")
    ).toBe(false);
    expect(
      acceptsSubmissionResponse({ status: "uncertain", submissionKey: "receipt-1" }, "receipt-1")
    ).toBe(true);
    expect(acceptsSubmissionResponse(undefined, "receipt-1")).toBe(false);
  });
  it("retains receipts for ambiguous transport failures, not explicit rejections", () => {
    expect(isUncertainSubmission(new TypeError("Failed to fetch"))).toBe(true);
    expect(
      isUncertainSubmission(new ApiRequestError("NETWORK_ERROR", "Request timed out", 0))
    ).toBe(true);
    expect(isUncertainSubmission(new ApiRequestError(502, "Gateway error", 502))).toBe(true);
    expect(isUncertainSubmission(new ApiRequestError(400, "Invalid input", 400))).toBe(false);
    expect(isUncertainSubmission(new ApiRequestError(403, "Forbidden", 403))).toBe(false);
  });
});
