/** Scoped GPT Image release. Defaults to an offline plan; never runs full seed. */
import 'dotenv/config';
import {
  planSingleModelSeed,
  seedSingleImageModel,
} from './ai-catalog/seed-catalog';

const slugs = ['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'];
async function main() {
  const args = process.argv.slice(2);
  if (
    args.some((arg) => !['--apply', '--dry-run'].includes(arg)) ||
    args.length > 1
  ) {
    throw new Error(
      'Usage: tsx prisma/seed/update-gpt-image-catalog.ts [--dry-run | --apply]',
    );
  }
  if (!args.includes('--apply')) {
    console.log(JSON.stringify(slugs.map(planSingleModelSeed), null, 2));
    return;
  }
  // Import only on explicit apply so review/dry-run never opens a DB connection.
  const { buildPrisma } = await import('../../src/infra/db/db.module.js');
  const prisma = buildPrisma();
  try {
    for (const slug of slugs)
      console.log(await seedSingleImageModel(prisma, slug));
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
