import {
  StudioDocumentType,
  StudioDocumentVersionSource,
  Prisma,
} from '@prisma/client';
import { encodeDocumentSnapshot } from '../documents/document-crdt';
import { rootSchemaFor } from '../documents/document-modes';

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
  const initialState = encodeDocumentSnapshot(
    {},
    rootSchemaFor(StudioDocumentType.canvas)!,
  );
  const section = await tx.platformProjectSection.create({
    data: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      title: input.title,
      rank: input.rank,
      createdById: input.actorId,
    },
  });

  const document = await tx.studioDocument.create({
    data: {
      workspaceId: input.workspaceId,
      platformProjectId: input.projectId,
      sectionId: section.id,
      type: StudioDocumentType.canvas,
      title: input.title,
      contentSnapshot:
        initialState.snapshot as unknown as Prisma.InputJsonValue,
      crdtState: Buffer.from(initialState.state),
      createdById: input.actorId,
    },
  });
  const version = await tx.studioDocumentVersion.create({
    data: {
      documentId: document.id,
      versionNumber: 1,
      schemaVersion: document.schemaVersion,
      sequence: 0,
      title: document.title,
      source: StudioDocumentVersionSource.system,
      snapshot: document.contentSnapshot as Prisma.InputJsonValue,
      crdtState: document.crdtState,
      createdById: input.actorId,
      metadata: { reason: 'initial_section_canvas' },
    },
  });
  const canvas = await tx.studioDocument.update({
    where: { id: document.id },
    data: { currentVersionId: version.id },
  });

  return { section, canvas };
}
