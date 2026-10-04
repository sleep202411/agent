import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CrewAgreementArchiveJobStatus,
  CrewAgreementSendJobStatus,
  CrewAgreementStatus,
  Prisma,
  type CrewAgreement,
} from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../infra/db/db.module';
import { NotificationService } from '../../notification';
import { CrewAuthorizationService } from '../crew-authorization.service';
import type { CreateCrewAgreementInput, ListCrewAgreementsQuery } from '../dto';
import { BoldSignAgreementProvider } from './boldsign-agreement.provider';

const AGREEMENT_ARCHIVE_INCLUDE = {
  sendJob: true,
  archiveJob: true,
  assetNode: { select: { mediaAssetId: true } },
  auditAssetNode: { select: { mediaAssetId: true } },
} satisfies Prisma.CrewAgreementInclude;

@Injectable()
export class CrewAgreementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: CrewAuthorizationService,
    private readonly provider: BoldSignAgreementProvider,
    private readonly notifications: NotificationService,
  ) {}

  /** Personal index: only agreements addressed to or created by this actor. */
  async listMine(userId: string, query: ListCrewAgreementsQuery) {
    const scope: Prisma.CrewAgreementWhereInput = {
      OR: [{ memberUserId: userId }, { createdByUserId: userId }],
      crew: {
        deletedAt: null,
        members: { some: { userId, status: 'active' } },
      },
      ...agreementViewWhere(query.view),
    };
    const cursor = query.cursor
      ? await this.prisma.crewAgreement.findFirst({
          where: { AND: [scope, { id: query.cursor }] },
          select: { id: true, updatedAt: true },
        })
      : null;
    if (query.cursor && !cursor)
      throw new BadRequestException({
        code: 'CREW_AGREEMENT_CURSOR_INVALID',
        message: 'Restart the contracts list.',
      });
    const rows = await this.prisma.crewAgreement.findMany({
      where: {
        AND: [
          scope,
          ...(cursor
            ? [
                {
                  OR: [
                    { updatedAt: { lt: cursor.updatedAt } },
                    { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: {
        id: true,
        title: true,
        crewId: true,
        memberUserId: true,
        status: true,
        updatedAt: true,
        crew: { select: { name: true } },
      },
    });
    const page = rows.slice(0, query.limit);
    const permissions = new Map<string, string[]>();
    for (const row of page) {
      if (permissions.has(row.crewId)) continue;
      const context = await this.authorization.resolve(row.crewId, userId);
      permissions.set(row.crewId, context?.permissions ?? []);
    }
    return {
      items: page
        .filter((row) => {
          const allowed = permissions.get(row.crewId) ?? [];
          return (
            allowed.includes('agreements.manage') ||
            (row.memberUserId === userId &&
              allowed.includes('agreements.view_own'))
          );
        })
        .map((row) => ({
          id: row.id,
          title: row.title,
          crewId: row.crewId,
          status: row.status,
          updatedAt: row.updatedAt,
          crew: row.crew,
        })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async list(crewId: string, userId: string, query: ListCrewAgreementsQuery) {
    const context = await this.authorization.requireMembership(crewId, userId);
    const canManage = context.permissions.includes('agreements.manage');
    if (!canManage && !context.permissions.includes('agreements.view_own')) {
      throw new ForbiddenException({ message: 'You cannot view agreements.' });
    }
    const scopeWhere = {
      crewId,
      ...(canManage ? {} : { memberUserId: userId }),
    } satisfies Prisma.CrewAgreementWhereInput;
    const where = {
      ...scopeWhere,
      ...agreementViewWhere(query.view),
    } satisfies Prisma.CrewAgreementWhereInput;
    const cursor = query.cursor
      ? await this.prisma.crewAgreement.findFirst({
          where: { ...where, id: query.cursor },
          select: { id: true, updatedAt: true },
        })
      : null;
    if (query.cursor && !cursor) {
      throw new BadRequestException({
        code: 'CREW_AGREEMENT_CURSOR_INVALID',
        message:
          'The agreements cursor is invalid for the current view. Restart from the first page.',
      });
    }
    const pageWhere = cursor
      ? {
          ...where,
          OR: [
            { updatedAt: { lt: cursor.updatedAt } },
            { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
          ],
        }
      : where;
    const [rows, grouped] = await Promise.all([
      this.prisma.crewAgreement.findMany({
        where: pageWhere,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        include: AGREEMENT_ARCHIVE_INCLUDE,
      }),
      this.prisma.crewAgreement.groupBy({
        by: ['status'],
        where: scopeWhere,
        _count: { _all: true },
      }),
    ]);
    const items = rows.slice(0, query.limit);
    const summary = agreementSummary(grouped);
    return {
      capabilities: {
        create: canManage && this.provider.isConfigured(),
        sync: this.provider.canSync(),
        provider: 'boldsign' as const,
      },
      items: items.map((agreement) =>
        agreementDto(
          agreement,
          canManage,
          agreement.memberUserId === userId &&
            agreement.status === CrewAgreementStatus.sent,
        ),
      ),
      nextCursor:
        rows.length > query.limit
          ? (items[items.length - 1]?.id ?? null)
          : null,
      total: summary[query.view],
      summary,
    };
  }

  async create(
    crewId: string,
    userId: string,
    input: CreateCrewAgreementInput,
  ) {
    await this.authorization.require(crewId, userId, 'agreements.manage');
    this.requireDispatchConfigured();
    const member = await this.prisma.crewMember.findFirst({
      where: {
        crewId,
        userId: input.memberUserId,
        status: 'active',
      },
      select: { id: true },
    });
    if (!member) {
      throw new NotFoundException({
        message: 'The agreement signer must be an active crew member.',
      });
    }

    const draft = await this.prisma.$transaction((tx) =>
      this.createQueuedAgreement(
        {
          crewId,
          memberUserId: input.memberUserId,
          signerName: input.signerName,
          signerEmail: input.signerEmail,
          title: input.title,
          createdByUserId: userId,
        },
        tx,
      ),
    );
    return agreementDto(draft, true);
  }

  requireDispatchConfigured(): void {
    if (this.provider.isConfigured()) return;
    throw new ServiceUnavailableException({
      message:
        'BoldSign agreement sending is not configured for this deployment.',
    });
  }

  async stageInvitationAgreement(
    invitation: {
      id: string;
      crewId: string;
      inviteeUserId: string;
      invitedByUserId: string;
      agreementTitle: string | null;
      agreementSignerName: string | null;
      agreementSignerEmail: string | null;
    },
    tx: Prisma.TransactionClient,
  ) {
    if (
      !invitation.agreementTitle ||
      !invitation.agreementSignerName ||
      !invitation.agreementSignerEmail
    ) {
      return null;
    }
    const existing = await tx.crewAgreement.findUnique({
      where: { invitationId: invitation.id },
      include: AGREEMENT_ARCHIVE_INCLUDE,
    });
    if (existing) return existing;
    return this.createQueuedAgreement(
      {
        invitationId: invitation.id,
        crewId: invitation.crewId,
        memberUserId: invitation.inviteeUserId,
        signerName: invitation.agreementSignerName,
        signerEmail: invitation.agreementSignerEmail,
        title: invitation.agreementTitle,
        createdByUserId: invitation.invitedByUserId,
      },
      tx,
    );
  }

  async retrySend(agreementId: string, userId: string) {
    const agreement = await this.prisma.crewAgreement.findUnique({
      where: { id: agreementId },
      include: AGREEMENT_ARCHIVE_INCLUDE,
    });
    if (!agreement) throw new NotFoundException('Agreement not found.');
    await this.authorization.require(
      agreement.crewId,
      userId,
      'agreements.manage',
    );
    this.requireDispatchConfigured();
    if (
      agreement.providerDocumentId ||
      agreement.sendJob?.status !== CrewAgreementSendJobStatus.failed
    ) {
      throw new BadRequestException({
        message:
          'Only an agreement whose initial BoldSign dispatch failed can be retried.',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM crew_agreements WHERE id = ${agreement.id}::uuid FOR UPDATE`;
      await tx.$executeRaw`SELECT id FROM crew_agreement_send_jobs WHERE agreement_id = ${agreement.id}::uuid FOR UPDATE`;
      await this.authorization.require(
        agreement.crewId,
        userId,
        'agreements.manage',
        tx,
      );
      const current = await tx.crewAgreement.findUnique({
        where: { id: agreement.id },
        include: AGREEMENT_ARCHIVE_INCLUDE,
      });
      if (
        !current ||
        current.providerDocumentId ||
        current.sendJob?.status !== CrewAgreementSendJobStatus.failed ||
        (current.status !== CrewAgreementStatus.failed &&
          current.status !== CrewAgreementStatus.draft)
      )
        return;

      await tx.crewAgreement.update({
        where: { id: agreement.id },
        data: {
          status: CrewAgreementStatus.draft,
          providerStatus: null,
          lastSyncedAt: null,
        },
      });
      await tx.crewAgreementSendJob.update({
        where: { agreementId: agreement.id },
        data: {
          status: CrewAgreementSendJobStatus.pending,
          attempt: 0,
          nextAttemptAt: null,
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          completedAt: null,
        },
      });
      await this.authorization.require(
        agreement.crewId,
        userId,
        'agreements.manage',
        tx,
      );
    });
    const updated = await this.prisma.crewAgreement.findUniqueOrThrow({
      where: { id: agreement.id },
      include: AGREEMENT_ARCHIVE_INCLUDE,
    });
    return agreementDto(updated, true);
  }

  async createSigningSession(agreementId: string, userId: string) {
    const agreement = await this.prisma.crewAgreement.findUnique({
      where: { id: agreementId },
    });
    if (!agreement) throw new NotFoundException('Agreement not found.');
    const context = await this.authorization.requireMembership(
      agreement.crewId,
      userId,
    );
    if (
      !context.permissions.includes('agreements.view_own') ||
      agreement.memberUserId !== userId
    ) {
      throw new ForbiddenException({
        message:
          'Only the authenticated member named as this agreement signer can open its signing session.',
      });
    }
    if (
      agreement.status !== CrewAgreementStatus.sent ||
      !agreement.providerDocumentId
    ) {
      throw new BadRequestException({
        message:
          'This agreement is not currently awaiting your signature in BoldSign.',
      });
    }
    const session = await this.provider.getEmbeddedSigningLink(
      agreement.providerDocumentId,
      agreement.signerEmail,
    );
    return {
      signLink: session.signLink,
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  async sync(agreementId: string, userId: string) {
    const agreement = await this.prisma.crewAgreement.findUnique({
      where: { id: agreementId },
    });
    if (!agreement) throw new NotFoundException('Agreement not found.');
    const context = await this.authorization.requireMembership(
      agreement.crewId,
      userId,
    );
    const canManage = context.permissions.includes('agreements.manage');
    if (!canManage && agreement.memberUserId !== userId) {
      throw new ForbiddenException({
        message: 'You cannot access this agreement.',
      });
    }
    if (!agreement.providerDocumentId) {
      throw new NotFoundException({
        message: 'This agreement has no BoldSign document.',
      });
    }

    const providerStatus = await this.provider.getDocumentStatus(
      agreement.providerDocumentId,
    );
    const resolvedStatus = mapBoldSignStatus(providerStatus, providerStatus);
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      // Serialize with webhook writes, then discard a response for an older
      // document or lifecycle. Provider calls must remain outside the lock.
      await tx.$executeRaw`SELECT id FROM crew_agreements WHERE id=${agreement.id}::uuid FOR UPDATE`;
      const current = await tx.crewAgreement.findUniqueOrThrow({
        where: { id: agreement.id },
      });
      if (
        isTerminalAgreementStatus(current.status) ||
        current.providerDocumentId !== agreement.providerDocumentId ||
        current.status !== agreement.status ||
        current.lastProviderEventId !== agreement.lastProviderEventId ||
        current.lastSyncedAt?.getTime() !== agreement.lastSyncedAt?.getTime()
      ) {
        await this.enqueueArchive(current, tx);
        return tx.crewAgreement.findUniqueOrThrow({
          where: { id: current.id },
          include: AGREEMENT_ARCHIVE_INCLUDE,
        });
      }
      const status = resolvedStatus;
      const row = await tx.crewAgreement.update({
        where: { id: agreement.id },
        data: {
          status,
          providerStatus,
          lastSyncedAt: now,
          ...(status === CrewAgreementStatus.signed &&
          agreement.status !== CrewAgreementStatus.signed
            ? { signedAt: now }
            : {}),
          ...(status === CrewAgreementStatus.voided &&
          agreement.status !== CrewAgreementStatus.voided
            ? { voidedAt: now }
            : {}),
        },
      });
      await this.enqueueArchive(row, tx);
      await this.notifyStatusChange(row, agreement.status, tx);
      return tx.crewAgreement.findUniqueOrThrow({
        where: { id: row.id },
        include: AGREEMENT_ARCHIVE_INCLUDE,
      });
    });
    return agreementDto(
      updated,
      canManage,
      updated.memberUserId === userId &&
        updated.status === CrewAgreementStatus.sent,
    );
  }

  async retryArchive(agreementId: string, userId: string) {
    const agreement = await this.prisma.crewAgreement.findUnique({
      where: { id: agreementId },
      include: AGREEMENT_ARCHIVE_INCLUDE,
    });
    if (!agreement) throw new NotFoundException('Agreement not found.');
    await this.authorization.require(
      agreement.crewId,
      userId,
      'agreements.manage',
    );
    if (
      agreement.status !== CrewAgreementStatus.signed ||
      !agreement.providerDocumentId
    ) {
      throw new BadRequestException({
        message:
          'Only a signed BoldSign agreement can retry artifact archival.',
      });
    }
    if (agreement.assetNodeId && agreement.auditAssetNodeId) {
      return agreementDto(agreement, true);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM crew_agreements WHERE id = ${agreement.id}::uuid FOR UPDATE`;
      await tx.$executeRaw`SELECT id FROM crew_agreement_archive_jobs WHERE agreement_id = ${agreement.id}::uuid FOR UPDATE`;
      await this.authorization.require(
        agreement.crewId,
        userId,
        'agreements.manage',
        tx,
      );
      const current = await tx.crewAgreement.findUnique({
        where: { id: agreement.id },
        include: AGREEMENT_ARCHIVE_INCLUDE,
      });
      if (
        !current ||
        current.status !== CrewAgreementStatus.signed ||
        !current.providerDocumentId ||
        (current.assetNodeId && current.auditAssetNodeId) ||
        current.archiveJob?.status === CrewAgreementArchiveJobStatus.pending ||
        current.archiveJob?.status === CrewAgreementArchiveJobStatus.processing
      )
        return;
      await tx.crewAgreementArchiveJob.upsert({
        where: { agreementId: agreement.id },
        create: { agreementId: agreement.id },
        update: {
          status: CrewAgreementArchiveJobStatus.pending,
          attempt: 0,
          nextAttemptAt: null,
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          completedAt: null,
        },
      });
      await this.authorization.require(
        agreement.crewId,
        userId,
        'agreements.manage',
        tx,
      );
    });
    const updated = await this.prisma.crewAgreement.findUniqueOrThrow({
      where: { id: agreement.id },
      include: AGREEMENT_ARCHIVE_INCLUDE,
    });
    return agreementDto(updated, true);
  }

  /**
   * Public BoldSign callback. Signature verification happens before any state
   * lookup. Metadata lets us correlate a callback even if it races the
   * send-from-template response and `providerDocumentId` is not stored yet.
   */
  async handleWebhook(input: {
    rawBody: Buffer;
    signatureHeader?: string;
    eventHeader?: string;
  }) {
    const payload = parseWebhookPayload(input.rawBody);
    if (
      input.eventHeader?.trim().toLowerCase() === 'verification' ||
      payload.event.eventType.trim().toLowerCase() === 'verification'
    ) {
      return { received: true, verification: true };
    }
    if (!this.provider.isEnabled()) {
      throw new ServiceUnavailableException({
        message: 'BoldSign webhook handling is disabled for this deployment.',
      });
    }
    this.provider.verifyWebhook(input.rawBody, input.signatureHeader);

    const data = payload.data;
    if (!data?.documentId) {
      // Account-level webhooks also deliver template / identity events.
      return { received: true, handled: false };
    }
    const metadataAgreementId = agreementIdFromMetadata(data.metaData);
    const candidates: Prisma.CrewAgreementWhereInput[] = [
      { providerDocumentId: data.documentId },
    ];
    if (metadataAgreementId) candidates.push({ id: metadataAgreementId });

    return this.prisma.$transaction(async (tx) => {
      const candidate = await tx.crewAgreement.findFirst({
        where: { OR: candidates },
        select: { id: true },
      });
      if (!candidate) return { received: true, handled: false };

      await tx.$executeRaw(
        Prisma.sql`SELECT id
                   FROM crew_agreements
                   WHERE id = ${candidate.id}::uuid
                   FOR UPDATE`,
      );
      const agreement = await tx.crewAgreement.findUniqueOrThrow({
        where: { id: candidate.id },
      });
      if (
        agreement.providerDocumentId &&
        agreement.providerDocumentId !== data.documentId
      ) {
        throw new BadRequestException({
          message:
            'BoldSign webhook document id does not match the agreement metadata.',
        });
      }

      const eventAt = new Date(payload.event.created * 1_000);
      const providerStatus =
        data.status?.trim() || payload.event.eventType.trim();
      const nextStatus = mapBoldSignStatus(
        providerStatus,
        payload.event.eventType,
      );
      if (
        agreement.lastProviderEventId === payload.event.id ||
        !shouldApplyWebhookEvent(agreement, eventAt, nextStatus)
      ) {
        return {
          received: true,
          handled: true,
          applied: false,
          agreementId: agreement.id,
        };
      }

      const updated = await tx.crewAgreement.update({
        where: { id: agreement.id },
        data: {
          providerDocumentId: data.documentId,
          providerStatus: providerStatus.slice(0, 64),
          status: nextStatus,
          lastProviderEventId: payload.event.id.slice(0, 80),
          lastProviderEventAt: eventAt,
          lastSyncedAt: new Date(),
          ...(nextStatus === CrewAgreementStatus.sent && !agreement.sentAt
            ? { sentAt: eventAt }
            : {}),
          ...(nextStatus === CrewAgreementStatus.signed && !agreement.signedAt
            ? { signedAt: eventAt }
            : {}),
          ...(nextStatus === CrewAgreementStatus.voided && !agreement.voidedAt
            ? { voidedAt: eventAt }
            : {}),
        },
      });
      await this.enqueueArchive(updated, tx);
      await this.notifyStatusChange(updated, agreement.status, tx);
      return {
        received: true,
        handled: true,
        applied: true,
        agreementId: updated.id,
        status: updated.status,
      };
    });
  }

  private async enqueueArchive(
    agreement: CrewAgreement,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (
      agreement.status !== CrewAgreementStatus.signed ||
      !agreement.providerDocumentId ||
      (agreement.assetNodeId && agreement.auditAssetNodeId)
    ) {
      return;
    }
    await tx.crewAgreementArchiveJob.upsert({
      where: { agreementId: agreement.id },
      create: { agreementId: agreement.id },
      // A failed row requires an explicit retry so a persistent provider or
      // storage fault cannot hot-loop every time somebody presses Sync.
      update: { agreementId: agreement.id },
    });
  }

  private async createQueuedAgreement(
    input: {
      invitationId?: string;
      crewId: string;
      memberUserId: string;
      signerName: string;
      signerEmail: string;
      title: string;
      createdByUserId: string;
    },
    tx: Prisma.TransactionClient,
  ) {
    const agreement = await tx.crewAgreement.create({
      data: {
        invitationId: input.invitationId,
        crewId: input.crewId,
        memberUserId: input.memberUserId,
        signerName: input.signerName.trim(),
        signerEmail: input.signerEmail.trim().toLowerCase(),
        title: input.title.trim(),
        createdByUserId: input.createdByUserId,
      },
    });
    await tx.crewAgreementSendJob.create({
      data: { agreementId: agreement.id },
    });
    return tx.crewAgreement.findUniqueOrThrow({
      where: { id: agreement.id },
      include: AGREEMENT_ARCHIVE_INCLUDE,
    });
  }

  private async notifyStatusChange(
    agreement: CrewAgreement,
    previousStatus: CrewAgreementStatus,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (agreement.status === previousStatus) return;
    if (agreement.status === CrewAgreementStatus.sent) {
      await this.notifications.send(
        {
          userId: agreement.memberUserId,
          type: 'crew.agreement.sent',
          title: agreement.title,
          body: 'A crew agreement was sent to your email for signature.',
          meta: {
            crewId: agreement.crewId,
            agreementId: agreement.id,
            agreementTitle: agreement.title,
            status: agreement.status,
            deeplink: `/crews/${agreement.crewId}/workspace?tab=members&agreement=${agreement.id}`,
          },
          idempotencyKey: `crew.agreement.sent:${agreement.id}`,
        },
        tx,
      );
      return;
    }
    const recipients = new Set([
      agreement.memberUserId,
      agreement.createdByUserId,
    ]);
    await Promise.all(
      [...recipients].map((userId) =>
        this.notifications.send(
          {
            userId,
            type: 'crew.agreement.updated',
            title: agreement.title,
            body: agreementStatusNotificationBody(agreement.status),
            meta: {
              crewId: agreement.crewId,
              agreementId: agreement.id,
              agreementTitle: agreement.title,
              status: agreement.status,
              deeplink: `/crews/${agreement.crewId}/workspace?tab=members&agreement=${agreement.id}`,
            },
            idempotencyKey: `crew.agreement.status:${agreement.id}:${agreement.status}:${userId}`,
          },
          tx,
        ),
      ),
    );
  }
}

function agreementViewWhere(
  view: ListCrewAgreementsQuery['view'],
): Prisma.CrewAgreementWhereInput {
  switch (view) {
    case 'active':
      return {
        status: {
          in: [
            CrewAgreementStatus.draft,
            CrewAgreementStatus.sending,
            CrewAgreementStatus.sent,
          ],
        },
      };
    case 'signed':
      return { status: CrewAgreementStatus.signed };
    case 'attention':
      return {
        status: {
          in: [
            CrewAgreementStatus.declined,
            CrewAgreementStatus.expired,
            CrewAgreementStatus.failed,
            CrewAgreementStatus.voided,
          ],
        },
      };
    case 'all':
      return {};
  }
}

function agreementSummary(
  grouped: Array<{
    status: CrewAgreementStatus;
    _count: { _all: number };
  }>,
) {
  const summary = { all: 0, active: 0, signed: 0, attention: 0 };
  for (const row of grouped) {
    const count = row._count._all;
    summary.all += count;
    switch (row.status) {
      case CrewAgreementStatus.draft:
      case CrewAgreementStatus.sending:
      case CrewAgreementStatus.sent:
        summary.active += count;
        break;
      case CrewAgreementStatus.signed:
        summary.signed += count;
        break;
      case CrewAgreementStatus.declined:
      case CrewAgreementStatus.expired:
      case CrewAgreementStatus.failed:
      case CrewAgreementStatus.voided:
        summary.attention += count;
        break;
    }
  }
  return summary;
}

function mapBoldSignStatus(
  providerStatus: string,
  eventType: string,
): CrewAgreementStatus {
  switch (eventType.trim().toLowerCase()) {
    case 'declined':
      return CrewAgreementStatus.declined;
    case 'expired':
      return CrewAgreementStatus.expired;
    case 'revoked':
      return CrewAgreementStatus.voided;
    case 'sendfailed':
    case 'deliveryfailed':
      return CrewAgreementStatus.failed;
  }
  switch (providerStatus.trim().toLowerCase()) {
    case 'completed':
      return CrewAgreementStatus.signed;
    case 'declined':
      return CrewAgreementStatus.declined;
    case 'expired':
      return CrewAgreementStatus.expired;
    case 'revoked':
      return CrewAgreementStatus.voided;
    case 'sendfailed':
      return CrewAgreementStatus.failed;
    default:
      return CrewAgreementStatus.sent;
  }
}

function shouldApplyWebhookEvent(
  agreement: CrewAgreement,
  eventAt: Date,
  nextStatus: CrewAgreementStatus,
): boolean {
  if (agreement.lastProviderEventAt) {
    const order = eventAt.getTime() - agreement.lastProviderEventAt.getTime();
    if (order < 0) return false;
    if (
      order === 0 &&
      agreementStatusRank(nextStatus) < agreementStatusRank(agreement.status)
    ) {
      return false;
    }
  }
  return !isTerminalAgreementStatus(agreement.status);
}

function agreementStatusRank(status: CrewAgreementStatus): number {
  switch (status) {
    case CrewAgreementStatus.signed:
      return 100;
    case CrewAgreementStatus.declined:
      return 90;
    case CrewAgreementStatus.voided:
      return 80;
    case CrewAgreementStatus.expired:
      return 70;
    case CrewAgreementStatus.failed:
      return 30;
    case CrewAgreementStatus.sent:
      return 20;
    case CrewAgreementStatus.sending:
      return 15;
    case CrewAgreementStatus.draft:
      return 10;
  }
}

function isTerminalAgreementStatus(status: CrewAgreementStatus): boolean {
  switch (status) {
    case CrewAgreementStatus.signed:
    case CrewAgreementStatus.declined:
    case CrewAgreementStatus.expired:
    case CrewAgreementStatus.voided:
      return true;
    case CrewAgreementStatus.draft:
    case CrewAgreementStatus.sending:
    case CrewAgreementStatus.sent:
    case CrewAgreementStatus.failed:
      return false;
  }
}

function agreementStatusNotificationBody(status: CrewAgreementStatus): string {
  switch (status) {
    case CrewAgreementStatus.signed:
      return 'The crew agreement has been fully signed.';
    case CrewAgreementStatus.declined:
      return 'The signer declined the crew agreement.';
    case CrewAgreementStatus.expired:
      return 'The crew agreement expired before it was signed.';
    case CrewAgreementStatus.failed:
      return 'BoldSign could not send or deliver the crew agreement.';
    case CrewAgreementStatus.voided:
      return 'The crew agreement was revoked.';
    case CrewAgreementStatus.sent:
      return 'The crew agreement was sent for signature.';
    case CrewAgreementStatus.sending:
      return 'The crew agreement is being sent for signature.';
    case CrewAgreementStatus.draft:
      return 'The crew agreement is a draft.';
  }
}

const BoldSignWebhookSchema = z
  .object({
    event: z.object({
      id: z.string().min(1),
      created: z.number().int().positive(),
      eventType: z.string().min(1),
    }),
    data: z
      .object({
        documentId: z.string().min(1).optional(),
        status: z.string().optional(),
        metaData: z.record(z.string(), z.unknown()).nullable().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

function parseWebhookPayload(rawBody: Buffer) {
  let value: unknown;
  try {
    value = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new BadRequestException({
      message: 'BoldSign webhook body is not valid JSON.',
    });
  }
  const result = BoldSignWebhookSchema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      message: 'BoldSign webhook payload is invalid.',
      issues: result.error.issues,
    });
  }
  return result.data;
}

function agreementIdFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const value = metadata?.FizzDragonAgreementId;
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
    ? value
    : null;
}

function agreementDto(
  agreement: {
    id: string;
    crewId: string;
    memberUserId: string;
    signerName: string;
    signerEmail: string;
    title: string;
    provider: string;
    providerDocumentId: string | null;
    providerStatus: string | null;
    status: CrewAgreementStatus;
    sendJob?: {
      status: CrewAgreementSendJobStatus;
      attempt: number;
      lastError: string | null;
    } | null;
    assetNodeId?: string | null;
    auditAssetNodeId?: string | null;
    archiveJob?: {
      status: CrewAgreementArchiveJobStatus;
      attempt: number;
    } | null;
    assetNode?: { mediaAssetId: string | null } | null;
    auditAssetNode?: { mediaAssetId: string | null } | null;
    sentAt: Date | null;
    signedAt: Date | null;
    lastSyncedAt: Date | null;
    lastProviderEventId?: string | null;
    lastProviderEventAt?: Date | null;
    voidedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
  canRetryArchive = false,
  canSign = false,
) {
  return {
    id: agreement.id,
    crewId: agreement.crewId,
    memberUserId: agreement.memberUserId,
    signerName: agreement.signerName,
    signerEmail: agreement.signerEmail,
    title: agreement.title,
    provider: agreement.provider,
    providerDocumentId: agreement.providerDocumentId,
    providerStatus: agreement.providerStatus,
    status: agreement.status,
    capabilities: {
      sign: canSign,
    },
    delivery: agreementDeliveryDto(agreement, canRetryArchive),
    archive: agreementArchiveDto(agreement, canRetryArchive),
    sentAt: agreement.sentAt?.toISOString() ?? null,
    signedAt: agreement.signedAt?.toISOString() ?? null,
    lastSyncedAt: agreement.lastSyncedAt?.toISOString() ?? null,
    voidedAt: agreement.voidedAt?.toISOString() ?? null,
    createdAt: agreement.createdAt.toISOString(),
    updatedAt: agreement.updatedAt.toISOString(),
  };
}

function agreementDeliveryDto(
  agreement: {
    providerDocumentId: string | null;
    sendJob?: {
      status: CrewAgreementSendJobStatus;
      attempt: number;
      lastError: string | null;
    } | null;
  },
  canRetry: boolean,
) {
  const status = agreement.providerDocumentId
    ? ('completed' as const)
    : (agreement.sendJob?.status ?? ('pending' as const));
  return {
    status,
    attempt: agreement.sendJob?.attempt ?? 0,
    error: status === 'failed' ? (agreement.sendJob?.lastError ?? null) : null,
    canRetry:
      canRetry &&
      status === CrewAgreementSendJobStatus.failed &&
      !agreement.providerDocumentId,
  };
}

function agreementArchiveDto(
  agreement: {
    status: CrewAgreementStatus;
    assetNodeId?: string | null;
    auditAssetNodeId?: string | null;
    archiveJob?: {
      status: CrewAgreementArchiveJobStatus;
      attempt: number;
    } | null;
    assetNode?: { mediaAssetId: string | null } | null;
    auditAssetNode?: { mediaAssetId: string | null } | null;
  },
  canRetry: boolean,
) {
  const ready = Boolean(agreement.assetNodeId && agreement.auditAssetNodeId);
  const status =
    agreement.status !== CrewAgreementStatus.signed
      ? ('not_applicable' as const)
      : ready
        ? ('ready' as const)
        : agreement.archiveJob?.status === CrewAgreementArchiveJobStatus.failed
          ? ('failed' as const)
          : agreement.archiveJob?.status ===
              CrewAgreementArchiveJobStatus.processing
            ? ('processing' as const)
            : ('pending' as const);
  return {
    status,
    signedAssetNodeId: agreement.assetNodeId ?? null,
    auditAssetNodeId: agreement.auditAssetNodeId ?? null,
    signedDocumentUrl: agreement.assetNode?.mediaAssetId
      ? `/aurora/media/assets/${agreement.assetNode.mediaAssetId}/content`
      : null,
    auditTrailUrl: agreement.auditAssetNode?.mediaAssetId
      ? `/aurora/media/assets/${agreement.auditAssetNode.mediaAssetId}/content`
      : null,
    attempt: agreement.archiveJob?.attempt ?? 0,
    canRetry: canRetry && status === 'failed',
  };
}
