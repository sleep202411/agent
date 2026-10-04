import { Prisma, StudioDocumentType } from '@prisma/client';
import { DocumentStateBuilder } from '../../documents/document-crdt';
import { rootSchemaFor } from '../../documents/document-modes';

/**
 * Project covers, document JSON and generation inputs lack MediaAsset foreign keys.
 * Job input retention cannot rely on the separately written usage ledger.
 * Include recoverable versions and operation snapshots, even for archived or
 * soft-deleted documents. Removing a Crew library entry must not break them.
 * Pending CRDT updates are materialized against their base from one database
 * snapshot, so concurrent compaction cannot make us miss a pruned update.
 */
export async function savedProjectMediaReferences(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  mediaAssetIds: readonly string[],
): Promise<Set<string>> {
  // PostgreSQL UUID keys are case-insensitive; imported JSON/Yjs strings may
  // retain uppercase characters. Apply the same identity rule to those strings.
  const ids = [...new Set(mediaAssetIds)];
  if (ids.length === 0) return new Set();
  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT candidate.id
    FROM unnest(ARRAY[${Prisma.join(ids)}]::text[]) AS candidate(id)
    WHERE EXISTS (
      SELECT 1 FROM platform_projects p WHERE p.cover_asset_id = candidate.id::uuid
    ) OR EXISTS (
      SELECT 1 FROM ai_jobs j
      WHERE strpos(lower(j.reference_snapshot::text), lower(candidate.id)) > 0
         OR strpos(lower(j.input::text), lower(candidate.id)) > 0
         OR strpos(lower(j.normalized_input::text), lower(candidate.id)) > 0
    ) OR EXISTS (
      SELECT 1 FROM studio_documents d
      WHERE strpos(lower(d.content_snapshot::text), lower(candidate.id)) > 0
    ) OR EXISTS (
      SELECT 1 FROM studio_document_versions v
      WHERE strpos(lower(v.snapshot::text), lower(candidate.id)) > 0
    ) OR EXISTS (
      SELECT 1 FROM studio_document_operations o
      WHERE strpos(lower(o.snapshot::text), lower(candidate.id)) > 0
         OR strpos(lower(o.patch::text), lower(candidate.id)) > 0
    )
  `);
  const referenced = new Set(rows.map((row) => row.id));
  if (referenced.size === ids.length) return referenced;

  // Read bounded pages rather than one round trip per document or unbounded histories.
  // Each statement reads the base and tail together: independent reads can race
  // with compaction, which advances the base and prunes superseded operations.
  let cursor = '00000000-0000-0000-0000-000000000000';
  while (referenced.size < ids.length) {
    const documents = await db.$queryRaw<
      Array<{
        id: string;
        type: StudioDocumentType;
        crdt_state: Uint8Array | null;
        snapshot_text: string;
        updates: string[] | null;
      }>
    >(Prisma.sql`
      SELECT d.id, d.type, d.crdt_state, d.content_snapshot::text AS snapshot_text,
        (SELECT jsonb_agg(encode(o.yjs_update, 'base64') ORDER BY o.sequence)
         FROM studio_document_operations o
         WHERE o.document_id = d.id AND o.sequence > d.snapshot_sequence
           AND o.sequence <= d.current_sequence AND o.yjs_update IS NOT NULL) AS updates
      FROM studio_documents d
      WHERE d.id > ${cursor}::uuid
        AND (d.crdt_state IS NOT NULL OR EXISTS (
          SELECT 1 FROM unnest(ARRAY[${Prisma.join(ids)}]::text[]) AS candidate(id)
          WHERE strpos(lower(d.content_snapshot::text), lower(candidate.id)) > 0
        ) OR EXISTS (
          SELECT 1 FROM studio_document_operations o
          WHERE o.document_id = d.id AND o.sequence > d.snapshot_sequence
            AND o.sequence <= d.current_sequence AND o.yjs_update IS NOT NULL
        ))
      ORDER BY d.id LIMIT 64
    `);
    if (!documents.length) break;
    for (const document of documents) {
      cursor = document.id;
      for (const id of ids) {
        if (document.snapshot_text.toLowerCase().includes(id.toLowerCase()))
          referenced.add(id);
      }
      if (referenced.size === ids.length) break;
      if (!document.crdt_state && !document.updates?.length) continue;
      const schema = rootSchemaFor(document.type);
      if (!schema)
        throw new Error(
          'Cannot verify media references in an unsupported CRDT document',
        );
      const builder = new DocumentStateBuilder(document.crdt_state, schema);
      try {
        for (const update of document.updates ?? [])
          builder.apply(Buffer.from(update, 'base64'));
        const snapshot = JSON.stringify(
          builder.retainedContent(),
        ).toLowerCase();
        for (const id of ids)
          if (snapshot.includes(id.toLowerCase())) referenced.add(id);
      } finally {
        builder.destroy();
      }
    }
  }
  // Saved versions can carry a binary restore state even when their JSON
  // snapshot is empty or stale. Historical media must remain restorable.
  cursor = '00000000-0000-0000-0000-000000000000';
  while (referenced.size < ids.length) {
    const versions = await db.$queryRaw<
      Array<{ id: string; type: StudioDocumentType; crdt_state: Uint8Array }>
    >(Prisma.sql`
      SELECT v.id, d.type, v.crdt_state FROM studio_document_versions v
      JOIN studio_documents d ON d.id = v.document_id
      WHERE v.id > ${cursor}::uuid AND v.crdt_state IS NOT NULL
      ORDER BY v.id LIMIT 64
    `);
    if (!versions.length) break;
    for (const version of versions) {
      cursor = version.id;
      const schema = rootSchemaFor(version.type);
      if (!schema)
        throw new Error(
          'Cannot verify media references in an unsupported saved CRDT version',
        );
      const builder = new DocumentStateBuilder(version.crdt_state, schema);
      try {
        const snapshot = JSON.stringify(
          builder.retainedContent(),
        ).toLowerCase();
        for (const id of ids)
          if (snapshot.includes(id.toLowerCase())) referenced.add(id);
      } finally {
        builder.destroy();
      }
    }
  }
  return referenced;
}
