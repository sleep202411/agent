import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import pg from 'pg';

const socket = process.env.FD_KNOWLEDGE_TEST_SOCKET;
test('knowledge migration repairs missing-column reads and preserves published sources', {
  skip: !socket,
}, async () => {
  assert.ok(socket.startsWith('/private/tmp/fizz-knowledge-pg-'), 'Use an isolated local test database');
  const client = new pg.Client({ host: socket, port: 55499, database: 'postgres' });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE ips (id UUID PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, deleted_at TIMESTAMPTZ)');
    const id = 'a0000000-0000-4000-8000-000000000001';
    await client.query('INSERT INTO ips(id) VALUES ($1)', [id]);
    const read = () => client.query('SELECT audience_documents, version FROM ips WHERE id = $1::uuid AND deleted_at IS NULL', [id]);
    await client.query('SAVEPOINT before_read');
    await assert.rejects(read(), { code: '42703' });
    await client.query('ROLLBACK TO SAVEPOINT before_read');
    const migration = readFileSync(new URL('../prisma/migrations/20261011000000_ip_audience_documents/migration.sql', import.meta.url), 'utf8');
    await client.query(migration);
    assert.deepEqual((await read()).rows[0], { audience_documents: [], version: 1 });
    const documents = [{ id, title: 'Film', content: 'Published reference', isPublished: true, updatedAt: new Date().toISOString() }];
    await client.query('UPDATE ips SET audience_documents=$1::jsonb, version=version+1 WHERE id=$2', [JSON.stringify(documents), id]);
    await client.query(migration);
    assert.deepEqual((await read()).rows[0], { audience_documents: documents, version: 2 });
    const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
    assert.match(schema, /audienceDocuments\s+Json\s+@default\("\[\]"\)\s+@map\("audience_documents"\)/);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
