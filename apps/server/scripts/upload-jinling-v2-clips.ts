/**
 * Upload the generated jinling-v2 film-cut clips to the immutable blob release
 * that media-release-v2.ts points at:
 *   foundry-outputs/interactive-films/jinling-rumeng/s01/v2/film-cut/{clipId}.mp4
 * (v1's s01/v1 objects are untouched, so both storylines coexist.)
 *
 *   npx tsx scripts/upload-jinling-v2-clips.ts
 */
import 'dotenv/config';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { BlobServiceClient } from '@azure/storage-blob';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const V2_CLIPS = path.join(
  REPO_ROOT,
  'apps/web/tmp/jinling-production/v2-clips',
);
const PREFIX = 'interactive-films/jinling-rumeng/s01/v2/film-cut';

async function main(): Promise<void> {
  const cs = process.env.AZURE_BLOB_CONNECTION_STRING;
  if (!cs) throw new Error('AZURE_BLOB_CONNECTION_STRING missing');
  const account = /AccountName=([^;]+)/u.exec(cs)?.[1];
  const container = 'foundry-outputs';
  const cc =
    BlobServiceClient.fromConnectionString(cs).getContainerClient(container);

  const files = (await readdir(V2_CLIPS))
    .filter((f) => f.endsWith('.mp4'))
    .sort();
  if (files.length === 0) throw new Error(`no .mp4 in ${V2_CLIPS}`);
  console.log(
    `uploading ${files.length} clip(s) → ${account}/${container}/${PREFIX}`,
  );

  for (const file of files) {
    const key = `${PREFIX}/${file.toLowerCase()}`;
    const blob = cc.getBlockBlobClient(key);
    await blob.uploadFile(path.join(V2_CLIPS, file), {
      blobHTTPHeaders: {
        blobContentType: 'video/mp4',
        blobCacheControl: 'public, max-age=31536000, immutable',
      },
    });
    console.log(
      `✅ ${file} → https://${account}.blob.core.windows.net/${container}/${key}`,
    );
  }
  console.log(`\ndone: ${files.length} clip(s) live under s01/v2/film-cut`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
