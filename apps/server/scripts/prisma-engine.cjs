'use strict';

// Build-time preparation and offline verification only. No application or
// database module is imported; the engine is invoked solely with --version.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../../..');
const binary = '/opt/prisma/schema-engine';
const manifestFile = '/opt/prisma/schema-engine.json';
const readJson = (filename) => JSON.parse(fs.readFileSync(filename, 'utf8'));
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};

function lockedPackage(filename, lock) {
  const pkg = readJson(filename);
  const location = path
    .relative(root, path.dirname(filename))
    .split(path.sep)
    .join('/');
  check(
    location.startsWith('node_modules/'),
    'Prisma package is outside the image workspace',
  );
  check(
    lock.packages?.[location]?.version === pkg.version,
    `Lock mismatch for ${pkg.name}`,
  );
  return pkg;
}

async function engineContext() {
  check(
    process.platform === 'linux' && ['x64', 'arm64'].includes(process.arch),
    'The server image requires Linux amd64 or arm64',
  );
  const lock = readJson(path.join(root, 'package-lock.json'));
  const cli = lockedPackage(require.resolve('prisma/package.json'), lock);
  const enginesFile = require.resolve('@prisma/engines/package.json');
  const engines = lockedPackage(enginesFile, lock);
  const engineRequire = createRequire(enginesFile);
  const version = lockedPackage(
    engineRequire.resolve('@prisma/engines-version/package.json'),
    lock,
  );
  const commit = engineRequire('@prisma/engines-version').enginesVersion;
  check(
    cli.version === engines.version,
    'Prisma CLI and engines package versions differ',
  );
  check(
    engines.dependencies['@prisma/engines-version'] === version.version,
    'Prisma engine version dependency is not locked',
  );
  check(
    /^[a-f0-9]{40}$/.test(commit) && version.prisma.enginesVersion === commit,
    'Prisma engine commit metadata differs',
  );
  const platform = await engineRequire(
    '@prisma/get-platform',
  ).getPlatformInfo();
  check(
    platform.targetDistro === 'musl' && platform.libssl === '3.0.x',
    'The server image requires Alpine with OpenSSL 3',
  );
  return {
    engineRequire,
    enginesDirectory: path.dirname(enginesFile),
    metadata: {
      formatVersion: 1,
      prismaVersion: cli.version,
      enginesPackageVersion: engines.version,
      enginesVersionPackageVersion: version.version,
      engineCommit: commit,
      binaryTarget: platform.binaryTarget,
    },
  };
}

function inspectBinary(filename, commit) {
  const stat = fs.statSync(filename);
  check(
    stat.isFile() && stat.size > 0 && stat.mode & 0o111,
    'Prisma engine is not executable',
  );
  const output = execFileSync(filename, ['--version'], {
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 16384,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  check(
    output.match(/^schema-engine-cli ([a-f0-9]{40})(?:\s|$)/)?.[1] === commit,
    'Prisma engine binary does not match the locked commit',
  );
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filename))
    .digest('hex');
}

async function main(mode) {
  check(
    ['prepare', 'verify'].includes(mode),
    'Usage: prisma-engine.cjs prepare|verify',
  );
  const context = await engineContext();
  if (mode === 'prepare') {
    for (const name of [
      'PRISMA_SCHEMA_ENGINE_BINARY',
      'PRISMA_MIGRATION_ENGINE_BINARY',
      'BINARY_DOWNLOAD_VERSION',
      'PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING',
    ]) {
      check(!process.env[name], `Unexpected build-time override: ${name}`);
    }
    await context.engineRequire('@prisma/fetch-engine').download({
      binaries: { 'schema-engine': context.enginesDirectory },
      binaryTargets: [context.metadata.binaryTarget],
      version: context.metadata.engineCommit,
      showProgress: false,
      failSilent: false,
    });
    const source = path.join(
      context.enginesDirectory,
      `schema-engine-${context.metadata.binaryTarget}`,
    );
    const sha256 = inspectBinary(source, context.metadata.engineCommit);
    fs.mkdirSync(path.dirname(binary), { recursive: true, mode: 0o755 });
    fs.copyFileSync(source, binary);
    fs.chmodSync(binary, 0o555);
    check(
      inspectBinary(binary, context.metadata.engineCommit) === sha256,
      'Copied Prisma engine hash differs',
    );
    fs.writeFileSync(
      manifestFile,
      JSON.stringify({ ...context.metadata, sha256 }) + '\n',
      { mode: 0o444 },
    );
  } else {
    check(
      process.env.PRISMA_SCHEMA_ENGINE_BINARY === binary,
      'Prisma CLI engine path is not fixed',
    );
    const manifest = readJson(manifestFile);
    for (const [name, expected] of Object.entries(context.metadata)) {
      check(
        manifest[name] === expected,
        `Prisma engine manifest mismatch: ${name}`,
      );
    }
    check(
      inspectBinary(binary, context.metadata.engineCommit) === manifest.sha256,
      'Prisma engine content hash differs from its build manifest',
    );
  }
  console.log(
    JSON.stringify({
      mode,
      ...context.metadata,
      sha256: readJson(manifestFile).sha256,
    }),
  );
}

if (require.main === module) {
  main(process.argv.length === 3 ? process.argv[2] : '').catch((error) => {
    console.error(`Prisma engine validation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
