/**
 * TEMP: register the 5 jinling-v2 main-cast face images as ModelArk `asset://`
 * (Moderation:Skip) so Seedance omni-reference accepts them past the real-person
 * pre-filter. Uploads each to the durable blob first (CreateAsset needs a PUBLIC
 * url, not base64), then CreateAssetGroup(AIGC) → CreateAsset → poll to Active.
 * Writes docs/jinling-rumeng/v2-cast-assets.json {REF-*: asset://id}.
 *
 *   npx tsx scripts/register-jinling-cast-assets.ts
 */
import 'dotenv/config';
import path from 'node:path';
import os from 'node:os';
import { writeFileSync } from 'node:fs';
import { BlobServiceClient } from '@azure/storage-blob';
import { BytePlusAssetsConfigService } from '../src/ai-generation/providers/byteplus/assets/byteplus-assets-config.service';
import { BytePlusAssetsClient } from '../src/ai-generation/providers/byteplus/assets/byteplus-assets-client';

process.env.BYTEPLUS_ASSETS_MODERATION_STRATEGY = 'Skip';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DOWNLOADS = path.join(os.homedir(), 'Downloads');

const CAST = [
  { key: 'daiyu', ref: 'REF-DAIYU', file: '林黛玉.png' },
  { key: 'baoyu', ref: 'REF-BAOYU', file: '贾宝玉.png' },
  { key: 'xifeng', ref: 'REF-XIFENG', file: '王熙凤.png' },
  { key: 'jiamu', ref: 'REF-JIAMU', file: '贾母.png' },
  { key: 'wang', ref: 'REF-WANG', file: '王夫人.png' },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function uploadBlob(localPath: string, key: string): Promise<string> {
  const cs = process.env.AZURE_BLOB_CONNECTION_STRING;
  if (!cs) throw new Error('AZURE_BLOB_CONNECTION_STRING missing');
  const account = /AccountName=([^;]+)/u.exec(cs)?.[1];
  const container = process.env.AZURE_BLOB_CONTAINER ?? 'foundry-outputs';
  const svc = BlobServiceClient.fromConnectionString(cs);
  const blob = svc.getContainerClient(container).getBlockBlobClient(key);
  await blob.uploadFile(localPath, {
    blobHTTPHeaders: {
      blobContentType: 'image/png',
      blobCacheControl: 'public, max-age=31536000, immutable',
    },
  });
  return `https://${account}.blob.core.windows.net/${container}/${key}`;
}

async function main(): Promise<void> {
  const config = new BytePlusAssetsConfigService();
  const client = new BytePlusAssetsClient(config);
  console.log(
    'moderation strategy:',
    config.config.assetModerationStrategy,
    '| endpoint:',
    config.config.endpoint,
  );

  const group = await client.createAssetGroup({
    name: 'jinling-v2-cast',
    description: '金陵入梦 v2 主角脸参考',
  });
  console.log('asset group:', group.Id);

  const out: Record<string, string> = {};
  for (const c of CAST) {
    const local = path.join(DOWNLOADS, c.file);
    const key = `interactive-films/jinling-rumeng/s01/v2/cast-refs/${c.key}.png`;
    const url = await uploadBlob(local, key);
    const asset = await client.createAsset({
      groupId: group.Id,
      url,
      assetType: 'Image',
      name: c.ref,
    });
    let status = 'Processing';
    for (let i = 0; i < 40 && status !== 'Active'; i += 1) {
      await sleep(3000);
      const rec = await client.getAsset(asset.Id);
      status = (rec as { Status?: string }).Status ?? 'Processing';
      if (status === 'Failed')
        throw new Error(`${c.ref} asset moderation/processing failed`);
    }
    out[c.ref] = `asset://${asset.Id}`;
    console.log(`✅ ${c.ref} → asset://${asset.Id} (${status})`);
  }

  const outPath = path.join(
    REPO_ROOT,
    'docs/jinling-rumeng/v2-cast-assets.json',
  );
  writeFileSync(
    outPath,
    `${JSON.stringify({ groupId: group.Id, assets: out }, null, 2)}\n`,
  );
  console.log('wrote', outPath);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
