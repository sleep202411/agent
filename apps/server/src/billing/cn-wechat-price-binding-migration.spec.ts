import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { PGlite } = process.getBuiltinModule('module').createRequire(__filename)(
  '@electric-sql/pglite',
) as typeof import('@electric-sql/pglite');

it('activates only live CNY WeChat bindings that were waiting for impossible catalog sync', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`
      CREATE TYPE "PaymentProvider" AS ENUM ('airwallex', 'wechat_pay', 'alipay', 'manual', 'internal');
      CREATE TYPE "BillingProviderBindingStatus" AS ENUM ('active', 'inactive', 'sync_pending', 'sync_failed');
      CREATE TABLE "billing_prices" (
        "id" text PRIMARY KEY,
        "currency" text NOT NULL
      );
      CREATE TABLE "billing_provider_price_bindings" (
        "id" text PRIMARY KEY,
        "price_id" text NOT NULL REFERENCES "billing_prices" ("id"),
        "provider" "PaymentProvider" NOT NULL,
        "status" "BillingProviderBindingStatus" NOT NULL,
        "sync_error" text,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "archived_at" timestamptz
      );
      INSERT INTO "billing_prices" ("id", "currency") VALUES ('cny', 'CNY'), ('usd', 'USD');
      INSERT INTO "billing_provider_price_bindings"
        ("id", "price_id", "provider", "status", "sync_error", "archived_at")
      VALUES
        ('cny-pending', 'cny', 'wechat_pay', 'sync_pending', 'not supported', NULL),
        ('cny-failed', 'cny', 'wechat_pay', 'sync_failed', 'not supported', NULL),
        ('cny-inactive', 'cny', 'wechat_pay', 'inactive', NULL, NULL),
        ('usd-pending', 'usd', 'wechat_pay', 'sync_pending', NULL, NULL),
        ('airwallex-pending', 'cny', 'airwallex', 'sync_pending', NULL, NULL),
        ('archived-pending', 'cny', 'wechat_pay', 'sync_pending', NULL, CURRENT_TIMESTAMP);
    `);

    await db.exec(
      readFileSync(
        join(
          __dirname,
          '../../prisma/migrations/20260923160000_activate_cn_wechat_price_bindings/migration.sql',
        ),
        'utf8',
      ),
    );

    expect(
      (
        await db.query<{
          id: string;
          status: string;
          sync_error: string | null;
        }>(
          'SELECT id, status, sync_error FROM billing_provider_price_bindings ORDER BY id',
        )
      ).rows,
    ).toEqual([
      {
        id: 'airwallex-pending',
        status: 'sync_pending',
        sync_error: null,
      },
      {
        id: 'archived-pending',
        status: 'sync_pending',
        sync_error: null,
      },
      { id: 'cny-failed', status: 'active', sync_error: null },
      { id: 'cny-inactive', status: 'inactive', sync_error: null },
      { id: 'cny-pending', status: 'active', sync_error: null },
      { id: 'usd-pending', status: 'sync_pending', sync_error: null },
    ]);
  } finally {
    await db.close();
  }
}, 30000);
