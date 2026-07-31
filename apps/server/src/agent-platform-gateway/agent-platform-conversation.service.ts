import { createHash, randomUUID } from 'node:crypto';

import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type AgentPlatformConversation } from '@prisma/client';

import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { AgentPlatformAuthorizationService } from './agent-platform-authorization.service';
import {
  AgentBusinessScopeSchema,
  canonicalAgentSessionName,
  conversationScopeKey,
  scopeRequestFromStoredScope,
  type AgentBusinessScope,
  type AgentConversationCreateRequest,
  type AgentConversationPreferenceRequest,
  type AgentConversationResolveRequest,
  type AgentConversationSummary,
  type AgentPlatformPermissionMode,
  type AgentSessionGrantRequest,
  type AuthorizedAgentContext,
  type AuthorizedAgentScope,
} from './agent-platform-gateway.dto';

const CONVERSATION_TRANSACTION_ATTEMPTS = 3;

type AuthorizedConversation = Readonly<{
  conversation: AgentConversationSummary;
  context: AuthorizedAgentContext;
}>;

@Injectable()
export class AgentPlatformConversationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AgentPlatformAuthorizationService,
  ) {}

  async resolve(
    user: AuthUser,
    request: AgentConversationResolveRequest,
  ): Promise<AuthorizedConversation> {
    const authorizedScope = await this.authorization.authorize(user, request);
    const conversation = await this.withConversationTransaction(
      authorizedScope,
      false,
      'smart',
    );
    return this.authorizedConversation(authorizedScope, conversation);
  }

  async create(
    user: AuthUser,
    request: AgentConversationCreateRequest,
  ): Promise<AuthorizedConversation> {
    const authorizedScope = await this.authorization.authorize(user, request);
    const conversation = await this.withConversationTransaction(
      authorizedScope,
      true,
      request.permissionMode ?? 'smart',
    );
    return this.authorizedConversation(authorizedScope, conversation);
  }

  async authorizeExisting(
    user: AuthUser,
    request: AgentSessionGrantRequest,
  ): Promise<AuthorizedConversation> {
    const conversation = await this.prisma.agentPlatformConversation.findUnique(
      {
        where: { id: request.conversationId },
      },
    );
    if (!conversation || conversation.ownerActorId !== user.userId) {
      throw conversationNotFound();
    }

    const scope = parseStoredScope(conversation);
    const authorizedScope = await this.authorization.authorize(
      user,
      scopeRequestFromStoredScope(scope, request.locale),
    );
    if (
      authorizedScope.surface !== conversation.surface ||
      authorizedScope.scope.kind !== conversation.scopeKind ||
      hashScope(authorizedScope.scope) !== conversation.scopeKey
    ) {
      throw new InternalServerErrorException({
        code: 'AGENT_CONVERSATION_SCOPE_CORRUPT',
        message: 'The Agent conversation has an invalid stored scope.',
      });
    }
    return this.authorizedConversation(authorizedScope, conversation);
  }

  async updatePreference(
    user: AuthUser,
    request: AgentConversationPreferenceRequest,
  ): Promise<AuthorizedConversation> {
    const authorized = await this.authorizeExisting(user, {
      schemaVersion: 'agent-session-grant-request/v1',
      conversationId: request.conversationId,
      locale: request.locale,
    });
    const conversation = await this.prisma.agentPlatformConversation.update({
      where: {
        id: authorized.conversation.id,
        ownerActorId: user.userId,
      },
      data: { permissionMode: request.permissionMode },
    });
    return this.authorizedConversation(
      {
        actorId: authorized.context.actorId,
        actorDisplayName: authorized.context.actorDisplayName,
        surface: authorized.context.surface,
        scope: authorized.context.scope,
        locale: authorized.context.locale,
        roles: authorized.context.roles,
        permissions: authorized.context.permissions,
      } as AuthorizedAgentScope,
      conversation,
    );
  }

  private async withConversationTransaction(
    authorizedScope: AuthorizedAgentScope,
    replaceCurrent: boolean,
    permissionMode: AgentPlatformPermissionMode,
  ): Promise<AgentPlatformConversation> {
    const scopeKey = hashScope(authorizedScope.scope);
    const lockIdentity = [
      authorizedScope.actorId,
      authorizedScope.surface,
      scopeKey,
    ].join(':');

    for (
      let attempt = 1;
      attempt <= CONVERSATION_TRANSACTION_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await this.prisma.$transaction(
          async (transaction) => {
            await transaction.$executeRaw`
              SELECT pg_advisory_xact_lock(hashtextextended(${lockIdentity}, 0))
            `;

            if (replaceCurrent) {
              const archivedAt = new Date();
              await transaction.agentPlatformConversation.updateMany({
                where: {
                  ownerActorId: authorizedScope.actorId,
                  surface: authorizedScope.surface,
                  scopeKey,
                  archivedAt: null,
                },
                data: { archivedAt, updatedAt: archivedAt },
              });
            } else {
              const current =
                await transaction.agentPlatformConversation.findFirst({
                  where: {
                    ownerActorId: authorizedScope.actorId,
                    surface: authorizedScope.surface,
                    scopeKey,
                    archivedAt: null,
                  },
                  orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
                });
              if (current) return current;
            }

            return transaction.agentPlatformConversation.create({
              data: {
                ownerActorId: authorizedScope.actorId,
                surface: authorizedScope.surface,
                scopeKind: authorizedScope.scope.kind,
                scopeKey,
                scope: authorizedScope.scope as Prisma.InputJsonValue,
                permissionMode,
              },
            });
          },
          // The transaction-scoped advisory lock serializes one actor/scope.
          // READ COMMITTED is intentional: a waiter must take a fresh snapshot
          // after acquiring the lock so it can observe the winner's insert.
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );
      } catch (error) {
        if (
          attempt < CONVERSATION_TRANSACTION_ATTEMPTS &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034'
        ) {
          continue;
        }
        throw error;
      }
    }

    throw new InternalServerErrorException({
      code: 'AGENT_CONVERSATION_TRANSACTION_EXHAUSTED',
      message: 'The Agent conversation transaction could not complete.',
    });
  }

  private authorizedConversation(
    authorizedScope: AuthorizedAgentScope,
    conversation: AgentPlatformConversation,
  ): AuthorizedConversation {
    const context = Object.freeze({
      ...authorizedScope,
      conversationId: conversation.id,
      sessionName: canonicalAgentSessionName(conversation.id),
      permissionMode: conversation.permissionMode,
      traceId: randomUUID(),
    }) as AuthorizedAgentContext;
    return Object.freeze({
      conversation: summarizeConversation(conversation),
      context,
    });
  }
}

function hashScope(scope: AgentBusinessScope): string {
  return createHash('sha256').update(conversationScopeKey(scope)).digest('hex');
}

function parseStoredScope(
  conversation: AgentPlatformConversation,
): AgentBusinessScope {
  const result = AgentBusinessScopeSchema.safeParse(conversation.scope);
  if (!result.success) {
    throw new InternalServerErrorException({
      code: 'AGENT_CONVERSATION_SCOPE_CORRUPT',
      message: 'The Agent conversation has an invalid stored scope.',
    });
  }
  return result.data;
}

function summarizeConversation(
  conversation: AgentPlatformConversation,
): AgentConversationSummary {
  return {
    id: conversation.id,
    surface: conversation.surface as AgentConversationSummary['surface'],
    title: conversation.title,
    permissionMode: conversation.permissionMode,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    archivedAt: conversation.archivedAt?.toISOString() ?? null,
  };
}

function conversationNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'AGENT_CONVERSATION_NOT_FOUND',
    message: 'Agent conversation not found.',
  });
}
