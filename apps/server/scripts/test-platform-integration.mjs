// Explicit local fixtures only; fail if any selected regression is skipped.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const auditVariables = [
  'CONTENT_GPS_TEST_DATABASE_URL',
  'CONTRACT_RETENTION_TEST_DATABASE_URL',
  'DISPUTE_LIST_TEST_DATABASE_URL',
  'REPORT_PURCHASE_TEST_DATABASE_URL',
  'STORYBOARD_EXPORT_TEST_DATABASE_URL',
  'TASK_CONTRACTS_TEST_DATABASE_URL',
  'TASK_DELIVERY_FOLDER_TEST_DATABASE_URL',
  'TASK_FEEDBACK_TEST_DATABASE_URL',
  'WITHDRAWAL_TEST_DATABASE_URL',
];
for (const [name, port, database] of [
  ...auditVariables.map((name) => [
    name,
    '55441',
    '/audit_migrations_20261005',
  ]),
  ...[
    'LOCAL_AUDIT_DATABASE_URL',
    'TASK01_TEST_DATABASE_URL',
    'PROJECT_SECTIONS_TEST_DATABASE_URL',
    'PROJECT_SKILLS_TEST_DATABASE_URL',
  ].map((name) => [name, '55439', '/task01']),
]) {
  const url = new URL(process.env[name] ?? 'invalid:');
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    url.port !== port ||
    url.pathname !== database ||
    url.search ||
    url.hash
  )
    throw new Error(
      `${name} requires the dedicated loopback fixture on ${port}${database}, without URL options`,
    );
}
for (const name of [
  'S3_LOCAL_INTEGRATION',
  'STORYBOARD_RENDER_INTEGRATION',
  'MEDIA_RETENTION_SCALE',
  'WITHDRAWAL_SCALE_TEST',
]) {
  if (process.env[name] !== '1')
    throw new Error(`${name}=1 is required; never silently skip`);
}
const suites = [
  'src/creator-services/device-city.postgres.spec.ts',
  'src/referrals/referral-cash-totals.postgres.spec.ts',
  'src/notification/notification.postgres.integration.spec.ts',
  'src/crews/assets/task-contract-retention.postgres.spec.ts',
  'src/crews/assets/media-retention-query.postgres.spec.ts',
  'src/crews/tasks/dispute-list.postgres.spec.ts',
  'src/crews/tasks/task-contracts.postgres.spec.ts',
  'src/crews/tasks/task-delivery-folder.postgres.spec.ts',
  'src/crews/accountability/task-feedback.postgres.spec.ts',
  'src/creator-withdrawals/creator-withdrawals.postgres.spec.ts',
  'src/creator-withdrawals/revenue-distribution.postgres.spec.ts',
  'src/project-sections/project-sections.postgres.spec.ts',
  'src/project-skills/project-skills.postgres.spec.ts',
  'src/ip-commerce/report-purchases.postgres.spec.ts',
  'src/storyboard-export/storyboard-export-queue.postgres.spec.ts',
  'src/storyboard-export/saved-storyboard.postgres.spec.ts',
  'src/storyboard-export/local-video-renderer.spec.ts',
  'src/infra/storage/s3-storage.local-integration.spec.ts',
];
const require = createRequire(import.meta.url);
const dir = mkdtempSync(join(tmpdir(), 'fizz-platform-integration-'));
try {
  const report = join(dir, 'results.json');
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-vm-modules',
      require.resolve('jest/bin/jest'),
      '--runInBand',
      '--testTimeout=30000',
      '--json',
      `--outputFile=${report}`,
      '--runTestsByPath',
      ...suites,
    ],
    { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit' },
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
