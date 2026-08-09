import { InternalServerErrorException } from '@nestjs/common';
import { ProjectSectionsService } from './project-sections.service';

const project = {
  id: 'project-1',
  workspaceId: 'workspace-1',
  version: 4,
};

function section(documents: unknown[]) {
  return {
    id: 'section-1',
    projectId: project.id,
    title: 'Chapter 1',
    rank: 0,
    version: 2,
    createdAt: new Date('2026-08-09T10:00:00Z'),
    updatedAt: new Date('2026-08-09T10:05:00Z'),
    documents,
  };
}

function makeService(documents: unknown[]) {
  const prisma = {
    platformProjectSection: {
      findMany: jest.fn().mockResolvedValue([section(documents)]),
    },
  };
  const permissions = {
    requireProjectRole: jest.fn().mockResolvedValue(project),
  };
  return new ProjectSectionsService(
    prisma as never,
    permissions as never,
    {} as never,
  );
}

describe('ProjectSectionsService.list', () => {
  it('returns the authoritative canvas id with the project structure version', async () => {
    const service = makeService([{ id: 'canvas-1' }]);
    await expect(
      service.list({ userId: 'user-1' }, project.id),
    ).resolves.toEqual({
      projectVersion: 4,
      sections: [
        expect.objectContaining({
          id: 'section-1',
          canvasDocumentId: 'canvas-1',
          version: 2,
        }),
      ],
    });
  });

  it('fails loud when a section does not own exactly one active canvas', async () => {
    const service = makeService([]);
    await expect(
      service.list({ userId: 'user-1' }, project.id),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
