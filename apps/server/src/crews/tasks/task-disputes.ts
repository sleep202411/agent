import { requireDisputeAttachments } from './dispute-attachment-evidence';
import { CURRENT_CELL } from '../../common/region';
import { writeAdminAudit } from '../../admin-auth/admin-audit';
import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type CrewTaskDispute } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../../auth';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthGuard,
  AdminPermissionGuard,
  CurrentAdmin,
  RequireAdminPermissions,
  type AdminActor,
} from '../../admin-auth';
import { PrismaService } from '../../infra/db/db.module';
import { NotificationService } from '../../notification';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { parseIdParam } from '../../common/params';

const Evidence = z
  .array(z.string().uuid())
  .max(20)
  .default([])
  .transform((ids) => [...new Set(ids)].sort());
export const OpenDispute = z
  .object({
    id: z.string().uuid(),
    respondentUserId: z.string().trim().min(1).max(64),
    title: z.string().trim().min(1).max(180),
    message: z.string().trim().min(1).max(4000),
    submissionIds: Evidence,
  })
  .strict();
export const DisputeUpdate = z
  .object({
    requestKey: z.string().uuid(),
    expectedVersion: z.number().int().positive().max(2147483646),
    action: z.enum(['message', 'claim', 'resolve', 'appeal']),
    attachmentIds: z
      .array(z.string().uuid())
      .max(20)
      .transform((ids) => [...new Set(ids)].sort())
      .optional(),
    message: z.string().trim().min(1).max(4000),
    submissionIds: Evidence,
  })
  .strict();
const Page = z
  .object({
    beforeId: z.string().uuid().optional(),
    view: z.enum(['all', 'initiated', 'responses']).optional(),
    lifecycle: z.enum(['all', 'active', 'archived']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
const HistoryPage = z
  .object({
    beforeVersion: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type DisputeActor =
  | { kind: 'user'; id: string }
  | { kind: 'admin'; admin: AdminActor };
const actorId = (a: DisputeActor) => (a.kind === 'user' ? a.id : a.admin.id);
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
export class CrewTaskDisputesService {
  constructor(
    private readonly db: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  private authorize(row: CrewTaskDispute | null, actor: DisputeActor) {
    if (actor.kind === 'admin') {
      if (
        actor.admin.status !== 'active' ||
        !actor.admin.permissions.includes(ADMIN_PERMISSION_KEYS.CrewManage) ||
        (actor.admin.siteScope !== 'all' &&
          actor.admin.siteScope !== (CURRENT_CELL === 'cn' ? 'cn' : 'global'))
      )
        throw new ForbiddenException(
          'Active Crew administration permission is required.',
        );
    } else if (
      row &&
      ![row.openedByUserId, row.respondentUserId].includes(actor.id)
    ) {
      throw new NotFoundException('Dispute not found.');
    }
  }
  async attachmentAccess(
    id: string,
    actor: DisputeActor,
    tx: Prisma.TransactionClient = this.db,
  ) {
    const row = await tx.crewTaskDispute.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Dispute not found.');
    this.authorize(row, actor);
    if (actor.kind === 'admin') await this.requireCurrentAdmin(tx, actor.admin);
    return row;
  }

  private async requireCurrentAdmin(
    tx: Prisma.TransactionClient,
    actor: AdminActor,
  ) {
    await tx.$queryRaw`SELECT s.id FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id
      JOIN admin_user_roles ur ON ur.user_id=u.id JOIN admin_role_permissions rp ON rp.role_id=ur.role_id
      JOIN admin_permissions p ON p.id=rp.permission_id
      WHERE s.id=${actor.sessionId}::uuid AND u.id=${actor.id}::uuid AND p.key=${ADMIN_PERMISSION_KEYS.CrewManage}
      FOR SHARE OF s,u,ur,rp,p`;
    const [row] = await tx.$queryRaw<{ allowed: boolean }[]>`SELECT EXISTS(
      SELECT 1 FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id
      JOIN admin_user_roles ur ON ur.user_id=u.id JOIN admin_role_permissions rp ON rp.role_id=ur.role_id
      JOIN admin_permissions p ON p.id=rp.permission_id
      WHERE s.id=${actor.sessionId}::uuid AND u.id=${actor.id}::uuid
      AND s.status='active' AND s.expires_at>clock_timestamp() AND u.status='active'
      AND (u.site_scope='all' OR u.site_scope::text=${CURRENT_CELL === 'cn' ? 'cn' : 'global'})
      AND p.key=${ADMIN_PERMISSION_KEYS.CrewManage}) AS allowed`;
    if (!row?.allowed)
      throw new ForbiddenException(
        'Current Crew administration permission is required.',
      );
  }
  private async evidence(
    tx: Prisma.TransactionClient,
    taskId: string,
    ids: string[],
  ) {
    if (
      ids.length &&
      (await tx.crewTaskSubmission.count({
        where: { taskId, id: { in: ids } },
      })) !== ids.length
    )
      throw new ConflictException(
        'Evidence must reference submissions from this task.',
      );
  }
  private async notify(
    tx: Prisma.TransactionClient,
    row: CrewTaskDispute,
    actor: DisputeActor,
    action: string,
  ) {
    const task = await tx.crewTask.findUniqueOrThrow({
      where: { id: row.taskId },
      select: { crewId: true },
    });
    for (const userId of [row.openedByUserId, row.respondentUserId]) {
      if (actor.kind === 'user' && userId === actor.id) continue;
      await this.notifications.send(
        {
          userId,
          type: 'crew.task.updated',
          title: `Task dispute: ${row.title}`,
          body: `Dispute update: ${action}.`,
          meta: {
            crewId: task.crewId,
            taskId: row.taskId,
            disputeId: row.id,
            deeplink: `/crews/${task.crewId}/workspace?tab=tasks&task=${row.taskId}`,
          },
          idempotencyKey: `crew.dispute:${row.id}:${row.version}:${userId}`,
        },
        tx,
      );
    }
  }
  private async pendingPair(
    tx: Prisma.TransactionClient,
    taskId: string,
    left: string,
    right: string,
    except?: string,
  ) {
    return tx.crewTaskDispute.findFirst({
      where: {
        taskId,
        status: { not: 'resolved' },
        ...(except ? { id: { not: except } } : {}),
        OR: [
          { openedByUserId: left, respondentUserId: right },
          { openedByUserId: right, respondentUserId: left },
        ],
      },
    });
  }

  async open(taskId: string, userId: string, raw: z.input<typeof OpenDispute>) {
    const input = OpenDispute.parse(raw);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:dispute-id:${input.id}`},0))`;
      const prior = await tx.crewTaskDispute.findUnique({
        where: { id: input.id },
        include: { events: { where: { version: 1 } } },
      });
      if (prior) {
        this.authorize(prior, { kind: 'user', id: userId });
        if (
          prior.taskId !== taskId ||
          prior.openedByUserId !== userId ||
          prior.events[0]?.fingerprint !== hash(input)
        )
          throw new ConflictException(
            'Dispute ID was already used with different details.',
          );
        return tx.crewTaskDispute.findUniqueOrThrow({
          where: { id: prior.id },
        });
      }
      const initial = await tx.crewTask.findUnique({
        where: { id: taskId },
        select: { crewId: true },
      });
      if (!initial) throw new NotFoundException('Task not found.');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${initial.crewId}`},0))`;
      const task = await tx.crewTask.findFirst({
        where: { id: taskId },
        include: {
          assignees: true,
          crew: { include: { ownership: { include: { member: true } } } },
        },
      });
      if (!task) throw new NotFoundException('Task not found.');
      const participants = new Set([
        task.createdByUserId,
        task.approvedByUserId,
        task.crew.ownership?.member.userId,
        ...task.assignees.map((a) => a.userId),
      ]);
      for (const id of [userId, input.respondentUserId]) {
        if (
          !participants.has(id) &&
          !(await tx.crewTaskSubmission.findFirst({
            where: {
              taskId,
              OR: [{ submittedByUserId: id }, { reviewedByUserId: id }],
            },
            select: { id: true },
          }))
        )
          throw new ForbiddenException(
            'Dispute parties must have participated in this task.',
          );
      }
      if (userId === input.respondentUserId)
        throw new ConflictException(
          'Choose another task participant as the respondent.',
        );
      if (await this.pendingPair(tx, taskId, userId, input.respondentUserId))
        throw new ConflictException(
          'A dispute between these parties is already open for this task.',
        );
      await this.evidence(tx, taskId, input.submissionIds);
      const row = await tx.crewTaskDispute.create({
        data: {
          id: input.id,
          taskId,
          openedByUserId: userId,
          respondentUserId: input.respondentUserId,
          title: input.title,
        },
      });
      await tx.crewTaskDisputeEvent.create({
        data: {
          id: randomUUID(),
          disputeId: row.id,
          version: 1,
          requestKey: input.id,
          fingerprint: hash(input),
          actorId: userId,
          actorKind: 'user',
          action: 'open',
          message: input.message,
          submissionIds: input.submissionIds,
        },
      });
      await this.notify(tx, row, { kind: 'user', id: userId }, 'opened');
      return row;
    });
  }

  async update(
    id: string,
    actor: DisputeActor,
    raw: z.input<typeof DisputeUpdate>,
  ) {
    const input = DisputeUpdate.parse(raw);
    this.authorize(null, actor);
    return this.db.$transaction(async (tx) => {
      const initial = await tx.crewTaskDispute.findUnique({
        where: { id },
        include: { task: { select: { crewId: true } } },
      });
      if (!initial) throw new NotFoundException('Dispute not found.');
      this.authorize(initial, actor);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${initial.task.crewId}`},0))`;
      await tx.$queryRaw`SELECT id FROM crew_task_disputes WHERE id=${id}::uuid FOR UPDATE`;
      const row = await tx.crewTaskDispute.findUniqueOrThrow({ where: { id } });
      if (actor.kind === 'admin')
        await this.requireCurrentAdmin(tx, actor.admin);
      const retry = await tx.crewTaskDisputeEvent.findUnique({
        where: {
          disputeId_requestKey: { disputeId: id, requestKey: input.requestKey },
        },
      });
      if (retry) {
        if (
          retry.actorKind !== actor.kind ||
          retry.actorId !== actorId(actor) ||
          retry.fingerprint !== hash(input)
        )
          throw new ConflictException(
            'Request key was already used for another dispute update.',
          );
        return row;
      }
      if (row.version !== input.expectedVersion)
        throw new ConflictException(
          'Dispute changed. Read the latest version before responding.',
        );
      let status = row.status;
      let ownerAdminId = row.ownerAdminId;
      if (input.action === 'claim') {
        if (actor.kind !== 'admin')
          throw new ForbiddenException('Only operations can claim a case.');
        if (status === 'resolved')
          throw new ConflictException(
            'A resolved case must be appealed before review resumes.',
          );
        ownerAdminId = actor.admin.id;
        status = 'in_review';
      } else if (input.action === 'resolve') {
        if (actor.kind !== 'admin' || row.ownerAdminId !== actor.admin.id)
          throw new ForbiddenException(
            'Only the assigned operations owner can resolve this case.',
          );
        if (status !== 'in_review')
          throw new ConflictException('Claim the case before resolving it.');
        status = 'resolved';
      } else if (input.action === 'appeal') {
        if (actor.kind !== 'user')
          throw new ForbiddenException('Only a case participant can appeal.');
        if (status !== 'resolved')
          throw new ConflictException('Only a resolved case can be appealed.');
        if (
          await this.pendingPair(
            tx,
            row.taskId,
            row.openedByUserId,
            row.respondentUserId,
            row.id,
          )
        )
          throw new ConflictException(
            'Resolve the other open case between these parties first.',
          );
        status = 'appealed';
        ownerAdminId = null;
      } else if (status === 'resolved')
        throw new ConflictException(
          'Appeal a resolved case before adding discussion.',
        );
      await this.evidence(tx, row.taskId, input.submissionIds);
      await requireDisputeAttachments(
        tx,
        id,
        actor.kind === 'user' ? actor.id : null,
        input.attachmentIds,
      );
      await tx.crewTaskDisputeEvent.create({
        data: {
          id: randomUUID(),
          disputeId: id,
          version: row.version + 1,
          requestKey: input.requestKey,
          fingerprint: hash(input),
          actorId: actorId(actor),
          actorKind: actor.kind,
          action: input.action,
          message: input.message,
          submissionIds: input.submissionIds,
          attachmentIds: input.attachmentIds ?? [],
        },
      });
      const updated = await tx.crewTaskDispute.update({
        where: { id },
        data: { status, ownerAdminId, version: { increment: 1 } },
      });
      if (actor.kind === 'admin')
        await writeAdminAudit(tx, {
          actor: actor.admin,
          action: `admin.crew.dispute.${input.action}`,
          resourceType: 'crew_task_dispute',
          resourceId: id,
          reason: input.message.slice(0, 1000),
          before: {
            version: row.version,
            status: row.status,
            ownerAdminId: row.ownerAdminId,
          },
          after: {
            version: updated.version,
            status: updated.status,
            ownerAdminId: updated.ownerAdminId,
          },
        });
      await this.notify(tx, updated, actor, input.action);
      if (actor.kind === 'admin')
        await this.requireCurrentAdmin(tx, actor.admin);
      return updated;
    });
  }

  async history(
    id: string,
    actor: DisputeActor,
    raw: z.infer<typeof HistoryPage> = { limit: 20 },
  ) {
    const page = HistoryPage.parse(raw);
    this.authorize(null, actor);
    const row = await this.db.crewTaskDispute.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Dispute not found.');
    this.authorize(row, actor);
    const events = await this.db.crewTaskDisputeEvent.findMany({
      where: {
        disputeId: id,
        version: {
          lte: row.version,
          ...(page.beforeVersion ? { lt: page.beforeVersion } : {}),
        },
      },
      orderBy: { version: 'desc' },
      take: page.limit + 1,
      select: {
        id: true,
        version: true,
        actorId: true,
        actorKind: true,
        action: true,
        message: true,
        submissionIds: true,
        attachmentIds: true,
        createdAt: true,
      },
    });
    return {
      ...row,
      events: events.slice(0, page.limit),
      nextBeforeVersion:
        events.length > page.limit ? events[page.limit - 1].version : null,
    };
  }

  async list(actor: DisputeActor, raw: z.infer<typeof Page> = { limit: 20 }) {
    const page = Page.parse(raw);
    this.authorize(null, actor);
    const scope: Prisma.CrewTaskDisputeWhereInput =
      actor.kind === 'user'
        ? page.view === 'initiated'
          ? { openedByUserId: actor.id }
          : page.view === 'responses'
            ? { respondentUserId: actor.id }
            : {
                OR: [
                  { openedByUserId: actor.id },
                  { respondentUserId: actor.id },
                ],
              }
        : {};
    if (page.lifecycle === 'archived') scope.status = 'resolved';
    if (page.lifecycle === 'active') scope.status = { not: 'resolved' };
    const cursor = page.beforeId
      ? await this.db.crewTaskDispute.findFirst({
          where: { AND: [scope, { id: page.beforeId }] },
        })
      : null;
    if (page.beforeId && !cursor)
      throw new NotFoundException('Dispute cursor not found.');
    const rows = await this.db.crewTaskDispute.findMany({
      where: {
        AND: [
          scope,
          ...(cursor
            ? [
                {
                  OR: [
                    { createdAt: { lt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit + 1,
    });
    return {
      items: rows.slice(0, page.limit),
      nextBeforeId: rows.length > page.limit ? rows[page.limit - 1].id : null,
    };
  }
}

@Controller()
export class CrewTaskDisputesController {
  constructor(private readonly svc: CrewTaskDisputesService) {}
  @Post('crew-tasks/:taskId/disputes')
  open(
    @Param('taskId') id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(OpenDispute)) body: z.infer<typeof OpenDispute>,
  ) {
    return this.svc.open(parseIdParam(id, 'taskId'), user.userId, body);
  }
  @Get('crew-disputes')
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(Page)) page: z.infer<typeof Page>,
  ) {
    return this.svc.list({ kind: 'user', id: user.userId }, page);
  }
  @Get('crew-disputes/:id')
  history(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(HistoryPage))
    page: z.infer<typeof HistoryPage>,
  ) {
    return this.svc.history(
      parseIdParam(id, 'id'),
      { kind: 'user', id: user.userId },
      page,
    );
  }
  @Post('crew-disputes/:id/events')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(DisputeUpdate))
    body: z.infer<typeof DisputeUpdate>,
  ) {
    return this.svc.update(
      parseIdParam(id, 'id'),
      { kind: 'user', id: user.userId },
      body,
    );
  }
}

@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CrewManage)
@Controller('admin/crew-disputes')
export class CrewTaskDisputesAdminController {
  constructor(private readonly svc: CrewTaskDisputesService) {}
  @Get()
  list(
    @CurrentAdmin() admin: AdminActor,
    @Query(new ZodValidationPipe(Page)) page: z.infer<typeof Page>,
  ) {
    return this.svc.list({ kind: 'admin', admin }, page);
  }
  @Get(':id')
  history(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminActor,
    @Query(new ZodValidationPipe(HistoryPage))
    page: z.infer<typeof HistoryPage>,
  ) {
    return this.svc.history(
      parseIdParam(id, 'id'),
      { kind: 'admin', admin },
      page,
    );
  }
  @Post(':id/events')
  update(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminActor,
    @Body(new ZodValidationPipe(DisputeUpdate))
    body: z.infer<typeof DisputeUpdate>,
  ) {
    return this.svc.update(
      parseIdParam(id, 'id'),
      { kind: 'admin', admin },
      body,
    );
  }
}
