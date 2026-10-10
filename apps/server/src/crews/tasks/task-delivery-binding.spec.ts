import {
  taskDeliveryCategoryKey,
  bindTaskDeliveryCategoryKey,
  findActiveDeliveryCategory,
} from './task-delivery-binding';
import { Client } from 'pg';
import type { Prisma } from '@prisma/client';

it.each([
  ['script', undefined, 'script_delivery'],
  ['art', 'characters', 'character_art_delivery'],
  ['art', 'scenes', 'scene_art_delivery'],
  ['art', 'props', 'prop_art_delivery'],
  ['music', undefined, 'music_delivery'],
  ['edit', undefined, 'assembly_delivery'],
  ['storyboard', undefined, 'storyboard_delivery'],
])(
  'maps %s/%s to its maintained delivery category',
  (taskKind, assetCategory, key) => {
    expect(
      taskDeliveryCategoryKey({ taskKind, metadata: { assetCategory } }),
    ).toBe(key);
  },
);
it('honors an explicitly configured episode-template category', () => {
  expect(
    taskDeliveryCategoryKey({
      taskKind: 'script',
      metadata: { deliveryCategoryKey: 'custom_script' },
    }),
  ).toBe('custom_script');
});
const url = process.env.DELIVERY_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'delivery revision selection on isolated PostgreSQL',
  () => {
    let db: Client;
    let tx: Prisma.TransactionClient;
    const a = '00000000-0000-4000-8000-000000000001';
    const b = '00000000-0000-4000-8000-000000000002';
    const task = '00000000-0000-4000-8000-000000000003';
    beforeAll(async () => {
      const parsed = new URL(url!);
      if (
        parsed.hostname !== '127.0.0.1' ||
        parsed.port !== '55443' ||
        parsed.pathname !== '/postgres'
      )
        throw new Error('Isolated local test database required');
      db = new Client({ connectionString: url });
      await db.connect();
      await db.query(
        'CREATE TEMP TABLE crew_delivery_catalog_revisions(category_id uuid,version int,definition jsonb); CREATE TEMP TABLE crew_task_delivery_templates(task_id uuid PRIMARY KEY,category_id uuid,category_version int)',
      );
      const query = async (parts: TemplateStringsArray, ...values: unknown[]) =>
        db.query(
          parts.reduce((sql, part, i) => sql + (i ? `$${i}` : '') + part, ''),
          values,
        );
      tx = {
        $queryRaw: async (...args: Parameters<typeof query>) =>
          (await query(...args)).rows,
        $executeRaw: async (...args: Parameters<typeof query>) =>
          (await query(...args)).rowCount,
      } as unknown as Prisma.TransactionClient;
    });
    afterAll(async () => {
      await db?.end();
    });
    beforeEach(async () => {
      await db.query(
        'TRUNCATE crew_delivery_catalog_revisions,crew_task_delivery_templates',
      );
    });
    async function revision(
      id: string,
      version: number,
      status: string,
      key = 'script_delivery',
    ) {
      await db.query(
        'INSERT INTO crew_delivery_catalog_revisions VALUES($1,$2,$3)',
        [id, version, JSON.stringify({ status, categoryKey: key })],
      );
    }
    it('does not bind archived revisions and allows their key to be reused', async () => {
      await revision(a, 1, 'active');
      await revision(a, 2, 'archived');
      expect(
        await findActiveDeliveryCategory(tx, 'script_delivery', b),
      ).toBeUndefined();
      await bindTaskDeliveryCategoryKey(tx, task, 'script_delivery');
      expect(
        (await db.query('SELECT * FROM crew_task_delivery_templates')).rows,
      ).toHaveLength(0);
      await revision(b, 1, 'active');
      await bindTaskDeliveryCategoryKey(tx, task, 'script_delivery');
      expect(
        (await db.query('SELECT * FROM crew_task_delivery_templates')).rows[0],
      ).toMatchObject({ category_id: b, category_version: 1 });
    });
    it('uses the latest revision while preserving an existing task agreement', async () => {
      await revision(a, 1, 'active');
      await revision(a, 2, 'active');
      expect(
        await findActiveDeliveryCategory(tx, 'script_delivery', a),
      ).toBeUndefined();
      await bindTaskDeliveryCategoryKey(tx, task, 'script_delivery');
      await revision(a, 3, 'active');
      await bindTaskDeliveryCategoryKey(tx, task, 'script_delivery');
      expect(
        (await db.query('SELECT * FROM crew_task_delivery_templates')).rows[0]
          .category_version,
      ).toBe(2);
    });
  },
);
