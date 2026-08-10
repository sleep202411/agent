import { NotFoundException } from '@nestjs/common';
import { ProjectMemberRole } from '@prisma/client';
import { StudioDocumentAccessService } from './studio-document-access.service';

function createHarness() {
  const prisma = {
    studioDocument: { findFirst: jest.fn() },
  };
  const workspacePermissions = {
    requireProjectRole: jest.fn(),
  };
  const storyPermissions = {
    requireProject: jest.fn(),
  };
  const service = new StudioDocumentAccessService(
    prisma as never,
    workspacePermissions as never,
    storyPermissions as never,
  );
  return { prisma, service, storyPermissions, workspacePermissions };
}

describe('StudioDocumentAccessService', () => {
  it('authorizes a Platform document through Platform project membership', async () => {
    const harness = createHarness();
    const document = {
      id: 'document-1',
      platformProjectId: 'platform-project-1',
      storyProjectId: null,
    };
    harness.prisma.studioDocument.findFirst.mockResolvedValue(document);

    await expect(
      harness.service.requireDocument('user-1', document.id, 'read'),
    ).resolves.toBe(document);
    expect(
      harness.workspacePermissions.requireProjectRole,
    ).toHaveBeenCalledWith(
      'user-1',
      'platform-project-1',
      ProjectMemberRole.viewer,
    );
    expect(harness.storyPermissions.requireProject).not.toHaveBeenCalled();
  });

  it.each([
    ['read', 'story.read'],
    ['comment', 'story.review'],
    ['edit', 'story.edit'],
    ['generate', 'story.generate'],
  ] as const)('maps Story %s access to %s', async (action, capability) => {
    const harness = createHarness();
    const document = {
      id: 'document-2',
      platformProjectId: null,
      storyProjectId: 'story-project-1',
    };
    harness.prisma.studioDocument.findFirst.mockResolvedValue(document);

    await expect(
      harness.service.requireDocument('user-2', document.id, action),
    ).resolves.toBe(document);
    expect(harness.storyPermissions.requireProject).toHaveBeenCalledWith(
      'user-2',
      'story-project-1',
      capability,
    );
    expect(
      harness.workspacePermissions.requireProjectRole,
    ).not.toHaveBeenCalled();
  });

  it('fails closed when a corrupted document has no owner', async () => {
    const harness = createHarness();
    harness.prisma.studioDocument.findFirst.mockResolvedValue({
      id: 'document-3',
      platformProjectId: null,
      storyProjectId: null,
    });

    await expect(
      harness.service.requireDocument('user-3', 'document-3', 'read'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      harness.workspacePermissions.requireProjectRole,
    ).not.toHaveBeenCalled();
    expect(harness.storyPermissions.requireProject).not.toHaveBeenCalled();
  });
});
