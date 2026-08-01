import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

type PackageManifest = Readonly<{
  dependencies?: Readonly<Record<string, string>>;
  engines?: Readonly<Record<string, string>>;
  packageManager?: string;
  allowScripts?: Readonly<Record<string, boolean>>;
}>;

type PackageLock = Readonly<{
  packages?: Readonly<
    Record<
      string,
      Readonly<{
        version?: string;
        name?: string;
      }>
    >
  >;
}>;

const outputDirectory = resolve(".mastra/output");
const manifest = readJson<PackageManifest>(resolve(outputDirectory, "package.json"));
const lock = readJson<PackageLock>(resolve(outputDirectory, "package-lock.json"));
const dependencies = manifest.dependencies ?? {};
const expectedEngines = Object.freeze({
  node: ">=24.18.0 <25",
  npm: "11.16.0",
});

assertRuntimeContract("Mastra API", manifest);
assertDeniedInstallScripts("Mastra API", manifest, ["protobufjs"]);

const requiredDependencies = Object.freeze({
  "@mastra/core": "1.55.0",
  "@mastra/ai-sdk": "1.7.0",
  "@mastra/memory": "1.24.0",
  "@mastra/observability": "1.16.3",
  "@mastra/otel-exporter": "1.3.6",
  "@mastra/pg": "1.18.1",
  "@opentelemetry/exporter-logs-otlp-proto": "0.218.0",
  "@opentelemetry/exporter-trace-otlp-proto": "0.218.0",
  "@temporalio/client": "1.21.1",
  "@temporalio/envconfig": "1.21.1",
  "@ably/ai-transport": "0.6.0",
  hono: "4.12.32",
  jose: "6.2.5",
  zod: "4.4.3",
});

for (const [dependency, expected] of Object.entries(requiredDependencies)) {
  const actual = dependencies[dependency];
  if (actual !== expected) {
    throw new Error(
      `Production artifact dependency ${dependency} is ${actual ?? "missing"}; expected ${expected}`
    );
  }
}

for (const forbidden of [
  "@ai-sdk/google",
  "@ai-sdk/google-vertex",
  "@clickhouse/client",
  "@mastra/clickhouse",
  "ai",
  "ably",
  "google-auth-library",
  "libsql",
]) {
  if (dependencies[forbidden]) {
    throw new Error(`Production artifact must not depend on ${forbidden}`);
  }
}

assertLockedVersion("@opentelemetry/exporter-logs-otlp-proto", "0.218.0");
assertLockedVersion("@opentelemetry/exporter-trace-otlp-proto", "0.218.0");
assertLockedVersion("@temporalio/client", "1.21.1");
assertLockedVersion("@temporalio/envconfig", "1.21.1");

const workflowBundle = resolve(".temporal/workflow-bundle.js");
if (!existsSync(workflowBundle) || statSync(workflowBundle).size < 100_000) {
  throw new Error("Temporal workflow bundle is missing or unexpectedly small");
}

const workerDirectory = resolve(".temporal/worker");
const workerManifest = readJson<PackageManifest>(resolve(workerDirectory, "package.json"));
const workerLock = readJson<PackageLock>(resolve(workerDirectory, "package-lock.json"));
const workerDependencies = workerManifest.dependencies ?? {};

assertRuntimeContract("Temporal Worker", workerManifest);
assertDeniedInstallScripts("Temporal Worker", workerManifest, ["@swc/core", "protobufjs"]);

for (const dependency of [
  "@ably/ai-transport",
  "@ai-sdk/google-vertex",
  "@mastra/ai-sdk",
  "@mastra/core",
  "@mastra/memory",
  "@mastra/observability",
  "@mastra/otel-exporter",
  "@mastra/pg",
  "@opentelemetry/exporter-logs-otlp-proto",
  "@opentelemetry/exporter-trace-otlp-proto",
  "@temporalio/activity",
  "@temporalio/common",
  "@temporalio/envconfig",
  "@temporalio/worker",
  "ably",
  "ai",
  "google-auth-library",
  "zod",
]) {
  if (!workerDependencies[dependency]) {
    throw new Error(`Temporal Worker artifact is missing ${dependency}`);
  }
}

for (const forbidden of ["hono", "jose", "temporal-client-v1"]) {
  if (workerDependencies[forbidden]) {
    throw new Error(`Temporal Worker artifact must not depend directly on ${forbidden}`);
  }
}

assertWorkerLockedVersion("@temporalio/activity", "1.21.1");
assertWorkerLockedVersion("@temporalio/client", "1.21.1");
assertWorkerLockedVersion("@temporalio/common", "1.21.1");
assertWorkerLockedVersion("@temporalio/envconfig", "1.21.1");
assertWorkerLockedVersion("@temporalio/worker", "1.21.1");
assertWorkerLockedVersion("@ai-sdk/google-vertex", "4.0.174");
assertWorkerLockedVersion("google-auth-library", "10.9.1");
assertWorkerLockedVersion("undici", "6.28.0");

const packagedWorkflowBundle = resolve(workerDirectory, ".temporal/workflow-bundle.js");
if (!existsSync(packagedWorkflowBundle) || statSync(packagedWorkflowBundle).size < 100_000) {
  throw new Error("Temporal Worker artifact has no valid prebuilt Workflow bundle");
}

const migratorDirectory = resolve(".migrations/agent-memory");
const migratorManifest = readJson<PackageManifest>(resolve(migratorDirectory, "package.json"));
const migratorLock = readJson<PackageLock>(resolve(migratorDirectory, "package-lock.json"));
assertRuntimeContract("Agent Memory migrator", migratorManifest);
for (const [dependency, expected] of Object.entries({
  "@mastra/core": "1.55.0",
  "@mastra/pg": "1.18.1",
})) {
  if (migratorManifest.dependencies?.[dependency] !== expected) {
    throw new Error(
      `Agent Memory migrator dependency ${dependency} is ${
        migratorManifest.dependencies?.[dependency] ?? "missing"
      }; expected ${expected}`
    );
  }
  const entry = migratorLock.packages?.[`node_modules/${dependency}`];
  if (entry?.version !== expected) {
    throw new Error(
      `Agent Memory migrator lock entry ${dependency} is ${
        entry?.version ?? "missing"
      }; expected ${expected}`
    );
  }
}
for (const requiredFile of [
  "dist/migrate-memory.js",
  "migrations/0001_mastra_memory.sql",
  "migrations/0002_memory_identity_invariants.sql",
  "migrations/0003_memory_history_pagination.sql",
  "migrations/0004_mastra_framework_storage.sql",
]) {
  if (!existsSync(resolve(migratorDirectory, requiredFile))) {
    throw new Error(`Agent Memory migrator is missing ${requiredFile}`);
  }
}

process.stdout.write("Production artifact dependency contract is valid.\n");

function assertLockedVersion(
  packageName: string,
  expectedVersion: string,
  expectedName?: string
): void {
  const entry = lock.packages?.[`node_modules/${packageName}`];
  if (entry?.version !== expectedVersion) {
    throw new Error(
      `Production lock entry ${packageName} is ${entry?.version ?? "missing"}; expected ${expectedVersion}`
    );
  }
  if (expectedName && entry.name !== expectedName) {
    throw new Error(
      `Production lock alias ${packageName} resolves to ${entry.name ?? "unknown"}; expected ${expectedName}`
    );
  }
}

function assertWorkerLockedVersion(packageName: string, expectedVersion: string): void {
  const entry = workerLock.packages?.[`node_modules/${packageName}`];
  if (entry?.version !== expectedVersion) {
    throw new Error(
      `Worker lock entry ${packageName} is ${entry?.version ?? "missing"}; expected ${expectedVersion}`
    );
  }
}

function assertRuntimeContract(label: string, packageManifest: PackageManifest): void {
  for (const [runtime, expectedVersion] of Object.entries(expectedEngines)) {
    const actualVersion = packageManifest.engines?.[runtime];
    if (actualVersion !== expectedVersion) {
      throw new Error(
        `${label} engine ${runtime} is ${actualVersion ?? "missing"}; expected ${expectedVersion}`
      );
    }
  }

  const expectedPackageManager = `npm@${expectedEngines.npm}`;
  if (packageManifest.packageManager !== expectedPackageManager) {
    throw new Error(
      `${label} packageManager is ${packageManifest.packageManager ?? "missing"}; expected ${expectedPackageManager}`
    );
  }
}

function assertDeniedInstallScripts(
  label: string,
  packageManifest: PackageManifest,
  dependencies: ReadonlyArray<string>
): void {
  for (const dependency of dependencies) {
    if (packageManifest.allowScripts?.[dependency] !== false) {
      throw new Error(`${label} must explicitly deny install scripts for ${dependency}`);
    }
  }
}

function readJson<T>(path: string): T {
  if (!existsSync(path)) {
    throw new Error(`Missing production artifact file: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
