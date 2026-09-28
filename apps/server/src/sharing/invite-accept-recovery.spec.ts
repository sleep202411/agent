import { ForbiddenException } from '@nestjs/common';
import { ProjectInvitesService } from './project-invites.service';
import { WorkspaceInvitesService } from './workspace-invites.service';
import { StoryProjectInvitesService } from '../story-studio/story-project-invites.service';

const user = { userId: 'recipient' } as never;
const invite = {
  id: 'invite',
  workspaceId: 'workspace',
  projectId: 'project',
  storyProjectId: 'story',
  status: 'pending',
  role: 'viewer',
  expiresAt: new Date('2099-01-01'),
} as never;
const conflict = { code: 'P2002', meta: { target: ['unrelated_unique_key'] } };
function fixture(scope: 'workspace' | 'project' | 'story') {
  const target = {
    id: scope,
    name: 'Fixture',
    title: 'Fixture',
    workspaceId: 'workspace',
  };
  const prisma = {
    workspace: { findFirst: jest.fn().mockResolvedValue(target) },
    platformProject: { findFirst: jest.fn().mockResolvedValue(target) },
    storyProject: { findFirst: jest.fn().mockResolvedValue(target) },
    workspaceInvite: { findUnique: jest.fn().mockResolvedValue(invite) },
    projectInvite: { findUnique: jest.fn().mockResolvedValue(invite) },
    storyProjectInvite: { findUnique: jest.fn().mockResolvedValue(invite) },
    $transaction: jest.fn().mockRejectedValue(conflict),
  };
  const readAccess = jest
    .fn()
    .mockRejectedValue(new ForbiddenException('No access'));
  const permissions = {
    requireWorkspaceRole: readAccess,
    requireProjectRole: readAccess,
    requireProject: readAccess,
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service =
    scope === 'workspace'
      ? new WorkspaceInvitesService(
          prisma as never,
          permissions as never,
          audit as never,
          {} as never,
        )
      : scope === 'project'
        ? new ProjectInvitesService(
            prisma as never,
            permissions as never,
            audit as never,
            {} as never,
          )
        : new StoryProjectInvitesService(
            prisma as never,
            permissions as never,
            audit as never,
            {} as never,
            {} as never,
          );
  return { service, readAccess, audit, prisma };
}
describe.each(['workspace', 'project', 'story'] as const)(
  '%s invitation conflict recovery',
  (scope) => {
    it('does not report a rolled-back join as successful without current access', async () => {
      const { service, audit } = fixture(scope);
      await expect(service.accept(invite, user)).rejects.toBe(conflict);
      expect(audit.record).not.toHaveBeenCalled();
    });
    it('retains idempotent success when a concurrent join established access', async () => {
      const { service, readAccess, audit } = fixture(scope);
      readAccess.mockResolvedValue({});
      await expect(service.accept(invite, user)).resolves.toMatchObject({
        workspaceId: 'workspace',
      });
      expect(readAccess).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          after: expect.objectContaining({ created: false }) as unknown,
        }),
      );
    });
    it('propagates failed access verification rather than reporting success', async () => {
      const { service, readAccess, audit } = fixture(scope);
      readAccess.mockRejectedValue(new Error('database unavailable'));
      await expect(service.accept(invite, user)).rejects.toThrow(
        'database unavailable',
      );
      expect(audit.record).not.toHaveBeenCalled();
    });
  },
);
