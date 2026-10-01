import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const raw = process.env.CONTENT_GPS_TEST_DATABASE_URL;
if (!raw)
  throw new Error(
    'CONTENT_GPS_TEST_DATABASE_URL is required; GPS tests must not silently skip.',
  );
const url = new URL(raw);
if (
  !['postgres:', 'postgresql:'].includes(url.protocol) ||
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.port !== '55441' ||
  url.pathname !== '/gps_test' ||
  url.hash ||
  [...url.searchParams.keys()].some(
    (key) => !['sslmode', 'application_name'].includes(key),
  )
) {
  throw new Error(
    'GPS tests require the dedicated loopback database on port 55441 named gps_test.',
  );
}

const require = createRequire(import.meta.url);
// These suites create/drop common tables. One worker is part of the fixture contract.
const result = spawnSync(
  process.execPath,
  [
    require.resolve('jest/bin/jest'),
    '--runInBand',
    '--runTestsByPath',
    'src/ip-commerce/content-gps-locations.postgres.spec.ts',
    'src/ip-commerce/content-gps-analysis.postgres.spec.ts',
    'src/ip-commerce/content-gps-search.postgres.spec.ts',
    'src/creator-services/creator-locations.postgres.spec.ts',
    'src/creator-services/creator-geocoding.postgres.spec.ts',
    'src/creator-services/creator-discovery.postgres.spec.ts',
    'src/discovery-assistant/discovery-assistant.postgres.spec.ts',
  ],
  { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
