import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise the scripts' actual admission functions without running their
// top-level database setup or main(), even when tests fail.
for (const [script, variable] of [
  ['repair-storyboard-node-identities.ts', 'connectionString'],
  ['repair-story-chapter-graphs.ts', 'databaseUrl'],
]) {
  const source = readFileSync(new URL(script, import.meta.url), 'utf8');
  const file = ts.createSourceFile(
    script,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const guard = file.statements.find(
    (node) =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === 'assertDatabaseAllowed',
  );
  assert.ok(guard);
  const js = ts.transpileModule(guard.getText(file), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const load = new Function(variable, `${js}; return assertDatabaseAllowed;`);
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    test(`${script}: admits loopback ${host}`, () => {
      assert.doesNotThrow(() =>
        load(`postgresql://user:pass@${host}:5432/test`)({
          allowRemote: false,
        }),
      );
    });
  }
  for (const url of [
    'postgresql://user:localhost@remote.invalid/test',
    'postgresql://user:pass@remote.invalid/127.0.0.1',
    'postgresql://user:pass@localhost.remote.invalid/test',
    'postgresql://user:pass@remote.invalid/test',
  ]) {
    test(`${script}: rejects unapproved remote ${url}`, () => {
      assert.throws(() => load(url)({ allowRemote: false }), /allow-remote/);
      assert.doesNotThrow(() => load(url)({ allowRemote: true }));
    });
  }
}
