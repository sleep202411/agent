import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IpPublisherStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import type {
  CreateAdminIpPublisherInput,
  ListAdminIpPublishersQuery,
  SetAdminIpPublishersInput,
  UpdateAdminIpPublisherInput,
} from './dto';

type PublisherNames = {
  'en-US'?: string;
  'zh-CN'?: string;
  'zh-HK'?: string;
};

function resolvePublisherLogoUrl(logoUrl: string): string {
  if (!logoUrl || /^https?:\/\//i.test(logoUrl)) return logoUrl;
  const base = process.env.BANNER_BASE_URL?.replace(/\/+$/, '');
  return base ? `${base}/${logoUrl.replace(/^\/+/, '')}` : logoUrl;
}

function asNames(value: Prisma.JsonValue): PublisherNames {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as PublisherNames;
}

export function publisherDisplayName(
  names: Prisma.JsonValue,
  locale?: string | null,
  fallback = '',
): string {
  const map = asNames(names);
  const preferred = locale?.trim();
  if (preferred && map[preferred as keyof PublisherNames]?.trim()) {
    return map[preferred as keyof PublisherNames]!.trim();
  }
  return (
    map['zh-CN']?.trim() ||
    map['en-US']?.trim() ||
    map['zh-HK']?.trim() ||
    fallback
  );
}

export function publisherPublicDto(
  publisher: {
    id: string;
    code: string;
    names: Prisma.JsonValue;
    logoUrl: string;
    websiteUrl: string | null;
    displayOrder: number;
  },
  locale?: string | null,
) {
  return {
    id: publisher.id,
    code: publisher.code,
    name: publisherDisplayName(publisher.names, locale, publisher.code),
    logoUrl: resolvePublisherLogoUrl(publisher.logoUrl),
    websiteUrl: publisher.websiteUrl,
    displayOrder: publisher.displayOrder,
  };
}

const publisherAssignmentInclude = {
  publisher: true,
} satisfies Prisma.IpPublisherAssignmentInclude;

@Injectable()
export class IpPublishersService {
  constructor(private readonly prisma: PrismaService) {}

  async listAdmin(query: ListAdminIpPublishersQuery) {
    const rows = await this.prisma.ipPublisher.findMany({
      where: query.status ? { status: query.status } : undefined,
      orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
      include: {
        _count: { select: { assignments: true } },
      },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        code: row.code,
        status: row.status,
        displayOrder: row.displayOrder,
        names: asNames(row.names),
        name: publisherDisplayName(row.names, query.locale, row.code),
        logoUrl: resolvePublisherLogoUrl(row.logoUrl),
        websiteUrl: row.websiteUrl,
        notes: row.notes,
        assignmentCount: row._count.assignments,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  async createAdmin(admin: AuthUser, input: CreateAdminIpPublisherInput) {
    try {
      const created = await this.prisma.ipPublisher.create({
        data: {
          code: input.code,
          status: input.status,
          displayOrder: input.displayOrder,
          names: input.names,
          logoUrl: input.logoUrl,
          websiteUrl: input.websiteUrl ?? null,
          notes: input.notes ?? null,
          createdById: admin.userId,
          updatedById: admin.userId,
        },
        include: { _count: { select: { assignments: true } } },
      });
      return {
        publisher: {
          id: created.id,
          code: created.code,
          status: created.status,
          displayOrder: created.displayOrder,
          names: asNames(created.names),
          name: publisherDisplayName(created.names, undefined, created.code),
          logoUrl: resolvePublisherLogoUrl(created.logoUrl),
          websiteUrl: created.websiteUrl,
          notes: created.notes,
          assignmentCount: created._count.assignments,
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
        },
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Publisher code already exists.');
      }
      throw error;
    }
  }

  async updateAdmin(
    admin: AuthUser,
    publisherId: string,
    input: UpdateAdminIpPublisherInput,
  ) {
    const existing = await this.prisma.ipPublisher.findUnique({
      where: { id: publisherId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Publisher not found.');
    try {
      const updated = await this.prisma.ipPublisher.update({
        where: { id: publisherId },
        data: {
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.displayOrder !== undefined
            ? { displayOrder: input.displayOrder }
            : {}),
          ...(input.names !== undefined ? { names: input.names } : {}),
          ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
          ...(input.websiteUrl !== undefined
            ? { websiteUrl: input.websiteUrl }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          updatedById: admin.userId,
        },
        include: { _count: { select: { assignments: true } } },
      });
      return {
        publisher: {
          id: updated.id,
          code: updated.code,
          status: updated.status,
          displayOrder: updated.displayOrder,
          names: asNames(updated.names),
          name: publisherDisplayName(updated.names, undefined, updated.code),
          logoUrl: resolvePublisherLogoUrl(updated.logoUrl),
          websiteUrl: updated.websiteUrl,
          notes: updated.notes,
          assignmentCount: updated._count.assignments,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        },
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Publisher code already exists.');
      }
      throw error;
    }
  }

  async listForIp(
    ipId: string,
    locale?: string | null,
    activeOnly = false,
    db: Pick<Prisma.TransactionClient, 'ipPublisherAssignment'> = this.prisma,
  ) {
    const rows = await db.ipPublisherAssignment.findMany({
      where: {
        ipId,
        ...(activeOnly
          ? { publisher: { status: IpPublisherStatus.active } }
          : {}),
      },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      include: publisherAssignmentInclude,
    });
    return rows.map((row) => ({
      ...publisherPublicDto(row.publisher, locale),
      displayOrder: row.displayOrder,
      status: row.publisher.status,
    }));
  }

  async setForIp(
    admin: AuthUser,
    ipId: string,
    input: SetAdminIpPublishersInput,
  ) {
    const uniqueIds = [...new Set(input.publisherIds)];
    if (uniqueIds.length !== input.publisherIds.length) {
      throw new BadRequestException('Duplicate publisher ids are not allowed.');
    }

    return this.prisma.$transaction(async (tx) => {
      // All replacements of an IP's publisher list share its row lock. Locking
      // existing assignments alone does not serialize empty/disjoint lists.
      const ips = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM ips WHERE id = ${ipId}::uuid AND deleted_at IS NULL FOR UPDATE
      `;
      if (!ips.length) throw new NotFoundException('IP not found.');

      if (uniqueIds.length > 0) {
        // Hold catalog rows through commit: a concurrent deactivation must not
        // slip between eligibility validation and assignment. Consistent order
        // also avoids deadlocks between IPs sharing several publishers.
        const publishers = await tx.$queryRaw<
          Array<{ id: string; status: IpPublisherStatus }>
        >(
          Prisma.sql`SELECT id, status FROM ip_publishers
            WHERE id IN (${Prisma.join(uniqueIds.map((id) => Prisma.sql`${id}::uuid`))})
            ORDER BY id FOR SHARE`,
        );
        if (publishers.length !== uniqueIds.length) {
          throw new NotFoundException('One or more publishers were not found.');
        }
        if (publishers.some((row) => row.status !== IpPublisherStatus.active)) {
          throw new BadRequestException(
            'Only active publishers can be assigned to an IP.',
          );
        }
      }

      await tx.ipPublisherAssignment.deleteMany({ where: { ipId } });
      if (uniqueIds.length > 0) {
        await tx.ipPublisherAssignment.createMany({
          data: uniqueIds.map((publisherId, index) => ({
            ipId,
            publisherId,
            displayOrder: index,
            createdById: admin.userId,
          })),
        });
      }
      // Read before releasing the lock so the response describes this save,
      // rather than another administrator's later replacement.
      return { publishers: await this.listForIp(ipId, undefined, false, tx) };
    });
  }
}

/** Build publisher DTOs from an IP include payload. */
export function publishersFromAssignments(
  assignments:
    | Array<{
        displayOrder: number;
        publisher: {
          id: string;
          code: string;
          status: IpPublisherStatus;
          names: Prisma.JsonValue;
          logoUrl: string;
          websiteUrl: string | null;
          displayOrder: number;
        };
      }>
    | undefined,
  locale?: string | null,
  options?: { activeOnly?: boolean },
) {
  const activeOnly = options?.activeOnly ?? true;
  return (assignments ?? [])
    .filter(
      (row) => !activeOnly || row.publisher.status === IpPublisherStatus.active,
    )
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((row) => ({
      ...publisherPublicDto(row.publisher, locale),
      displayOrder: row.displayOrder,
      status: row.publisher.status,
    }));
}
