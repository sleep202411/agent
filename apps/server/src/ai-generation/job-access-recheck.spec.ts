import { ForbiddenException } from '@nestjs/common';
import { WorkspaceMemberRole } from '@prisma/client';
import { AiGenerationService } from './ai-generation.service';
import type { AuthUser } from '../auth';
import type { AiJob } from './types';

type AccessService = {
  cancelJob(user: AuthUser, id: string): Promise<unknown>;
  getAccessibleJob(
    user: AuthUser,
    id: string,
    role: WorkspaceMemberRole,
  ): Promise<AiJob>;
};

function fixture(scope: Partial<AiJob>, allowed: boolean) {
  const job = { id: 'job', userId: 'creator', ...scope } as AiJob;
  const permission = jest.fn(() =>
    allowed
      ? Promise.resolve()
      : Promise.reject(new ForbiddenException('Access revoked')),
  );
  const service = Object.assign(Object.create(AiGenerationService.prototype), {
    store: {
      findById: jest.fn().mockResolvedValue(job),
      cancelIfActive: jest.fn(),
    },
    workspacePermissions: {
      requireProjectRole: permission,
      requireWorkspaceRole: permission,
    },
    storyPermissions: { requireProject: permission },
  }) as AccessService;
  return { job, service, permission };
}

describe('generation job access after membership changes', () => {
  const scopes: Partial<AiJob>[] = [
    { projectId: 'project', workspaceId: 'workspace' },
    { storyProjectId: 'story', workspaceId: 'workspace' },
    { workspaceId: 'workspace' },
  ];
  it.each(scopes)(
    'denies the original submitter after scope access is revoked: %j',
    async (scope) => {
      const { service, permission } = fixture(scope, false);
      for (const role of [WorkspaceMemberRole.editor]) {
        await expect(
          service.getAccessibleJob(
            { userId: 'creator' } as AuthUser,
            'job',
            role,
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect(permission).toHaveBeenCalledTimes(1);
    },
  );
  it.each(scopes)(
    'preserves access for an authorized submitter: %j',
    async (scope) => {
      const { job, service, permission } = fixture(scope, true);
      await expect(
        service.getAccessibleJob(
          { userId: 'creator' } as AuthUser,
          'job',
          WorkspaceMemberRole.editor,
        ),
      ).resolves.toBe(job);
      expect(permission).toHaveBeenCalledTimes(1);
    },
  );
  it.each(scopes)(
    'rejects public cancellation before mutation after access revocation: %j',
    async (scope) => {
      const { service } = fixture(scope, false);
      await expect(
        service.cancelJob({ userId: 'creator' } as AuthUser, 'job'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      const store = (
        service as unknown as { store: { cancelIfActive: jest.Mock } }
      ).store;
      expect(store.cancelIfActive).not.toHaveBeenCalled();
    },
  );

  it.each(scopes)(
    'preserves the existing creator read-history contract: %j',
    async (scope) => {
      const { job, service, permission } = fixture(scope, false);
      await expect(
        service.getAccessibleJob(
          { userId: 'creator' } as AuthUser,
          'job',
          WorkspaceMemberRole.viewer,
        ),
      ).resolves.toBe(job);
      expect(permission).not.toHaveBeenCalled();
    },
  );

  it('retains creator access for legacy unscoped jobs but denies other users', async () => {
    const { job, service, permission } = fixture({}, false);
    await expect(
      service.getAccessibleJob(
        { userId: 'creator' } as AuthUser,
        'job',
        WorkspaceMemberRole.editor,
      ),
    ).resolves.toBe(job);
    await expect(
      service.getAccessibleJob(
        { userId: 'other' } as AuthUser,
        'job',
        WorkspaceMemberRole.editor,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(permission).not.toHaveBeenCalled();
  });
});
