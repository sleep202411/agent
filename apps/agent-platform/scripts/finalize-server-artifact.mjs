import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const nodeVersion = ">=24.18.0 <25";
const npmVersion = "11.16.0";
const execFileAsync = promisify(execFile);
const artifactDirectory = resolve(".mastra/output");
const sourceManifestPath = resolve("package.json");
const manifestPath = resolve(artifactDirectory, "package.json");
const lockPath = resolve(artifactDirectory, "package-lock.json");

const sourceManifest = JSON.parse(await readFile(sourceManifestPath, "utf8"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

for (const dependency of Object.keys(manifest.dependencies ?? {})) {
  const pinnedVersion = sourceManifest.dependencies?.[dependency];
  if (pinnedVersion) {
    manifest.dependencies[dependency] = pinnedVersion;
  }
}

manifest.engines = {
  node: nodeVersion,
  npm: npmVersion,
};
manifest.packageManager = `npm@${npmVersion}`;
manifest.allowScripts = {
  protobufjs: false,
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o640,
});

const { stdout, stderr } = await execFileAsync(
  "npm",
  ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
  {
    cwd: artifactDirectory,
    env: {
      ...process.env,
      NODE_ENV: "production",
    },
    maxBuffer: 4 * 1024 * 1024,
  }
);

if (stdout.trim()) process.stdout.write(stdout);
if (stderr.trim()) process.stderr.write(stderr);

const lock = JSON.parse(await readFile(lockPath, "utf8"));
const lockRoot = lock.packages?.[""];

if (!lockRoot) {
  throw new Error("Mastra production lock has no root package entry");
}

lockRoot.engines = {
  node: nodeVersion,
  npm: npmVersion,
};

await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o640,
});

process.stdout.write(
  `Mastra server artifact finalized with source-pinned runtime dependencies for Node ${nodeVersion} and npm ${npmVersion}.\n`
);
