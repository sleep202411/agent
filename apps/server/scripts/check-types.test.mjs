import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createTypecheckPlan, runTypecheck } from './check-types.mjs';

test('covers every root, retains ambient declarations, and fails on an error in the last group', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fizz-typecheck-contract-'));
  try {
    mkdirSync(join(dir, 'src'));
    mkdirSync(join(dir, 'node_modules/@types/fixture'), { recursive: true });
    writeFileSync(
      join(dir, 'node_modules/@types/fixture/index.d.ts'),
      'interface AutoGlobal { value: string }',
    );
    writeFileSync(
      join(dir, 'src/model.ts'),
      'export interface Model { id: number }',
    );
    writeFileSync(
      join(dir, 'global.ts'),
      'export {}; declare global { interface FixtureGlobal { value: string } }',
    );
    for (let i = 0; i < 81; i++)
      writeFileSync(
        join(dir, `fixture-${String(i).padStart(3, '0')}.ts`),
        'export const fixture: FixtureGlobal & AutoGlobal = { value: "ok" };',
      );
    writeFileSync(
      join(dir, 'z-last.ts'),
      'import type { Model } from "./src/model"; export const invalid: Model = { id: "wrong" };',
    );
    const config = join(dir, 'tsconfig.json');
    writeFileSync(
      config,
      JSON.stringify({
        compilerOptions: {
          target: 'ES2023',
          module: 'commonjs',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: ['fixture'],
        },
        include: ['**/*.ts'],
      }),
    );
    const { roots, groups } = createTypecheckPlan(config);
    assert.equal(roots.length, 84);
    assert.equal(groups.length, 3);
    assert.deepEqual(new Set(groups.flatMap((g) => g.files)), new Set(roots));
    for (const group of groups)
      assert.ok(group.files.includes(join(dir, 'global.ts')));
    assert.ok(groups.at(-1).files.includes(join(dir, 'z-last.ts')));
    assert.equal(runTypecheck(config), 2);
    writeFileSync(
      join(dir, 'z-last.ts'),
      'import type { Model } from "./src/model"; export const valid: Model = { id: 1 };',
    );
    assert.equal(runTypecheck(config), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
