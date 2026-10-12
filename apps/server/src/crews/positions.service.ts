import { assertNewCrewCurrency } from './earnings/ledger-currency';
/**
 * Position CRUD inside a crew.
 *
 * Status invariant:
 *   open    — public, accepting applications
 *   frozen  — owner toggled off; not visible to outsiders
 *   full    — recruitedCount >= targetCount; service-managed.
 *             Owner can't manually set FULL — applications go through
 *             approve workflow, and a remove drops back to open.
 *
 * Hard-soft delete (deletedAt) is ALWAYS blocked while pending
 * applications exist — per spec, owner must process them first.
 */
import {
  hasUserLevel,
  CERTIFIED_PRODUCER_LEVEL_ID,
} from '../integrations/java/user-level-gates';
import { assertRecruitableTask } from './task-recruitment';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type CrewModerationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { toSmallestUnit } from '../common/currency';
import type {
  CreatePositionInput,
  ListCrewPositionsQuery,
  ListPublicPositionsQuery,
  UpdatePositionInput,
} from './dto';
import { newCrewDomainId } from './id';
import { resolveCrewLogoUrl, toPositionDTO } from './mappers';
import { CrewAuthorizationService } from './crew-authorization.service';

@Injectable()
export class PositionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: CrewAuthorizationService,
  ) {}

  private requireProducer(levelIds: readonly number[]) {
    // Java level 13 is the certified producer qualification. Crew creation is unrestricted.
    if (!hasUserLevel(levelIds, CERTIFIED_PRODUCER_LEVEL_ID))
      throw new ForbiddenException({
        code: 'CREW_PRODUCER_REQUIRED',
        message:
          'Producer qualification is required to publish recruitment to the Positions plaza.',
      });
  }

  async list(
    crewId: string,
    viewerId: string | null,
    query: ListCrewPositionsQuery,
  ) {
    const crew = await this.prisma.crew.findFirst({
      where: { id: crewId, deletedAt: null },
      select: { listingStatus: true, moderationStatus: true },
    });
    if (!crew) throw new NotFoundException('Crew not found');
    // A taken-down crew leaks nothing — its positions 404 for everyone.
    if (crew.moderationStatus === 'taken_down') {
      throw new NotFoundException('Crew not found');
    }

    const viewer = viewerId
      ? await this.authorization.resolve(crewId, viewerId)
      : null;
    if (crew.listingStatus !== 'listed' && !viewer) {
      // Mirror crews.detail visibility — unlisted crews are accessible
      // only to founder + active members. Deep-linking to
      // /crews/:id/positions must not leak position lists either.
      throw new NotFoundException('Crew not found');
    }

    const canManage = viewer?.permissions.includes('openings.manage') ?? false;
    const where = {
      crewId,
      deletedAt: null,
      // Admin-taken-down postings are invisible on every public surface.
      moderationStatus: 'ok',
      ...(canManage
        ? {}
        : {
            status: { not: 'frozen' as const },
            recruitmentVisibility: 'public',
          }),
    } satisfies Prisma.CrewPositionWhereInput;
    if (query.cursor) {
      const cursor = await this.prisma.crewPosition.findFirst({
        where: { ...where, id: query.cursor },
        select: { id: true },
      });
      if (!cursor) {
        throw new BadRequestException({
          code: 'CREW_POSITION_CURSOR_INVALID',
          message:
            'The crew positions cursor is invalid for the current viewer. Restart from the first page.',
        });
      }
    }
    const [rows, total] = await Promise.all([
      this.prisma.crewPosition.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
      this.prisma.crewPosition.count({ where }),
    ]);
    const page = rows.slice(0, query.limit);
    const applicationGroups = canManage
      ? await this.prisma.crewApplication.groupBy({
          by: ['positionId', 'status'],
          where: { crewId, positionId: { in: page.map((row) => row.id) } },
          _count: { _all: true },
        })
      : [];
    const counts = new Map<
      string,
      { total: number; pending: number; approved: number; rejected: number }
    >();
    for (const group of applicationGroups) {
      const current = counts.get(group.positionId) ?? {
        total: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
      };
      const count = group._count._all;
      current[group.status] += count;
      current.total += count;
      counts.set(group.positionId, current);
    }
    return {
      items: page.map((row) =>
        toPositionDTO(
          row,
          canManage
            ? (counts.get(row.id) ?? {
                total: 0,
                pending: 0,
                approved: 0,
                rejected: 0,
              })
            : undefined,
        ),
      ),
      nextCursor:
        rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
      total,
    };
  }

  async saved(positionId: string, userId: string) {
    return {
      saved: Boolean(
        await this.prisma.crewSavedPosition.findUnique({
          where: { userId_positionId: { userId, positionId } },
        }),
      ),
    };
  }
  async save(positionId: string, userId: string, saved: boolean) {
    if (!saved) {
      await this.prisma.crewSavedPosition.deleteMany({
        where: { userId, positionId },
      });
      return { saved: false };
    }
    const position = await this.prisma.crewPosition.findFirst({
      where: {
        id: positionId,
        deletedAt: null,
        status: { not: 'frozen' },
        moderationStatus: 'ok',
        recruitmentVisibility: 'public',
        crew: {
          deletedAt: null,
          listingStatus: 'listed',
          moderationStatus: 'ok',
        },
      },
      select: { id: true, crewId: true },
    });
    if (!position) throw new NotFoundException('Position not found');
    if (
      await this.prisma.ipUserContentBlock.findFirst({
        where: {
          userId,
          targetType: 'crew',
          targetId: position.crewId,
          unblockedAt: null,
        },
      })
    )
      throw new NotFoundException('Position not found');
    await this.prisma.crewSavedPosition.createMany({
      data: [{ userId, positionId }],
      skipDuplicates: true,
    });
    return { saved: true };
  }

  async listPublic(query: ListPublicPositionsQuery, userId?: string) {
    const blockedCrews = userId
      ? await this.prisma.ipUserContentBlock.findMany({
          where: { userId, targetType: 'crew', unblockedAt: null },
          select: { targetId: true },
        })
      : [];
    const limit = query.limit;
    const today = new Date(new Date().toISOString().slice(0, 10));
    const baseWhere = {
      ...(query.positionType ? { positionType: query.positionType } : {}),
      ...(query.salaryMinMinor !== undefined ||
      query.salaryMaxMinor !== undefined
        ? {
            salaryNegotiable: false,
            salaryCurrency: query.salaryCurrency,
            salaryPeriod: query.salaryPeriod,
            ...(query.salaryMinMinor !== undefined
              ? { salaryMaxAmount: { gte: BigInt(query.salaryMinMinor) } }
              : {}),
            ...(query.salaryMaxMinor !== undefined
              ? { salaryMinAmount: { lte: BigInt(query.salaryMaxMinor) } }
              : {}),
          }
        : {}),
      recruitmentVisibility: 'public',
      ...(query.saved === 'true'
        ? { savedBy: { some: { userId: userId ?? '' } } }
        : {}),
      ...(query.crewId ? { crewId: query.crewId } : {}),
      ...(query.skills?.length || query.skill
        ? {
            requiredSkills: {
              hasSome: [
                ...new Set([
                  ...(query.skills ?? []),
                  ...(query.skill ? [query.skill] : []),
                ]),
              ],
            },
          }
        : {}),
      ...(query.q
        ? {
            AND: [
              {
                groupedTasks: {
                  none: {
                    OR: [
                      { deletedAt: { not: null } },
                      {
                        workflowState: {
                          semantic: {
                            in: ['approved', 'cancelled', 'submitted'],
                          },
                        },
                      },
                    ],
                  },
                },
              },
              {
                OR: [
                  {
                    description: {
                      contains: query.q,
                      mode: 'insensitive' as const,
                    },
                  },
                  {
                    positionType: {
                      contains: query.q,
                      mode: 'insensitive' as const,
                    },
                  },
                  {
                    crew: {
                      name: { contains: query.q, mode: 'insensitive' as const },
                    },
                  },
                ],
              },
            ],
          }
        : {}),
      deletedAt: null,
      status: 'open',
      moderationStatus: 'ok',
      OR: [{ closeDate: null }, { closeDate: { gte: today } }],
      ...(query.employment.length
        ? { employmentType: { in: query.employment } }
        : {}),
      ...(query.seniority.length
        ? { experienceLevel: { in: query.seniority } }
        : {}),
      ...(query.workMode.length ? { workMode: { in: query.workMode } } : {}),
      // Mirror crews.list visibility: positions on unlisted crews
      // must not surface in the public plaza, otherwise a clicker
      // lands on a 404 crew-detail page (crews.detail rejects
      // non-member viewers for unlisted crews).
      crew: {
        ...(query.genre ? { genres: { has: query.genre } } : {}),
        ...(blockedCrews.length
          ? { id: { notIn: blockedCrews.map((row) => row.targetId) } }
          : {}),
        deletedAt: null,
        listingStatus: 'listed',
        moderationStatus: 'ok',
      },
    } satisfies Prisma.CrewPositionWhereInput;
    const where: Prisma.CrewPositionWhereInput = {
      ...baseWhere,
      AND: [
        ...(baseWhere.AND ?? []),
        {
          OR: [
            { taskId: null },
            {
              task: {
                deletedAt: null,
                workflowState: {
                  semantic: { notIn: ['approved', 'cancelled', 'submitted'] },
                },
              },
            },
          ],
        },
      ],
    };
    const direction = query.sort === 'oldest' ? 'asc' : 'desc';
    if (query.cursor) {
      const cursor = await this.prisma.crewPosition.findFirst({
        where: { ...where, id: query.cursor },
        select: { id: true },
      });
      if (!cursor) {
        throw new BadRequestException({
          code: 'CREW_POSITION_CURSOR_INVALID',
          message:
            'The positions cursor is invalid for the current filters. Restart from the first page.',
        });
      }
    }
    const [rows, total] = await Promise.all([
      this.prisma.crewPosition.findMany({
        where,
        include: {
          crew: {
            select: {
              id: true,
              name: true,
              logo: true,
              tagline: true,
              genres: true,
              styles: true,
            },
          },
        },
        orderBy: [{ createdAt: direction }, { id: direction }],
        take: limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
      this.prisma.crewPosition.count({ where }),
    ]);

    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => ({
        position: toPositionDTO(row),
        crew: {
          id: row.crew.id,
          name: row.crew.name,
          logo: row.crew.logo,
          tagline: row.crew.tagline,
          genres: row.crew.genres,
          styles: row.crew.styles,
        },
      })),
      nextCursor:
        rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
      total,
    };
  }

  /**
   * Admin patrol — every recruitment posting across all crews, newest first,
   * for post-hoc moderation. Bypasses viewer-visibility gates by design; the
   * controller enforces AdminAuthGuard + CrewManage.
   */
  async adminList(opts: {
    q?: string;
    moderationStatus?: CrewModerationStatus;
    limit?: number;
    cursor?: string;
  }) {
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
    const q = opts.q?.trim();
    const where: Prisma.CrewPositionWhereInput = {
      deletedAt: null,
      ...(opts.moderationStatus
        ? { moderationStatus: opts.moderationStatus }
        : {}),
      ...(q
        ? {
            OR: [
              { id: q },
              { positionType: { contains: q, mode: 'insensitive' } },
              { crew: { name: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    if (opts.cursor) {
      const cursor = await this.prisma.crewPosition.findFirst({
        where: { AND: [where, { id: opts.cursor }] },
        select: { id: true },
      });
      if (!cursor)
        throw new BadRequestException({
          code: 'CREW_POSITION_CURSOR_INVALID',
          message:
            'The positions cursor is invalid for the current filters. Restart from the first page.',
        });
    }
    const rows = await this.prisma.crewPosition.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      include: { crew: { select: { id: true, name: true, logo: true } } },
    });
    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: slice.map((row) => ({
        id: row.id,
        crewId: row.crewId,
        crewName: row.crew.name,
        crewLogo: resolveCrewLogoUrl(row.crew.logo),
        positionType: row.positionType,
        description: row.description,
        status: row.status,
        moderationStatus: row.moderationStatus,
        moderationReason: row.moderationReason,
        moderatedAt: row.moderatedAt ? row.moderatedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? slice[slice.length - 1].id : null,
    };
  }

  /** Take a posting down / restore it, with an audit reason. Post-hoc. */
  async setModeration(
    positionId: string,
    status: CrewModerationStatus,
    opts: { adminId: string; reason?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM crew_positions WHERE id=${positionId} FOR UPDATE`;
      const position = await tx.crewPosition.findFirst({
        where: { id: positionId, deletedAt: null },
        select: { id: true },
      });
      if (!position) throw new NotFoundException('Position not found');
      const reason = opts.reason?.trim() || null;
      const updated = await tx.crewPosition.update({
        where: { id: positionId },
        data: {
          moderationStatus: status,
          moderatedAt: new Date(),
          moderatedByAdminId: opts.adminId,
          moderationReason: status === 'taken_down' ? reason : null,
        },
        include: { crew: { select: { id: true, name: true, logo: true } } },
      });
      return {
        id: updated.id,
        crewId: updated.crewId,
        crewName: updated.crew.name,
        crewLogo: resolveCrewLogoUrl(updated.crew.logo),
        positionType: updated.positionType,
        description: updated.description,
        status: updated.status,
        moderationStatus: updated.moderationStatus,
        moderationReason: updated.moderationReason,
        moderatedAt: updated.moderatedAt
          ? updated.moderatedAt.toISOString()
          : null,
        createdAt: updated.createdAt.toISOString(),
      };
    });
  }

  async create(
    crewId: string,
    ownerId: string,
    input: CreatePositionInput,
    levelIds: readonly number[] = [],
  ) {
    await this.authorization.require(crewId, ownerId, 'openings.manage');
    if (input.recruitmentVisibility !== 'private')
      this.requireProducer(levelIds);
    if (input.recruitmentVisibility === 'private' && !input.taskId)
      throw new BadRequestException(
        'Private recruitment requires a linked task.',
      );
    return this.positionWrite(crewId, ownerId, undefined, async (tx) => {
      let groupedTaskTerms: Record<string, Prisma.InputJsonValue> | undefined;
      if (input.tasks) {
        if (
          input.taskId ||
          input.recruitmentVisibility === 'private' ||
          input.targetCount !== 1
        )
          throw new BadRequestException(
            'Grouped recruitment requires one public position for one creator.',
          );
        if (new Set(input.tasks.map((t) => t.id)).size !== input.tasks.length)
          throw new BadRequestException('Select each task only once.');
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${crewId}`}, 0))`;
        await this.authorization.require(crewId, ownerId, 'tasks.manage', tx);
        groupedTaskTerms = {};
        let total = 0;
        let currency: string | undefined;
        let paymentTerms: string | undefined;
        const descriptions: string[] = [];
        const taskSkills = new Set<string>();
        for (const selected of input.tasks) {
          await assertRecruitableTask(tx, crewId, selected.id);
          const task = await tx.crewTask.findFirstOrThrow({
            where: { id: selected.id, crewId, deletedAt: null },
            include: { assignees: true },
          });
          if (
            task.version !== selected.expectedVersion ||
            task.assignees.length
          )
            throw new ConflictException(
              'A selected task changed or already has an assignee. Refresh before recruiting.',
            );
          if (
            await tx.crewPosition.count({
              where: {
                deletedAt: null,
                OR: [
                  { taskId: task.id },
                  { groupedTasks: { some: { id: task.id } } },
                ],
              },
            })
          )
            throw new ConflictException(
              'A selected task already belongs to recruitment.',
            );
          for (const skill of ((task.metadata as Prisma.JsonObject | null)
            ?.requiredSkills ?? []) as Prisma.JsonArray) {
            if (typeof skill === 'string') taskSkills.add(skill);
          }
          const c = (task.metadata as Prisma.JsonObject | null)
            ?.compensation as Prisma.JsonObject | undefined;
          const amount = c?.rewardUsdMinor;
          if (
            typeof amount !== 'number' ||
            !Number.isSafeInteger(amount) ||
            amount < 0 ||
            typeof c?.rewardCurrency !== 'string' ||
            typeof c?.paymentTerms !== 'string'
          )
            throw new BadRequestException(
              'Set a fixed reward, currency and payment terms on every selected task first.',
            );
          if (
            (currency && currency !== c.rewardCurrency) ||
            (paymentTerms && paymentTerms !== c.paymentTerms)
          )
            throw new BadRequestException(
              'Grouped tasks must share currency and payment terms.',
            );
          if (c.profitShareBps)
            throw new BadRequestException(
              'Revenue-sharing tasks require individual negotiated recruitment.',
            );
          currency = c.rewardCurrency;
          paymentTerms = c.paymentTerms;
          assertNewCrewCurrency(currency, 'task currency');
          groupedTaskTerms[task.id] = { amount, currency };
          total += amount;
          descriptions.push(
            `${task.title}: ${currency} ${(amount / 100).toFixed(2)}\n${task.description ?? ''}`,
          );
        }
        if (!Number.isSafeInteger(total) || total > 10_000_000_000)
          throw new BadRequestException(
            'The grouped reward exceeds the supported limit.',
          );
        if (new Set([...taskSkills, ...(input.requiredSkills ?? [])]).size > 20)
          throw new BadRequestException(
            'Grouped recruitment supports at most 20 distinct required skills. Select fewer tasks.',
          );
        input = {
          ...input,
          requiredSkills: [
            ...new Set([...taskSkills, ...(input.requiredSkills ?? [])]),
          ],
          description: descriptions.join('\n\n'),
          paymentTerms: paymentTerms as CreatePositionInput['paymentTerms'],
          salary: {
            currency: currency as 'USD' | 'CNY',
            min: total / 100,
            max: total / 100,
            period: 'project',
            negotiable: false,
          },
        };
      }
      if (input.taskId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${crewId}`}, 0))`;
        await this.authorization.require(crewId, ownerId, 'tasks.manage', tx);
        await assertRecruitableTask(tx, crewId, input.taskId);
        if (input.expectedTaskVersion !== undefined) {
          const snapshot = await tx.crewTask.findFirst({
            where: { id: input.taskId, crewId, deletedAt: null },
            select: { version: true },
          });
          if (!snapshot || snapshot.version !== input.expectedTaskVersion)
            throw new ConflictException(
              'Task changed. Refresh before publishing recruitment.',
            );
          const existing = await tx.crewPosition.findFirst({
            where: {
              OR: [
                { taskId: input.taskId },
                { groupedTasks: { some: { id: input.taskId } } },
              ],
              deletedAt: null,
            },
            select: { id: true },
          });
          if (existing)
            throw new ConflictException(
              'This task already has recruitment. Review its existing position.',
            );
        }

        const assigned = await tx.crewTaskAssignee.count({
          where: { taskId: input.taskId },
        });
        if (assigned)
          throw new ConflictException(
            'Create task recruitment before assigning work. Existing assignments must retain their agreements.',
          );
      }
      assertNewCrewCurrency(input.salary?.currency, 'salary.currency');
      const ccy = input.salary?.currency ?? null;
      const row = await tx.crewPosition.create({
        data: {
          id: newCrewDomainId(),
          crewId,
          taskId: input.taskId ?? null,
          ...(input.tasks
            ? {
                groupedTasks: {
                  connect: input.tasks.map((t) => ({ id: t.id })),
                },
                groupedTaskTerms,
              }
            : {}),
          recruitmentVisibility: input.recruitmentVisibility ?? 'public',
          positionType: input.positionType,
          description: input.description,
          targetCount: input.targetCount,
          workMode: input.workMode,
          location:
            input.workMode === 'remote' ? null : (input.location ?? null),
          employmentType: input.employmentType,
          experienceLevel: input.experienceLevel,
          requiredSkills: input.requiredSkills,
          paymentTerms: input.paymentTerms ?? null,
          salaryPeriod: input.salary?.period ?? null,
          salaryCurrency: ccy,
          salaryMinAmount:
            input.salary?.min != null && ccy != null
              ? toSmallestUnit(input.salary.min, ccy)
              : null,
          salaryMaxAmount:
            input.salary?.max != null && ccy != null
              ? toSmallestUnit(input.salary.max, ccy)
              : null,
          salaryNegotiable: input.salary?.negotiable ?? false,
          durationMonths: input.durationMonths ?? null,
          // Wire is plain %, storage is bp. Math.round guards against
          // FP rounding from values like 2.5 (which round-trips fine
          // but defensive-coded for future steps like 0.25 if we relax).
          revenueShareBp:
            input.revenueSharePercent != null
              ? Math.round(input.revenueSharePercent * 100)
              : null,
          closeDate: input.closeDate
            ? new Date(`${input.closeDate}T00:00:00Z`)
            : null,
        },
      });
      return toPositionDTO(row);
    });
  }

  async update(
    crewId: string,
    positionId: string,
    ownerId: string,
    input: UpdatePositionInput,
    levelIds: readonly number[] = [],
  ) {
    await this.authorization.require(crewId, ownerId, 'openings.manage');
    return this.positionWrite(crewId, ownerId, positionId, async (tx) => {
      const pos = await this.requirePosition(crewId, positionId, tx);
      if (
        pos.groupedTaskTerms &&
        (input.salary ||
          input.description !== undefined ||
          input.requiredSkills !== undefined ||
          input.paymentTerms ||
          input.targetCount !== undefined ||
          input.revenueSharePercent !== undefined)
      )
        throw new ConflictException(
          'Grouped recruitment retains its per-task agreements. Create a new posting to change compensation or headcount.',
        );
      assertNewCrewCurrency(input.salary?.currency, 'salary.currency');

      if (
        input.targetCount !== undefined &&
        input.targetCount < pos.recruitedCount
      ) {
        throw new BadRequestException({
          message: 'targetCount cannot be below recruitedCount',
          field: 'targetCount',
          recruitedCount: pos.recruitedCount,
        });
      }

      let nextStatus = input.status ?? pos.status;
      // Closing is explicit owner intent; capacity edits must not publish it again.
      if (input.targetCount !== undefined && nextStatus !== 'frozen') {
        const tc = input.targetCount;
        if (pos.recruitedCount >= tc) nextStatus = 'full';
        else if (pos.status === 'full' && pos.recruitedCount < tc)
          nextStatus = 'open';
      }

      if (
        pos.recruitmentVisibility !== 'private' &&
        pos.status === 'frozen' &&
        nextStatus !== 'frozen'
      ) {
        this.requireProducer(levelIds);
      }
      const updated = await tx.crewPosition.update({
        where: { id: positionId },
        data: {
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.targetCount !== undefined
            ? { targetCount: input.targetCount }
            : {}),
          ...(input.workMode !== undefined ? { workMode: input.workMode } : {}),
          ...(input.location !== undefined ? { location: input.location } : {}),
          ...(input.employmentType !== undefined
            ? { employmentType: input.employmentType }
            : {}),
          ...(input.experienceLevel !== undefined
            ? { experienceLevel: input.experienceLevel }
            : {}),
          ...(input.requiredSkills !== undefined
            ? { requiredSkills: input.requiredSkills }
            : {}),
          ...(input.paymentTerms !== undefined
            ? { paymentTerms: input.paymentTerms }
            : {}),
          ...(input.salary?.period !== undefined
            ? { salaryPeriod: input.salary.period }
            : {}),
          ...(input.salary?.currency !== undefined
            ? { salaryCurrency: input.salary.currency }
            : {}),
          ...(input.salary?.min !== undefined && input.salary?.currency
            ? {
                salaryMinAmount:
                  input.salary.min != null
                    ? toSmallestUnit(input.salary.min, input.salary.currency)
                    : null,
              }
            : {}),
          ...(input.salary?.max !== undefined && input.salary?.currency
            ? {
                salaryMaxAmount:
                  input.salary.max != null
                    ? toSmallestUnit(input.salary.max, input.salary.currency)
                    : null,
              }
            : {}),
          ...(input.salary?.negotiable !== undefined
            ? { salaryNegotiable: input.salary.negotiable }
            : {}),
          ...(input.durationMonths !== undefined
            ? { durationMonths: input.durationMonths }
            : {}),
          ...(input.revenueSharePercent !== undefined
            ? {
                revenueShareBp:
                  input.revenueSharePercent != null
                    ? Math.round(input.revenueSharePercent * 100)
                    : null,
              }
            : {}),
          ...(input.closeDate !== undefined
            ? {
                closeDate: input.closeDate
                  ? new Date(`${input.closeDate}T00:00:00Z`)
                  : null,
              }
            : {}),
          status: nextStatus,
        },
      });
      return toPositionDTO(updated);
    });
  }

  async delete(
    crewId: string,
    positionId: string,
    ownerId: string,
  ): Promise<void> {
    await this.authorization.require(crewId, ownerId, 'openings.manage');
    return this.positionWrite(crewId, ownerId, positionId, async (tx) => {
      await this.requirePosition(crewId, positionId, tx);

      const pendingCount = await tx.crewApplication.count({
        where: { positionId, status: 'pending' },
      });
      if (pendingCount > 0) {
        throw new ConflictException({
          message: 'Cannot delete position with pending applications',
          pendingCount,
        });
      }
      await tx.crewPosition.update({
        where: { id: positionId },
        data: { deletedAt: new Date() },
      });
    });
  }

  private async positionWrite<T>(
    crewId: string,
    userId: string,
    positionId: string | undefined,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      if (positionId)
        await tx.$queryRaw`SELECT id FROM crew_positions WHERE id=${positionId} AND crew_id=${crewId} FOR UPDATE`;
      else
        await tx.$queryRaw`SELECT id FROM crews WHERE id=${crewId} FOR SHARE`;
      await this.authorization.require(crewId, userId, 'openings.manage', tx);
      const result = await work(tx);
      await this.authorization.require(crewId, userId, 'openings.manage', tx);
      return result;
    });
  }

  private async requirePosition(
    crewId: string,
    positionId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const pos = await db.crewPosition.findFirst({
      where: { id: positionId, crewId, deletedAt: null },
    });
    if (!pos) throw new NotFoundException('Position not found');
    return pos;
  }
}
