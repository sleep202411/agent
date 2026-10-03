import { CrewInvitationStatus } from '@prisma/client';
import {
  CreateCrewInvitationSchema,
  ListCrewInvitationsQuerySchema,
} from '../dto';
import { CrewInvitationsService } from './invitations.service';

const CREW_ID = 'crew-1';
const OWNER_ID = 'owner-1';
const INVITEE_ID = 'member-1';
const INVITATION_ID = 'invitation-1';

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: INVITATION_ID,
    crewId: CREW_ID,
    inviteeUserId: INVITEE_ID,
    invitedByUserId: OWNER_ID,
    policyKeys: [],
    status: CrewInvitationStatus.pending,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    acceptedAt: null,
    declinedAt: null,
    revokedAt: null,
    agreementTitle: null,
    agreementSignerName: null,
    agreementSignerEmail: null,
    agreement: null,
    createdAt: new Date('2026-07-29T09:00:00.000Z'),
    updatedAt: new Date('2026-07-29T09:00:00.000Z'),
    crew: {
      id: CREW_ID,
      name: 'Night Shift',
    },
    ...overrides,
  };
}

function build() {
  const member = {
    id: 'crew-member-1',
    crewId: CREW_ID,
    userId: INVITEE_ID,
    status: 'active',
    joinedVia: 'invitation',
  };
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    crewInvitation: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(invitation()),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(invitation(data)),
        ),
      update: jest.fn().mockResolvedValue(
        invitation({
          status: CrewInvitationStatus.accepted,
          acceptedAt: new Date(),
        }),
      ),
    },
    crewMember: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(member),
    },
    crewMemberPosition: { create: jest.fn().mockResolvedValue({}) },
    crewMemberPolicy: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    crewAuthorizationEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    crewInvitation: {
      findUnique: jest.fn().mockResolvedValue(invitation()),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    crew: {
      findFirst: jest.fn().mockResolvedValue({
        id: CREW_ID,
        name: 'Night Shift',
      }),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const users = { lookupByContact: jest.fn(), lookupByUserId: jest.fn() };
  const notifications = { send: jest.fn().mockResolvedValue({}) };
  const conversations = {
    openCrewConversation: jest.fn().mockResolvedValue({ id: 'conversation-1' }),
    syncCrewParticipant: jest.fn().mockResolvedValue(undefined),
    persistSystem: jest.fn().mockResolvedValue({ id: 'message-1' }),
    broadcastMessage: jest.fn().mockResolvedValue(undefined),
  };
  const collaboration = {
    addCrewMemberAccess: jest.fn().mockResolvedValue(undefined),
  };
  const agreements = {
    requireDispatchConfigured: jest.fn(),
    stageInvitationAgreement: jest.fn().mockResolvedValue(null),
  };
  const authorization = {
    require: jest.fn().mockResolvedValue({ memberId: 'member-owner' }),
  };
  return {
    authorization,
    tx,
    prisma,
    users,
    notifications,
    conversations,
    collaboration,
    agreements,
    service: new CrewInvitationsService(
      prisma as never,
      users as never,
      notifications as never,
      conversations as never,
      collaboration as never,
      agreements as never,
      authorization as never,
    ),
  };
}

describe('CrewInvitationsService', () => {
  it('validates bounded invitation list pagination', () => {
    expect(ListCrewInvitationsQuerySchema.parse({})).toEqual({ limit: 30 });
    expect(
      ListCrewInvitationsQuerySchema.parse({
        limit: '100',
        cursor: INVITATION_ID,
      }),
    ).toEqual({ limit: 100, cursor: INVITATION_ID });
    expect(
      ListCrewInvitationsQuerySchema.safeParse({ limit: 101 }).success,
    ).toBe(false);
    expect(
      CreateCrewInvitationSchema.parse({
        account: 'mina@example.com',
        policyKeys: [],
        agreement: {
          title: 'Storyboard agreement',
          signerName: 'Mina Chen',
          signerEmail: 'MINA@example.com',
        },
      }),
    ).toMatchObject({
      expiresInDays: 7,
      agreement: {
        title: 'Storyboard agreement',
        signerName: 'Mina Chen',
        signerEmail: 'MINA@example.com',
      },
    });
    expect(
      CreateCrewInvitationSchema.safeParse({
        account: 'mina@example.com',
        position: { categoryKey: 'storyboard' },
        policyKeys: [],
      }).success,
    ).toBe(false);
  });

  it('returns pending crew invitations as a stable page with an authoritative total', async () => {
    const t = build();
    const first = invitation({
      id: 'invitation-3',
      createdAt: new Date('2026-07-29T11:00:00.000Z'),
    });
    const second = invitation({
      id: 'invitation-2',
      createdAt: new Date('2026-07-29T10:00:00.000Z'),
    });
    const lookahead = invitation({
      id: 'invitation-1',
      createdAt: new Date('2026-07-29T09:00:00.000Z'),
    });
    t.prisma.crewInvitation.findMany.mockResolvedValue([
      first,
      second,
      lookahead,
    ]);
    t.prisma.crewInvitation.count.mockResolvedValue(7);

    const result = await t.service.listForCrew(CREW_ID, OWNER_ID, {
      limit: 2,
    });

    expect(result).toMatchObject({
      total: 7,
      nextCursor: 'invitation-2',
      items: [{ id: 'invitation-3' }, { id: 'invitation-2' }],
    });
    expect(t.prisma.crewInvitation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 3,
      }),
    );
  });

  it('rejects a crew invitation cursor outside the visible pending scope', async () => {
    const t = build();

    await expect(
      t.service.listForCrew(CREW_ID, OWNER_ID, {
        limit: 30,
        cursor: 'other-invitation',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'CREW_INVITATION_CURSOR_INVALID',
        message: expect.stringContaining('cursor is invalid') as unknown,
      }) as unknown,
    });
    expect(t.prisma.crewInvitation.findMany).not.toHaveBeenCalled();
  });

  it('accepts an invitation and grants collaboration plus group-chat access atomically', async () => {
    const t = build();

    await expect(t.service.accept(INVITATION_ID, INVITEE_ID)).resolves.toEqual({
      crewId: CREW_ID,
      memberId: 'crew-member-1',
      accepted: true,
      agreementId: null,
      agreementQueued: false,
      workspaceHref: `/crews/${CREW_ID}/workspace`,
    });

    const [createMemberInput] = t.tx.crewMember.create.mock
      .calls[0] as unknown as [
      {
        data: {
          id: string;
          crewId: string;
          userId: string;
          status: string;
          joinedVia: string;
        };
      },
    ];
    expect(createMemberInput.data).toMatchObject({
      crewId: CREW_ID,
      userId: INVITEE_ID,
      status: 'active',
      joinedVia: 'invitation',
    });
    expect(t.collaboration.addCrewMemberAccess).toHaveBeenCalledWith(
      CREW_ID,
      INVITEE_ID,
      OWNER_ID,
      t.tx,
    );
    expect(t.conversations.syncCrewParticipant).toHaveBeenCalledWith(
      CREW_ID,
      INVITEE_ID,
      'join',
      t.tx,
    );
    expect(t.conversations.persistSystem).toHaveBeenCalledWith(
      'conversation-1',
      'crew.member.joined',
      { userId: INVITEE_ID },
      t.tx,
    );
    expect(t.conversations.broadcastMessage).toHaveBeenCalledWith({
      id: 'message-1',
    });
  });

  it('persists and discloses an optional agreement on the invitation', async () => {
    const t = build();
    t.users.lookupByContact.mockResolvedValue({
      userId: INVITEE_ID,
      isCrewOwner: false,
      isCrewMember: false,
    });

    await expect(
      t.service.create(CREW_ID, OWNER_ID, 'viewer-cookie', {
        account: 'mina@example.com',
        policyKeys: [],
        expiresInDays: 7,
        agreement: {
          title: 'Storyboard agreement',
          signerName: 'Mina Chen',
          signerEmail: 'MINA@example.com',
        },
      }),
    ).resolves.toMatchObject({
      agreementRequest: {
        title: 'Storyboard agreement',
        signerName: 'Mina Chen',
        signerEmail: 'mina@example.com',
      },
    });
    expect(t.agreements.requireDispatchConfigured).toHaveBeenCalledTimes(1);
    expect(t.tx.crewInvitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agreementTitle: 'Storyboard agreement',
        agreementSignerName: 'Mina Chen',
        agreementSignerEmail: 'mina@example.com',
      }) as unknown,
    });
  });

  it('rejects an invitation opened by a different account before changing membership', async () => {
    const t = build();

    await expect(
      t.service.accept(INVITATION_ID, 'another-user'),
    ).rejects.toMatchObject({
      response: { message: 'This invitation belongs to another account.' },
    });
    expect(t.tx.crewMember.create).not.toHaveBeenCalled();
    expect(t.tx.crewInvitation.updateMany).not.toHaveBeenCalled();
    expect(t.collaboration.addCrewMemberAccess).not.toHaveBeenCalled();
  });

  it('queues the disclosed optional agreement only after membership is accepted', async () => {
    const t = build();
    t.tx.crewInvitation.findUnique.mockResolvedValue(
      invitation({
        agreementTitle: 'Storyboard agreement',
        agreementSignerName: 'Mina Chen',
        agreementSignerEmail: 'mina@example.com',
      }),
    );
    t.agreements.stageInvitationAgreement.mockResolvedValue({
      id: 'agreement-1',
    });

    await expect(t.service.accept(INVITATION_ID, INVITEE_ID)).resolves.toEqual(
      expect.objectContaining({
        accepted: true,
        agreementId: 'agreement-1',
        agreementQueued: true,
      }),
    );
    expect(t.agreements.stageInvitationAgreement).toHaveBeenCalledWith(
      expect.objectContaining({
        id: INVITATION_ID,
        agreementTitle: 'Storyboard agreement',
      }),
      t.tx,
    );
  });
});

it.each(['decline', 'revoke'] as const)(
  'rejects %s if another request already changed the invitation',
  async (action) => {
    const t = build();
    t.prisma.crewInvitation.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      t.service[action](
        INVITATION_ID,
        action === 'decline' ? INVITEE_ID : OWNER_ID,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(t.prisma.crewInvitation.update).not.toHaveBeenCalled();
    expect(t.prisma.crewInvitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: INVITATION_ID, status: CrewInvitationStatus.pending },
      }),
    );
  },
);

it('does not grant membership when acceptance loses the pending-state transition', async () => {
  const t = build();
  t.tx.crewInvitation.updateMany.mockResolvedValue({ count: 0 });
  await expect(
    t.service.accept(INVITATION_ID, INVITEE_ID),
  ).rejects.toMatchObject({ status: 409 });
  expect(t.tx.crewMember.create).not.toHaveBeenCalled();
  expect(t.tx.crewInvitation.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        id: INVITATION_ID,
        status: CrewInvitationStatus.pending,
        expiresAt: { gt: expect.any(Date) as unknown },
      },
    }),
  );

  expect(t.agreements.stageInvitationAgreement).not.toHaveBeenCalled();
  expect(t.notifications.send).not.toHaveBeenCalled();
});

it('does not expire an invitation that was accepted after the detail read', async () => {
  const t = build();
  const stale = invitation({ expiresAt: new Date(0) });
  const accepted = invitation({
    status: CrewInvitationStatus.accepted,
    expiresAt: new Date(0),
  });
  t.prisma.crewInvitation.findUnique
    .mockResolvedValueOnce(stale)
    .mockResolvedValueOnce(accepted);
  t.prisma.crewInvitation.updateMany.mockResolvedValue({ count: 0 });
  await expect(
    t.service.getMine(INVITATION_ID, INVITEE_ID),
  ).resolves.toMatchObject({ status: 'accepted' });
  expect(t.prisma.crewInvitation.update).not.toHaveBeenCalled();
  expect(t.prisma.crewInvitation.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        id: INVITATION_ID,
        status: CrewInvitationStatus.pending,
        expiresAt: { lte: expect.any(Date) as unknown },
      }) as unknown,
    }),
  );
});

describe('role-specific setup invitations', () => {
  it('validates the role and creates no membership before acceptance', async () => {
    const t = build();
    t.users.lookupByContact.mockResolvedValue({
      userId: INVITEE_ID,
      isCrewMember: false,
    });
    const input = CreateCrewInvitationSchema.parse({
      account: 'member@example.com',
      positionCategory: 'screenwriter',
    });
    const result = await t.service.create(CREW_ID, OWNER_ID, 'cookie', input);
    expect(result).toMatchObject({ positionCategory: 'screenwriter' });
    expect(t.tx.crewMember.create).not.toHaveBeenCalled();
    expect(t.tx.crewMemberPosition.create).not.toHaveBeenCalled();
    expect(
      CreateCrewInvitationSchema.safeParse({
        account: 'member@example.com',
        positionCategory: 'admin',
      }).success,
    ).toBe(false);
  });
  it('assigns the disclosed production role atomically on acceptance without granting policies', async () => {
    const t = build();
    t.tx.crewInvitation.findUnique.mockResolvedValue(
      invitation({ positionCategory: 'screenwriter' }),
    );
    t.prisma.crewInvitation.findUnique.mockResolvedValue(
      invitation({ positionCategory: 'screenwriter' }),
    );
    await t.service.accept(INVITATION_ID, INVITEE_ID);
    expect(t.tx.crewMemberPosition.create).toHaveBeenCalledWith({
      data: {
        crewId: CREW_ID,
        memberId: 'crew-member-1',
        categoryKey: 'screenwriter',
        isPrimary: true,
      },
    });
    expect(t.tx.crewMemberPolicy.createMany).not.toHaveBeenCalled();
  });
});

it('requires member-management permission before inviting someone for a production role', async () => {
  const t = build();
  t.authorization.require.mockImplementation((_crew, _actor, permission) => {
    if (permission === 'members.manage')
      throw new Error('Member management required');
    return Promise.resolve({ memberId: 'member-owner' });
  });
  await expect(
    t.service.create(
      CREW_ID,
      OWNER_ID,
      'cookie',
      CreateCrewInvitationSchema.parse({
        account: 'member@example.com',
        positionCategory: 'director',
      }),
    ),
  ).rejects.toThrow('Member management required');
  expect(t.users.lookupByContact).not.toHaveBeenCalled();
  expect(t.tx.crewInvitation.create).not.toHaveBeenCalled();
});

it('resolves explicit user IDs again when creating invitations and rejects existing members', async () => {
  const t = build();
  t.users.lookupByUserId.mockResolvedValue({
    userId: '273848',
    isCrewMember: true,
    isCrewOwner: false,
  });
  const input = CreateCrewInvitationSchema.parse({
    account: '273848',
    lookupBy: 'userId',
  });
  await expect(
    t.service.create(CREW_ID, OWNER_ID, 'viewer-cookie', input),
  ).rejects.toThrow('This user is already a crew member.');
  expect(t.users.lookupByUserId).toHaveBeenCalledWith(
    '273848',
    'viewer-cookie',
    CREW_ID,
  );
  expect(t.users.lookupByContact).not.toHaveBeenCalled();
  expect(
    CreateCrewInvitationSchema.safeParse({
      account: 'user@example.com',
      lookupBy: 'userId',
    }).success,
  ).toBe(false);
  expect(
    CreateCrewInvitationSchema.safeParse({ account: '1', lookupBy: 'userId' })
      .success,
  ).toBe(true);
});

it('creates an invitation for the explicitly resolved user ID', async () => {
  const t = build();
  t.users.lookupByUserId.mockResolvedValue({
    userId: '273848',
    isCrewMember: false,
    isCrewOwner: false,
  });
  await t.service.create(CREW_ID, OWNER_ID, 'viewer-cookie', {
    account: '273848',
    lookupBy: 'userId',
    policyKeys: [],
    expiresInDays: 7,
  });
  expect(t.tx.crewInvitation.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ inviteeUserId: '273848' }) as unknown,
    }),
  );
  expect(t.users.lookupByContact).not.toHaveBeenCalled();
  expect(t.tx.crewMember.create).not.toHaveBeenCalled();
});
