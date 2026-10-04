/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers are intentionally untyped in agreement lifecycle assertions. */
import { ServiceUnavailableException } from '@nestjs/common';
import {
  CrewAgreementArchiveJobStatus,
  CrewAgreementSendJobStatus,
  CrewAgreementStatus,
} from '@prisma/client';
import { ListCrewAgreementsQuerySchema } from '../dto';
import { CrewAgreementsService } from './agreements.service';

const CREW_ID = 'crew-1';
const OWNER_ID = 'owner-1';
const MEMBER_ID = 'member-1';
const AGREEMENT_ID = '01910d50-4c88-7c78-92d4-16892c06a001';

function agreement(overrides: Record<string, unknown> = {}) {
  return {
    id: AGREEMENT_ID,
    crewId: CREW_ID,
    memberUserId: MEMBER_ID,
    signerName: 'Mina Chen',
    signerEmail: 'mina@example.com',
    title: 'Storyboard delivery agreement',
    provider: 'boldsign',
    providerDocumentId: null,
    providerStatus: null,
    status: CrewAgreementStatus.draft,
    assetNodeId: null,
    auditAssetNodeId: null,
    archiveJob: null,
    sendJob: {
      status: CrewAgreementSendJobStatus.pending,
      attempt: 0,
      lastError: null,
    },
    createdByUserId: OWNER_ID,
    sentAt: null,
    signedAt: null,
    lastSyncedAt: null,
    lastProviderEventId: null,
    lastProviderEventAt: null,
    voidedAt: null,
    createdAt: new Date('2026-07-29T09:00:00.000Z'),
    updatedAt: new Date('2026-07-29T09:00:00.000Z'),
    ...overrides,
  };
}

function build() {
  const prisma = {
    crewAgreement: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn().mockResolvedValue(agreement()),
      create: jest.fn().mockResolvedValue(agreement()),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    crewMember: {
      findFirst: jest.fn().mockResolvedValue({ id: 'crew-member-1' }),
    },
    crewAgreementArchiveJob: {
      upsert: jest.fn().mockResolvedValue({}),
    },
    crewAgreementSendJob: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) =>
    fn(prisma),
  );
  const authorizationContext = (userId: string) => ({
    crewId: CREW_ID,
    memberId: userId === OWNER_ID ? 'owner-member-1' : 'crew-member-1',
    userId,
    isOwner: userId === OWNER_ID,
    policyKeys: userId === OWNER_ID ? ['admin'] : [],
    permissions:
      userId === OWNER_ID
        ? ['agreements.view_own', 'agreements.manage']
        : ['agreements.view_own'],
  });
  const authorization = {
    resolve: jest.fn((_crewId: string, userId: string) =>
      Promise.resolve(authorizationContext(userId)),
    ),
    requireMembership: jest.fn((_crewId: string, userId: string) =>
      Promise.resolve(authorizationContext(userId)),
    ),
    require: jest.fn((_crewId: string, userId: string) =>
      Promise.resolve(authorizationContext(userId)),
    ),
  };
  const provider = {
    isEnabled: jest.fn().mockReturnValue(true),
    isConfigured: jest.fn().mockReturnValue(true),
    canSync: jest.fn().mockReturnValue(true),
    sendFromTemplate: jest.fn().mockResolvedValue('boldsign-document-1'),
    getDocumentStatus: jest.fn().mockResolvedValue('Completed'),
    getEmbeddedSigningLink: jest.fn().mockResolvedValue({
      signLink:
        'https://app.boldsign.com/document/sign/?documentId=boldsign-document-1',
      expiresAt: new Date('2026-07-29T12:15:00.000Z'),
    }),
    verifyWebhook: jest.fn(),
  };
  const notifications = { send: jest.fn().mockResolvedValue({}) };
  return {
    prisma,
    authorization,
    provider,
    notifications,
    service: new CrewAgreementsService(
      prisma as never,
      authorization as never,
      provider as never,
      notifications as never,
    ),
  };
}

describe('CrewAgreementsService', () => {
  it('scopes personal contracts to the actor and rechecks current crew permissions', async () => {
    const t = build();
    t.prisma.crewAgreement.findMany.mockResolvedValue([
      agreement({ crew: { name: 'Film' } }),
    ]);
    const page = await t.service.listMine(MEMBER_ID, {
      limit: 30,
      view: 'all',
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).not.toHaveProperty('signerEmail');
    expect(t.prisma.crewAgreement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            expect.objectContaining({
              OR: [{ memberUserId: MEMBER_ID }, { createdByUserId: MEMBER_ID }],
              crew: {
                deletedAt: null,
                members: { some: { userId: MEMBER_ID, status: 'active' } },
              },
            }),
          ],
        },
      }),
    );
    t.authorization.resolve.mockResolvedValue({
      crewId: CREW_ID,
      memberId: 'member',
      userId: MEMBER_ID,
      isOwner: false,
      policyKeys: [],
      permissions: [],
    });
    expect(
      (await t.service.listMine(MEMBER_ID, { limit: 30, view: 'all' })).items,
    ).toEqual([]);
  });

  it('rejects a personal contract cursor outside the scoped list', async () => {
    const t = build();
    await expect(
      t.service.listMine(MEMBER_ID, {
        limit: 30,
        view: 'signed',
        cursor: AGREEMENT_ID,
      }),
    ).rejects.toMatchObject({
      response: { code: 'CREW_AGREEMENT_CURSOR_INVALID' },
    });
    expect(t.prisma.crewAgreement.findMany).not.toHaveBeenCalled();
  });
  it('validates bounded agreement list pagination and product views', () => {
    expect(ListCrewAgreementsQuerySchema.parse({})).toEqual({
      limit: 30,
      view: 'all',
    });
    expect(
      ListCrewAgreementsQuerySchema.parse({
        limit: '100',
        cursor: AGREEMENT_ID,
        view: 'attention',
      }),
    ).toEqual({
      limit: 100,
      cursor: AGREEMENT_ID,
      view: 'attention',
    });
    expect(
      ListCrewAgreementsQuerySchema.safeParse({ limit: 101 }).success,
    ).toBe(false);
  });

  it('keeps agreements optional when BoldSign is not configured', async () => {
    const t = build();
    t.provider.isConfigured.mockReturnValue(false);
    t.provider.canSync.mockReturnValue(false);

    await expect(
      t.service.list(CREW_ID, OWNER_ID, { limit: 30, view: 'all' }),
    ).resolves.toEqual({
      capabilities: {
        create: false,
        sync: false,
        provider: 'boldsign',
      },
      items: [],
      nextCursor: null,
      total: 0,
      summary: { all: 0, active: 0, signed: 0, attention: 0 },
    });
  });

  it('paginates agreements and returns authoritative product-view counts', async () => {
    const t = build();
    const first = agreement({
      id: '01910d50-4c88-7c78-92d4-16892c06a003',
      status: CrewAgreementStatus.sent,
      updatedAt: new Date('2026-07-29T11:00:00.000Z'),
    });
    const second = agreement({
      id: '01910d50-4c88-7c78-92d4-16892c06a002',
      status: CrewAgreementStatus.draft,
      updatedAt: new Date('2026-07-29T10:00:00.000Z'),
    });
    const lookahead = agreement({
      id: AGREEMENT_ID,
      status: CrewAgreementStatus.sent,
    });
    t.prisma.crewAgreement.findMany.mockResolvedValue([
      first,
      second,
      lookahead,
    ]);
    t.prisma.crewAgreement.groupBy.mockResolvedValue([
      { status: CrewAgreementStatus.sent, _count: { _all: 4 } },
      { status: CrewAgreementStatus.signed, _count: { _all: 2 } },
      { status: CrewAgreementStatus.failed, _count: { _all: 1 } },
    ]);

    const result = await t.service.list(CREW_ID, OWNER_ID, {
      limit: 2,
      view: 'active',
    });

    expect(result).toMatchObject({
      nextCursor: second.id,
      total: 4,
      summary: { all: 7, active: 4, signed: 2, attention: 1 },
      items: [{ id: first.id }, { id: second.id }],
    });
    expect(t.prisma.crewAgreement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 3,
      }),
    );
  });

  it('rejects an agreement cursor outside the caller scope and selected view', async () => {
    const t = build();

    await expect(
      t.service.list(CREW_ID, OWNER_ID, {
        limit: 30,
        view: 'signed',
        cursor: AGREEMENT_ID,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'CREW_AGREEMENT_CURSOR_INVALID',
        message: expect.stringContaining('cursor is invalid'),
      }),
    });
    expect(t.prisma.crewAgreement.findMany).not.toHaveBeenCalled();
  });

  it('exposes secure archive state and controlled media entry points', async () => {
    const t = build();
    t.prisma.crewAgreement.findMany.mockResolvedValue([
      agreement({
        status: CrewAgreementStatus.signed,
        assetNodeId: '01910d50-4c88-7c78-92d4-16892c06a010',
        auditAssetNodeId: '01910d50-4c88-7c78-92d4-16892c06a011',
        assetNode: {
          mediaAssetId: '01910d50-4c88-7c78-92d4-16892c06a020',
        },
        auditAssetNode: {
          mediaAssetId: '01910d50-4c88-7c78-92d4-16892c06a021',
        },
        archiveJob: {
          status: CrewAgreementArchiveJobStatus.completed,
          attempt: 1,
        },
      }),
    ]);
    t.prisma.crewAgreement.groupBy.mockResolvedValue([
      { status: CrewAgreementStatus.signed, _count: { _all: 1 } },
    ]);

    const result = await t.service.list(CREW_ID, OWNER_ID, {
      limit: 30,
      view: 'signed',
    });

    expect(result.items[0]).toMatchObject({
      archive: {
        status: 'ready',
        signedDocumentUrl:
          '/aurora/media/assets/01910d50-4c88-7c78-92d4-16892c06a020/content',
        auditTrailUrl:
          '/aurora/media/assets/01910d50-4c88-7c78-92d4-16892c06a021/content',
        canRetry: false,
      },
    });
  });

  it('creates an agreement and its durable BoldSign dispatch atomically', async () => {
    const t = build();
    t.prisma.crewAgreement.findUniqueOrThrow.mockResolvedValue(agreement());

    const result = await t.service.create(CREW_ID, OWNER_ID, {
      memberUserId: MEMBER_ID,
      signerName: 'Mina Chen',
      signerEmail: 'MINA@EXAMPLE.COM',
      title: 'Storyboard delivery agreement',
    });

    expect(t.prisma.crewAgreement.create).toHaveBeenCalledWith({
      data: {
        crewId: CREW_ID,
        memberUserId: MEMBER_ID,
        signerName: 'Mina Chen',
        signerEmail: 'mina@example.com',
        title: 'Storyboard delivery agreement',
        createdByUserId: OWNER_ID,
      },
    });
    expect(t.prisma.crewAgreementSendJob.create).toHaveBeenCalledWith({
      data: { agreementId: AGREEMENT_ID },
    });
    expect(t.provider.sendFromTemplate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: AGREEMENT_ID,
      status: CrewAgreementStatus.draft,
      providerDocumentId: null,
      delivery: {
        status: 'pending',
        canRetry: false,
      },
    });
    expect(t.notifications.send).not.toHaveBeenCalled();
  });

  it('materializes an invitation agreement exactly once after acceptance', async () => {
    const t = build();
    t.prisma.crewAgreement.findUnique.mockResolvedValue(null);
    t.prisma.crewAgreement.findUniqueOrThrow.mockResolvedValue(
      agreement({
        invitationId: '01910d50-4c88-7c78-92d4-16892c06a099',
      }),
    );

    await t.service.stageInvitationAgreement(
      {
        id: '01910d50-4c88-7c78-92d4-16892c06a099',
        crewId: CREW_ID,
        inviteeUserId: MEMBER_ID,
        invitedByUserId: OWNER_ID,
        agreementTitle: 'Storyboard agreement',
        agreementSignerName: 'Mina Chen',
        agreementSignerEmail: 'MINA@example.com',
      },
      t.prisma as never,
    );

    expect(t.prisma.crewAgreement.create).toHaveBeenCalledWith({
      data: {
        invitationId: '01910d50-4c88-7c78-92d4-16892c06a099',
        crewId: CREW_ID,
        memberUserId: MEMBER_ID,
        signerName: 'Mina Chen',
        signerEmail: 'mina@example.com',
        title: 'Storyboard agreement',
        createdByUserId: OWNER_ID,
      },
    });
    expect(t.prisma.crewAgreementSendJob.create).toHaveBeenCalledTimes(1);
  });

  it.each(['retrySend', 'retryArchive'] as const)(
    'rejects %s when transaction permission is withdrawn',
    async (method) => {
      const t = build();
      const failed = agreement({
        status:
          method === 'retrySend'
            ? CrewAgreementStatus.failed
            : CrewAgreementStatus.signed,
        providerDocumentId: method === 'retrySend' ? null : 'document',
        sendJob: { status: CrewAgreementSendJobStatus.failed },
        archiveJob: { status: CrewAgreementArchiveJobStatus.failed },
      });
      t.prisma.crewAgreement.findUnique.mockResolvedValue(failed);
      const denied = new Error('Agreement management withdrawn');
      t.authorization.require
        .mockResolvedValueOnce({} as never)
        .mockRejectedValueOnce(denied);
      await expect(t.service[method](AGREEMENT_ID, OWNER_ID)).rejects.toBe(
        denied,
      );
      expect(t.authorization.require).toHaveBeenLastCalledWith(
        CREW_ID,
        OWNER_ID,
        'agreements.manage',
        t.prisma,
      );
      expect(t.prisma.crewAgreement.update).not.toHaveBeenCalled();
      expect(t.prisma.crewAgreementSendJob.update).not.toHaveBeenCalled();
      expect(t.prisma.crewAgreementArchiveJob.upsert).not.toHaveBeenCalled();
    },
  );

  it.each(['retrySend', 'retryArchive'] as const)(
    'preserves a job restarted while %s waited',
    async (method) => {
      const t = build();
      const failed = agreement({
        status:
          method === 'retrySend'
            ? CrewAgreementStatus.failed
            : CrewAgreementStatus.signed,
        providerDocumentId: method === 'retrySend' ? null : 'document',
        sendJob: { status: CrewAgreementSendJobStatus.failed },
        archiveJob: { status: CrewAgreementArchiveJobStatus.failed },
      });
      const restarted = {
        ...failed,
        sendJob: { status: CrewAgreementSendJobStatus.processing },
        archiveJob: { status: CrewAgreementArchiveJobStatus.processing },
      };
      t.prisma.crewAgreement.findUnique
        .mockResolvedValueOnce(failed)
        .mockResolvedValue(restarted);
      t.prisma.crewAgreement.findUniqueOrThrow.mockResolvedValue(restarted);
      await t.service[method](AGREEMENT_ID, OWNER_ID);
      expect(t.prisma.crewAgreementSendJob.update).not.toHaveBeenCalled();
      expect(t.prisma.crewAgreementArchiveJob.upsert).not.toHaveBeenCalled();
      expect(t.prisma.crewAgreement.update).not.toHaveBeenCalled();
    },
  );

  it('lets an owner explicitly retry a terminal initial dispatch failure', async () => {
    const t = build();
    t.prisma.crewAgreement.findUnique.mockResolvedValue(
      agreement({
        status: CrewAgreementStatus.failed,
        sendJob: {
          status: CrewAgreementSendJobStatus.failed,
          attempt: 10,
          lastError: 'BoldSign unavailable',
        },
      }),
    );
    t.prisma.crewAgreement.findUniqueOrThrow.mockResolvedValue(
      agreement({
        status: CrewAgreementStatus.draft,
        sendJob: {
          status: CrewAgreementSendJobStatus.pending,
          attempt: 0,
          lastError: null,
        },
      }),
    );

    await expect(
      t.service.retrySend(AGREEMENT_ID, OWNER_ID),
    ).resolves.toMatchObject({
      status: CrewAgreementStatus.draft,
      delivery: { status: 'pending', attempt: 0 },
    });
    expect(t.prisma.crewAgreementSendJob.update).toHaveBeenCalledWith({
      where: { agreementId: AGREEMENT_ID },
      data: expect.objectContaining({
        status: CrewAgreementSendJobStatus.pending,
        attempt: 0,
        lockedAt: null,
        lockedBy: null,
      }),
    });
  });

  it('mints a short-lived signing session only for the authenticated signer', async () => {
    const t = build();
    t.prisma.crewAgreement.findUnique.mockResolvedValue(
      agreement({
        providerDocumentId: 'boldsign-document-1',
        providerStatus: 'Sent',
        status: CrewAgreementStatus.sent,
      }),
    );

    await expect(
      t.service.createSigningSession(AGREEMENT_ID, MEMBER_ID),
    ).resolves.toEqual({
      signLink:
        'https://app.boldsign.com/document/sign/?documentId=boldsign-document-1',
      expiresAt: '2026-07-29T12:15:00.000Z',
    });
    expect(t.authorization.requireMembership).toHaveBeenCalledWith(
      CREW_ID,
      MEMBER_ID,
    );
    expect(t.provider.getEmbeddedSigningLink).toHaveBeenCalledWith(
      'boldsign-document-1',
      'mina@example.com',
    );
  });

  it('never exposes another member signing credential to a crew admin', async () => {
    const t = build();
    t.prisma.crewAgreement.findUnique.mockResolvedValue(
      agreement({
        providerDocumentId: 'boldsign-document-1',
        providerStatus: 'Sent',
        status: CrewAgreementStatus.sent,
      }),
    );

    await expect(
      t.service.createSigningSession(AGREEMENT_ID, OWNER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringContaining('authenticated member'),
      }),
    });
    expect(t.provider.getEmbeddedSigningLink).not.toHaveBeenCalled();
  });

  it('does not mint a signing credential before BoldSign confirms delivery', async () => {
    const t = build();
    t.prisma.crewAgreement.findUnique.mockResolvedValue(
      agreement({
        providerDocumentId: 'boldsign-document-1',
        status: CrewAgreementStatus.sending,
      }),
    );

    await expect(
      t.service.createSigningSession(AGREEMENT_ID, MEMBER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringContaining('not currently awaiting'),
      }),
    });
    expect(t.provider.getEmbeddedSigningLink).not.toHaveBeenCalled();
  });

  it('maps a completed BoldSign document to a signed agreement', async () => {
    const t = build();
    const sent = agreement({
      providerDocumentId: 'boldsign-document-1',
      providerStatus: 'Sent',
      status: CrewAgreementStatus.sent,
    });
    const completed = agreement({
      providerDocumentId: 'boldsign-document-1',
      providerStatus: 'Completed',
      status: CrewAgreementStatus.signed,
      signedAt: new Date('2026-07-29T10:00:00.000Z'),
      lastSyncedAt: new Date('2026-07-29T10:00:00.000Z'),
    });
    t.prisma.crewAgreement.findUnique.mockResolvedValue(sent);
    t.prisma.crewAgreement.update.mockResolvedValue(completed);
    t.prisma.crewAgreement.findUniqueOrThrow
      .mockResolvedValueOnce(sent)
      .mockResolvedValue({
        ...completed,
        archiveJob: {
          status: 'pending',
          attempt: 0,
        },
      });

    await expect(
      t.service.sync(AGREEMENT_ID, MEMBER_ID),
    ).resolves.toMatchObject({
      status: CrewAgreementStatus.signed,
      providerStatus: 'Completed',
    });
    expect(t.authorization.requireMembership).toHaveBeenCalledWith(
      CREW_ID,
      MEMBER_ID,
    );
    const [updateInput] = t.prisma.crewAgreement.update.mock
      .calls[0] as unknown as [
      {
        where: { id: string };
        data: {
          status: CrewAgreementStatus;
          providerStatus: string;
          lastSyncedAt: Date;
          signedAt: Date;
        };
      },
    ];
    expect(updateInput).toMatchObject({
      where: { id: AGREEMENT_ID },
      data: {
        status: CrewAgreementStatus.signed,
        providerStatus: 'Completed',
      },
    });
    expect(updateInput.data.signedAt).toBeInstanceOf(Date);
    expect(updateInput.data.lastSyncedAt).toBeInstanceOf(Date);
    expect(t.prisma.crewAgreementArchiveJob.upsert).toHaveBeenCalledWith({
      where: { agreementId: AGREEMENT_ID },
      create: { agreementId: AGREEMENT_ID },
      update: { agreementId: AGREEMENT_ID },
    });
  });

  it('applies a verified Completed webhook and notifies both parties atomically', async () => {
    const t = build();
    const sent = agreement({
      providerDocumentId: 'boldsign-document-1',
      providerStatus: 'InProgress',
      status: CrewAgreementStatus.sent,
    });
    const completed = agreement({
      providerDocumentId: 'boldsign-document-1',
      providerStatus: 'Completed',
      status: CrewAgreementStatus.signed,
      signedAt: new Date('2026-07-29T10:00:00.000Z'),
      lastProviderEventId: 'event-completed-1',
      lastProviderEventAt: new Date('2026-07-29T10:00:00.000Z'),
    });
    t.prisma.crewAgreement.findFirst.mockResolvedValue({ id: AGREEMENT_ID });
    t.prisma.crewAgreement.findUniqueOrThrow.mockResolvedValue(sent);
    t.prisma.crewAgreement.update.mockResolvedValue(completed);
    const rawBody = Buffer.from(
      JSON.stringify({
        event: {
          id: 'event-completed-1',
          created: 1785319200,
          eventType: 'Completed',
        },
        data: {
          documentId: 'boldsign-document-1',
          status: 'Completed',
          metaData: { FizzDragonAgreementId: AGREEMENT_ID },
        },
      }),
    );

    await expect(
      t.service.handleWebhook({
        rawBody,
        signatureHeader: 't=1785319200, s0='.concat('a'.repeat(64)),
      }),
    ).resolves.toEqual({
      received: true,
      handled: true,
      applied: true,
      agreementId: AGREEMENT_ID,
      status: CrewAgreementStatus.signed,
    });

    expect(t.provider.verifyWebhook).toHaveBeenCalledWith(
      rawBody,
      expect.any(String),
    );
    expect(t.prisma.$executeRaw).toHaveBeenCalled();
    expect(t.prisma.crewAgreement.update).toHaveBeenCalledWith({
      where: { id: AGREEMENT_ID },
      data: expect.objectContaining({
        providerDocumentId: 'boldsign-document-1',
        providerStatus: 'Completed',
        status: CrewAgreementStatus.signed,
        lastProviderEventId: 'event-completed-1',
        lastProviderEventAt: expect.any(Date),
        signedAt: expect.any(Date),
      }),
    });
    expect(t.prisma.crewAgreementArchiveJob.upsert).toHaveBeenCalledWith({
      where: { agreementId: AGREEMENT_ID },
      create: { agreementId: AGREEMENT_ID },
      update: { agreementId: AGREEMENT_ID },
    });
    expect(t.notifications.send).toHaveBeenCalledTimes(2);
    expect(t.notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: MEMBER_ID,
        type: 'crew.agreement.updated',
        meta: expect.objectContaining({ status: CrewAgreementStatus.signed }),
      }),
      t.prisma,
    );
    expect(t.notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: OWNER_ID,
        type: 'crew.agreement.updated',
      }),
      t.prisma,
    );
  });

  it('lets an admin explicitly requeue a failed signed-artifact archive', async () => {
    const t = build();
    const failed = agreement({
      status: CrewAgreementStatus.signed,
      providerDocumentId: 'boldsign-document-1',
      archiveJob: {
        status: CrewAgreementArchiveJobStatus.failed,
        attempt: 12,
      },
    });
    const pending = {
      ...failed,
      archiveJob: {
        status: CrewAgreementArchiveJobStatus.pending,
        attempt: 0,
      },
    };
    t.prisma.crewAgreement.findUnique.mockResolvedValue(failed);
    t.prisma.crewAgreement.findUniqueOrThrow.mockResolvedValue(pending);

    await expect(
      t.service.retryArchive(AGREEMENT_ID, OWNER_ID),
    ).resolves.toMatchObject({
      archive: { status: 'pending', attempt: 0, canRetry: false },
    });
    expect(t.authorization.require).toHaveBeenCalledWith(
      CREW_ID,
      OWNER_ID,
      'agreements.manage',
    );
    expect(t.prisma.crewAgreementArchiveJob.upsert).toHaveBeenCalledWith({
      where: { agreementId: AGREEMENT_ID },
      create: { agreementId: AGREEMENT_ID },
      update: expect.objectContaining({
        status: CrewAgreementArchiveJobStatus.pending,
        attempt: 0,
        lockedAt: null,
        lockedBy: null,
      }),
    });
  });

  it('does not regress a terminal agreement when an older callback arrives', async () => {
    const t = build();
    t.prisma.crewAgreement.findFirst.mockResolvedValue({ id: AGREEMENT_ID });
    t.prisma.crewAgreement.findUniqueOrThrow.mockResolvedValue(
      agreement({
        providerDocumentId: 'boldsign-document-1',
        providerStatus: 'Completed',
        status: CrewAgreementStatus.signed,
        signedAt: new Date('2026-07-29T10:00:00.000Z'),
        lastProviderEventId: 'event-completed-1',
        lastProviderEventAt: new Date('2026-07-29T10:00:00.000Z'),
      }),
    );

    await expect(
      t.service.handleWebhook({
        rawBody: Buffer.from(
          JSON.stringify({
            event: {
              id: 'event-sent-late',
              created: 1785319199,
              eventType: 'Sent',
            },
            data: {
              documentId: 'boldsign-document-1',
              status: 'InProgress',
            },
          }),
        ),
        signatureHeader: 't=1785319200, s0='.concat('a'.repeat(64)),
      }),
    ).resolves.toMatchObject({ applied: false });

    expect(t.prisma.crewAgreement.update).not.toHaveBeenCalled();
    expect(t.notifications.send).not.toHaveBeenCalled();
  });

  it('acknowledges the BoldSign endpoint verification probe without a signature', async () => {
    const t = build();

    await expect(
      t.service.handleWebhook({
        rawBody: Buffer.from(
          JSON.stringify({
            event: {
              id: 'verification-1',
              created: 1785319200,
              eventType: 'Verification',
            },
          }),
        ),
        eventHeader: 'Verification',
      }),
    ).resolves.toEqual({ received: true, verification: true });

    expect(t.provider.verifyWebhook).not.toHaveBeenCalled();
    expect(t.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects ordinary webhook events when BoldSign is disabled for the deployment', async () => {
    const t = build();
    t.provider.isEnabled.mockReturnValue(false);

    await expect(
      t.service.handleWebhook({
        rawBody: Buffer.from(
          JSON.stringify({
            event: {
              id: 'event-sent-1',
              created: 1785319200,
              eventType: 'Sent',
            },
          }),
        ),
        eventHeader: 'Sent',
      }),
    ).rejects.toThrow(ServiceUnavailableException);

    expect(t.provider.verifyWebhook).not.toHaveBeenCalled();
    expect(t.prisma.$transaction).not.toHaveBeenCalled();
  });
});
