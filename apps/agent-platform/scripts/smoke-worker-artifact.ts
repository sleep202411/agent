import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const sourceArtifact = resolve(".temporal/worker");
const isolatedRoot = await mkdtemp(join(tmpdir(), "fizzdragon-agent-worker-smoke-"));
const isolatedArtifact = join(isolatedRoot, "worker");
const domainGatewayPrivateKey = generateKeyPairSync("ed25519").privateKey;

try {
  await cp(sourceArtifact, isolatedArtifact, {
    recursive: true,
    verbatimSymlinks: true,
  });

  const probe = [
    'const runtime = await import("./dist/src/runtime/dependencies.js");',
    "const dependencies = runtime.createRuntimeDependencies();",
    'const undici = await import("undici");',
    'if (!dependencies.agent || !dependencies.mastra) throw new Error("Worker composition failed");',
    'if (typeof undici.fetch !== "function" || typeof undici.Agent !== "function")',
    '  throw new Error("Patched Undici runtime contract is unavailable");',
    'process.stdout.write("Standalone Worker artifact initialized successfully.\\n");',
    "process.exit(0);",
  ].join("\n");

  const child = spawn(process.execPath, ["--input-type=module", "--eval", probe], {
    cwd: isolatedArtifact,
    env: {
      NODE_ENV: "development",
      AGENT_RELEASE: "worker-build-smoke",
      GOOGLE_CLOUD_PROJECT: "glass-proxy-501907-d2",
      GOOGLE_CLOUD_LOCATION: "global",
      AGENT_INTERACTIVE_MODEL_ID: "gemini-2.5-flash",
      AGENT_REASONING_MODEL_ID: "gemini-2.5-pro",
      AGENT_MEMORY_OBSERVER_MODEL_ID: "gemini-2.5-flash",
      OTEL_EXPORTER_ENDPOINT: "http://127.0.0.1:1/v1/traces",
      TEMPORAL_ADDRESS: "127.0.0.1:1",
      TEMPORAL_NAMESPACE: "default",
      TEMPORAL_TASK_QUEUE: "fizzdragon-agent-worker-build-smoke",
      TEMPORAL_WORKER_DEPLOYMENT_NAME: "fizzdragon-agent-platform",
      ABLY_API_KEY: "worker-build-smoke:secret",
      AGENT_MEMORY_DATABASE_URL: "postgres://worker:worker@127.0.0.1:1/agent_memory",
      AGENT_MEMORY_DATABASE_ROLE: "worker",
      DOMAIN_GATEWAY_URL: "http://127.0.0.1:1",
      DOMAIN_GATEWAY_JWT_PRIVATE_KEY_B64: Buffer.from(
        domainGatewayPrivateKey.export({ format: "pem", type: "pkcs8" })
      ).toString("base64"),
      DOMAIN_GATEWAY_JWT_KEY_ID: "worker-build-smoke-domain-key",
      DOMAIN_GATEWAY_JWT_ISSUER: "fizzdragon-agent-platform",
      DOMAIN_GATEWAY_JWT_AUDIENCE: "fizzdragon-domain-gateway",
      MASTRA_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  const [exitCode, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];

  if (exitCode !== 0) {
    throw new Error(
      `Standalone Worker artifact exited with ${exitCode ?? signal ?? "unknown"}.\n${output}`
    );
  }
  if (!output.includes("Standalone Worker artifact initialized successfully.")) {
    throw new Error(`Standalone Worker artifact did not complete its probe.\n${output}`);
  }
  process.stdout.write(output);

  function capture(chunk: Buffer | string): void {
    output = (output + chunk.toString()).slice(-32_768);
  }
} finally {
  await rm(isolatedRoot, { recursive: true, force: true });
}
