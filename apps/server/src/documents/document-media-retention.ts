import { BadRequestException } from '@nestjs/common';
import { Prisma, type StudioDocument } from '@prisma/client';
import { lockMediaAssetReferences } from '../media/media-asset-lifecycle-lock';
import { DocumentStateBuilder } from './document-crdt';
import { rootSchemaFor } from './document-modes';
import type { AppendDocumentOperationInput } from './dto';
import { readDocumentCrdtState } from './document-persisted-state';

function idsIn(value: unknown): Set<string> {
  // Document IDs and node IDs share the UUID format. Resolve candidates against
  // media_assets below; never treat every UUID in an arbitrary document as media.
  return new Set(
    (JSON.stringify(value) ?? '')
      .match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)
      ?.map((id) => id.toLowerCase()) ?? [],
  );
}

export async function protectNewDocumentMedia(
  tx: Prisma.TransactionClient,
  before: unknown,
  after: unknown,
): Promise<void> {
  const previous = idsIn(before);
  const introduced = [...idsIn(after)].filter((id) => !previous.has(id)).sort();
  if (!introduced.length) return;
  await lockMediaAssetReferences(tx, introduced);
  const retired = await tx.mediaAsset.count({
    where: {
      id: { in: introduced },
      OR: [{ deletedAt: { not: null } }, { status: 'deleted' }],
    },
  });
  if (retired)
    throw new BadRequestException({
      code: 'DOCUMENT_MEDIA_UNAVAILABLE',
      msg: 'A newly added media file was deleted. Remove or replace it before saving.',
    });
}

/** Called under the document operation lock, before saving the new operation. */
export async function protectDocumentOperationMedia(
  tx: Prisma.TransactionClient,
  document: StudioDocument,
  input: AppendDocumentOperationInput,
): Promise<void> {
  if (input.operationType !== 'yjs_update') {
    await protectNewDocumentMedia(tx, document.contentSnapshot, [
      input.patch,
      input.snapshot,
      input.materializedContent,
    ]);
    return;
  }
  const schema = rootSchemaFor(document.type);
  if (!schema || !input.yjsUpdateBase64)
    throw new BadRequestException({
      code: 'DOCUMENT_CRDT_UPDATE_INVALID',
      msg: 'This document cannot accept a collaborative update.',
    });
  const state = await readDocumentCrdtState(tx, document.id);
  const builder = new DocumentStateBuilder(state.crdt_state, schema);
  try {
    for (const update of state.updates ?? [])
      builder.apply(Buffer.from(update, 'base64'));
    const before = builder.retainedContent();
    builder.apply(Buffer.from(input.yjsUpdateBase64, 'base64'));
    await protectNewDocumentMedia(tx, before, builder.retainedContent());
  } finally {
    builder.destroy();
  }
}

export function documentBinaryMediaSnapshot(
  type: StudioDocument['type'],
  state: Uint8Array | null,
): unknown {
  if (!state) return {};
  const schema = rootSchemaFor(type);
  if (!schema)
    throw new BadRequestException({
      code: 'DOCUMENT_CRDT_STATE_INVALID',
      msg: 'This document cannot use a collaborative restore state.',
    });
  let builder: DocumentStateBuilder | undefined;
  try {
    builder = new DocumentStateBuilder(state, schema);
    return builder.retainedContent();
  } catch {
    throw new BadRequestException({
      code: 'DOCUMENT_CRDT_STATE_INVALID',
      msg: 'The collaborative restore state is invalid.',
    });
  } finally {
    builder?.destroy();
  }
}
