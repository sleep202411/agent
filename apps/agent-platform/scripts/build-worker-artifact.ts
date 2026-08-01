import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

type SourceManifest = Readonly<{
  dependencies?: Readonly<Record<string, string>>;
}>;

const execFileAsync = promisify(execFile);
const artifactDirectory = resolve(".temporal/worker");
const sourceManifest = JSON.parse(
  await readFile(resolve("package.json"), "utf8")
) as SourceManifest;
const runtimeDependencyNames = [
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
] as const;

const dependencies = Object.fromEntries(
  runtimeDependencyNames.map((name) => {
    const version = sourceManifest.dependencies?.[name];
    if (!version) {
      throw new Error(`Worker runtime dependency ${name} is not pinned in package.json`);
    }
    return [name, version];
  })
);

await rm(artifactDirectory, { recursive: true, force: true });
await mkdir(resolve(artifactDirectory, "dist"), { recursive: true });
await mkdir(resolve(artifactDirectory, ".temporal"), { recursive: true });
await cp(resolve("dist/src"), resolve(artifactDirectory, "dist/src"), { recursive: true });
await cp(
  resolve(".temporal/workflow-bundle.js"),
  resolve(artifactDirectory, ".temporal/workflow-bundle.js")
);
await writeFile(
  resolve(artifactDirectory, "package.json"),
  `${JSON.stringify(
    {
      name: "fizzdragon-agent-platform-worker",
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: {
        start: "node dist/src/runtime/worker.js",
      },
      engines: {
        node: ">=24.18.0 <25",
        npm: "11.16.0",
      },
      packageManager: "npm@11.16.0",
      dependencies,
      // AI SDK 6 currently requires provider-utils 4.0.41, whose declared
      // undici 5 range has no patched release. Undici 6 retains the fetch and
      // Agent APIs provider-utils uses and is the first maintained patched line.
      overrides: {
        "@ai-sdk/provider-utils@4.0.41": {
          undici: "6.28.0",
        },
      },
      allowScripts: {
        "@swc/core": false,
        protobufjs: false,
      },
    },
    null,
    2
  )}\n`,
  { encoding: "utf8", mode: 0o640 }
);

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
process.stdout.write(`Temporal Worker artifact written to ${artifactDirectory}\n`);
