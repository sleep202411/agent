import { NotFoundException } from '@nestjs/common';

import { AgentPlatformAuthorizationService } from './agent-platform-authorization.service';

const USER = Object.freeze({ userId: '42' });
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';

function fixture() {
  const storyPermissions = {
    requireProject: jest.fn().mockResolvedValue({
      project: { workspaceId: WORKSPACE_ID },
      role: 'owner',
      capabilities: ['story.read', 'story.edit', 'story.generate'],
    }),
  };
  const crewRoles = {
    require: jest.fn().mockResolvedValue('member'),
  };
  return {
    storyPermissions,
    crewRoles,
    service: new AgentPlatformAuthorizationService(
      storyPermissions as never,
      crewRoles as never,
    ),
  };
}

describe('AgentPlatformAuthorizationService', () => {
  it('derives Story Agent permissions from authoritative project access', async () => {
    const { service, storyPermissions } = fixture();

    const context = await service.authorize(USER, {
      schemaVersion: 'agent-conversation-resolve/v1',
      surface: 'story-studio',
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      locale: 'en-US',
    });

    expect(storyPermissions.requireProject).toHaveBeenCalledWith(
      USER.userId,
      PROJECT_ID,
      'story.read',
    );
    expect(context).toMatchObject({
      actorId: USER.userId,
      surface: 'story-studio',
      scope: {
        kind: 'story-project',
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
      },
      roles: ['story.owner'],
      permissions: ['story.read', 'story.write'],
    });
  });

  it('does not grant write permission to a read-only Story member', async () => {
    const { service, storyPermissions } = fixture();
    storyPermissions.requireProject.mockResolvedValue({
      project: { workspaceId: WORKSPACE_ID },
      role: 'viewer',
      capabilities: ['story.read'],
    });

    const context = await service.authorize(USER, {
      schemaVersion: 'agent-conversation-resolve/v1',
      surface: 'story-studio',
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      locale: 'en-US',
    });

    expect(context.permissions).toEqual(['story.read']);
  });

  it('conceals a Story project when the caller supplies the wrong workspace', async () => {
    const { service } = fixture();

    await expect(
      service.authorize(USER, {
        schemaVersion: 'agent-conversation-resolve/v1',
        surface: 'story-studio',
        workspaceId: '0197f4a2-0800-7000-8000-000000000009',
        projectId: PROJECT_ID,
        locale: 'en-US',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to sign a Crew context while the Crew module is being refactored', async () => {
    const { service, crewRoles } = fixture();

    await expect(
      service.authorize(USER, {
        schemaVersion: 'agent-conversation-resolve/v1',
        surface: 'crew-management',
        crewId: 'crew-7',
        locale: 'en-US',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    // Refused before any authority is consulted: the surface is unavailable,
    // not merely unauthorised for this caller.
    expect(crewRoles.require).not.toHaveBeenCalled();
  });

  // Re-enable together with the guard in the service — the Crew capability pack
  // and the resolution below are intact and still type-checked, they are only
  // waiting on the Crew module's refactor.
  describe.skip('once the Crew Agent surface is enabled', () => {
    it.each([
      ['member', ['crew.read']],
      ['finance', ['crew.read', 'crew.finance']],
      ['admin', ['crew.read', 'crew.manage', 'crew.finance']],
    ] as const)(
      'maps the authoritative %s Crew role to least-privilege permissions',
      async (role, permissions) => {
        const { service, crewRoles } = fixture();
        crewRoles.require.mockResolvedValue(role);

        const context = await service.authorize(USER, {
          schemaVersion: 'agent-conversation-resolve/v1',
          surface: 'crew-management',
          crewId: 'crew-7',
          locale: 'en-US',
        });

        expect(crewRoles.require).toHaveBeenCalledWith('crew-7', '42', [
          'admin',
          'finance',
          'member',
        ]);
        expect(context).toMatchObject({
          scope: { kind: 'crew', crewId: 'crew-7' },
          roles: [`crew.${role}`],
          permissions,
        });
        expect(context.scope).not.toHaveProperty('workspaceId');
      },
    );
  });
});
