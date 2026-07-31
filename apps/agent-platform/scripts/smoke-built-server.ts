import { spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { SignJWT } from "jose";

const SMOKE_CONVERSATION_ID = "0197f4a2-0800-7000-8000-000000000004";
const OUTSIDE_CONVERSATION_ID = "0197f4a2-0800-7000-8000-000000000099";
const artifact = resolve(".mastra/output/index.mjs");
if (!existsSync(artifact)) {
  throw new Error("Missing .mastra/output/index.mjs; run npm run build:server first.");
}

const port = await findAvailablePort();
const domainGatewayPrivateKey = generateKeyPairSync("ed25519").privateKey;
const child = spawn(process.execPath, [artifact], {
  cwd: dirname(artifact),
  env: {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(port),
    AGENT_RELEASE: "build-smoke",
    AGENT_AUTH_MODE: "local",
    AGENT_LOCAL_JWT_SECRET: "build-smoke-secret-must-be-at-least-32-characters",
    OTEL_EXPORTER_ENDPOINT: "http://127.0.0.1:1/v1/traces",
    OTEL_COLLECTOR_HEALTH_URL: "http://127.0.0.1:1/",
    TEMPORAL_ADDRESS: "127.0.0.1:1",
    TEMPORAL_NAMESPACE: "default",
    TEMPORAL_TASK_QUEUE: "fizzdragon-agent-build-smoke",
    TEMPORAL_WORKER_DEPLOYMENT_NAME: "fizzdragon-agent-platform",
    AGENT_MEMORY_DATABASE_URL: "postgres://server:server@127.0.0.1:1/agent_memory",
    AGENT_MEMORY_DATABASE_ROLE: "server",
    DOMAIN_GATEWAY_URL: "http://127.0.0.1:1",
    DOMAIN_GATEWAY_JWT_PRIVATE_KEY_B64: Buffer.from(
      domainGatewayPrivateKey.export({ format: "pem", type: "pkcs8" })
    ).toString("base64"),
    DOMAIN_GATEWAY_JWT_KEY_ID: "build-smoke-domain-key",
    DOMAIN_GATEWAY_JWT_ISSUER: "fizzdragon-agent-platform",
    DOMAIN_GATEWAY_JWT_AUDIENCE: "fizzdragon-domain-gateway",
    MASTRA_TELEMETRY_DISABLED: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
capture(child.stdout);
capture(child.stderr);

try {
  const origin = `http://127.0.0.1:${port}`;
  await waitForLiveness(child, `${origin}/api/v1/health/live`, 30_000);
  await expectStatus(`${origin}/api/v1/invocations`, 401, { method: "POST" });
  const token = await buildSmokeToken();
  await expectStatus(`${origin}/api/v1/invocations`, 400, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: "{",
  });
  await expectStatus(`${origin}/api/v1/invocations`, 403, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    // A complete agent-invocation/v1 body: the request must reach the session
    // scope check, not stop at request-contract validation.
    body: JSON.stringify({
      inputEventId: "build-smoke-event",
      invocationId: "0197f4a2-0800-7000-8000-000000000010",
      provisionalRunId: "0197f4a2-0800-7000-8000-000000000011",
      attemptId: "0197f4a2-0800-7000-8000-000000000012",
      attemptOrdinal: 0,
      sessionName: `agent:v1:conversation:${OUTSIDE_CONVERSATION_ID}`,
    }),
  });
  await expectStatus(`${origin}/__mastra/agents`, 404);
  await expectStatus(`${origin}/v1/health/live`, 404);
  if (output.includes("falling back to an in-memory store")) {
    throw new Error(`Built server used Mastra's implicit storage fallback.\n${output}`);
  }
  process.stdout.write("Built server reached the liveness endpoint.\n");
} finally {
  await terminate(child);
}

async function expectStatus(
  url: string,
  expectedStatus: number,
  init?: RequestInit
): Promise<void> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(2_000),
  });
  if (response.status !== expectedStatus) {
    throw new Error(`${url} returned ${response.status}; expected ${expectedStatus}.\n${output}`);
  }
  if (
    response.headers.get("cache-control") !== "no-store" ||
    response.headers.get("x-content-type-options") !== "nosniff"
  ) {
    throw new Error(`${url} omitted mandatory response hardening headers.\n${output}`);
  }
}

async function buildSmokeToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({
    agent_context: {
      actorId: "actor-1",
      actorDisplayName: "Actor One",
      conversationId: SMOKE_CONVERSATION_ID,
      surface: "story-studio",
      sessionName: `agent:v1:conversation:${SMOKE_CONVERSATION_ID}`,
      permissionMode: "smart",
      scope: {
        kind: "story-project",
        workspaceId: "workspace-1",
        projectId: "project-1",
      },
      locale: "en-US",
      roles: ["creator"],
      permissions: ["story.read"],
      traceId: "build-smoke-trace",
    },
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject("actor-1")
    .setIssuer("fizzdragon-agent-local")
    .setAudience("fizzdragon-agent-platform")
    .setIssuedAt(now)
    .setExpirationTime(now + 5 * 60)
    .sign(new TextEncoder().encode("build-smoke-secret-must-be-at-least-32-characters"));
}

function capture(stream: NodeJS.ReadableStream | null): void {
  stream?.on("data", (chunk: Buffer | string) => {
    output = (output + chunk.toString()).slice(-16_384);
  });
}

async function waitForLiveness(
  processHandle: ChildProcess,
  url: string,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Built server exited with ${processHandle.exitCode}.\n${output}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
        const body = (await response.json()) as { status?: unknown; service?: unknown };
        if (body.status === "ok" && body.service === "fizzdragon-agent-platform") return;
      }
    } catch {
      // The server is still starting.
    }
    await delay(100);
  }
  throw new Error(`Built server did not become live within ${timeoutMs}ms.\n${output}`);
}

async function terminate(processHandle: ChildProcess): Promise<void> {
  if (processHandle.exitCode !== null) return;
  processHandle.kill("SIGTERM");
  await Promise.race([once(processHandle, "exit"), delay(5_000)]);
  if (processHandle.exitCode === null) {
    processHandle.kill("SIGKILL");
    await once(processHandle, "exit");
  }
}

async function findAvailablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
  return address.port;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
