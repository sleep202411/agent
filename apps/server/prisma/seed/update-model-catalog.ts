/** Scoped model release. Defaults to an offline plan; never runs full seed. */
import 'dotenv/config';
import {
  planSingleModelSeed,
  seedSingleAudioModel,
  seedSingleImageModel,
  seedSingleVideoModel,
} from './ai-catalog/seed-catalog';

async function main() {
  const args = process.argv.slice(2);
  const slugs = [...new Set(args.filter((arg) => !arg.startsWith('--')))];
  if (
    !slugs.length ||
    args.some(
      (arg) => arg.startsWith('--') && !['--apply', '--dry-run'].includes(arg),
    ) ||
    (args.includes('--apply') && args.includes('--dry-run'))
  ) {
    throw new Error(
      'Usage: update-model-catalog [--dry-run | --apply] <slug...>',
    );
  }
  // Validate every slug before opening a connection or writing any model.
  const plans = slugs.map(planSingleModelSeed);
  if (!args.includes('--apply')) {
    console.log(JSON.stringify(plans, null, 2));
    return;
  }
  const { buildPrisma } = await import('../../src/infra/db/db.module.js');
  const prisma = buildPrisma();
  try {
    for (const plan of plans) {
      const seed =
        plan.modality === 'image'
          ? seedSingleImageModel
          : plan.modality === 'video'
            ? seedSingleVideoModel
            : seedSingleAudioModel;
      console.log(await seed(prisma, plan.slug));
    }
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
