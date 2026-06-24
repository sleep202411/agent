// Phase 1 (LOCAL, no DB): generate the trilingual posters + upload to prod Blob.
// Consumes outputs/ip-bulk-seed/plan-3lang.json, writes manifest-3lang.json
// (resumable) + cost-3lang.csv. DB writes happen later in `commit` (needs prod
// DATABASE_URL). fal openai/gpt-image-2, 16:9 webp, captures x-fal-billable-units.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlobServiceClient } from '@azure/storage-blob';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(SERVER, 'outputs/ip-bulk-seed');
const env = fs.readFileSync(path.join(SERVER, '.env'), 'utf8');
const envv = (k) => (env.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim();
const KEY = envv('FAL_API_KEY');
const AZ = envv('AZURE_BLOB_CONNECTION_STRING');
const CONTAINER = envv('AZURE_BLOB_CONTAINER');
const REGION = envv('AZURE_BLOB_REGION') || null;
if (!KEY || !AZ || !CONTAINER) { console.error('missing FAL_API_KEY / AZURE_BLOB_*'); process.exit(1); }

const W = 1344, H = 768, QUALITY = 'high', FMT = 'webp', CT = 'image/webp';
const CONCURRENCY = Number(process.argv.find((_, i, a) => a[i - 1] === '-c')) || 40;
const ENDPOINT = 'openai/gpt-image-2';
const QBASE = 'https://queue.fal.run';

const plan = JSON.parse(fs.readFileSync(path.join(OUT, 'plan-3lang.json'), 'utf8'));
const MANIFEST = path.join(OUT, 'manifest-3lang.json');
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : [];
const done = new Set(manifest.filter((m) => m.ok).map((m) => m.coverAssetId));
const blob = BlobServiceClient.fromConnectionString(AZ).getContainerClient(CONTAINER);

let unitPrice = null;
try {
  const pr = await fetch(`https://api.fal.ai/v1/models/pricing?endpoint_id=${ENDPOINT}`, { headers: { Authorization: `Key ${KEY}` } });
  const pd = await pr.json();
  unitPrice = (pd.prices?.find((x) => x.endpoint_id === ENDPOINT) ?? pd.prices?.[0])?.unit_price ?? null;
} catch { /* keep null */ }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function falJson(url, init, attempt = 0) {
  try {
    const res = await fetch(url, { ...init, headers: { Authorization: `Key ${KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
    const text = await res.text().catch(() => '');
    if (res.status >= 500 && attempt < 3) { await sleep(1000 * (attempt + 1) ** 2); return falJson(url, init, attempt + 1); }
    if (!res.ok) throw new Error(`fal ${res.status}: ${text.slice(0, 140)}`);
    return { json: text ? JSON.parse(text) : null, headers: res.headers };
  } catch (e) {
    if (attempt < 3) { await sleep(1000 * (attempt + 1) ** 2); return falJson(url, init, attempt + 1); }
    throw e;
  }
}
async function genPoster(prompt) {
  const { json: sub } = await falJson(`${QBASE}/${ENDPOINT}`, {
    method: 'POST',
    body: JSON.stringify({ prompt, image_size: { width: W, height: H }, quality: QUALITY, num_images: 1, output_format: FMT }),
  });
  const id = sub.request_id ?? sub.requestId;
  if (!id) throw new Error('no request_id');
  for (let i = 0; i < 240; i++) {
    await sleep(2500);
    const { json: st } = await falJson(`${QBASE}/${ENDPOINT}/requests/${id}/status`, { method: 'GET' });
    const s = String(st.status ?? '').toUpperCase();
    if (s === 'COMPLETED') break;
    if (s === 'FAILED' || s === 'ERROR') throw new Error('fal ' + s);
    if (i === 239) throw new Error('poll timeout');
  }
  const { json: res, headers } = await falJson(`${QBASE}/${ENDPOINT}/requests/${id}`, { method: 'GET' });
  const first = res.images?.[0];
  const url = typeof first === 'string' ? first : (first?.url ?? res.image?.url);
  if (!url) throw new Error('no image url');
  const billable = headers.get('x-fal-billable-units');
  return { url, billable: billable != null ? Number(billable) : null };
}

const pending = plan.filter((p) => !done.has(p.coverAssetId)).slice(0, Number(process.env.LIMIT) || Infinity);
console.log(`gen ${pending.length}/${plan.length} (skip ${plan.length - pending.length}) c=${CONCURRENCY} ${FMT}/${QUALITY} ${W}x${H} unit_price=${unitPrice}`);
let ok = 0, fail = 0, total = 0;
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k]); } }));
}
await pool(pending, CONCURRENCY, async (p) => {
  const t = Date.now();
  try {
    const promptToUse = process.env.STRIP ? p.prompt.split('改编方向')[0].trim() : p.prompt;
    const { url, billable } = await genPoster(promptToUse);
    const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
    const objectKey = `ip-bulk-seed/3lang/${p.coverAssetId}.${FMT}`;
    await blob.getBlockBlobClient(objectKey).uploadData(bytes, { blobHTTPHeaders: { blobContentType: CT } });
    const cost = (billable != null && unitPrice != null) ? billable * unitPrice : null;
    if (cost) total += cost;
    manifest.push({ title: p.title, ipId: p.ipId, coverAssetId: p.coverAssetId, mode: p.mode, objectKey, sizeBytes: bytes.length, width: W, height: H, contentType: CT, billable, cost, ok: true });
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
    ok++;
    console.log(`  ✓ [${p.mode}] ${p.title} ${((Date.now() - t) / 1000) | 0}s $${cost?.toFixed(4) ?? '?'} (${ok + fail}/${pending.length})`);
  } catch (e) {
    fail++;
    manifest.push({ title: p.title, coverAssetId: p.coverAssetId, ok: false, error: String(e.message || e).slice(0, 120) });
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
    console.error(`  ✗ ${p.title}: ${e.message}`);
  }
});
const csv = [['title', 'mode', 'coverAssetId', 'billableUnits', 'costUSD', 'objectKey']];
for (const m of manifest.filter((x) => x.ok)) csv.push([m.title, m.mode, m.coverAssetId, m.billable ?? '', m.cost != null ? m.cost.toFixed(4) : '', m.objectKey]);
fs.writeFileSync(path.join(OUT, 'cost-3lang.csv'), csv.map((r) => r.join(',')).join('\n'));
console.log(`\nDONE gen ok=${ok} fail=${fail} total≈$${total.toFixed(2)}. manifest=${MANIFEST}`);
