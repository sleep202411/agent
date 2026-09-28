import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'legacy-sync-test-'));
  try {
    const target = join(root, 'web'); const source = join(root, 'dist');
    await mkdir(join(target, 'scripts'), {recursive: true});
    await copyFile(new URL('./sync-legacy.mjs', import.meta.url), join(target, 'scripts/sync-legacy.mjs'));
    for (const dir of ['assets', 'static']) {
      await mkdir(join(target, 'public', dir), {recursive: true});
      await mkdir(join(source, dir), {recursive: true});
      await writeFile(join(target, 'public', dir, 'old.txt'), 'old');
      await writeFile(join(source, dir, 'new.js'), 'https://fizzstudio.fizzdragon.com https://fizzstudio.fizzspace.cn');
    }
    await writeFile(join(target, 'public/legacy.html'), 'old html');
    await run({target, source, sync: () => spawnSync(process.execPath, [join(target, 'scripts/sync-legacy.mjs')], {env: {...process.env, LEGACY_DIST: source}, encoding: 'utf8'})});
  } finally {await rm(root, {recursive: true, force: true});}
}

test('invalid HTML fails before changing the installed bundle', async () => fixture(async ({target, source, sync}) => {
  await writeFile(join(source, 'index.html'), '<html><body>incomplete export</body></html>');
  const result = sync();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not find <head>/);
  assert.equal(await readFile(join(target, 'public/legacy.html'), 'utf8'), 'old html');
  for (const dir of ['assets', 'static']) assert.equal(await readFile(join(target, 'public', dir, 'old.txt'), 'utf8'), 'old');
}));

test('valid bundle still replaces assets and injects routing/chrome patches', async () => fixture(async ({target, source, sync}) => {
  await writeFile(join(source, 'index.html'), '<html><head></head><body>new</body></html>');
  const result = sync();
  assert.equal(result.status, 0, result.stderr);
  const html = await readFile(join(target, 'public/legacy.html'), 'utf8');
  assert.match(html, /window.history.replaceState/);
  assert.match(html, /fizz-legacy-hide-chrome/);
  assert.match(await readFile(join(target, 'public/assets/new.js'), 'utf8'), /https:\/\/fizzdragon.com https:\/\/fizzdragon.fizzspace.cn/);
  await assert.rejects(readFile(join(target, 'public/assets/old.txt')), {code: 'ENOENT'});
}));
