import { Logger } from '@nestjs/common';
import { CrewStudioRevocationService } from './crew-studio-revocation.service';

function fixture() {
  const prisma = {
    crewMember: {
      findMany: jest.fn().mockResolvedValue([{ userId: 'member' }]),
    },
    storyProject: { findMany: jest.fn().mockResolvedValue([{ id: 'story' }]) },
    studioDocument: {
      findMany: jest.fn().mockResolvedValue([{ id: 'document' }]),
    },
  };
  const realtime = {
    revokeWorkspaceAccess: jest.fn().mockResolvedValue(undefined),
    revokeStoryProjectAccess: jest.fn().mockResolvedValue(undefined),
  };
  const documents = {
    revokeUserFromDocuments: jest.fn().mockResolvedValue(undefined),
  };
  return {
    prisma,
    realtime,
    documents,
    service: new CrewStudioRevocationService(
      prisma as never,
      realtime as never,
      documents as never,
    ),
  };
}

it('targets the removed member across workspace, Story and document channels', async () => {
  const f = fixture();
  await f.service.revoke('crew', 'workspace', 'removed-member');
  expect(f.prisma.crewMember.findMany).not.toHaveBeenCalled();
  expect(f.realtime.revokeWorkspaceAccess).toHaveBeenCalledWith(
    'workspace',
    'removed-member',
  );
  expect(f.realtime.revokeStoryProjectAccess).toHaveBeenCalledWith(
    'story',
    'removed-member',
  );
  expect(f.documents.revokeUserFromDocuments).toHaveBeenCalledWith(
    ['document'],
    'removed-member',
  );
});

it('includes the roster history after unlinking to cover concurrent removal', async () => {
  const f = fixture();
  await f.service.revoke('crew', 'old-workspace');
  expect(f.prisma.crewMember.findMany).toHaveBeenCalledWith({
    where: { crewId: 'crew' },
    select: { userId: true },
  });
  expect(f.realtime.revokeWorkspaceAccess).toHaveBeenCalledWith(
    'old-workspace',
    'member',
  );
});

it('does not turn a committed change into a failed write when fan-out fails', async () => {
  const f = fixture();
  const warn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => {});
  f.realtime.revokeWorkspaceAccess.mockRejectedValue(
    new Error('Redis unavailable'),
  );
  try {
    await expect(
      f.service.revoke('crew', 'workspace', 'member'),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
});
