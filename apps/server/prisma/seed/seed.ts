/**
 * Prisma seed entrypoint.
 *
 * Wired via the `prisma.seed` script in `apps/server/package.json`
 * (`tsx prisma/seed/seed.ts`) and runnable directly. Loads `.env` for
 * `DATABASE_URL` (local dev: localhost:5433), opens a Prisma client through the
 * shared `buildPrisma` factory, runs the idempotent AI image-catalog seed, and
 * always disconnects. Any failure exits non-zero.
 */
import 'dotenv/config';

import { CURRENT_CELL } from '../../src/common/region';
import { buildPrisma } from '../../src/infra/db/db.module';
import {
  seedAiImageCatalog,
  seedAiVideoCatalog,
} from './ai-catalog/seed-catalog';
import { seedCnPrices } from './cn-prices';
import { seedMembershipPlans } from './membership-plans';

async function main(): Promise<void> {
  const prisma = buildPrisma();
  await prisma.$connect();
  try {
    await seedAiImageCatalog(prisma);
    await seedAiVideoCatalog(prisma);
    await seedMembershipPlans(prisma);
    // CN-only fiat pricing (CNY compute packs + one-off membership + wechat_pay
    // bindings). Gated so it never runs on .com.
    if (CURRENT_CELL === 'cn') {
      await seedCnPrices(prisma);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
