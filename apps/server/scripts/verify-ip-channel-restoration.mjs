// In-memory PostgreSQL only. Does not read DATABASE_URL or contact a server.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const sql = readFileSync(new URL('../prisma/migrations/20260923093000_restore_existing_ip_channels/migration.sql', import.meta.url), 'utf8');
const db = await PGlite.create();
try {
  await db.exec(`
    CREATE TYPE "IpChannelType" AS ENUM ('ip', 'community');
    CREATE TABLE ips (
      id integer PRIMARY KEY, channel_type "IpChannelType" NOT NULL DEFAULT 'community',
      version integer NOT NULL DEFAULT 0, updated_at timestamptz DEFAULT '2026-01-01',
      deleted_at timestamptz, status text DEFAULT 'draft', listing_visibility text DEFAULT 'private',
      price integer DEFAULT 99, media text DEFAULT 'unchanged', room_number text DEFAULT '100391'
    );
    INSERT INTO ips(id,channel_type,version,status,listing_visibility,deleted_at) VALUES
      (1,'community',4,'published','public',NULL),
      (2,'community',2,'draft','private',NULL),
      (3,'community',7,'suspended','private',NULL),
      (4,'ip',3,'published','public',NULL),
      (5,'community',8,'archived','private','2026-01-02');
  `);
  const before = (await db.query('SELECT * FROM ips ORDER BY id')).rows;
  await db.exec(sql);
  const after = (await db.query('SELECT * FROM ips ORDER BY id')).rows;
  for (let i = 0; i < before.length; i++) {
    const changed = i < 3;
    assert.equal(after[i].channel_type, changed ? 'ip' : before[i].channel_type);
    assert.equal(after[i].version, before[i].version + (changed ? 1 : 0));
    for (const field of ['status', 'listing_visibility', 'price', 'media', 'room_number', 'deleted_at']) {
      assert.deepEqual(after[i][field], before[i][field], field);
    }
    if (changed) assert.notEqual(after[i].updated_at, before[i].updated_at);
    else assert.deepEqual(after[i], before[i]);
  }
  const stale = await db.query('UPDATE ips SET channel_type = \'community\' WHERE id=1 AND version=4 RETURNING id');
  assert.equal(stale.rows.length, 0, 'stale Admin edit must not match');
  await db.exec(sql);
  assert.deepEqual((await db.query('SELECT * FROM ips ORDER BY id')).rows, after);
  await db.exec("INSERT INTO ips(id) VALUES (6); INSERT INTO ips(id,channel_type) VALUES (7,'ip')");
  assert.deepEqual((await db.query('SELECT channel_type FROM ips WHERE id>=6 ORDER BY id')).rows,
    [{channel_type:'community'}, {channel_type:'ip'}]);
  console.log('PASS: existing titles restored; visibility/media/pricing preserved; stale versions rejected; repeat safe; future defaults/choice preserved');
} finally { await db.close(); }
