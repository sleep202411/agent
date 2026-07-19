import {
  StoryAgentRunDtoSchema,
  type StoryAgentRunDto,
  type StoryAgentRunStatus,
} from "@repo/shared/story-agent";

export const STORY_AGENT_TEST_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
export const STORY_AGENT_TEST_PROJECT_ID = "00000000-0000-4000-8000-000000000002";
export const STORY_AGENT_TEST_OTHER_PROJECT_ID = "00000000-0000-4000-8000-000000000003";
export const STORY_AGENT_TEST_RUN_ID = "00000000-0000-4000-8000-000000000004";

const CREATED_AT = "2026-07-18T12:00:00.000Z";
const CONFIRMED_AT = "2026-07-18T12:00:01.000Z";
const STARTED_AT = "2026-07-18T12:00:02.000Z";
const COMPLETED_AT = "2026-07-18T12:00:03.000Z";

export function storyAgentRunFixture(
  status: StoryAgentRunStatus = "proposed",
  overrides: Partial<StoryAgentRunDto> = {}
): StoryAgentRunDto {
  const authoringPhase = status === "authoring" || status === "authoring_failed";
  const terminalFailure = status === "failed" || status === "stale";
  const succeeded = status === "succeeded";
  const applying = status === "applying";
  const cancelled = status === "cancelled";
  const kind = overrides.kind ?? "apply";

  return StoryAgentRunDtoSchema.parse({
    id: STORY_AGENT_TEST_RUN_ID,
    kind,
    status,
    workspaceId: STORY_AGENT_TEST_WORKSPACE_ID,
    projectId: STORY_AGENT_TEST_PROJECT_ID,
    initiator: { id: "user-1", displayName: "Isaac" },
    confirmedByUserId: applying || succeeded ? "user-1" : null,
    cancelledByUserId: cancelled ? "user-1" : null,
    proposal: authoringPhase
      ? {
          schemaVersion: "story-patch-brief-v1",
          title: "Build the opening choice",
          summary: "Add a meaningful first decision to the story.",
          brief:
            "Draft an opening decision that forces the dreamer to choose between waking and staying.",
        }
      : {
          schemaVersion: "story-patch-v1",
          draftSchemaVersion: "interactive-film-draft-v3",
          baseDraftRevision: 8,
          baseContentHash: "a".repeat(64),
          baseLayoutRevision: 5,
          title: "Build the opening choice",
          summary: "Add a meaningful first decision to the story.",
          operations: [
            {
              operationId: "00000000-0000-4000-8000-000000000005",
              kind: "story_bible.update_overview",
              summary: "Clarify the story logline.",
              payload: { logline: "A dreamer must choose whether to wake." },
            },
          ],
        },
    undoOfRunId: kind === "undo" ? "00000000-0000-4000-8000-000000000006" : null,
    baseDraftRevision: 8,
    baseLayoutRevision: 5,
    resultDraftRevision: succeeded ? 9 : null,
    resultLayoutRevision: succeeded ? 6 : null,
    affectedNodeIds: succeeded ? ["clip:opening"] : [],
    createdNodeIds: succeeded ? ["clip:opening"] : [],
    revealStartedAt: succeeded ? COMPLETED_AT : null,
    lockExpiresAt: applying ? "2026-07-18T12:01:02.000Z" : null,
    error:
      status === "authoring_failed"
        ? {
            code: "STORY_AGENT_AUTHORING_FAILED",
            detail: "The Agent could not draft this change.",
          }
        : terminalFailure
          ? {
              code: status === "stale" ? "STORY_AGENT_RUN_STALE" : "STORY_AGENT_RUN_FAILED",
              detail:
                status === "stale"
                  ? "The project changed before this proposal could be applied."
                  : "The proposal could not be applied.",
            }
          : null,
    createdAt: CREATED_AT,
    expiresAt: "2026-07-18T12:05:00.000Z",
    confirmedAt: applying || succeeded ? CONFIRMED_AT : null,
    startedAt: applying || succeeded ? STARTED_AT : null,
    completedAt: succeeded || terminalFailure ? COMPLETED_AT : null,
    cancelledAt: cancelled ? COMPLETED_AT : null,
    updatedAt:
      succeeded || terminalFailure || cancelled ? COMPLETED_AT : applying ? STARTED_AT : CREATED_AT,
    ...overrides,
  });
}
