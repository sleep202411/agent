import {
  EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ID,
  EXPERIENCE_CORE_CHECKPOINT_RENDERER_ID,
  EXPERIENCE_CORE_CHOICE_RENDERER_ID,
  EXPERIENCE_CORE_RENDERER_API_VERSION,
  EXPERIENCE_CORE_RENDERER_CONFIG_VERSION,
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  ExperienceCoreChargeFeedbackRendererConfigSchema,
  ExperienceCoreCheckpointOutcomePayloadSchema,
  ExperienceCoreCheckpointRendererConfigSchema,
  ExperienceCoreChoiceRendererConfigSchema,
  ExperienceCoreChoiceSelectedOutcomePayloadSchema,
  ExperienceCoreMediaEndedOutcomePayloadSchema,
  ExperienceCoreRendererOpenCommandPayloadSchema,
  ExperienceCoreVideoRendererConfigSchema,
  ExperienceStableIdSchema,
  type ExperienceJsonObject,
} from "@repo/shared/experience-runtime";
import type { ExperienceRendererAdapter } from "./renderer-registry.js";
import { ExperienceRuntimeInvariantError } from "./runtime.js";

function invalidRendererContract(
  rendererId: string,
  boundary: "config" | "command" | "outcome",
  issues: readonly { path: PropertyKey[]; message: string }[]
): never {
  const detail = issues
    .map((issue) => `${issue.path.join(".") || boundary}: ${issue.message}`)
    .join("; ");
  throw new ExperienceRuntimeInvariantError(
    `RENDERER_${boundary.toUpperCase()}_INVALID`,
    `${rendererId} ${boundary} is invalid: ${detail}`
  );
}

function assertEmptyPayload(
  rendererId: string,
  boundary: "command" | "outcome",
  payload: ExperienceJsonObject
): void {
  const parsed = ExperienceCoreRendererOpenCommandPayloadSchema.safeParse(payload);
  if (!parsed.success) invalidRendererContract(rendererId, boundary, parsed.error.issues);
}

export const EXPERIENCE_CORE_VIDEO_RENDERER_ADAPTER: ExperienceRendererAdapter = {
  rendererId: EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  apiVersion: EXPERIENCE_CORE_RENDERER_API_VERSION,
  configSchemaVersion: EXPERIENCE_CORE_RENDERER_CONFIG_VERSION,
  capabilities: new Set([EXPERIENCE_CORE_VIDEO_RENDERER_ID]),
  supportsCommand: () => false,
  supportsOutcome: (outcomeType) => outcomeType === "media-ended",
  assertConfig(config) {
    const parsed = ExperienceCoreVideoRendererConfigSchema.safeParse(config);
    if (!parsed.success) invalidRendererContract(this.rendererId, "config", parsed.error.issues);
  },
  assertCommand(commandType) {
    throw new ExperienceRuntimeInvariantError(
      "RENDERER_COMMAND_UNSUPPORTED",
      `${this.rendererId} does not support command ${commandType}`
    );
  },
  assertOutcome(outcomeType, payload) {
    if (!this.supportsOutcome(outcomeType)) {
      throw new ExperienceRuntimeInvariantError(
        "RENDERER_OUTCOME_UNSUPPORTED",
        `${this.rendererId} does not support outcome ${outcomeType}`
      );
    }
    const parsed = ExperienceCoreMediaEndedOutcomePayloadSchema.safeParse(payload);
    if (!parsed.success) invalidRendererContract(this.rendererId, "outcome", parsed.error.issues);
  },
};

export const EXPERIENCE_CORE_CHOICE_RENDERER_ADAPTER: ExperienceRendererAdapter = {
  rendererId: EXPERIENCE_CORE_CHOICE_RENDERER_ID,
  apiVersion: EXPERIENCE_CORE_RENDERER_API_VERSION,
  configSchemaVersion: EXPERIENCE_CORE_RENDERER_CONFIG_VERSION,
  capabilities: new Set([EXPERIENCE_CORE_CHOICE_RENDERER_ID]),
  supportsCommand: (commandType) => commandType === "open",
  supportsOutcome: (outcomeType) => outcomeType === "choice-selected",
  assertConfig(config) {
    const parsed = ExperienceCoreChoiceRendererConfigSchema.safeParse(config);
    if (!parsed.success) invalidRendererContract(this.rendererId, "config", parsed.error.issues);
  },
  assertCommand(commandType, payload) {
    if (!this.supportsCommand(commandType)) {
      throw new ExperienceRuntimeInvariantError(
        "RENDERER_COMMAND_UNSUPPORTED",
        `${this.rendererId} does not support command ${commandType}`
      );
    }
    assertEmptyPayload(this.rendererId, "command", payload);
  },
  assertOutcome(outcomeType, payload) {
    if (!this.supportsOutcome(outcomeType)) {
      throw new ExperienceRuntimeInvariantError(
        "RENDERER_OUTCOME_UNSUPPORTED",
        `${this.rendererId} does not support outcome ${outcomeType}`
      );
    }
    const parsed = ExperienceCoreChoiceSelectedOutcomePayloadSchema.safeParse(payload);
    if (!parsed.success) invalidRendererContract(this.rendererId, "outcome", parsed.error.issues);
  },
};

export const EXPERIENCE_CORE_CHECKPOINT_RENDERER_ADAPTER: ExperienceRendererAdapter = {
  rendererId: EXPERIENCE_CORE_CHECKPOINT_RENDERER_ID,
  apiVersion: EXPERIENCE_CORE_RENDERER_API_VERSION,
  configSchemaVersion: EXPERIENCE_CORE_RENDERER_CONFIG_VERSION,
  capabilities: new Set([EXPERIENCE_CORE_CHECKPOINT_RENDERER_ID]),
  supportsCommand: (commandType) => commandType === "open",
  supportsOutcome: (outcomeType) => ExperienceStableIdSchema.safeParse(outcomeType).success,
  assertConfig(config) {
    const parsed = ExperienceCoreCheckpointRendererConfigSchema.safeParse(config);
    if (!parsed.success) invalidRendererContract(this.rendererId, "config", parsed.error.issues);
  },
  assertCommand(commandType, payload) {
    if (!this.supportsCommand(commandType)) {
      throw new ExperienceRuntimeInvariantError(
        "RENDERER_COMMAND_UNSUPPORTED",
        `${this.rendererId} does not support command ${commandType}`
      );
    }
    assertEmptyPayload(this.rendererId, "command", payload);
  },
  assertOutcome(outcomeType, payload) {
    if (!this.supportsOutcome(outcomeType)) {
      throw new ExperienceRuntimeInvariantError(
        "RENDERER_OUTCOME_UNSUPPORTED",
        `${this.rendererId} does not support outcome ${outcomeType}`
      );
    }
    const parsed = ExperienceCoreCheckpointOutcomePayloadSchema.safeParse(payload);
    if (!parsed.success) invalidRendererContract(this.rendererId, "outcome", parsed.error.issues);
  },
};

export const EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ADAPTER: ExperienceRendererAdapter = {
  rendererId: EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ID,
  apiVersion: EXPERIENCE_CORE_RENDERER_API_VERSION,
  configSchemaVersion: EXPERIENCE_CORE_RENDERER_CONFIG_VERSION,
  capabilities: new Set([EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ID, "input.press-hold"]),
  supportsCommand: (commandType) => commandType === "complete",
  supportsOutcome: () => false,
  assertConfig(config) {
    const parsed = ExperienceCoreChargeFeedbackRendererConfigSchema.safeParse(config);
    if (!parsed.success) invalidRendererContract(this.rendererId, "config", parsed.error.issues);
  },
  assertCommand(commandType, payload) {
    if (!this.supportsCommand(commandType)) {
      throw new ExperienceRuntimeInvariantError(
        "RENDERER_COMMAND_UNSUPPORTED",
        `${this.rendererId} does not support command ${commandType}`
      );
    }
    assertEmptyPayload(this.rendererId, "command", payload);
  },
  assertOutcome(outcomeType) {
    throw new ExperienceRuntimeInvariantError(
      "RENDERER_OUTCOME_UNSUPPORTED",
      `${this.rendererId} does not support outcome ${outcomeType}`
    );
  },
};

export const EXPERIENCE_CORE_RENDERER_ADAPTERS = [
  EXPERIENCE_CORE_VIDEO_RENDERER_ADAPTER,
  EXPERIENCE_CORE_CHOICE_RENDERER_ADAPTER,
  EXPERIENCE_CORE_CHECKPOINT_RENDERER_ADAPTER,
  EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ADAPTER,
] as const satisfies readonly ExperienceRendererAdapter[];
