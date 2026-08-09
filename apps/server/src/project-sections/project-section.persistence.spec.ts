/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { PlatformDocumentType } from '@prisma/client';
import { createProjectSectionWithCanvas } from './project-section.persistence';

describe('createProjectSectionWithCanvas', () => {
  it('creates the section, canvas, and initial version as one transaction aggregate', async () => {
    const section = { id: 'section-1' };
    const document = {
      id: 'document-1',
      schemaVersion: '2026-05-27',
      title: 'Chapter 2',
      contentSnapshot: {},
    };
    const tx = {
      platformProjectSection: {
        create: jest.fn().mockResolvedValue(section),
      },
      platformDocument: {
        create: jest.fn().mockResolvedValue(document),
        update: jest
          .fn()
          .mockResolvedValue({ ...document, currentVersionId: 'version-1' }),
      },
      platformDocumentVersion: {
        create: jest.fn().mockResolvedValue({ id: 'version-1' }),
      },
    };

    const result = await createProjectSectionWithCanvas(tx as never, {
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      title: 'Chapter 2',
      rank: 1,
      actorId: 'user-1',
    });

    expect(tx.platformDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'project-1',
        sectionId: 'section-1',
        type: PlatformDocumentType.canvas,
      }),
    });
    expect(tx.platformDocumentVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        documentId: 'document-1',
        metadata: { reason: 'initial_section_canvas' },
      }),
    });
    expect(tx.platformDocument.update).toHaveBeenCalledWith({
      where: { id: 'document-1' },
      data: { currentVersionId: 'version-1' },
    });
    expect(result.section).toBe(section);
  });
});
