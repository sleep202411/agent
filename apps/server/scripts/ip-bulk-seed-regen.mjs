// Poster RE-GEN (preview by default — NO DB write). For a catalogNo range, rebuild
// a CLEAN trilingual prompt (中文 + 英文 + regionLang, deduped to bilingual when
// regionLang ∈ {中文,英文}; story tail stripped), gen via fal gpt-image-2 (1344×768
// webp/high), upload to a PREVIEW Blob key (ip-bulk-seed/3lang-preview/), and print
// the URLs. Does NOT touch the live MediaAsset. Reuses apps/server/.env keys.
//
//   node scripts/ip-bulk-seed-regen.mjs [--from 100] [--to 109] [-c 10]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlobServiceClient } from '@azure/storage-blob';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(SERVER, 'outputs/ip-bulk-seed');
const env = fs.readFileSync(path.join(SERVER, '.env'), 'utf8');
const envv = (k) => (env.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim();
const KEY = envv('FAL_API_KEY') || envv('FAL_KEY');
const AZ = envv('AZURE_BLOB_CONNECTION_STRING');
const CONTAINER = envv('AZURE_BLOB_CONTAINER');
const PUB = (envv('AZURE_BLOB_PUBLIC_BASE_URL') || '').replace(/\/+$/, '');
if (!KEY || !AZ || !CONTAINER) { console.error('missing FAL_API_KEY / AZURE_BLOB_*'); process.exit(1); }

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const FROM = Number(arg('--from', '100')), TO = Number(arg('--to', '109'));
const CONCURRENCY = Number(arg('-c', '10'));
const W = 1344, H = 768, FMT = 'webp', CT = 'image/webp', ENDPOINT = 'openai/gpt-image-2', QBASE = 'https://queue.fal.run';

// regionLang = the first stated language that is NOT a base (中文/英文); null => bilingual.
function regionLangOf(prompt) {
  const m = prompt.match(/。(.*?)显示/);
  if (!m) return null;
  for (const part of m[1].split(/[、和，,]/)) {
    const mm = part.trim().match(/^([一-龥]{1,6}?[文语])/);
    if (mm) { const t = mm[1]; if (!['中文', '英文', '双语', '三语', '多语', '语'].includes(t)) return t; }
  }
  return null;
}
function buildClean(title, rl) {
  const clause = (!rl || rl === '中文' || rl === '英文')
    ? '中文和英文双语显示，中文在上，英文在下'
    : `中文、${rl}和英文三语显示，中文在上，${rl}在中，英文在下`;
  return `帮我制作一个影视海报，片名：${title}。${clause}，简约风格，文字仅有主题文字。`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function falJson(url, init, a = 0) {
  try {
    const res = await fetch(url, { ...init, headers: { Authorization: `Key ${KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
    const text = await res.text().catch(() => '');
    if (res.status >= 500 && a < 3) { await sleep(1000 * (a + 1) ** 2); return falJson(url, init, a + 1); }
    if (!res.ok) throw new Error(`fal ${res.status}: ${text.slice(0, 140)}`);
    return text ? JSON.parse(text) : null;
  } catch (e) { if (a < 3) { await sleep(1000 * (a + 1) ** 2); return falJson(url, init, a + 1); } throw e; }
}
async function genPoster(prompt) {
  const sub = await falJson(`${QBASE}/${ENDPOINT}`, { method: 'POST', body: JSON.stringify({ prompt, image_size: { width: W, height: H }, quality: 'high', num_images: 1, output_format: FMT }) });
  const id = sub.request_id ?? sub.requestId;
  if (!id) throw new Error('no request_id');
  for (let i = 0; i < 240; i++) {
    await sleep(2500);
    const st = await falJson(`${QBASE}/${ENDPOINT}/requests/${id}/status`, { method: 'GET' });
    const s = String(st.status ?? '').toUpperCase();
    if (s === 'COMPLETED') break;
    if (s === 'FAILED' || s === 'ERROR') throw new Error('fal ' + s);
    if (i === 239) throw new Error('poll timeout');
  }
  const res = await falJson(`${QBASE}/${ENDPOINT}/requests/${id}`, { method: 'GET' });
  const f = res.images?.[0];
  const url = typeof f === 'string' ? f : (f?.url ?? res.image?.url);
  if (!url) throw new Error('no image url');
  return url;
}

const p3 = JSON.parse(fs.readFileSync(path.join(OUT, 'plan-3lang.json'), 'utf8'));
const byNo = new Map(p3.map((x) => [String(x.catalogNo), x]));
const targets = [];
for (let n = FROM; n <= TO; n++) { const x = byNo.get(String(n)); if (x) targets.push({ no: n, ...x }); }
const blob = BlobServiceClient.fromConnectionString(AZ).getContainerClient(CONTAINER);
console.log(`regen PREVIEW ${targets.length} posters (catalogNo ${FROM}-${TO}) c=${CONCURRENCY} ${W}x${H} ${FMT}/high — NO DB write`);

const results = [];
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k]); } })); }
await pool(targets, CONCURRENCY, async (t) => {
  try {
    const rl = regionLangOf(t.prompt);
    const prompt = buildClean(t.title, rl);
    const url = await genPoster(prompt);
    const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
    const objectKey = `ip-bulk-seed/3lang-preview/${t.coverAssetId}.${FMT}`;
    await blob.getBlockBlobClient(objectKey).uploadData(bytes, { blobHTTPHeaders: { blobContentType: CT } });
    const previewUrl = PUB ? `${PUB}/${objectKey}` : null;
    results.push({ no: t.no, title: t.title, lang: rl || '中英双语', coverAssetId: t.coverAssetId, prompt, falUrl: url, previewUrl, objectKey });
    console.log(`  ✓ [${t.no}] ${t.title} (${rl || '中英双语'})`);
  } catch (e) {
    results.push({ no: t.no, title: t.title, error: String(e.message || e).slice(0, 140) });
    console.error(`  ✗ [${t.no}] ${t.title}: ${e.message}`);
  }
});
results.sort((a, b) => a.no - b.no);
fs.writeFileSync(path.join(OUT, `regen-preview-${FROM}-${TO}.json`), JSON.stringify(results, null, 2));
console.log('\n=== PREVIEW RESULTS ===');
for (const r of results) console.log(r.error ? `[${r.no}] ${r.title} ✗ ${r.error}` : `[${r.no}] ${r.title} | ${r.lang}\n    ${r.falUrl}`);
console.log(`\nwrote ${path.join(OUT, `regen-preview-${FROM}-${TO}.json`)}`);
