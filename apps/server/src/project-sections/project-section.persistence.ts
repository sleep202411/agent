import {
  PlatformDocumentType,
  PlatformDocumentVersionSource,
  Prisma,
} from '@prisma/client';

export interface CreateProjectSectionWithCanvasInput {
  workspaceId: string;
  projectId: string;
  title: string;
  rank: number;
  actorId: string;
}

/**
 * The section and its canvas are one aggregate: neither may exist without the
 * other. Keep this helper transaction-only so project creation and later
 * section creation enforce the same invariant atomically.
 */
export async function createProjectSectionWithCanvas(
  tx: Prisma.TransactionClient,
  input: CreateProjectSectionWithCanvasInput,
) {
  const section = await tx.platformProjectSection.create({
    data: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      title: input.title,
      rank: input.rank,
      createdById: input.actorId,
    },
  });

  const document = await tx.platformDocument.create({
    data: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      sectionId: section.id,
      type: PlatformDocumentType.canvas,
      title: input.title,
      createdById: input.actorId,
    },
  });
  const version = await tx.platformDocumentVersion.create({
    data: {
      documentId: document.id,
      versionNumber: 1,
      schemaVersion: document.schemaVersion,
      sequence: 0,
      title: document.title,
      source: PlatformDocumentVersionSource.system,
      snapshot: document.contentSnapshot as Prisma.InputJsonValue,
      createdById: input.actorId,
      metadata: { reason: 'initial_section_canvas' },
    },
  });
  const canvas = await tx.platformDocument.update({
    where: { id: document.id },
    data: { currentVersionId: version.id },
  });

  return { section, canvas };
}
