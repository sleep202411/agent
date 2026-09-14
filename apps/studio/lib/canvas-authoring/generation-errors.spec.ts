import { describe, expect, it } from "vitest";
import {
  displayGenerationError,
  errorMessageFromJob,
  generationStateFromJob,
  normalizeFizzAiError,
  type FizzAiJobView,
} from "./generation-api";
import en from "@/messages/en-US.json";
import zh from "@/messages/zh-CN.json";
import hk from "@/messages/zh-HK.json";

const reason =
  "The parameter `content` specified in the request is not valid: reference_audio cannot be the only reference input.";
const providerError = `${reason} Request id: 02178913355771728c256f90ee836450e608b7d1b1192f3f8860e`;
const job = {
  id: "failed-job",
  status: "failed",
  error: { code: "VALIDATION_ERROR", userMessage: providerError },
} as FizzAiJobView;
const copy = {
  fallback: en.canvasOps.generationFailed,
  providerUnavailable: en.canvasOps.generationProviderUnavailable,
  referenceAudioRequiresVisual: en.canvasOps.generationReferenceAudioRequiresVisual,
};

describe("generation failure details", () => {
  it("preserves the BytePlus reason through job projection and toast formatting", () => {
    expect(generationStateFromJob(job)).toMatchObject({
      jobId: job.id,
      status: "failed",
      errorCode: "VALIDATION_ERROR",
      error: reason,
    });
    expect(errorMessageFromJob(job, copy.fallback)).toBe(reason);
    expect(normalizeFizzAiError(new Error(providerError), copy.fallback)).toBe(reason);
    expect(
      normalizeFizzAiError(
        { responseBody: JSON.stringify({ message: providerError }) },
        copy.fallback
      )
    ).toBe(reason);
  });

  it.each([en, zh, hk])(
    "shows the audio-reference instruction in the selected locale",
    (messages) => {
      const localized = {
        ...copy,
        referenceAudioRequiresVisual: messages.canvasOps.generationReferenceAudioRequiresVisual,
      };
      expect(displayGenerationError(generationStateFromJob(job), localized)).toBe(
        localized.referenceAudioRequiresVisual
      );
      expect(displayGenerationError({ error: providerError }, localized)).toBe(
        localized.referenceAudioRequiresVisual
      );
    }
  );

  it("keeps other provider validation reasons verbatim", () => {
    const message = "Reference video duration must not exceed 15 seconds.";
    const state = generationStateFromJob({
      ...job,
      error: { message: `${message} Request id: request-123.` },
    });
    expect(displayGenerationError(state, copy)).toBe(message);
  });

  it("retains an actionable sentence after the request identifier", () => {
    const message = "Invalid reference. Request id: abc-123. Please use a PNG image.";
    expect(normalizeFizzAiError(new Error(message), copy.fallback)).toBe(
      "Invalid reference.  Please use a PNG image."
    );
  });

  it.each([
    "Your account 123456789012 cannot use this model.",
    "ModelNotOpen: dreamina-seedance-2-0. Request id: abc-123",
  ])("continues hiding account and provider configuration internals", (message) => {
    expect(
      generationStateFromJob({ ...job, error: { userMessage: message } }).error
    ).toBeUndefined();
    expect(displayGenerationError({ error: message }, copy)).toBe(copy.providerUnavailable);
  });

  it("handles empty details and unavailable providers", () => {
    expect(displayGenerationError(undefined, copy)).toBe(copy.fallback);
    expect(displayGenerationError({ error: "   " }, copy)).toBe(copy.fallback);
    expect(
      errorMessageFromJob({ ...job, error: { userMessage: "Request id: abc-123" } }, copy.fallback)
    ).toBe(copy.fallback);
    expect(displayGenerationError({ errorCode: "PROVIDER_NOT_CONFIGURED" }, copy)).toBe(
      copy.providerUnavailable
    );
  });
});
