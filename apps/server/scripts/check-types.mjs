import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const serverRoot = fileURLToPath(new URL('..', import.meta.url));

export function createTypecheckPlan(configFile) {
  const config = ts.readConfigFile(configFile, ts.sys.readFile);
  if (config.error)
    throw new Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, '\n'),
    );
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    dirname(configFile),
    {},
    configFile,
  );
  if (parsed.errors.length)
    throw new Error(
      parsed.errors
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
        .join('\n'),
    );
  const roots = [...parsed.fileNames].sort();
  // Preserve script globals and global/module augmentations in every program.
  const globals = roots.filter((file) => {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    let ambient = false;
    function visit(node) {
      if (
        ts.isModuleDeclaration(node) &&
        (ts.isStringLiteral(node.name) ||
          node.flags & ts.NodeFlags.GlobalAugmentation)
      )
        ambient = true;
      ts.forEachChild(node, visit);
    }
    visit(source);
    return source.isDeclarationFile || !ts.isExternalModule(source) || ambient;
  });
  const production = roots.filter((file) => {
    const path = relative(dirname(configFile), file).replaceAll('\\', '/');
    return path.startsWith('src/') && !path.endsWith('.spec.ts');
  });
  const remaining = roots.filter((file) => !production.includes(file));
  const groups = production.length
    ? [{ name: 'source', files: production }]
    : [];
  for (let offset = 0; offset < remaining.length; offset += 80) {
    groups.push({
      name: `tests-seeds-scripts-${1 + offset / 80}`,
      files: remaining.slice(offset, offset + 80),
    });
  }
  for (const group of groups)
    group.files = [...new Set([...group.files, ...globals])];
  const covered = new Set(groups.flatMap((group) => group.files));
  if (covered.size !== roots.length || roots.some((file) => !covered.has(file)))
    throw new Error('Incomplete Server type-check coverage');
  return {
    roots,
    groups,
    typeRoots: ts.getEffectiveTypeRoots(parsed.options, ts.sys),
  };
}

export function runTypecheck(configFile) {
  const { roots, groups, typeRoots } = createTypecheckPlan(configFile);
  const directory = mkdtempSync(join(tmpdir(), 'fizz-server-types-'));
  try {
    console.log(
      `Checking all ${roots.length} Server roots in ${groups.length} sequential programs (4 GiB heap each).`,
    );
    for (const group of groups) {
      const configPath = join(directory, `${group.name}.json`);
      writeFileSync(
        configPath,
        JSON.stringify({
          extends: configFile,
          compilerOptions: { noEmit: true, typeRoots },
          files: group.files,
          include: [],
        }),
      );
      console.log(
        `Checking ${group.name} (${group.files.length} roots, with full imports)`,
      );
      const started = Date.now();
      const result = spawnSync(
        process.execPath,
        [
          '--max-old-space-size=4096',
          require.resolve('typescript/bin/tsc'),
          '--project',
          configPath,
          '--pretty',
          'false',
        ],
        { stdio: 'inherit', cwd: dirname(configFile) },
      );
      if (result.error) throw result.error;
      if (result.status !== 0) return result.status ?? 1;
      console.log(
        `Passed ${group.name} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
    }
    return 0;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = runTypecheck(join(serverRoot, 'tsconfig.spec.json'));
}
