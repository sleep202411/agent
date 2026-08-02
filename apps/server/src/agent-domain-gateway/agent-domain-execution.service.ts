import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type AgentDomainCommand } from '@prisma/client';
import { ZodError } from 'zod';

import { PrismaService } from '../infra/db/db.module';
import { canonicalJsonHash } from '../story-studio/canonical-json';
import {
  AgentDomainToolIdSchema,
  AgentDomainToolRequestSchema,
  AgentDomainToolResultSchema,
  type AgentDomainToolResult,
} from './agent-domain.dto';
import { parseAgentDomainToolArguments } from './agent-domain-tool.schemas';
import { StoryAgentDomainService } from './story-agent-domain.service';
import { StorySourceMaterialDomainService } from './story-source-material-domain.service';

export type AgentDomainHttpResult = Readonly<{
  httpStatus: number;
  body: AgentDomainToolResult;
  replayed: boolean;
}>;

@Injectable()
export class AgentDomainExecutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly story: StoryAgentDomainService,
    private readonly sourceMaterial: StorySourceMaterialDomainService,
  ) {}

  async execute(input: {
    toolId: string;
    idempotencyKey: string;
    body: unknown;
  }): Promise<AgentDomainHttpResult> {
    const toolId = AgentDomainToolIdSchema.parse(input.toolId);
    const requestHash = canonicalJsonHash(input.body);

    return this.prisma.$transaction(
      async (tx) => {
        await lockIdempotencyKey(tx, input.idempotencyKey);
        const existing = await tx.agentDomainCommand.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (existing) {
          return replay(existing, toolId, requestHash);
        }

        // A domain rejection keeps its receipt but must discard everything the
        // command already wrote — a rejected approval that leaves the row half
        // mutated is unrecoverable. The savepoint is the only way to drop those
        // writes without also dropping the idempotency lock this transaction
        // holds, which is what keeps the command exactly-once.
        await tx.$executeRaw`SAVEPOINT agent_domain_dispatch`;
        try {
          const request = AgentDomainToolRequestSchema.parse(input.body);
          const args = parseAgentDomainToolArguments(toolId, request.arguments);
          const body = await this.dispatch(tx, toolId, request, args, {
            idempotencyKey: input.idempotencyKey,
            requestHash,
          });
          const httpStatus = HttpStatus.OK;
          await persistReceipt(tx, {
            idempotencyKey: input.idempotencyKey,
            toolId,
            requestHash,
            request,
            requestDocument: input.body,
            httpStatus,
            body,
          });
          return { httpStatus, body, replayed: false };
        } catch (error) {
          const rejection = domainRejection(error);
          if (!rejection) throw error;
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT agent_domain_dispatch`;
          const request = AgentDomainToolRequestSchema.safeParse(input.body);
          await persistReceipt(tx, {
            idempotencyKey: input.idempotencyKey,
            toolId,
            requestHash,
            request: request.success ? request.data : null,
            requestDocument: input.body,
            httpStatus: rejection.httpStatus,
            body: rejection.body,
          });
          return { ...rejection, replayed: false };
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 15_000,
      },
    );
  }

  private dispatch(
    tx: Prisma.TransactionClient,
    toolId: ReturnType<typeof AgentDomainToolIdSchema.parse>,
    request: ReturnType<typeof AgentDomainToolRequestSchema.parse>,
    args: unknown,
    execution: { idempotencyKey: string; requestHash: string },
  ): Promise<AgentDomainToolResult> {
    switch (toolId) {
      case 'story_get_source_analysis':
        return this.sourceMaterial.analysis(tx, request, args);
      case 'story_query_source_material':
        return this.sourceMaterial.query(tx, request, args);
      case 'story_get_snapshot':
        return this.story.readSnapshot(tx, request, args);
      case 'story_apply_change_set':
        return this.story.applyChangeSet(tx, request, args, execution);
      case 'crew_get_state':
      case 'crew_apply_management_command':
      case 'crew_apply_finance_command':
      case 'crew_submit_own_assignment':
        throw new NotFoundException({
          code: 'AGENT_SURFACE_UNAVAILABLE',
          message: 'The crew Agent surface is not available.',
        });
    }
  }
}

async function lockIdempotencyKey(
  tx: Prisma.TransactionClient,
  idempotencyKey: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`agent-domain:${idempotencyKey}`}, 0)
    )
  `;
}

function replay(
  receipt: AgentDomainCommand,
  toolId: string,
  requestHash: string,
): AgentDomainHttpResult {
  if (receipt.toolId !== toolId || receipt.requestHash !== requestHash) {
    return {
      httpStatus: HttpStatus.CONFLICT,
      replayed: true,
      body: {
        status: 'rejected',
        error: {
          code: 'AGENT_DOMAIN_IDEMPOTENCY_CONFLICT',
          message:
            'The idempotency key was already used for a different Agent domain request.',
          retryable: false,
        },
      },
    };
  }
  return {
    httpStatus: receipt.httpStatus,
    body: AgentDomainToolResultSchema.parse(receipt.response),
    replayed: true,
  };
}

async function persistReceipt(
  tx: Prisma.TransactionClient,
  input: {
    idempotencyKey: string;
    toolId: string;
    requestHash: string;
    request: ReturnType<typeof AgentDomainToolRequestSchema.parse> | null;
    requestDocument: unknown;
    httpStatus: number;
    body: AgentDomainToolResult;
  },
): Promise<void> {
  await tx.agentDomainCommand.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      toolId: input.toolId,
      actorId: input.request?.actor.id ?? 'invalid-request',
      surface: input.request?.scope.surface ?? 'invalid-request',
      scopeKey: input.request
        ? scopeKey(input.request.scope)
        : 'invalid-request',
      requestHash: input.requestHash,
      request: input.requestDocument as Prisma.InputJsonValue,
      httpStatus: input.httpStatus,
      response: input.body as unknown as Prisma.InputJsonObject,
    },
  });
}

function scopeKey(
  scope: ReturnType<typeof AgentDomainToolRequestSchema.parse>['scope'],
): string {
  return scope.surface === 'story-studio'
    ? `${scope.workspaceId}:${scope.projectId}`
    : scope.crewId;
}

function domainRejection(
  error: unknown,
): Omit<AgentDomainHttpResult, 'replayed'> | null {
  if (error instanceof ZodError) {
    return rejected(HttpStatus.UNPROCESSABLE_ENTITY, {
      code: 'AGENT_DOMAIN_INPUT_INVALID',
      message: 'The Agent tool input does not match the domain contract.',
      details: error.issues,
    });
  }
  if (
    error instanceof ForbiddenException ||
    error instanceof NotFoundException
  ) {
    return rejected(HttpStatus.FORBIDDEN, {
      code: 'AGENT_DOMAIN_FORBIDDEN',
      message: 'The actor is not allowed to access this domain resource.',
    });
  }
  if (error instanceof ConflictException) {
    return rejected(HttpStatus.CONFLICT, displayable(error));
  }
  if (
    error instanceof BadRequestException ||
    error instanceof UnprocessableEntityException
  ) {
    return rejected(HttpStatus.UNPROCESSABLE_ENTITY, displayable(error));
  }
  if (error instanceof HttpException && error.getStatus() === 423) {
    return rejected(HttpStatus.CONFLICT, displayable(error));
  }
  return null;
}

function displayable(error: HttpException): {
  code: string;
  message: string;
  details?: unknown;
} {
  const response = error.getResponse();
  if (typeof response === 'string') {
    return {
      code: statusCode(error.getStatus()),
      message: response,
    };
  }
  const record = response as Record<string, unknown>;
  const message = Array.isArray(record.message)
    ? record.message.join('; ')
    : typeof record.message === 'string'
      ? record.message
      : 'The domain command was rejected.';
  const code =
    typeof record.code === 'string' && record.code.length > 0
      ? record.code
      : statusCode(error.getStatus());
  const details = Object.fromEntries(
    Object.entries(record).filter(
      ([key]) => key !== 'code' && key !== 'message' && key !== 'statusCode',
    ),
  );
  return {
    code,
    message,
    ...(Object.keys(details).length > 0 ? { details } : {}),
  };
}

function statusCode(status: number): string {
  if (status === 409 || status === 423) {
    return 'AGENT_DOMAIN_CONFLICT';
  }
  if (status === 403 || status === 404) {
    return 'AGENT_DOMAIN_FORBIDDEN';
  }
  return 'AGENT_DOMAIN_INPUT_INVALID';
}

function rejected(
  httpStatus: number,
  error: {
    code: string;
    message: string;
    details?: unknown;
  },
): Omit<AgentDomainHttpResult, 'replayed'> {
  return {
    httpStatus,
    body: {
      status: 'rejected',
      error: {
        code: error.code,
        message: error.message,
        retryable: false,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    },
  };
}
