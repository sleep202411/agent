import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';

export interface PlatformAuditInput {
  workspaceId?: string | null;
  projectId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  requestId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class PlatformAuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    input: PlatformAuditInput,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await client.platformAuditLog.create({
      data: {
        workspaceId: input.workspaceId ?? null,
        projectId: input.projectId ?? null,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        requestId: input.requestId ?? null,
        before:
          input.before === undefined
            ? Prisma.JsonNull
            : (input.before as Prisma.InputJsonValue),
        after:
          input.after === undefined
            ? Prisma.JsonNull
            : (input.after as Prisma.InputJsonValue),
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}
