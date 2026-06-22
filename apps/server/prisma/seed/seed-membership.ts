/**
 * Membership-only seed entrypoint.
 *
 * Runs ONLY seedMembershipPlans (plans + prices + Airwallex provider-binding
 * rows). It deliberately does NOT run the AI catalog seeds, so it is safe to run
 * against prod without clobbering admin-managed AI catalog edits. Idempotent —
 * re-running archives retired plans, upserts the current lineup, and creates any
 * missing sync_pending provider bindings (never clobbers a synced binding).
 *
 * Run: `npm run seed:membership` (tsx prisma/seed/seed-membership.ts). Loads
 * `.env` for DATABASE_URL.
 */
import 'dotenv/config';

import { buildPrisma } from '../../src/infra/db/db.module';
import { seedMembershipPlans } from './membership-plans';

async function main(): Promise<void> {
  const prisma = buildPrisma();
  await prisma.$connect();
  try {
    await seedMembershipPlans(prisma);
    console.log('Membership plans + prices + provider bindings seeded.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
