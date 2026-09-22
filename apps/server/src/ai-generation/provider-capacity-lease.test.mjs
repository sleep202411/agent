// Run with node --test; requires redis-server on PATH. Uses only a private Unix socket.
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Module from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import Redis from 'ioredis';
import ts from 'typescript';

const filename = fileURLToPath(
  new URL('./provider-capacity-runtime.service.ts', import.meta.url),
);
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    experimentalDecorators: true,
    emitDecoratorMetadata: false,
  },
}).outputText;
const loaded = new Module(filename);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(dirname(filename));
// Replace only the DI token import; never bootstrap the application's Redis client.
loaded.require = function (specifier) {
  if (specifier === '../infra/redis/redis.module')
    return { REDIS: Symbol('test-redis') };
  return Module.prototype.require.call(this, specifier);
};
loaded._compile(compiled, filename);
const { ProviderCapacityRuntimeService } = loaded.exports;
let directory, child, redis, service;
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'provider-lease-'));
  const socket = join(directory, 'redis.sock');
  child = spawn(
    'redis-server',
    ['--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no'],
    { stdio: 'ignore' },
  );
  let spawnError;
  child.on('error', (error) => {
    spawnError = error;
  });
  for (
    let i = 0;
    i < 150 && !existsSync(socket) && !spawnError && child.exitCode === null;
    i++
  )
    await delay(20);
  if (spawnError) throw spawnError;
  assert.ok(existsSync(socket), 'private Redis socket must start');
  redis = new Redis({ path: socket, lazyConnect: true, retryStrategy: null });
  await redis.connect();
  service = new ProviderCapacityRuntimeService(redis);
});
beforeEach(async () => {
  await redis.flushdb();
});
after(async () => {
  if (redis) await redis.quit();
  if (child && child.exitCode === null) {
    const stopped = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await stopped;
  }
  if (directory) rmSync(directory, { recursive: true, force: true });
});
const job = (id, seconds) => ({
  id,
  provider: 'test',
  deployment: 'shared',
  routingSnapshot: {
    policy: {
      runtime: { maxProviderRuntimeSeconds: seconds },
      providerCapacity: { maxConcurrentRequests: 2 },
    },
  },
});
async function assertLongLeasePreserved() {
  const [key] = await redis.keys('*:active');
  const ttl = await redis.pttl(key);
  assert.ok(
    ttl > 300_000,
    `shared key expired before long reservation: TTL ${ttl}`,
  );
}
test('a short reservation does not shorten the shared long lease', async () => {
  assert.equal(
    (await service.reserveForProviderSubmit(job('long', 600))).ok,
    true,
  );
  assert.equal(
    (await service.reserveForProviderSubmit(job('short', 180))).ok,
    true,
  );
  await assertLongLeasePreserved();
});
test('renewing a short reservation preserves other long reservations', async () => {
  await service.reserveForProviderSubmit(job('long', 600));
  await service.reserveForProviderSubmit(job('short', 180));
  await service.reserveForProviderSubmit(job('long', 600));
  await service.reserveForProviderSubmit(job('short', 180));
  await assertLongLeasePreserved();
});
test('a short-job heartbeat does not shorten the shared long lease', async () => {
  await service.reserveForProviderSubmit(job('long', 600));
  await service.heartbeat(job('short', 180));
  await assertLongLeasePreserved();
});
test('capacity denial and release still admit exactly the available slots', async () => {
  await service.reserveForProviderSubmit(job('one', 600));
  await service.reserveForProviderSubmit(job('two', 600));
  assert.equal(
    (await service.reserveForProviderSubmit(job('three', 600))).reason,
    'provider_concurrency',
  );
  await service.release(job('one', 600));
  assert.equal(
    (await service.reserveForProviderSubmit(job('three', 600))).ok,
    true,
  );
});
