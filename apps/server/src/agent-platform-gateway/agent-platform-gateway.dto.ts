import {
  AgentCancellationGatewayRequestSchema,
  AgentCancellationResultSchema,
  AgentConversationCreateRequestSchema,
  AgentConversationGrantSchema,
  AgentConversationPreferenceRequestSchema,
  AgentConversationResolveRequestSchema,
  AgentHistoryGatewayRequestSchema,
  AgentHistoryPageSchema,
  AgentInvocationAcceptedSchema,
  AgentInvocationAttemptStatusSchema,
  AgentInvocationGatewayRequestSchema,
  AgentInvocationLifecycleAcknowledgementSchema,
  AgentInvocationLifecycleRequestSchema,
  AgentInvocationStatusPageSchema,
  AgentInvocationStatusRequestSchema,
  AgentPublicErrorSchema,
  AgentPlatformPermissionModeSchema,
  AgentSessionGrantRequestSchema,
  canonicalAgentSessionName,
  type AgentConversationCreateRequest,
  type AgentConversationResolveRequest,
  type AgentPlatformPermissionMode,
} from '@repo/shared/agent-platform';
import { z } from 'zod';

export {
  AgentCancellationGatewayRequestSchema,
  AgentCancellationResultSchema,
  AgentConversationCreateRequestSchema,
  AgentConversationGrantSchema,
  AgentConversationPreferenceRequestSchema,
  AgentConversationResolveRequestSchema,
  AgentHistoryGatewayRequestSchema,
  AgentHistoryPageSchema,
  AgentInvocationAcceptedSchema,
  AgentInvocationAttemptStatusSchema,
  AgentInvocationGatewayRequestSchema,
  AgentInvocationLifecycleAcknowledgementSchema,
  AgentInvocationLifecycleRequestSchema,
  AgentInvocationStatusPageSchema,
  AgentInvocationStatusRequestSchema,
  AgentPublicErrorSchema,
  AgentPlatformPermissionModeSchema,
  AgentSessionGrantRequestSchema,
  canonicalAgentSessionName,
};
export type {
  AgentCancellationGatewayRequest,
  AgentCancellationResult,
  AgentConversationCreateRequest,
  AgentConversationGrant,
  AgentConversationPreferenceRequest,
  AgentConversationResolveRequest,
  AgentConversationSummary,
  AgentHistoryGatewayRequest,
  AgentHistoryPage,
  AgentInvocationAccepted,
  AgentInvocationAttemptStatus,
  AgentInvocationGatewayRequest,
  AgentInvocationLifecycleAcknowledgement,
  AgentInvocationLifecycleRequest,
  AgentInvocationStatus,
  AgentInvocationStatusPage,
  AgentInvocationStatusRequest,
  AgentPublicError,
  AgentPlatformPermissionMode,
  AgentSessionGrantRequest,
} from '@repo/shared/agent-platform';

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const storyIdSchema = z.uuid();

export type AgentConversationScopeRequest =
  | AgentConversationResolveRequest
  | AgentConversationCreateRequest;

export type StoryAgentScope = Readonly<{
  kind: 'story-project';
  workspaceId: string;
  projectId: string;
}>;

export type CrewAgentScope = Readonly<{
  kind: 'crew';
  crewId: string;
}>;

export const AgentBusinessScopeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('story-project'),
      workspaceId: storyIdSchema,
      projectId: storyIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('crew'),
      crewId: identifierSchema,
    })
    .strict(),
]);

export type AgentBusinessScope = z.infer<typeof AgentBusinessScopeSchema>;

export type AuthorizedAgentScope =
  | Readonly<{
      actorId: string;
      actorDisplayName: string;
      surface: 'story-studio';
      scope: StoryAgentScope;
      locale: string;
      roles: readonly string[];
      permissions: readonly string[];
    }>
  | Readonly<{
      actorId: string;
      actorDisplayName: string;
      surface: 'crew-management';
      scope: CrewAgentScope;
      locale: string;
      roles: readonly string[];
      permissions: readonly string[];
    }>;

export type AuthorizedAgentContext = AuthorizedAgentScope &
  Readonly<{
    conversationId: string;
    sessionName: string;
    permissionMode: AgentPlatformPermissionMode;
    traceId: string;
  }>;

export function conversationScopeKey(scope: AgentBusinessScope): string {
  if (scope.kind === 'story-project') {
    return `story-project:${scope.workspaceId}:${scope.projectId}`;
  }
  return `crew:${scope.crewId}`;
}

export function scopeRequestFromStoredScope(
  scope: AgentBusinessScope,
  locale: string,
): AgentConversationResolveRequest {
  if (scope.kind === 'story-project') {
    return {
      schemaVersion: 'agent-conversation-resolve/v1',
      surface: 'story-studio',
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      locale,
    };
  }
  return {
    schemaVersion: 'agent-conversation-resolve/v1',
    surface: 'crew-management',
    crewId: scope.crewId,
    locale,
  };
}
