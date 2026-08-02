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
  return {
    storyPermissions,
    service: new AgentPlatformAuthorizationService(storyPermissions as never),
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
    const { service } = fixture();

    await expect(
      service.authorize(USER, {
        schemaVersion: 'agent-conversation-resolve/v1',
        surface: 'crew-management',
        crewId: 'crew-7',
        locale: 'en-US',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
