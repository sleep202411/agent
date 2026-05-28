import { Injectable } from '@nestjs/common';
import { AdminAuditOutcome, Prisma } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import type { ListAdminAuditQuery } from './admin-audit.dto';

@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListAdminAuditQuery) {
    const where = this.buildWhere(query);
    const skip = (query.page - 1) * query.pageSize;
    const [total, items] = await Promise.all([
      this.prisma.adminAuditLog.count({ where }),
      this.prisma.adminAuditLog.findMany({
        where,
        include: {
          actor: {
            select: {
              id: true,
              email: true,
              displayName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.pageSize,
      }),
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        actor: item.actor
          ? {
              id: item.actor.id,
              email: item.actor.email,
              displayName: item.actor.displayName,
            }
          : null,
        actorSessionId: item.actorSessionId,
        siteScope: item.siteScope,
        action: item.action,
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        outcome: item.outcome,
        reason: item.reason,
        ipAddress: item.ipAddress,
        userAgent: item.userAgent,
        before: item.before,
        after: item.after,
        metadata: item.metadata,
        createdAt: item.createdAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  private buildWhere(
    query: ListAdminAuditQuery,
  ): Prisma.AdminAuditLogWhereInput {
    return {
      ...(query.action ? { action: { contains: query.action } } : {}),
      ...(query.resourceType
        ? { resourceType: { contains: query.resourceType } }
        : {}),
      ...(query.outcome ? { outcome: query.outcome as AdminAuditOutcome } : {}),
      ...(query.q
        ? {
            OR: [
              { action: { contains: query.q, mode: 'insensitive' } },
              { resourceType: { contains: query.q, mode: 'insensitive' } },
              { resourceId: { contains: query.q, mode: 'insensitive' } },
              {
                actor: {
                  OR: [
                    { email: { contains: query.q, mode: 'insensitive' } },
                    {
                      displayName: {
                        contains: query.q,
                        mode: 'insensitive',
                      },
                    },
                  ],
                },
              },
            ],
          }
        : {}),
    };
  }
}
