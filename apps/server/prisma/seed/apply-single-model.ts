/**
 * Prod surgical apply: upsert one catalog slug with no snapshot scan.
 *
 *   DATABASE_URL=... npx tsx prisma/seed/apply-single-model.ts wan-3-0
 */
import { buildPrisma } from '../../src/infra/db/db.module';
import {
  seedSingleAudioModel,
  seedSingleVideoModel,
} from './ai-catalog/seed-catalog';

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: tsx prisma/seed/apply-single-model.ts <slug>');
    process.exit(2);
  }
  if (!process.env.DATABASE_URL?.trim()) {
    console.error('DATABASE_URL required');
    process.exit(2);
  }

  const prisma = buildPrisma();
  await prisma.$connect();
  try {
    let result: Awaited<ReturnType<typeof seedSingleVideoModel>>;
    try {
      result = await seedSingleVideoModel(prisma, slug);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes(`Unknown video model slug "${slug}"`)
      ) {
        throw error;
      }
      result = await seedSingleAudioModel(prisma, slug);
    }
    console.log(JSON.stringify(result));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
