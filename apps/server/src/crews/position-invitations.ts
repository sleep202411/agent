import {
  BadRequestException,
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
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CurrentUser, ViewerCookie, type AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { ZodValidationPipe } from '../common/zod.pipe';
import { parseIdParam } from '../common/params';
import { CrewAuthorizationService } from './crew-authorization.service';
import { ApplicationsService } from './applications.service';
import { ApplySchema, type ApplyInput } from './dto';
import { assertRecruitableTask } from './task-recruitment';

const CreateInput = z
  .object({
    inviteeUserId: z.string().trim().min(1).max(64),
    expiresInDays: z.number().int().min(1).max(30).default(7),
  })
  .strict();

const PageInput = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().uuid().optional(),
  })
  .strict();

function invitationId(raw: string) {
  const parsed = z.string().uuid().safeParse(raw);
  if (!parsed.success) throw new BadRequestException('Invalid invitation ID.');
  return parsed.data;
}

@Injectable()
export class CrewPositionInvitationsService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: CrewAuthorizationService,
    private readonly applications: ApplicationsService,
  ) {}

  async list(
    userId: string,
    query: z.infer<typeof PageInput>,
    positionId?: string,
  ) {
    const page = PageInput.parse(query);
    if (positionId) {
      const position = await this.db.crewPosition.findFirst({
        where: { id: positionId, deletedAt: null },
        select: { crewId: true },
      });
      if (!position) throw new NotFoundException('Position not found.');
      await this.auth.require(position.crewId, userId, 'openings.manage');
    }
    const where = {
      ...(positionId ? { positionId } : { inviteeUserId: userId }),
      position: {
        deletedAt: null,
        moderationStatus: 'ok' as const,
        crew: { deletedAt: null, moderationStatus: 'ok' as const },
      },
    };
    if (
      page.cursor &&
      !(await this.db.crewPositionInvitation.findFirst({
        where: { ...where, id: page.cursor },
        select: { id: true },
      }))
    )
      throw new BadRequestException('Invalid invitation cursor.');
    const rows = await this.db.crewPositionInvitation.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit + 1,
      ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    });
    return {
      items: rows.slice(0, page.limit),
      nextCursor: rows.length > page.limit ? rows[page.limit - 1].id : null,
    };
  }

  async create(
    positionId: string,
    actor: string,
    raw: z.infer<typeof CreateInput>,
  ) {
    const input = CreateInput.parse(raw);
    const position = await this.db.crewPosition.findFirst({
      where: { id: positionId, deletedAt: null },
    });
    if (!position?.taskId)
      throw new NotFoundException('Task recruitment position not found.');
    await this.auth.require(position.crewId, actor, 'openings.manage');
    if (actor === input.inviteeUserId)
      throw new ForbiddenException('You cannot invite yourself.');
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${position.crewId}`}, 0))`;
      await tx.$queryRaw`SELECT id FROM crew_positions WHERE id=${positionId} FOR UPDATE`;
      await this.auth.require(position.crewId, actor, 'openings.manage', tx);
      const current = await tx.crewPosition.findUniqueOrThrow({
        where: { id: positionId },
        include: { crew: true },
      });
      if (
        current.deletedAt ||
        current.status !== 'open' ||
        current.moderationStatus !== 'ok' ||
        current.crew.deletedAt ||
        current.crew.moderationStatus !== 'ok' ||
        current.recruitedCount >= current.targetCount ||
        (current.closeDate &&
          current.closeDate < new Date(new Date().toISOString().slice(0, 10)))
      )
        throw new ConflictException(
          'Position is no longer accepting invitations.',
        );
      await assertRecruitableTask(tx, position.crewId, position.taskId!);
      const existing = await tx.crewPositionInvitation.findFirst({
        where: {
          positionId,
          inviteeUserId: input.inviteeUserId,
          status: 'pending',
          expiresAt: { gt: new Date() },
        },
      });
      if (existing) return existing;
      return tx.crewPositionInvitation.create({
        data: {
          id: randomUUID(),
          positionId,
          inviteeUserId: input.inviteeUserId,
          invitedByUserId: actor,
          expiresAt: new Date(Date.now() + input.expiresInDays * 86400000),
        },
      });
    });
  }

  async get(id: string, userId: string) {
    const invitation = await this.db.crewPositionInvitation.findUnique({
      where: { id },
      include: {
        position: {
          include: {
            crew: { select: { deletedAt: true, moderationStatus: true } },
          },
        },
      },
    });
    if (
      !invitation ||
      invitation.position.deletedAt ||
      invitation.position.crew.deletedAt ||
      invitation.position.moderationStatus !== 'ok' ||
      invitation.position.crew.moderationStatus !== 'ok'
    )
      throw new NotFoundException('Invitation not found.');
    if (invitation.inviteeUserId !== userId)
      await this.auth.require(
        invitation.position.crewId,
        userId,
        'openings.manage',
      );
    const { position, ...record } = invitation;
    return {
      ...record,
      expired: invitation.expiresAt <= new Date(),
      position: {
        id: position.id,
        crewId: position.crewId,
        taskId: position.taskId,
        positionType: position.positionType,
        description: position.description,
        experienceLevel: position.experienceLevel,
        requiredSkills: position.requiredSkills,
      },
    };
  }

  async accept(id: string, userId: string, input: ApplyInput, cookie?: string) {
    const invitation = await this.get(id, userId);
    if (invitation.inviteeUserId !== userId)
      throw new ForbiddenException('Only the invited creator can accept.');
    return this.applications.apply(
      invitation.position.crewId,
      invitation.positionId,
      userId,
      input,
      cookie,
      id,
    );
  }

  async close(id: string, actor: string, status: 'declined' | 'revoked') {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM crew_position_invitations WHERE id=${id}::uuid FOR UPDATE`;
      const row = await tx.crewPositionInvitation.findUnique({
        where: { id },
        include: { position: { select: { crewId: true } } },
      });
      if (!row) throw new NotFoundException('Invitation not found.');
      if (status === 'declined') {
        if (row.inviteeUserId !== actor)
          throw new ForbiddenException('Only the invited creator can decline.');
      } else
        await this.auth.require(
          row.position.crewId,
          actor,
          'openings.manage',
          tx,
        );
      if (row.status === status) return { id, status };
      if (row.status !== 'pending')
        throw new ConflictException('Invitation is no longer pending.');
      await tx.crewPositionInvitation.update({
        where: { id },
        data: { status, respondedAt: new Date() },
      });
      await tx.crewAuthorizationEvent.create({
        data: {
          crewId: row.position.crewId,
          actorUserId: actor,
          action: `position.invitation.${status}`,
          after: { invitationId: id, status },
        },
      });
      return { id, status };
    });
  }
}

@Controller()
export class CrewPositionInvitationsController {
  constructor(private readonly svc: CrewPositionInvitationsService) {}
  @Get('crew-position-invitations')
  mine(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(PageInput)) query: z.infer<typeof PageInput>,
  ) {
    return this.svc.list(user.userId, query);
  }
  @Get('crew-positions/:positionId/invitations')
  list(
    @Param('positionId') id: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(PageInput)) query: z.infer<typeof PageInput>,
  ) {
    return this.svc.list(user.userId, query, parseIdParam(id, 'positionId'));
  }

  @Post('crew-positions/:positionId/invitations')
  create(
    @Param('positionId') id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateInput))
    input: z.infer<typeof CreateInput>,
  ) {
    return this.svc.create(parseIdParam(id, 'positionId'), user.userId, input);
  }
  @Get('crew-position-invitations/:id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.get(invitationId(id), user.userId);
  }
  @Post('crew-position-invitations/:id/accept')
  accept(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @ViewerCookie() cookie: string,
    @Body(new ZodValidationPipe(ApplySchema)) input: ApplyInput,
  ) {
    return this.svc.accept(invitationId(id), user.userId, input, cookie);
  }
  @Post('crew-position-invitations/:id/decline')
  decline(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.close(invitationId(id), user.userId, 'declined');
  }
  @Post('crew-position-invitations/:id/revoke')
  revoke(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.close(invitationId(id), user.userId, 'revoked');
  }
}
