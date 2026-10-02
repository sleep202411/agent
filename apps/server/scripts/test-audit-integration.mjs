import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const [name, port, database] of [
  ['AI_ACTOR_TEST_DATABASE_URL', '55193', '/ai_actor_review'],
  ['FD_TEMPLATE_TEST_DATABASE_URL', '55441', '/fd_audit'],
]) {
  const url = new URL(process.env[name] ?? 'invalid:');
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    url.port !== port ||
    url.pathname !== database ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${name} requires its dedicated loopback fixture on ${port}${database}`,
    );
  }
}
if (
  process.env.REDIS_RATE_LIMIT_INTEGRATION_URL !==
    'redis://127.0.0.1:56385/15' ||
  process.env.IP_FEEDBACK_SQL_TEST !== '1'
) {
  throw new Error(
    'Owned Redis fixture and IP_FEEDBACK_SQL_TEST=1 are required; never silently skip.',
  );
}
const suites = [
  'src/ai-actors/ai-actors.postgres.spec.ts',
  'src/common/throttle/rate-limit.redis.spec.ts',
  'src/crews/templates/project-task-template.concurrent.spec.ts',
  'src/ip-commerce/ip-publishers.concurrent.spec.ts',
  'src/ip-commerce/ip-episode-feedback.regression.spec.ts',
];
const require = createRequire(import.meta.url);
const dir = mkdtempSync(join(tmpdir(), 'fizz-audit-integration-'));
try {
  const report = join(dir, 'results.json');
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-vm-modules',
      require.resolve('jest/bin/jest'),
      '--runInBand',
      '--json',
      `--outputFile=${report}`,
      '--runTestsByPath',
      ...suites,
    ],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else {
    const data = JSON.parse(readFileSync(report, 'utf8'));
    for (const suite of suites) {
      const entry = data.testResults.find((item) => item.name.endsWith(suite));
      if (
        !entry ||
        !entry.assertionResults.length ||
        entry.assertionResults.some((item) => item.status !== 'passed')
      ) {
        throw new Error(`Suite did not fully execute: ${suite}`);
      }
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
