import {
  ProjectMemberRole,
  ProjectMemberStatus,
  WorkspaceMemberRole,
  WorkspaceMemberStatus,
} from '@prisma/client';
import { CrewCollaborationService } from './crew-collaboration.service';

const CREW_ID = 'crew-1';
const WORKSPACE_ID = '00000000-0000-7000-8000-000000000001';
const PRODUCTION_PROJECT_ID = '00000000-0000-7000-8000-000000000002';
const OUTGOING = 'user-outgoing';
const INCOMING = 'user-incoming';

function build(opts: {
  workspaceId?: string | null;
  productionProjectId?: string | null;
  incomingWorkspaceMember?: Record<string, unknown> | null;
  incomingProjectMember?: Record<string, unknown> | null;
}) {
  const db = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    crew: {
      findUnique: jest.fn().mockResolvedValue({
        workspaceId:
          opts.workspaceId === undefined ? WORKSPACE_ID : opts.workspaceId,
        productionProjectId:
          opts.productionProjectId === undefined
            ? PRODUCTION_PROJECT_ID
            : opts.productionProjectId,
      }),
    },
    workspace: { update: jest.fn().mockResolvedValue({}) },
    workspaceMember: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.incomingWorkspaceMember ?? null),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
    projectMember: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.incomingProjectMember ?? null),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
    crewAssetGrant: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const service = new CrewCollaborationService(
    {} as never,
    { ensureDefaultAccounts: jest.fn() } as never,
    {} as never,
  );
  return { db, service };
}

describe('CrewCollaborationService.transferCrewOwnershipAccess', () => {
  it('is a no-op before the crew collaboration workspace is provisioned', async () => {
    const t = build({ workspaceId: null });

    await t.service.transferCrewOwnershipAccess(
      CREW_ID,
      OUTGOING,
      INCOMING,
      false,
      t.db as never,
    );

    expect(t.db.workspace.update).not.toHaveBeenCalled();
    expect(t.db.workspaceMember.updateMany).not.toHaveBeenCalled();
    expect(t.db.projectMember.updateMany).not.toHaveBeenCalled();
  });

  it('moves workspace and production ownership while retaining the old owner as a viewer', async () => {
    const t = build({
      incomingWorkspaceMember: {
        id: 'workspace-member-incoming',
        role: WorkspaceMemberRole.viewer,
        status: WorkspaceMemberStatus.active,
      },
      incomingProjectMember: {
        id: 'project-member-incoming',
        role: ProjectMemberRole.editor,
        status: ProjectMemberStatus.active,
      },
    });

    await t.service.transferCrewOwnershipAccess(
      CREW_ID,
      OUTGOING,
      INCOMING,
      false,
      t.db as never,
    );

    expect(t.db.workspace.update).toHaveBeenCalledWith({
      where: { id: WORKSPACE_ID },
      data: {
        ownerUserId: INCOMING,
        version: { increment: 1 },
      },
    });
    expect(t.db.workspaceMember.updateMany).toHaveBeenCalledWith({
      where: {
        workspaceId: WORKSPACE_ID,
        userId: OUTGOING,
        removedAt: null,
      },
      data: {
        role: WorkspaceMemberRole.viewer,
        status: WorkspaceMemberStatus.active,
      },
    });
    expect(t.db.workspaceMember.update).toHaveBeenCalledWith({
      where: { id: 'workspace-member-incoming' },
      data: {
        role: WorkspaceMemberRole.owner,
        status: WorkspaceMemberStatus.active,
      },
    });
    expect(t.db.projectMember.updateMany).toHaveBeenCalledWith({
      where: {
        projectId: PRODUCTION_PROJECT_ID,
        userId: OUTGOING,
        removedAt: null,
        role: ProjectMemberRole.owner,
      },
      data: {
        role: ProjectMemberRole.viewer,
        status: ProjectMemberStatus.active,
      },
    });
    expect(t.db.projectMember.update).toHaveBeenCalledWith({
      where: { id: 'project-member-incoming' },
      data: {
        role: ProjectMemberRole.owner,
        status: ProjectMemberStatus.active,
      },
    });
  });

  it('revokes every direct project grant when the outgoing owner leaves', async () => {
    const t = build({
      incomingWorkspaceMember: null,
      incomingProjectMember: null,
    });

    await t.service.transferCrewOwnershipAccess(
      CREW_ID,
      OUTGOING,
      INCOMING,
      true,
      t.db as never,
    );

    expect(t.db.workspaceMember.updateMany).toHaveBeenCalledWith({
      where: {
        workspaceId: WORKSPACE_ID,
        userId: OUTGOING,
        removedAt: null,
      },
      data: {
        role: WorkspaceMemberRole.viewer,
        status: WorkspaceMemberStatus.removed,
        removedAt: expect.any(Date) as unknown,
      },
    });
    expect(t.db.projectMember.updateMany).toHaveBeenCalledWith({
      where: {
        userId: OUTGOING,
        removedAt: null,
        project: { workspaceId: WORKSPACE_ID },
      },
      data: {
        status: ProjectMemberStatus.removed,
        removedAt: expect.any(Date) as unknown,
      },
    });
    expect(t.db.crewAssetGrant.deleteMany).toHaveBeenCalledWith({
      where: { userId: OUTGOING, node: { crewId: CREW_ID } },
    });
    expect(t.db.workspaceMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        userId: INCOMING,
        role: WorkspaceMemberRole.owner,
        status: WorkspaceMemberStatus.active,
      }) as unknown,
    });
    expect(t.db.projectMember.create).toHaveBeenCalledWith({
      data: {
        projectId: PRODUCTION_PROJECT_ID,
        userId: INCOMING,
        role: ProjectMemberRole.owner,
        status: ProjectMemberStatus.active,
        grantedById: INCOMING,
      },
    });
  });
});

describe('CrewCollaborationService.removeCrewMemberAccess', () => {
  it('revokes explicit asset grants even before workspace provisioning', async () => {
    const t = build({ workspaceId: null });

    await t.service.removeCrewMemberAccess(CREW_ID, OUTGOING, t.db as never);

    expect(t.db.crewAssetGrant.deleteMany).toHaveBeenCalledWith({
      where: { userId: OUTGOING, node: { crewId: CREW_ID } },
    });
    expect(t.db.workspaceMember.updateMany).not.toHaveBeenCalled();
  });
});

describe('explicit compute workspace setup', () => {
  it('rechecks ownership inside the transaction before provisioning', async () => {
    const tx = { $executeRaw: jest.fn(), $queryRaw: jest.fn() };
    const prisma = { $transaction: (fn: (tx: unknown) => unknown) => fn(tx) };
    const wallets = { ensureDefaultAccounts: jest.fn() };
    const authorization = {
      resolve: jest.fn().mockResolvedValue({ isOwner: false }),
    };
    const service = new CrewCollaborationService(
      prisma as never,
      wallets as never,
      authorization as never,
    );
    const provision = jest.spyOn(service, 'ensureCrewSpaceTx');
    await expect(
      service.ensureCrewSpace('crew', 'former-owner'),
    ).rejects.toThrow('Only the project owner');
    expect(provision).not.toHaveBeenCalled();
    expect(wallets.ensureDefaultAccounts).not.toHaveBeenCalled();
  });
});
