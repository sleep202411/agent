#!/usr/bin/env -S npx tsx
/**
 * Queue-drain visualizer for local dev.
 *
 * Submits N AI image jobs back-to-back, then polls /ai/jobs every
 * second and prints a status table. Pairs with two server-side env
 * knobs that make the queue visually testable:
 *
 *   AI_WORKER_IMAGE_CONCURRENCY=1     # one slot, so 4 jobs queue
 *   FOUNDRY_DEBUG_DELAY_MS=10000      # 10 s stub generations, no Azure
 *
 * Run from apps/server:
 *
 *   AI_WORKER_IMAGE_CONCURRENCY=1 \
 *   FOUNDRY_DEBUG_DELAY_MS=10000 \
 *   npm run start
 *
 *   # in another shell:
 *   npx tsx scripts/queue-test.ts 4
 *
 * Watch the table count down each slot and verify the UI updates
 * (in-queue → generating → completed) in lock-step.
 */
const BASE = process.env.AI_TEST_BASE ?? 'http://localhost:4399';
const MODEL_ID = process.env.AI_TEST_MODEL ?? 'foundry/gpt-image-2';
const COUNT = Math.max(1, Number(process.argv[2] ?? 4));
const TICK_MS = 1000;

interface JobView {
  id: string;
  status: string;
  stage: string;
  queuePosition: number | null;
  progress: number | null;
  estimatedTotalSeconds: number | null;
  prompt: string;
  createdAt: string;
  completedAt?: string;
  input?: Record<string, unknown>;
}

async function fetchSchemaVersion(): Promise<string> {
  const res = await fetch(`${BASE}/ai/models`);
  if (!res.ok) throw new Error(`models http ${res.status}`);
  const body = (await res.json()) as {
    data: { models: Array<{ id: string; schemaVersion: string }> };
  };
  const m = body.data.models.find((x) => x.id === MODEL_ID);
  if (!m) throw new Error(`model ${MODEL_ID} not found in catalog`);
  return m.schemaVersion;
}

async function submit(
  i: number,
  schemaVersion: string,
): Promise<{ id: string; prompt: string }> {
  const prompt = `queue-test #${i + 1} (${Date.now()})`;
  const res = await fetch(`${BASE}/ai/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      modelId: MODEL_ID,
      schemaVersion,
      input: {
        prompt,
        aspect_ratio: '1:1',
        resolution_tier: 'hd',
        quality: 'low',
        n: 1,
      },
      idempotencyKey: `qtest-${Date.now()}-${i}`,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`submit ${i} http ${res.status}: ${body.slice(0, 200)}`);
  }
  const body = (await res.json()) as { data: { request_id: string } };
  return { id: body.data.request_id, prompt };
}

async function listJobs(): Promise<JobView[]> {
  const res = await fetch(`${BASE}/ai/jobs?type=image&limit=20`);
  if (!res.ok) throw new Error(`list http ${res.status}`);
  const body = (await res.json()) as { data: { jobs: JobView[] } };
  return body.data.jobs;
}

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
} as const;

function colorFor(status: string): string {
  if (status === 'completed') return COLORS.green;
  if (status === 'in_progress') return COLORS.cyan;
  if (status === 'in_queue' || status === 'created') return COLORS.yellow;
  if (status === 'failed' || status === 'cancelled') return COLORS.red;
  return '';
}

function render(jobs: JobView[], submittedIds: Set<string>, t0: number): void {
  const ours = jobs.filter((j) => submittedIds.has(j.id));
  // Sort by createdAt so the table reads in submission order.
  ours.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Clear screen + move cursor home (works on POSIX terms).
  process.stdout.write('\x1b[2J\x1b[H');
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `${COLORS.bold}Queue drain test${COLORS.reset}  t+${elapsed}s  ` +
      `${COLORS.dim}poll every ${TICK_MS}ms${COLORS.reset}`,
  );
  console.log(
    `${COLORS.dim}AI_WORKER_IMAGE_CONCURRENCY (server-side) controls how many can run at once.${COLORS.reset}`,
  );
  console.log('');
  const head = ['#', 'job', 'status', 'stage', 'qpos', 'eta', 'age'];
  console.log(head.map((h) => h.padEnd(14)).join(''));
  console.log(COLORS.dim + '─'.repeat(head.length * 14) + COLORS.reset);
  ours.forEach((j, i) => {
    const c = colorFor(j.status);
    const ageMs = Date.now() - new Date(j.createdAt).getTime();
    const cells = [
      String(i + 1).padEnd(14),
      j.id.slice(0, 8).padEnd(14),
      (c + j.status + COLORS.reset).padEnd(14 + c.length + COLORS.reset.length),
      String(j.stage).padEnd(14),
      String(j.queuePosition ?? '-').padEnd(14),
      (j.estimatedTotalSeconds != null
        ? `${j.estimatedTotalSeconds}s`
        : '-'
      ).padEnd(14),
      `${(ageMs / 1000).toFixed(1)}s`.padEnd(14),
    ];
    console.log(cells.join(''));
  });
  const remaining = ours.filter(
    (j) =>
      j.status !== 'completed' &&
      j.status !== 'failed' &&
      j.status !== 'cancelled',
  ).length;
  console.log('');
  console.log(
    remaining === 0
      ? `${COLORS.green}✓ all ${ours.length} jobs done${COLORS.reset}`
      : `${COLORS.dim}${remaining}/${ours.length} still in flight${COLORS.reset}`,
  );
}

async function purge(ids: Set<string>): Promise<void> {
  // Stub jobs litter the gallery with empty 1×1 PNG cells. Delete the
  // ai_jobs rows after we finish so the UI stays clean — ON CASCADE
  // takes care of outputs / attempts / outbox rows. We can't call DB
  // from the script, so shell out to the same psql the harness uses.
  const idList = Array.from(ids)
    .map((s) => `'${s.replace(/'/g, "''")}'`)
    .join(',');
  if (!idList) return;
  const { execSync } = await import('node:child_process');
  const sql = `DELETE FROM ai_jobs WHERE id IN (${idList});`;
  try {
    execSync(
      `docker compose -f docker-compose.dev.yml exec -T postgres ` +
        `psql -U fizzdragon -d fizzdragon -c "${sql}"`,
      { stdio: 'pipe' },
    );
    console.log(
      `\n${COLORS.dim}purged ${ids.size} stub job(s).${COLORS.reset}`,
    );
  } catch (err) {
    console.error('purge failed (manual cleanup needed):', err);
  }
}

async function main() {
  console.log(`fetching schema version from ${BASE}/ai/models …`);
  const schemaVersion = await fetchSchemaVersion();

  console.log(
    `submitting ${COUNT} jobs to ${MODEL_ID} (schema ${schemaVersion})`,
  );
  const submitted = new Set<string>();
  // Ctrl-C cleanup — purge whatever we've submitted so far.
  const onSignal = () => {
    void purge(submitted).finally(() => process.exit(130));
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  for (let i = 0; i < COUNT; i++) {
    const { id, prompt } = await submit(i, schemaVersion);
    submitted.add(id);
    console.log(`  ${i + 1}/${COUNT}  ${id.slice(0, 8)}  ${prompt}`);
  }

  const t0 = Date.now();
  let allDone = false;
  while (!allDone) {
    try {
      const jobs = await listJobs();
      render(jobs, submitted, t0);
      const ours = jobs.filter((j) => submitted.has(j.id));
      allDone =
        ours.length === submitted.size &&
        ours.every(
          (j) =>
            j.status === 'completed' ||
            j.status === 'failed' ||
            j.status === 'cancelled',
        );
    } catch (err) {
      console.error('poll failed:', err);
    }
    if (!allDone) await new Promise((r) => setTimeout(r, TICK_MS));
  }

  if (process.env.AI_TEST_KEEP !== '1') await purge(submitted);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
