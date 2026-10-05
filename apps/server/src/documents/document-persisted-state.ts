import { Prisma } from '@prisma/client';

/** Read under the document mutation lock. Compaction does not take that lock:
 * its base replacement and operation pruning must be observed in one SQL snapshot.
 */
export async function readDocumentCrdtState(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  documentId: string,
) {
  const [state] = await tx.$queryRaw<
    Array<{
      crdt_state: Uint8Array | null;
      content_snapshot: Prisma.JsonValue;
      snapshot_sequence: number;
      current_sequence: number;
      updates: string[] | null;
      unsupported_sequence: number | null;
    }>
  >(Prisma.sql`
    SELECT d.crdt_state, d.content_snapshot, d.snapshot_sequence, d.current_sequence,
      (SELECT jsonb_agg(encode(o.yjs_update, 'base64') ORDER BY o.sequence)
       FROM studio_document_operations o
       WHERE o.document_id = d.id AND o.sequence > d.snapshot_sequence
         AND o.sequence <= d.current_sequence AND o.yjs_update IS NOT NULL) AS updates,
      (SELECT min(o.sequence) FROM studio_document_operations o
       WHERE o.document_id = d.id AND o.sequence > d.snapshot_sequence
         AND o.sequence <= d.current_sequence
         AND (o.operation_type <> 'yjs_update' OR o.yjs_update IS NULL)) AS unsupported_sequence
    FROM studio_documents d WHERE d.id = ${documentId}::uuid
  `);
  if (!state) throw new Error('Document disappeared while reading saved state');
  return state;
}
