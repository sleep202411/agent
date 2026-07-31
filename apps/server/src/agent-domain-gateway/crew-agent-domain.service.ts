import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Crew } from '@prisma/client';
import { CURRENCY_SYMBOLS, ZERO_DECIMAL_CURRENCIES } from '@repo/shared/crew';

import { assertAllowedCurrency, toSmallestUnit } from '../common/currency';
import { NotificationService } from '../notification';
import { newCrewDomainId } from '../crews/id';
import {
  toActivityDTO,
  toApplicationDTO,
  toAssignmentDTO,
  toCrewDTO,
  toEpisodeDTO,
  toMemberDTO,
  toPositionDTO,
} from '../crews/mappers';
import { writeActivity } from '../crews/episodes/activity-writer';
import type {
  AgentDomainToolRequest,
  AgentDomainToolResult,
} from './agent-domain.dto';
import {
  CrewFinanceArgumentsSchema,
  CrewManagementArgumentsSchema,
  CrewReadArgumentsSchema,
  CrewSelfServiceArgumentsSchema,
  type CrewManagementArguments,
} from './agent-domain-tool.schemas';

type CrewRequest = AgentDomainToolRequest & {
  scope: Extract<
    AgentDomainToolRequest['scope'],
    { surface: 'crew-management' }
  >;
};
type CrewRole = 'admin' | 'finance' | 'member';
type ExecutionIdentity = { idempotencyKey: string; requestHash: string };

@Injectable()
export class CrewAgentDomainService {
  constructor(private readonly notifications: NotificationService) {}

  async readState(
    tx: Prisma.TransactionClient,
    rawRequest: AgentDomainToolRequest,
    rawArguments: unknown,
  ): Promise<AgentDomainToolResult> {
    const request = requireCrewRequest(rawRequest);
    const args = CrewReadArgumentsSchema.parse(rawArguments);
    const { crew, role } = await authorizeCrew(
      tx,
      request.scope.crewId,
      request.actor.id,
      false,
    );

    let section: unknown;
    switch (args.section) {
      case 'overview':
        section = await readOverview(tx, crew, role);
        break;
      case 'positions':
        section = await readPage(
          tx.crewPosition,
          {
            crewId: crew.id,
            deletedAt: null,
            ...(args.cursor ? { id: { gt: args.cursor } } : {}),
          },
          args.limit,
          toPositionDTO,
        );
        break;
      case 'applications':
        requireRole(role, ['admin']);
        section = await readPage(
          tx.crewApplication,
          {
            crewId: crew.id,
            ...(args.cursor ? { id: { gt: args.cursor } } : {}),
          },
          args.limit,
          toApplicationDTO,
        );
        break;
      case 'members':
        section = await readPage(
          tx.crewMember,
          {
            crewId: crew.id,
            removedAt: null,
            ...(args.cursor ? { id: { gt: args.cursor } } : {}),
          },
          args.limit,
          toMemberDTO,
        );
        break;
      case 'episodes':
        section = await readPage(
          tx.episode,
          {
            crewId: crew.id,
            ...(args.cursor ? { id: { gt: args.cursor } } : {}),
          },
          args.limit,
          toEpisodeDTO,
        );
        break;
      case 'assignments':
        await requireEpisodeInCrew(tx, args.episodeId!, crew.id);
        section = await readPage(
          tx.episodeAssignment,
          {
            crewId: crew.id,
            episodeId: args.episodeId,
            ...(args.cursor ? { id: { gt: args.cursor } } : {}),
          },
          args.limit,
          toAssignmentDTO,
        );
        break;
      case 'activity':
        await requireEpisodeInCrew(tx, args.episodeId!, crew.id);
        section = await readPage(
          tx.episodeActivity,
          {
            crewId: crew.id,
            episodeId: args.episodeId,
            ...(args.cursor ? { id: { gt: args.cursor } } : {}),
          },
          args.limit,
          toActivityDTO,
        );
        break;
    }

    return {
      status: 'succeeded',
      revision: crew.version,
      data: {
        schemaVersion: 'crew-state/v2',
        crewId: crew.id,
        revision: crew.version,
        actorRole: role,
        section: args.section,
        value: section,
      },
    };
  }

  async applyManagementCommand(
    tx: Prisma.TransactionClient,
    rawRequest: AgentDomainToolRequest,
    rawArguments: unknown,
    execution: ExecutionIdentity,
  ): Promise<AgentDomainToolResult> {
    const request = requireCrewRequest(rawRequest);
    const args = CrewManagementArgumentsSchema.parse(rawArguments);
    const { crew, role } = await authorizeCrew(
      tx,
      request.scope.crewId,
      request.actor.id,
      true,
    );
    requireRole(role, ['admin']);
    assertCrewRevision(crew, args.baseRevision);

    const result = await this.executeManagement(
      tx,
      crew,
      request,
      args,
      execution,
    );
    return crewMutationResult(tx, crew.id, result);
  }

  async applyFinanceCommand(
    tx: Prisma.TransactionClient,
    rawRequest: AgentDomainToolRequest,
    rawArguments: unknown,
    _execution: ExecutionIdentity,
  ): Promise<AgentDomainToolResult> {
    const request = requireCrewRequest(rawRequest);
    const args = CrewFinanceArgumentsSchema.parse(rawArguments);
    const { crew, role } = await authorizeCrew(
      tx,
      request.scope.crewId,
      request.actor.id,
      true,
    );
    requireRole(role, ['admin', 'finance']);
    assertCrewRevision(crew, args.baseRevision);
    const assignment = await requireAssignmentInCrew(
      tx,
      args.command.assignmentId,
      crew.id,
    );
    assertEpisodeMutable(assignment.episode.status);
    assertAllowedCurrency(args.command.currency, 'currency');

    const now = new Date();
    const updated = await tx.episodeAssignment.update({
      where: { id: assignment.id },
      data: {
        revenueAmount: BigInt(args.command.amount),
        revenueCurrency: args.command.currency,
        revenueSetAt: now,
        revenueSetById: request.actor.id,
      },
    });
    await writeActivity(tx, {
      crewId: crew.id,
      episodeId: assignment.episodeId,
      type: 'revenue_set',
      actorUserId: request.actor.id,
      actorName: request.actor.displayName,
      payload: {
        targetUserId: assignment.userId,
        amount: args.command.amount,
        currency: args.command.currency,
        reason: args.reason,
      },
    });
    const currency = args.command.currency;
    const displayAmount = ZERO_DECIMAL_CURRENCIES.has(currency)
      ? String(args.command.amount)
      : (args.command.amount / 100).toFixed(2);
    await this.notifications.send(
      {
        userId: assignment.userId,
        type: 'crew.episode.revenue_set',
        title: `Revenue set for episode ${assignment.episode.number}`,
        body: `Your share: ${CURRENCY_SYMBOLS[currency]}${displayAmount}`,
        meta: {
          deeplink: `/crews/${crew.id}/workspace`,
          crewId: crew.id,
          episodeId: assignment.episodeId,
          assignmentId: assignment.id,
          amount: args.command.amount,
          currency,
        },
        idempotencyKey: `agent-domain.revenue-set:${_execution.idempotencyKey}`,
      },
      tx,
    );
    return crewMutationResult(tx, crew.id, toAssignmentDTO(updated));
  }

  async submitOwnAssignment(
    tx: Prisma.TransactionClient,
    rawRequest: AgentDomainToolRequest,
    rawArguments: unknown,
    execution: ExecutionIdentity,
  ): Promise<AgentDomainToolResult> {
    const request = requireCrewRequest(rawRequest);
    const args = CrewSelfServiceArgumentsSchema.parse(rawArguments);
    const { crew } = await authorizeCrew(
      tx,
      request.scope.crewId,
      request.actor.id,
      true,
    );
    assertCrewRevision(crew, args.baseRevision);
    const assignment = await requireAssignmentInCrew(
      tx,
      args.command.assignmentId,
      crew.id,
    );
    if (assignment.userId !== request.actor.id) {
      throw new ForbiddenException('Only the assignee can submit this work.');
    }
    assertEpisodeMutable(assignment.episode.status);
    if (
      assignment.status !== 'in_progress' &&
      assignment.status !== 'rejected'
    ) {
      throw new BadRequestException({
        code: 'ASSIGNMENT_TRANSITION_INVALID',
        message: 'The assignment is not submittable in its current state.',
        currentStatus: assignment.status,
        expectedStatuses: ['in_progress', 'rejected'],
      });
    }
    const now = new Date();
    const updated = await tx.episodeAssignment.update({
      where: { id: assignment.id },
      data: {
        status: 'submitted',
        submissionUrl: args.command.url ?? null,
        submissionNote: args.command.note ?? null,
        submittedAt: now,
        rejectReason: null,
        rejectSuggestion: null,
        rejectedAt: null,
      },
    });
    await writeActivity(tx, {
      crewId: crew.id,
      episodeId: assignment.episodeId,
      type: 'submission_made',
      actorUserId: request.actor.id,
      actorName: request.actor.displayName,
      payload: {
        targetUserId: assignment.userId,
        roleName: assignment.roleName ?? null,
        reason: args.reason,
        commandId: execution.requestHash,
      },
    });
    return crewMutationResult(tx, crew.id, toAssignmentDTO(updated));
  }

  private async executeManagement(
    tx: Prisma.TransactionClient,
    crew: Crew,
    request: CrewRequest,
    args: CrewManagementArguments,
    execution: ExecutionIdentity,
  ): Promise<unknown> {
    const command = args.command;
    switch (command.type) {
      case 'crew.profile.update':
        return toCrewDTO(
          await tx.crew.update({
            where: { id: crew.id },
            data: { ...command.patch, version: { increment: 1 } },
          }),
        );
      case 'crew.listing.update':
        return toCrewDTO(
          await tx.crew.update({
            where: { id: crew.id },
            data: {
              listingStatus: command.listingStatus,
              listedAt: command.listingStatus === 'listed' ? new Date() : null,
              version: { increment: 1 },
            },
          }),
        );
      case 'crew.owner.transfer':
        return this.transferOwner(tx, crew, request, command, execution);
      case 'crew.application.approve':
        return this.reviewApplication(
          tx,
          crew,
          request,
          command.applicationId,
          'approved',
        );
      case 'crew.application.reject':
        return this.reviewApplication(
          tx,
          crew,
          request,
          command.applicationId,
          'rejected',
        );
      case 'crew.member.remove':
        return this.removeMember(tx, crew, command.memberId, execution);
      case 'crew.member.finance.set':
        return this.setMemberFinance(
          tx,
          crew,
          command.memberId,
          command.isFinance,
        );
      case 'crew.position.create':
        return this.createPosition(tx, crew.id, command.position);
      case 'crew.position.update':
        return this.updatePosition(
          tx,
          crew.id,
          command.positionId,
          command.patch,
        );
      case 'crew.position.remove':
        return this.removePosition(tx, crew.id, command.positionId);
      case 'crew.episode.create':
        return this.createEpisode(tx, crew.id, request, command, args.reason);
      case 'crew.episode.approve':
        return this.approveEpisode(
          tx,
          crew,
          request,
          command.episodeId,
          args.reason,
        );
      case 'crew.assignment.add':
        return this.addAssignment(tx, crew, request, command, args.reason);
      case 'crew.assignment.remove':
        return this.removeAssignment(
          tx,
          crew,
          request,
          command.assignmentId,
          args.reason,
          execution,
        );
      case 'crew.assignment.approve':
        return this.reviewAssignment(
          tx,
          crew,
          request,
          command.assignmentId,
          'approved',
          undefined,
          args.reason,
          execution,
        );
      case 'crew.assignment.reject':
        return this.reviewAssignment(
          tx,
          crew,
          request,
          command.assignmentId,
          'rejected',
          {
            reason: command.reason,
            suggestion: command.suggestion ?? null,
          },
          args.reason,
          execution,
        );
    }
  }

  private async transferOwner(
    tx: Prisma.TransactionClient,
    crew: Crew,
    request: CrewRequest,
    command: { toUserId: string; removeOldOwner: boolean },
    execution: ExecutionIdentity,
  ): Promise<unknown> {
    if (command.toUserId === crew.founderId) {
      throw new BadRequestException('Target user is already the Crew owner.');
    }
    const incoming = await tx.crewMember.findFirst({
      where: { crewId: crew.id, userId: command.toUserId, removedAt: null },
    });
    if (!incoming) {
      throw new BadRequestException({
        code: 'CREW_OWNER_TARGET_NOT_MEMBER',
        message: 'Ownership can only be transferred to an active Crew member.',
      });
    }
    const outgoing = await tx.crewMember.findFirst({
      where: { crewId: crew.id, userId: crew.founderId, removedAt: null },
    });
    await tx.crew.update({
      where: { id: crew.id },
      data: { founderId: command.toUserId, version: { increment: 1 } },
    });
    if (outgoing) {
      await tx.crewMember.update({
        where: { id: outgoing.id },
        data: command.removeOldOwner
          ? { removedAt: new Date() }
          : { roleType: 'member' },
      });
    }
    await tx.crewMember.update({
      where: { id: incoming.id },
      data: { roleType: 'owner' },
    });
    await this.notifications.send(
      {
        userId: command.toUserId,
        type: 'crew.owner.transferred',
        title: `You now own "${crew.name}"`,
        body: `${request.actor.displayName} transferred Crew ownership to you.`,
        meta: { deeplink: `/crews/${crew.id}/workspace`, crewId: crew.id },
        idempotencyKey: `agent-domain.owner-transfer:${execution.idempotencyKey}`,
      },
      tx,
    );
    return { previousOwnerId: crew.founderId, ownerId: command.toUserId };
  }

  private async reviewApplication(
    tx: Prisma.TransactionClient,
    crew: Crew,
    request: CrewRequest,
    applicationId: string,
    next: 'approved' | 'rejected',
  ): Promise<unknown> {
    const application = await tx.crewApplication.findFirst({
      where: { id: applicationId, crewId: crew.id },
      include: { position: true },
    });
    if (!application) throw new NotFoundException('Application not found.');
    if (application.status !== 'pending') {
      throw new BadRequestException({
        code: 'CREW_APPLICATION_ALREADY_REVIEWED',
        message: 'The Crew application is not pending.',
        currentStatus: application.status,
      });
    }
    const transitioned = await tx.crewApplication.updateMany({
      where: { id: application.id, status: 'pending' },
      data: {
        status: next,
        reviewedAt: new Date(),
        reviewerId: request.actor.id,
      },
    });
    if (transitioned.count !== 1) {
      throw new ConflictException('The application was already reviewed.');
    }
    if (next === 'approved') {
      const activeMember = await tx.crewMember.findFirst({
        where: {
          crewId: crew.id,
          userId: application.applicantId,
          removedAt: null,
        },
      });
      if (activeMember) {
        throw new ConflictException('The applicant is already a Crew member.');
      }
      const bumped = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "crew_positions"
        SET
          "recruited_count" = "recruited_count" + 1,
          "status" = CASE
            WHEN "recruited_count" + 1 >= "target_count" THEN 'full'
            ELSE "status"
          END
        WHERE
          "id" = ${application.positionId}
          AND "crew_id" = ${crew.id}
          AND "deleted_at" IS NULL
          AND "status" <> 'frozen'
          AND "recruited_count" < "target_count"
        RETURNING "id"
      `;
      if (bumped.length !== 1) {
        throw new ConflictException(
          'The position is no longer accepting approvals.',
        );
      }
      await tx.crewMember.create({
        data: {
          id: newCrewDomainId(),
          crewId: crew.id,
          userId: application.applicantId,
          roleType: application.position.positionType,
          positionId: application.positionId,
          via: 'application',
        },
      });
    }
    await this.notifications.send(
      {
        userId: application.applicantId,
        type:
          next === 'approved'
            ? 'crew.application.approved'
            : 'crew.application.rejected',
        title:
          next === 'approved' ? 'Application approved' : 'Application rejected',
        body:
          next === 'approved'
            ? `You're now a ${application.position.positionType} in "${crew.name}".`
            : `Your application to "${crew.name}" was not accepted.`,
        meta: {
          deeplink:
            next === 'approved'
              ? `/crews/${crew.id}/workspace`
              : `/crews/${crew.id}`,
          crewId: crew.id,
          positionId: application.positionId,
          applicationId,
        },
        idempotencyKey: `crew.application.${next}:${applicationId}`,
      },
      tx,
    );
    const updated = await tx.crewApplication.findUniqueOrThrow({
      where: { id: application.id },
    });
    return toApplicationDTO(updated);
  }

  private async removeMember(
    tx: Prisma.TransactionClient,
    crew: Crew,
    memberId: string,
    execution: ExecutionIdentity,
  ): Promise<unknown> {
    const member = await tx.crewMember.findFirst({
      where: { id: memberId, crewId: crew.id, removedAt: null },
    });
    if (!member) throw new NotFoundException('Crew member not found.');
    if (member.userId === crew.founderId) {
      throw new BadRequestException('The Crew owner cannot be removed.');
    }
    const updated = await tx.crewMember.update({
      where: { id: member.id },
      data: { removedAt: new Date() },
    });
    if (member.via === 'application' && member.positionId) {
      const position = await tx.crewPosition.findUnique({
        where: { id: member.positionId },
      });
      if (position) {
        const recruitedCount = Math.max(0, position.recruitedCount - 1);
        await tx.crewPosition.update({
          where: { id: position.id },
          data: {
            recruitedCount,
            ...(position.status === 'full' &&
            recruitedCount < position.targetCount
              ? { status: 'open' as const }
              : {}),
          },
        });
      }
    }
    await this.notifications.send(
      {
        userId: member.userId,
        type: 'crew.member.removed',
        title: `Removed from "${crew.name}"`,
        body: 'You are no longer a member of this Crew.',
        meta: { deeplink: '/crews', crewId: crew.id },
        idempotencyKey: `agent-domain.member-remove:${execution.idempotencyKey}`,
      },
      tx,
    );
    return toMemberDTO(updated);
  }

  private async setMemberFinance(
    tx: Prisma.TransactionClient,
    crew: Crew,
    memberId: string,
    isFinance: boolean,
  ): Promise<unknown> {
    const member = await tx.crewMember.findFirst({
      where: { id: memberId, crewId: crew.id, removedAt: null },
    });
    if (!member) throw new NotFoundException('Crew member not found.');
    if (member.userId === crew.founderId) {
      throw new BadRequestException(
        'The Crew owner already has finance authority.',
      );
    }
    return toMemberDTO(
      await tx.crewMember.update({
        where: { id: member.id },
        data: { isFinance },
      }),
    );
  }

  private async createPosition(
    tx: Prisma.TransactionClient,
    crewId: string,
    input: Extract<
      CrewManagementArguments['command'],
      { type: 'crew.position.create' }
    >['position'],
  ): Promise<unknown> {
    assertAllowedCurrency(input.salary?.currency, 'salary.currency');
    const currency = input.salary?.currency ?? null;
    const row = await tx.crewPosition.create({
      data: {
        id: newCrewDomainId(),
        crewId,
        positionType: input.positionType,
        description: input.description,
        targetCount: input.targetCount,
        workMode: input.workMode,
        location: input.workMode === 'remote' ? null : (input.location ?? null),
        employmentType: input.employmentType,
        experienceLevel: input.experienceLevel,
        requiredSkills: input.requiredSkills,
        salaryPeriod: input.salary?.period ?? null,
        salaryCurrency: currency,
        salaryMinAmount:
          input.salary?.min != null && currency
            ? toSmallestUnit(input.salary.min, currency)
            : null,
        salaryMaxAmount:
          input.salary?.max != null && currency
            ? toSmallestUnit(input.salary.max, currency)
            : null,
        salaryNegotiable: input.salary?.negotiable ?? false,
        durationMonths: input.durationMonths ?? null,
        revenueShareBp:
          input.revenueSharePercent == null
            ? null
            : Math.round(input.revenueSharePercent * 100),
        closeDate: input.closeDate
          ? new Date(`${input.closeDate}T00:00:00Z`)
          : null,
      },
    });
    return toPositionDTO(row);
  }

  private async updatePosition(
    tx: Prisma.TransactionClient,
    crewId: string,
    positionId: string,
    input: Extract<
      CrewManagementArguments['command'],
      { type: 'crew.position.update' }
    >['patch'],
  ): Promise<unknown> {
    const position = await tx.crewPosition.findFirst({
      where: { id: positionId, crewId, deletedAt: null },
    });
    if (!position) throw new NotFoundException('Crew position not found.');
    assertAllowedCurrency(input.salary?.currency, 'salary.currency');
    if (
      input.targetCount !== undefined &&
      input.targetCount < position.recruitedCount
    ) {
      throw new BadRequestException({
        code: 'CREW_POSITION_HEADCOUNT_INVALID',
        message: 'targetCount cannot be below recruitedCount.',
        recruitedCount: position.recruitedCount,
      });
    }
    let status = input.status ?? position.status;
    if (input.targetCount !== undefined) {
      status =
        position.recruitedCount >= input.targetCount
          ? 'full'
          : position.status === 'full'
            ? 'open'
            : status;
    }
    const currency = input.salary?.currency;
    const updated = await tx.crewPosition.update({
      where: { id: position.id },
      data: {
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
        ...(input.targetCount === undefined
          ? {}
          : { targetCount: input.targetCount }),
        ...(input.workMode === undefined ? {} : { workMode: input.workMode }),
        ...(input.location === undefined ? {} : { location: input.location }),
        ...(input.employmentType === undefined
          ? {}
          : { employmentType: input.employmentType }),
        ...(input.experienceLevel === undefined
          ? {}
          : { experienceLevel: input.experienceLevel }),
        ...(input.requiredSkills === undefined
          ? {}
          : { requiredSkills: input.requiredSkills }),
        ...(input.salary?.period === undefined
          ? {}
          : { salaryPeriod: input.salary.period }),
        ...(currency === undefined ? {} : { salaryCurrency: currency }),
        ...(input.salary?.min === undefined || !currency
          ? {}
          : {
              salaryMinAmount:
                input.salary.min == null
                  ? null
                  : toSmallestUnit(input.salary.min, currency),
            }),
        ...(input.salary?.max === undefined || !currency
          ? {}
          : {
              salaryMaxAmount:
                input.salary.max == null
                  ? null
                  : toSmallestUnit(input.salary.max, currency),
            }),
        ...(input.salary?.negotiable === undefined
          ? {}
          : { salaryNegotiable: input.salary.negotiable }),
        ...(input.durationMonths === undefined
          ? {}
          : { durationMonths: input.durationMonths }),
        ...(input.revenueSharePercent === undefined
          ? {}
          : {
              revenueShareBp:
                input.revenueSharePercent == null
                  ? null
                  : Math.round(input.revenueSharePercent * 100),
            }),
        ...(input.closeDate === undefined
          ? {}
          : {
              closeDate: input.closeDate
                ? new Date(`${input.closeDate}T00:00:00Z`)
                : null,
            }),
        status,
      },
    });
    return toPositionDTO(updated);
  }

  private async removePosition(
    tx: Prisma.TransactionClient,
    crewId: string,
    positionId: string,
  ): Promise<unknown> {
    const position = await tx.crewPosition.findFirst({
      where: { id: positionId, crewId, deletedAt: null },
    });
    if (!position) throw new NotFoundException('Crew position not found.');
    const pending = await tx.crewApplication.count({
      where: { positionId, status: 'pending' },
    });
    if (pending > 0) {
      throw new ConflictException({
        code: 'CREW_POSITION_HAS_PENDING_APPLICATIONS',
        message: 'Review pending applications before removing this position.',
        pendingCount: pending,
      });
    }
    await tx.crewPosition.update({
      where: { id: position.id },
      data: { deletedAt: new Date() },
    });
    return { removedId: position.id };
  }

  private async createEpisode(
    tx: Prisma.TransactionClient,
    crewId: string,
    request: CrewRequest,
    command: Extract<
      CrewManagementArguments['command'],
      { type: 'crew.episode.create' }
    >,
    reason: string,
  ): Promise<unknown> {
    const last = await tx.episode.findFirst({
      where: { crewId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const episode = await tx.episode.create({
      data: {
        id: newCrewDomainId(),
        crewId,
        number: (last?.number ?? 0) + 1,
        title: command.title ?? null,
        description: command.description ?? null,
        deadline: command.deadline
          ? new Date(`${command.deadline}T00:00:00Z`)
          : null,
      },
    });
    await writeActivity(tx, {
      crewId,
      episodeId: episode.id,
      type: 'episode_created',
      actorUserId: request.actor.id,
      actorName: request.actor.displayName,
      payload: { number: episode.number, reason },
    });
    return toEpisodeDTO(episode);
  }

  private async approveEpisode(
    tx: Prisma.TransactionClient,
    crew: Crew,
    request: CrewRequest,
    episodeId: string,
    reason: string,
  ): Promise<unknown> {
    const episode = await tx.episode.findFirst({
      where: { id: episodeId, crewId: crew.id },
      include: { assignments: { select: { userId: true } } },
    });
    if (!episode) throw new NotFoundException('Episode not found.');
    if (episode.status !== 'in_production') {
      throw new BadRequestException({
        code: 'EPISODE_TRANSITION_INVALID',
        message: 'Only an in-production episode can be approved.',
        currentStatus: episode.status,
      });
    }
    const updated = await tx.episode.update({
      where: { id: episode.id },
      data: { status: 'approved', approvedAt: new Date() },
    });
    await writeActivity(tx, {
      crewId: crew.id,
      episodeId: episode.id,
      type: 'episode_approved',
      actorUserId: request.actor.id,
      actorName: request.actor.displayName,
      payload: { reason },
    });
    for (const userId of new Set(
      episode.assignments.map((item) => item.userId),
    )) {
      await this.notifications.send(
        {
          userId,
          type: 'crew.episode.approved',
          title: `Episode ${episode.number} approved`,
          body: `"${crew.name}" episode ${episode.number} is final.`,
          meta: {
            deeplink: `/crews/${crew.id}/workspace`,
            crewId: crew.id,
            episodeId: episode.id,
          },
          idempotencyKey: `crew.episode.approved:${episode.id}:${userId}`,
        },
        tx,
      );
    }
    return toEpisodeDTO(updated);
  }

  private async addAssignment(
    tx: Prisma.TransactionClient,
    crew: Crew,
    request: CrewRequest,
    command: Extract<
      CrewManagementArguments['command'],
      { type: 'crew.assignment.add' }
    >,
    reason: string,
  ): Promise<unknown> {
    const episode = await requireEpisodeInCrew(tx, command.episodeId, crew.id);
    assertEpisodeMutable(episode.status);
    const member = await tx.crewMember.findFirst({
      where: { crewId: crew.id, userId: command.userId, removedAt: null },
    });
    if (!member) {
      throw new BadRequestException(
        'The assignee is not an active Crew member.',
      );
    }
    if (command.positionId) {
      const position = await tx.crewPosition.findFirst({
        where: {
          id: command.positionId,
          crewId: crew.id,
          deletedAt: null,
        },
      });
      if (!position) throw new BadRequestException('Crew position not found.');
    }
    const duplicate = await tx.episodeAssignment.findUnique({
      where: {
        uniq_episode_user: {
          episodeId: episode.id,
          userId: command.userId,
        },
      },
    });
    if (duplicate) {
      throw new ConflictException({
        code: 'ASSIGNMENT_ALREADY_EXISTS',
        message: 'The user is already assigned to this episode.',
        assignmentId: duplicate.id,
      });
    }
    const assignment = await tx.episodeAssignment.create({
      data: {
        id: newCrewDomainId(),
        crewId: crew.id,
        episodeId: episode.id,
        userId: command.userId,
        positionId: command.positionId ?? null,
        roleName: command.roleName ?? null,
      },
    });
    if (episode.status === 'not_started') {
      await tx.episode.update({
        where: { id: episode.id },
        data: { status: 'in_production' },
      });
    }
    await writeActivity(tx, {
      crewId: crew.id,
      episodeId: episode.id,
      type: 'member_assigned',
      actorUserId: request.actor.id,
      actorName: request.actor.displayName,
      payload: {
        targetUserId: command.userId,
        roleName: command.roleName ?? null,
        reason,
      },
    });
    await this.notifications.send(
      {
        userId: command.userId,
        type: 'crew.episode.assigned',
        title: `Assigned to episode ${episode.number}`,
        body: command.roleName
          ? `You're now the ${command.roleName} for this episode.`
          : 'You have a new episode assignment.',
        meta: {
          deeplink: `/crews/${crew.id}/workspace`,
          crewId: crew.id,
          episodeId: episode.id,
          assignmentId: assignment.id,
        },
        idempotencyKey: `crew.episode.assigned:${assignment.id}`,
      },
      tx,
    );
    return toAssignmentDTO(assignment);
  }

  private async removeAssignment(
    tx: Prisma.TransactionClient,
    crew: Crew,
    request: CrewRequest,
    assignmentId: string,
    reason: string,
    execution: ExecutionIdentity,
  ): Promise<unknown> {
    const assignment = await requireAssignmentInCrew(tx, assignmentId, crew.id);
    assertEpisodeMutable(assignment.episode.status);
    if (
      assignment.status !== 'in_progress' &&
      assignment.status !== 'rejected'
    ) {
      throw new BadRequestException({
        code: 'ASSIGNMENT_TRANSITION_INVALID',
        message: 'The assignment is not removable in its current state.',
        currentStatus: assignment.status,
      });
    }
    await tx.episodeAssignment.delete({ where: { id: assignment.id } });
    await writeActivity(tx, {
      crewId: crew.id,
      episodeId: assignment.episodeId,
      type: 'member_unassigned',
      actorUserId: request.actor.id,
      actorName: request.actor.displayName,
      payload: {
        targetUserId: assignment.userId,
        roleName: assignment.roleName ?? null,
        reason,
      },
    });
    await this.notifications.send(
      {
        userId: assignment.userId,
        type: 'crew.episode.unassigned',
        title: `Removed from episode ${assignment.episode.number}`,
        body: 'You no longer have this episode assignment.',
        meta: {
          deeplink: `/crews/${crew.id}/workspace`,
          crewId: crew.id,
          episodeId: assignment.episodeId,
        },
        idempotencyKey: `agent-domain.assignment-remove:${execution.idempotencyKey}`,
      },
      tx,
    );
    return { removedId: assignment.id };
  }

  private async reviewAssignment(
    tx: Prisma.TransactionClient,
    crew: Crew,
    request: CrewRequest,
    assignmentId: string,
    next: 'approved' | 'rejected',
    rejection: { reason: string; suggestion: string | null } | undefined,
    commandReason: string,
    execution: ExecutionIdentity,
  ): Promise<unknown> {
    const assignment = await requireAssignmentInCrew(tx, assignmentId, crew.id);
    assertEpisodeMutable(assignment.episode.status);
    if (assignment.status !== 'submitted') {
      throw new BadRequestException({
        code: 'ASSIGNMENT_TRANSITION_INVALID',
        message: 'Only a submitted assignment can be reviewed.',
        currentStatus: assignment.status,
      });
    }
    const updated = await tx.episodeAssignment.update({
      where: { id: assignment.id },
      data:
        next === 'approved'
          ? {
              status: 'approved',
              rejectReason: null,
              rejectSuggestion: null,
              rejectedAt: null,
            }
          : {
              status: 'rejected',
              rejectReason: rejection?.reason ?? '',
              rejectSuggestion: rejection?.suggestion ?? null,
              rejectedAt: new Date(),
            },
    });
    await writeActivity(tx, {
      crewId: crew.id,
      episodeId: assignment.episodeId,
      type: next === 'approved' ? 'submission_approved' : 'submission_rejected',
      actorUserId: request.actor.id,
      actorName: request.actor.displayName,
      payload: {
        targetUserId: assignment.userId,
        roleName: assignment.roleName ?? null,
        commandReason,
        ...(rejection ? { reason: rejection.reason } : {}),
      },
    });
    await this.notifications.send(
      {
        userId: assignment.userId,
        type:
          next === 'approved'
            ? 'crew.episode.submission_approved'
            : 'crew.episode.submission_rejected',
        title:
          next === 'approved' ? 'Submission approved' : 'Submission rejected',
        body:
          next === 'approved'
            ? `Your work on episode ${assignment.episode.number} was approved.`
            : `Your submission for episode ${assignment.episode.number} needs revision.`,
        meta: {
          deeplink: `/crews/${crew.id}/workspace`,
          crewId: crew.id,
          episodeId: assignment.episodeId,
          assignmentId: assignment.id,
          ...(rejection ? { reason: rejection.reason } : {}),
        },
        idempotencyKey: `agent-domain.assignment-review:${execution.idempotencyKey}`,
      },
      tx,
    );
    return toAssignmentDTO(updated);
  }
}

function requireCrewRequest(request: AgentDomainToolRequest): CrewRequest {
  if (request.scope.surface !== 'crew-management') {
    throw new ConflictException({
      code: 'AGENT_DOMAIN_SCOPE_MISMATCH',
      message: 'The Crew tool requires a signed Crew Management scope.',
    });
  }
  return request as CrewRequest;
}

async function authorizeCrew(
  tx: Prisma.TransactionClient,
  crewId: string,
  actorId: string,
  lock: boolean,
): Promise<{ crew: Crew; role: CrewRole }> {
  if (lock) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "crews"
      WHERE "id" = ${crewId} AND "deleted_at" IS NULL
      FOR UPDATE
    `;
    if (locked.length !== 1) throw new NotFoundException('Crew not found.');
  }
  const crew = await tx.crew.findFirst({
    where: { id: crewId, deletedAt: null },
  });
  if (!crew) throw new NotFoundException('Crew not found.');
  if (crew.founderId === actorId) return { crew, role: 'admin' };
  const member = await tx.crewMember.findFirst({
    where: { crewId, userId: actorId, removedAt: null },
    select: { isFinance: true },
  });
  if (!member) throw new ForbiddenException('Crew membership is required.');
  return { crew, role: member.isFinance ? 'finance' : 'member' };
}

function requireRole(actual: CrewRole, allowed: readonly CrewRole[]): void {
  if (!allowed.includes(actual)) {
    throw new ForbiddenException({
      code: 'CREW_PERMISSION_DENIED',
      message: 'The actor does not have the required Crew role.',
      actualRole: actual,
      requiredRoles: allowed,
    });
  }
}

function assertCrewRevision(crew: Crew, expected: number): void {
  if (crew.version !== expected) {
    throw new ConflictException({
      code: 'CREW_REVISION_CONFLICT',
      message:
        'The Crew changed after this command was prepared. Read current state and prepare a new command.',
      expectedRevision: expected,
      actualRevision: crew.version,
    });
  }
}

async function readOverview(
  tx: Prisma.TransactionClient,
  crew: Crew,
  role: CrewRole,
): Promise<unknown> {
  const [
    memberCount,
    openPositionCount,
    applicationCount,
    episodeCount,
    assignmentCount,
  ] = await Promise.all([
    tx.crewMember.count({ where: { crewId: crew.id, removedAt: null } }),
    tx.crewPosition.count({
      where: { crewId: crew.id, deletedAt: null, status: 'open' },
    }),
    role === 'admin'
      ? tx.crewApplication.count({
          where: { crewId: crew.id, status: 'pending' },
        })
      : Promise.resolve(null),
    tx.episode.count({ where: { crewId: crew.id } }),
    tx.episodeAssignment.count({ where: { crewId: crew.id } }),
  ]);
  return {
    crew: { ...toCrewDTO(crew), version: crew.version },
    counts: {
      members: memberCount,
      openPositions: openPositionCount,
      pendingApplications: applicationCount,
      episodes: episodeCount,
      assignments: assignmentCount,
    },
  };
}

async function readPage<T extends { id: string }, R>(
  delegate: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy: { id: 'asc' };
      take: number;
    }): Promise<T[]>;
  },
  where: Record<string, unknown>,
  limit: number,
  map: (row: T) => R,
): Promise<{ items: R[]; nextCursor: string | null }> {
  const rows = await delegate.findMany({
    where,
    orderBy: { id: 'asc' },
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  return {
    items: page.map(map),
    nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
  };
}

async function requireEpisodeInCrew(
  tx: Prisma.TransactionClient,
  episodeId: string,
  crewId: string,
) {
  const episode = await tx.episode.findFirst({
    where: { id: episodeId, crewId },
  });
  if (!episode) throw new NotFoundException('Episode not found.');
  return episode;
}

async function requireAssignmentInCrew(
  tx: Prisma.TransactionClient,
  assignmentId: string,
  crewId: string,
) {
  const assignment = await tx.episodeAssignment.findFirst({
    where: { id: assignmentId, crewId },
    include: {
      episode: {
        select: { id: true, number: true, status: true, crewId: true },
      },
    },
  });
  if (!assignment) throw new NotFoundException('Assignment not found.');
  return assignment;
}

function assertEpisodeMutable(status: string): void {
  if (status === 'approved') {
    throw new ConflictException({
      code: 'EPISODE_FROZEN',
      message: 'An approved episode is immutable.',
    });
  }
}

async function crewMutationResult(
  tx: Prisma.TransactionClient,
  crewId: string,
  result: unknown,
): Promise<AgentDomainToolResult> {
  const current = await tx.crew.findUniqueOrThrow({
    where: { id: crewId },
    select: { version: true },
  });
  return {
    status: 'succeeded',
    revision: current.version,
    data: {
      schemaVersion: 'crew-command-result/v2',
      crewId,
      revision: current.version,
      result,
    },
  };
}
