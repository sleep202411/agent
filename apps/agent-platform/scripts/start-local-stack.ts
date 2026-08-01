import { generateKeyPairSync, type JsonWebKey } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "..");
const repositoryDirectory = resolve(appDirectory, "../..");
const localStateDirectory = resolve(appDirectory, ".local");
const localPostgresUrl = "postgres://fizzdragon:fizzdragon@127.0.0.1:5433/fizzdragon";
const localRedisUrl = "redis://127.0.0.1:6380";
const temporalAddress = "127.0.0.1:7233";
/**
 * One base queue for both sides. The Worker expands its lanes through
 * agentTaskQueues() and the product gateway appends "-document" itself, so a
 * literal on each side would drift silently: document analysis would be marked
 * dispatched onto a queue nobody polls and hang in `processing` forever.
 */
const localTemporalTaskQueue = "fizzdragon-agent";
/**
 * Admission is a correctness boundary with no defaults in the server's schema —
 * a deployment must state the capacity it will reserve. Those values are
 * deployment policy rather than developer secrets, so the local stack supplies
 * them the same way it supplies ports and signing keys. Spread before the
 * developer's .env so a local override still wins.
 */
const localAdmissionPolicy: NodeJS.ProcessEnv = {
  AGENT_ADMISSION_PROVIDER_LANE: "gemini",
  AGENT_ADMISSION_RETRY_AFTER_SECONDS: "5",
  AGENT_ADMISSION_RESERVED_TOKEN_UNITS_PER_RUN: "131072",
  AGENT_ADMISSION_RESERVED_COST_MICROUSD_PER_RUN: "500000",
  AGENT_ADMISSION_MAX_ACTIVE_GLOBAL: "64",
  AGENT_ADMISSION_MAX_ACTIVE_PER_WORKSPACE: "8",
  AGENT_ADMISSION_MAX_ACTIVE_PER_ACTOR: "2",
  AGENT_ADMISSION_MAX_ACTIVE_PER_PROVIDER_LANE: "32",
  AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_GLOBAL: "8388608",
  AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_WORKSPACE: "1048576",
  AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_ACTOR: "262144",
  AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_PROVIDER_LANE: "4194304",
  AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_GLOBAL: "32000000",
  AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_PER_WORKSPACE: "4000000",
  AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_PER_ACTOR: "1000000",
  AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_PER_PROVIDER_LANE: "16000000",
};
const temporalWorkerDeploymentName = "fizzdragon-agent-platform";
const localAgentRelease = "local-dev";
const localCollectorImage =
  "otel/opentelemetry-collector-contrib:0.157.0@sha256:f2f01157055a9b2aab9df7118e1f1c9abf345e99b23bc7a2bc791db374a7d0f6";
const localCollectorConfig = resolve(appDirectory, "deploy/otel-collector/local.yaml");
const platformIssuer = "http://127.0.0.1:4399/agent-platform";
const platformAudience = "fizzdragon-agent-platform";
const domainIssuer = "fizzdragon-agent-platform";
const domainAudience = "fizzdragon-domain-gateway";
const managedChildren: ManagedChild[] = [];
let shuttingDown = false;

type ManagedChild = Readonly<{
  name: string;
  process: ChildProcess;
}>;

async function main(): Promise<void> {
  const [serverFileEnvironment, agentFileEnvironment] = await Promise.all([
    loadEnvironmentFile(resolve(repositoryDirectory, "apps/server/.env")),
    loadEnvironmentFile(resolve(appDirectory, ".env")),
  ]);
  const inheritedEnvironment = definedEnvironment(process.env);
  const sourceEnvironment = {
    ...serverFileEnvironment,
    ...agentFileEnvironment,
    ...inheritedEnvironment,
  };

  const ablyApiKey = requireEnvironment(sourceEnvironment, "ABLY_API_KEY");
  if (!/^[\w-]+\.[\w-]+:[\w+/=-]+$/u.test(ablyApiKey)) {
    throw new Error("ABLY_API_KEY in apps/server/.env is not a complete Ably API key");
  }
  for (const variable of [
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_CLOUD_LOCATION",
    "AGENT_INTERACTIVE_MODEL_ID",
    "AGENT_REASONING_MODEL_ID",
    "AGENT_MEMORY_OBSERVER_MODEL_ID",
  ] as const) {
    requireEnvironment(sourceEnvironment, variable);
  }

  await Promise.all([
    assertLocalDependency("PostgreSQL", 5433),
    assertLocalDependency("Redis", 6380),
  ]);
  await assertPortAvailable("Agent Platform API", 4111);
  await assertPortAvailable("Agent Platform Worker health", 3010);
  await assertPortAvailable("Agent Platform Worker metrics", 9464);
  await assertPortAvailable("FizzDragon Server", 4399);
  await mkdir(localStateDirectory, { recursive: true });

  const platformIdentity = createSigningIdentity("agent-platform-local-1");
  const domainIdentity = createSigningIdentity("agent-domain-local-1", "runtime");
  const serverEnvironment: NodeJS.ProcessEnv = {
    ...localAdmissionPolicy,
    ...serverFileEnvironment,
    ...inheritedEnvironment,
    NODE_ENV: "development",
    PORT: "4399",
    AGENT_PLATFORM_TEMPORAL_TASK_QUEUE: localTemporalTaskQueue,
    DATABASE_URL: localPostgresUrl,
    REDIS_URL: localRedisUrl,
    TEMPORAL_ADDRESS: temporalAddress,
    TEMPORAL_NAMESPACE: "default",
    TEMPORAL_TLS_MODE: "disabled",
    AGENT_PLATFORM_ENABLED: "true",
    AGENT_PLATFORM_URL: "http://127.0.0.1:4111",
    AGENT_PLATFORM_JWT_PRIVATE_KEY_B64: platformIdentity.privateKeyBase64,
    AGENT_PLATFORM_JWT_KEY_ID: platformIdentity.keyId,
    AGENT_PLATFORM_JWT_ISSUER: platformIssuer,
    AGENT_PLATFORM_JWT_AUDIENCE: platformAudience,
    AGENT_DOMAIN_JWKS_B64: domainIdentity.publicJwksBase64,
    AGENT_DOMAIN_JWT_ISSUER: domainIssuer,
    AGENT_DOMAIN_JWT_AUDIENCE: domainAudience,
    ABLY_API_KEY: ablyApiKey,
  };
  const agentEnvironment: NodeJS.ProcessEnv = {
    ...agentFileEnvironment,
    ...inheritedEnvironment,
    NODE_ENV: "development",
    PORT: "4111",
    AGENT_RELEASE: localAgentRelease,
    MASTRA_TELEMETRY_DISABLED: "1",
    AGENT_AUTH_MODE: "jwks",
    AGENT_JWKS_URL: "http://127.0.0.1:4399/agent-platform/.well-known/jwks.json",
    AGENT_JWT_ISSUER: platformIssuer,
    AGENT_JWT_AUDIENCE: platformAudience,
    OTEL_EXPORTER_ENDPOINT: "http://127.0.0.1:4318/v1/traces",
    OTEL_COLLECTOR_HEALTH_URL: "http://127.0.0.1:13133/",
    TEMPORAL_ADDRESS: temporalAddress,
    TEMPORAL_NAMESPACE: "default",
    TEMPORAL_TASK_QUEUE: localTemporalTaskQueue,
    TEMPORAL_WORKER_DEPLOYMENT_NAME: temporalWorkerDeploymentName,
    AGENT_WORKER_HEALTH_HOST: "127.0.0.1",
    AGENT_WORKER_HEALTH_PORT: "3010",
    AGENT_WORKER_METRICS_BIND_ADDRESS: "127.0.0.1:9464",
    ABLY_API_KEY: ablyApiKey,
    AGENT_MEMORY_DATABASE_URL: localPostgresUrl,
    AGENT_MEMORY_DATABASE_ROLE: "fizzdragon",
    AGENT_MEMORY_MIGRATION_DATABASE_URL: localPostgresUrl,
    AGENT_MEMORY_API_DATABASE_ROLE: "fizzdragon",
    AGENT_MEMORY_WORKER_DATABASE_ROLE: "fizzdragon",
    DOMAIN_GATEWAY_URL: "http://127.0.0.1:4399",
    DOMAIN_GATEWAY_JWT_PRIVATE_KEY_B64: domainIdentity.privateKeyBase64,
    DOMAIN_GATEWAY_JWT_KEY_ID: domainIdentity.keyId,
    DOMAIN_GATEWAY_JWT_ISSUER: domainIssuer,
    DOMAIN_GATEWAY_JWT_AUDIENCE: domainAudience,
  };

  installSignalHandlers();
  await ensureTemporal();
  await ensureOpenTelemetryCollector();
  await runToCompletion(
    "product migrations",
    "npm",
    ["run", "db:deploy", "-w", "server"],
    repositoryDirectory,
    serverEnvironment
  );
  await runToCompletion(
    "Agent Memory migrations",
    "npm",
    ["run", "memory:migrate"],
    appDirectory,
    agentEnvironment
  );
  await runToCompletion(
    "Agent Worker build",
    "npm",
    ["run", "compile:worker"],
    appDirectory,
    agentEnvironment
  );

  startManaged(
    "server",
    "npm",
    ["run", "start:dev", "-w", "server"],
    repositoryDirectory,
    serverEnvironment
  );
  await waitForHttp(
    "FizzDragon Server JWKS",
    "http://127.0.0.1:4399/agent-platform/.well-known/jwks.json",
    300_000
  );

  startManaged("agent-worker", "npm", ["run", "start:worker"], appDirectory, agentEnvironment);
  await waitForHttp(
    "Agent Platform Worker readiness",
    "http://127.0.0.1:3010/health/ready",
    90_000
  );
  await runToCompletion(
    "Temporal Worker Deployment routing",
    temporalExecutable(),
    [
      "worker",
      "deployment",
      "set-current-version",
      "--address",
      temporalAddress,
      "--namespace",
      "default",
      "--deployment-name",
      temporalWorkerDeploymentName,
      "--build-id",
      localAgentRelease,
      "--yes",
    ],
    appDirectory,
    definedEnvironment(process.env)
  );

  startManaged("agent-api", "npm", ["run", "dev:api"], appDirectory, agentEnvironment);
  await waitForHttp(
    "Agent Platform API liveness",
    "http://127.0.0.1:4111/api/v1/health/live",
    300_000
  );
  await waitForHttp(
    "Agent Platform API readiness",
    "http://127.0.0.1:4111/api/v1/health/ready",
    300_000
  );

  process.stdout.write(
    [
      "",
      "FizzDragon Agent Platform local stack is ready.",
      "API:         http://127.0.0.1:4111",
      "Worker:      http://127.0.0.1:3010/health/ready",
      "Server:      http://127.0.0.1:4399",
      "Temporal UI: http://127.0.0.1:8233",
      "Press Ctrl+C to stop only the processes started by this command.",
      "",
    ].join("\n")
  );

  await new Promise<never>(() => undefined);
}

async function ensureTemporal(): Promise<void> {
  if (await canConnect(7233)) {
    await runToCompletion(
      "Temporal health",
      temporalExecutable(),
      ["operator", "cluster", "health", "--address", temporalAddress],
      appDirectory,
      definedEnvironment(process.env)
    );
    process.stdout.write("[temporal] Reusing the healthy local server on 127.0.0.1:7233.\n");
    return;
  }
  await assertPortAvailable("Temporal UI", 8233);
  startManaged(
    "temporal",
    temporalExecutable(),
    [
      "server",
      "start-dev",
      "--ip",
      "127.0.0.1",
      "--port",
      "7233",
      "--ui-port",
      "8233",
      "--ui-disable-news-fetch",
      "--db-filename",
      resolve(localStateDirectory, "temporal.db"),
      "--log-level",
      "warn",
    ],
    appDirectory,
    definedEnvironment(process.env)
  );
  await waitForPort("Temporal", 7233, 30_000);
}

async function ensureOpenTelemetryCollector(): Promise<void> {
  if (await canConnect(13133)) {
    await assertHttpHealthy("OpenTelemetry Collector", "http://127.0.0.1:13133/");
    if (!(await canConnect(4318))) {
      throw new Error(
        "OpenTelemetry Collector health is available, but OTLP/HTTP is not listening on 127.0.0.1:4318"
      );
    }
    process.stdout.write(
      "[otel-collector] Reusing the healthy local Collector on 127.0.0.1:4318.\n"
    );
    return;
  }

  await assertPortAvailable("OpenTelemetry OTLP/HTTP", 4318);
  await runQuietly(
    "docker",
    ["image", "inspect", localCollectorImage],
    appDirectory,
    definedEnvironment(process.env)
  ).catch(() => {
    throw new Error(
      `The pinned OpenTelemetry Collector image is missing. Run: docker pull ${localCollectorImage}`
    );
  });
  startManaged(
    "otel-collector",
    "docker",
    [
      "run",
      "--rm",
      "--pull=never",
      "--name",
      "fizzdragon-agent-otel-local",
      "--label",
      "com.fizzdragon.local-stack=agent-platform",
      "--publish",
      "127.0.0.1:4318:4318",
      "--publish",
      "127.0.0.1:13133:13133",
      "--volume",
      `${localCollectorConfig}:/etc/otelcol-contrib/config.yaml:ro`,
      localCollectorImage,
      "--config=/etc/otelcol-contrib/config.yaml",
    ],
    appDirectory,
    definedEnvironment(process.env)
  );
  await waitForHttp("OpenTelemetry Collector", "http://127.0.0.1:13133/", 30_000);
}

/* The Server binds each domain-signing kid to a capability and refuses a JWKS
   whose keys omit it, so the published JWK must declare one. The local stack
   runs the API and the Worker as a single process behind one domain key, so
   that key is legitimately "runtime" — it has to reach business commands. */
function createSigningIdentity(
  keyId: string,
  capability: "readiness" | "runtime" = "runtime"
): Readonly<{
  keyId: string;
  privateKeyBase64: string;
  publicJwksBase64: string;
}> {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicJwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  const jwks = {
    keys: [
      {
        ...publicJwk,
        kid: keyId,
        alg: "EdDSA",
        use: "sig",
        fizzdragon_capability: capability,
      },
    ],
  };
  return Object.freeze({
    keyId,
    privateKeyBase64: Buffer.from(privateKey.export({ format: "pem", type: "pkcs8" })).toString(
      "base64"
    ),
    publicJwksBase64: Buffer.from(JSON.stringify(jwks)).toString("base64"),
  });
}

async function loadEnvironmentFile(path: string): Promise<Record<string, string>> {
  try {
    return definedEnvironment(parseEnv(await readFile(path, "utf8")));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return {};
    throw error;
  }
}

function definedEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

function requireEnvironment(
  environment: Readonly<Record<string, string>>,
  variable: string
): string {
  const value = environment[variable]?.trim();
  if (!value) {
    throw new Error(
      `${variable} is required. Configure it in apps/agent-platform/.env or apps/server/.env.`
    );
  }
  return value;
}

async function assertLocalDependency(name: string, port: number): Promise<void> {
  if (!(await canConnect(port))) {
    throw new Error(`${name} is not reachable at 127.0.0.1:${port}`);
  }
}

async function assertPortAvailable(name: string, port: number): Promise<void> {
  if (await canConnect(port)) {
    throw new Error(`${name} cannot start because 127.0.0.1:${port} is already in use`);
  }
}

async function waitForPort(name: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(port)) return;
    await delay(200);
  }
  throw new Error(`${name} did not open 127.0.0.1:${port} within ${timeoutMs}ms`);
}

async function canConnect(port: number): Promise<boolean> {
  return new Promise((resolveConnection) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(250);
    socket.once("connect", () => {
      socket.destroy();
      resolveConnection(true);
    });
    const unavailable = () => {
      socket.destroy();
      resolveConnection(false);
    };
    socket.once("error", unavailable);
    socket.once("timeout", unavailable);
  });
}

async function waitForHttp(name: string, url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus: number | undefined;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(2_000),
      });
      lastStatus = response.status;
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      // The process can be healthy before its listener is bound.
    }
    await delay(300);
  }
  throw new Error(
    `${name} did not become ready within ${timeoutMs}ms${
      lastStatus === undefined ? "" : ` (last HTTP status ${lastStatus})`
    }`
  );
}

async function assertHttpHealthy(name: string, url: string): Promise<void> {
  const response = await fetch(url, {
    headers: { accept: "application/json, text/plain;q=0.9" },
    signal: AbortSignal.timeout(2_000),
  });
  await response.body?.cancel();
  if (!response.ok) {
    throw new Error(`${name} returned HTTP ${response.status} at ${url}`);
  }
}

function temporalExecutable(): string {
  const configured = process.env.TEMPORAL_CLI_PATH?.trim();
  if (configured) return configured;
  const homebrew = "/opt/homebrew/bin/temporal";
  try {
    accessSync(homebrew, constants.X_OK);
    return homebrew;
  } catch {
    return "temporal";
  }
}

function startManaged(
  name: string,
  command: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv
): ChildProcess {
  const child = spawn(command, args, {
    cwd,
    env: environment,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  managedChildren.push({ name, process: child });
  pipeWithPrefix(child.stdout, name, process.stdout);
  pipeWithPrefix(child.stderr, name, process.stderr);
  child.once("exit", (code, signal) => {
    if (shuttingDown) return;
    void failAndShutdown(
      new Error(`${name} exited unexpectedly (${signal ?? `code ${String(code)}`})`)
    );
  });
  child.once("error", (error) => {
    if (!shuttingDown) void failAndShutdown(error);
  });
  return child;
}

async function runToCompletion(
  name: string,
  command: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv
): Promise<void> {
  await new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    pipeWithPrefix(child.stdout, name, process.stdout);
    pipeWithPrefix(child.stderr, name, process.stderr);
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(new Error(`${name} failed (${signal ?? `code ${String(code)}`})`));
    });
  });
}

async function runQuietly(
  command: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv
): Promise<void> {
  await new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      stdio: "ignore",
    });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(
        new Error(`${command} ${args[0] ?? ""} failed (${signal ?? `code ${String(code)}`})`)
      );
    });
  });
}

function pipeWithPrefix(
  stream: NodeJS.ReadableStream | null,
  name: string,
  destination: NodeJS.WritableStream
): void {
  if (!stream) return;
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/u);
    pending = lines.pop() ?? "";
    for (const line of lines) destination.write(`[${name}] ${line}\n`);
  });
  stream.on("end", () => {
    if (pending) destination.write(`[${name}] ${pending}\n`);
  });
}

function installSignalHandlers(): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void shutdown(signal).finally(() => process.exit(0));
    });
  }
}

async function failAndShutdown(error: unknown): Promise<never> {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  await shutdown("SIGTERM");
  process.exit(1);
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of [...managedChildren].reverse()) terminate(child.process, signal);
  await Promise.race([
    Promise.allSettled(
      managedChildren.map(
        ({ process: child }) =>
          new Promise<void>((resolveExit) => {
            if (child.exitCode !== null || child.signalCode !== null) {
              resolveExit();
              return;
            }
            child.once("exit", () => resolveExit());
          })
      )
    ),
    delay(10_000),
  ]);
  for (const { process: child } of managedChildren) {
    if (child.exitCode === null && child.signalCode === null) terminate(child, "SIGKILL");
  }
}

function terminate(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ESRCH") throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

void main().catch((error: unknown) => {
  void failAndShutdown(error);
});
