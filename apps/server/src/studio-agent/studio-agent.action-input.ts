import { ConflictException } from '@nestjs/common';
import {
  STORY_PATCH_OPERATION_LABELS,
  type StoryPatchOperation,
  type StoryPatchServerSuppliedActionField,
  type StoryPatchServerSuppliedOperationField,
} from '@repo/shared/story-agent';
import type {
  StudioAgentCapabilityManifest,
  StudioAgentJsonObject,
  StudioAgentJsonValue,
  StudioAgentThreadScope,
} from '@repo/shared/studio-agent';
import { deriveStudioAgentUuid } from './studio-agent.hash';

export interface StudioAgentActionInputContext {
  capability: StudioAgentCapabilityManifest;
  scope: StudioAgentThreadScope;
  runId: string;
  stepId: string;
  toolCallId: string;
  input: StudioAgentJsonObject;
}

/**
 * Fills the machine fields of a tool-call input before anything else sees it.
 *
 * A capability input has two kinds of field: authorial decisions, which only a
 * model can make, and bookkeeping the server already holds or can derive.
 * Asking a model for the second kind is how `story.canvas.apply_patch` spent
 * whole turns failing one field at a time — an invented UUID, a transcribed
 * project id — with nothing gained when it got them right. Everything in a
 * capability's server-supplied set is written here and the model's value, if it
 * sent one, is discarded; the manifest declares those fields optional so the
 * model is never asked for them and never penalised for a wrong guess.
 *
 * This runs BEFORE the manifest gate (`checkCapabilityInput`) deliberately. The
 * persisted input is re-validated against the same closed manifest schema at
 * execute time, so a field injected after validation would pass prepare and then
 * fail execute.
 *
 * Derivations must be pure functions of the request: the result is hashed into
 * `inputHash`, which is the idempotency key for a replayed prepare and the
 * challenge a creator's approval is matched against.
 */
export function prepareStudioAgentActionInput(
  context: StudioAgentActionInputContext,
): StudioAgentJsonObject {
  switch (context.capability.capabilityId) {
    case 'story.canvas.apply_patch':
      return applyServerSuppliedStoryPatchFields(context);
    default:
      return context.input;
  }
}

/**
 * Story patch projection: scope ids from the run's immutable authorized scope,
 * operation bookkeeping from the tool call's own identity.
 *
 * Structurally broken input is left alone rather than repaired. The manifest
 * schema is the single place that reports contract violations, and a rewrite
 * that guessed at broken structure would only bury the field-level error the
 * model needs to correct itself.
 */
function applyServerSuppliedStoryPatchFields(
  context: StudioAgentActionInputContext,
): StudioAgentJsonObject {
  const { container, focus } = context.scope;
  if (container.resourceType !== 'story.project' || focus === null) {
    // The ids are no longer the model's to supply, so a scope that cannot
    // produce them can never produce a valid patch. Say so now instead of
    // persisting an action that dies on a missing-field error at execute time.
    throw new ConflictException({
      code: 'STUDIO_AGENT_STORY_SCOPE_INCOMPLETE',
      message:
        'This Story capability requires a project container and chapter focus.',
    });
  }
  const actionFields: Record<
    StoryPatchServerSuppliedActionField,
    StudioAgentJsonValue
  > = {
    projectId: container.resourceId,
    chapterId: focus.resourceId,
  };
  const operations = context.input.operations;
  return {
    ...context.input,
    ...actionFields,
    ...(Array.isArray(operations)
      ? {
          operations: operations.map((operation, index) =>
            applyServerSuppliedOperationFields(context, operation, index),
          ),
        }
      : {}),
  };
}

function applyServerSuppliedOperationFields(
  context: StudioAgentActionInputContext,
  operation: StudioAgentJsonValue,
  index: number,
): StudioAgentJsonValue {
  if (
    operation === null ||
    typeof operation !== 'object' ||
    Array.isArray(operation)
  ) {
    return operation;
  }
  const kind = operation.kind;
  if (typeof kind !== 'string' || !(kind in STORY_PATCH_OPERATION_LABELS)) {
    return operation;
  }
  const operationFields: Record<
    StoryPatchServerSuppliedOperationField,
    StudioAgentJsonValue
  > = {
    operationId: deriveStudioAgentUuid(
      `studio-agent.operation:${context.runId}:${context.stepId}:${context.toolCallId}:${index}`,
    ),
    summary: STORY_PATCH_OPERATION_LABELS[kind as StoryPatchOperation['kind']],
  };
  return { ...operation, ...operationFields };
}
