import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { ensureOriginalMediaPlacement } from '../src/infra/storage/media-asset-placement';

const connectionString =
  process.env.DATABASE_URL ??
  'postgres://fizzdragon:fizzdragon@localhost:5433/fizzdragon';
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString,
    max: 4,
    idleTimeoutMillis: 30_000,
  }),
});

type Args = {
  write: boolean;
  limit: number;
  allowRemote: boolean;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertLocalDatabase(args);

  const assets = await prisma.mediaAsset.findMany({
    where: {
      deletedAt: null,
      variants: { none: { variantKey: 'original', deletedAt: null } },
      OR: [{ objectKey: { not: null } }, { externalUrl: { not: null } }],
    },
    orderBy: { createdAt: 'asc' },
    take: args.limit,
  });

  if (!args.write) {
    console.log(
      `DRY RUN: ${assets.length} media assets need original variant/placement backfill. Re-run with --write to apply.`,
    );
    for (const asset of assets.slice(0, 20)) {
      console.log(
        `${asset.id} provider=${asset.storageProvider} bucket=${asset.bucket ?? '-'} object=${asset.objectKey ?? asset.externalUrl ?? '-'}`,
      );
    }
    return;
  }

  let completed = 0;
  for (const asset of assets) {
    await prisma.$transaction(async (tx) => {
      await ensureOriginalMediaPlacement(tx, {
        assetId: asset.id,
        storageProvider: asset.storageProvider,
        bucket: asset.bucket,
        region: asset.region,
        objectKey: asset.objectKey,
        externalUrl: asset.externalUrl,
        contentType: asset.contentType,
        sizeBytes: asset.sizeBytes,
        width: asset.width,
        height: asset.height,
        durationSeconds: asset.durationSeconds,
        checksumSha256: asset.checksumSha256,
        metadata: { source: 'manual_backfill_script' },
      });
    });
    completed += 1;
  }
  console.log(
    `Backfilled original variant/placement for ${completed} media assets.`,
  );
}

function parseArgs(argv: string[]): Args {
  const limitArg = argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 500;
  return {
    write: argv.includes('--write'),
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 5_000) : 500,
    allowRemote: argv.includes('--allow-remote'),
  };
}

function assertLocalDatabase(args: Args): void {
  if (args.allowRemote) return;
  const hostname = new URL(connectionString).hostname;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
    throw new Error(
      'Refusing to run media backfill against a non-local DATABASE_URL. Pass --allow-remote only during an approved maintenance window.',
    );
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
