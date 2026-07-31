import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

type SourceManifest = Readonly<{
  dependencies?: Readonly<Record<string, string>>;
}>;

const execFileAsync = promisify(execFile);
const artifactDirectory = resolve(".migrations/agent-memory");
const sourceManifest = JSON.parse(
  await readFile(resolve("package.json"), "utf8")
) as SourceManifest;
const dependencies = Object.fromEntries(
  ["@mastra/core", "@mastra/pg"].map((name) => {
    const version = sourceManifest.dependencies?.[name];
    if (!version) {
      throw new Error(`Agent Memory migrator dependency ${name} is not pinned`);
    }
    return [name, version];
  })
);

await rm(artifactDirectory, { recursive: true, force: true });
await mkdir(resolve(artifactDirectory, "dist"), { recursive: true });
await cp(
  resolve("dist/scripts/migrate-memory.js"),
  resolve(artifactDirectory, "dist/migrate-memory.js")
);
await cp(resolve("migrations"), resolve(artifactDirectory, "migrations"), { recursive: true });
await writeFile(
  resolve(artifactDirectory, "package.json"),
  `${JSON.stringify(
    {
      name: "fizzdragon-agent-memory-migrator",
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: {
        start: "node dist/migrate-memory.js",
      },
      engines: {
        node: ">=24.18.0 <25",
        npm: "11.16.0",
      },
      packageManager: "npm@11.16.0",
      dependencies,
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
process.stdout.write(`Agent Memory migrator artifact written to ${artifactDirectory}\n`);
