import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CREW_PERMISSION_KEYS } from '@repo/shared/crew';
import { CrewAuthorizationService } from './crew-authorization.service';

const CREW_ID = 'crew-1';
const USER_ID = 'user-1';
const MEMBER_ID = 'member-1';

interface AuthorizationMember {
  id: string;
  ownership: { crewId: string } | null;
  policies: Array<{ policyKey: string }>;
  permissionOverrides: Array<{
    permissionKey: string;
    effect: 'allow' | 'deny';
  }>;
}

function member(
  overrides: Partial<AuthorizationMember> = {},
): AuthorizationMember {
  return {
    id: MEMBER_ID,
    ownership: null,
    policies: [],
    permissionOverrides: [],
    ...overrides,
  };
}

function build(
  options: {
    crewExists?: boolean;
    activeMember?: AuthorizationMember | null;
    ownership?: {
      memberId: string;
      member: { userId: string; status: 'active' | 'suspended' | 'removed' };
    } | null;
  } = {},
) {
  const prisma = {
    crew: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          options.crewExists === false ? null : { id: CREW_ID },
        ),
    },
    crewMember: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          options.activeMember === undefined ? member() : options.activeMember,
        ),
    },
    crewOwnership: {
      findUnique: jest.fn().mockResolvedValue(options.ownership ?? null),
    },
  };
  return {
    prisma,
    service: new CrewAuthorizationService(prisma as never),
  };
}

describe('CrewAuthorizationService', () => {
  it('grants only the baseline to an active ordinary member', async () => {
    const { service, prisma } = build();

    await expect(service.resolve(CREW_ID, USER_ID)).resolves.toMatchObject({
      memberId: MEMBER_ID,
      isOwner: false,
      policyKeys: [],
      permissions: [
        'members.view',
        'tasks.view',
        'tasks.comment',
        'tasks.submit_assigned',
        'assets.view',
        'assets.upload',
        'agreements.view_own',
        'studio.view',
        'production.view',
        'production.deliver',
      ],
    });
    expect(prisma.crewMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { crewId: CREW_ID, userId: USER_ID, status: 'active' },
      }),
    );
  });

  it('composes admin and finance policies, then applies atomic overrides last', async () => {
    const { service } = build({
      activeMember: member({
        policies: [{ policyKey: 'admin' }, { policyKey: 'finance' }],
        permissionOverrides: [
          { permissionKey: 'assets.upload', effect: 'deny' },
          { permissionKey: 'finance.view', effect: 'deny' },
          { permissionKey: 'finance.settle', effect: 'allow' },
        ],
      }),
    });

    const context = await service.resolve(CREW_ID, USER_ID);

    expect(context?.policyKeys).toEqual(['admin', 'finance']);
    expect(context?.permissions).toEqual(
      expect.arrayContaining([
        'members.manage',
        'tasks.manage',
        'agreements.manage',
        'finance.settle',
      ]),
    );
    expect(context?.permissions).not.toContain('assets.upload');
    expect(context?.permissions).not.toContain('finance.view');
  });

  it('never delegates structural owner powers through an override', async () => {
    const { service } = build({
      activeMember: member({
        permissionOverrides: [
          { permissionKey: 'ownership.transfer', effect: 'allow' },
          { permissionKey: 'crew.delete', effect: 'allow' },
          { permissionKey: 'members.permissions.manage', effect: 'allow' },
        ],
      }),
    });

    const context = await service.resolve(CREW_ID, USER_ID);

    expect(context?.permissions).not.toContain('ownership.transfer');
    expect(context?.permissions).not.toContain('crew.delete');
    expect(context?.permissions).not.toContain('members.permissions.manage');
  });

  it('grants every registered permission to the owner and ignores deny overrides', async () => {
    const { service } = build({
      activeMember: member({
        ownership: { crewId: CREW_ID },
        permissionOverrides: [
          { permissionKey: 'crew.delete', effect: 'deny' },
          { permissionKey: 'assets.view', effect: 'deny' },
        ],
      }),
    });

    await expect(service.resolve(CREW_ID, USER_ID)).resolves.toMatchObject({
      isOwner: true,
      permissions: [...CREW_PERMISSION_KEYS],
    });
  });

  it('fails closed for inactive memberships and distinguishes a missing crew', async () => {
    const inactive = build({ activeMember: null });
    await expect(
      inactive.service.requireMembership(CREW_ID, USER_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const missingCrew = build({ crewExists: false });
    await expect(
      missingCrew.service.resolve(CREW_ID, USER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires the ownership target itself to remain an active member', async () => {
    const { service } = build({
      ownership: {
        memberId: MEMBER_ID,
        member: { userId: USER_ID, status: 'suspended' },
      },
    });

    await expect(service.owner(CREW_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
