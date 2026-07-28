/**
 * The one documented way to run the studio agent runtime locally.
 *
 * It exists because the pieces could not be started correctly by hand: the
 * workers loaded no `.env`, the control worker needed a workflow bundle that
 * only existed after a build, both roles defaulted to the same ports, and a
 * `packages/shared` edit stayed invisible until somebody remembered to rebuild.
 * Starting the stack must not require remembering any of that.
 *
 * Sequence, in order, refusing to continue on any failure:
 *   1. load `apps/studio-agent-runtime/.env` exactly as the workers will;
 *   2. validate the configuration of every role about to start, including that
 *      the roles cannot collide on a health port or metrics bind address;
 *   3. build `@repo/shared` and keep `tsc --watch` running on it;
 *   4. run each worker under `tsx watch`, watching this app's sources and the
 *      built `@repo/shared` output, so any edit restarts the worker that loaded
 *      it;
 *   5. poll each worker's `/ready` and print role state transitions, so a
 *      half-started stack is visible instead of assumed.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { loadRuntimeDotEnv, readDotEnvValue } from "../src/runtime-env.js";
import { resolveRuntimePaths } from "../src/runtime-paths.js";
import { RUNTIME_WORKER_ROLES, type RuntimeWorkerRole } from "../src/runtime-role.js";
// `../src/config.js` imports @repo/shared, which does not exist until it is
// built, so the configuration module is imported after the build step below.
// Type-only imports are erased and are safe here.
import type { RuntimeProcessConfig } from "../src/config.js";

const READINESS_POLL_INTERVAL_MS = 2_000;
const SHARED_BUILD_TIMEOUT_MS = 180_000;

const paths = resolveRuntimePaths(import.meta.url);
const sharedPackageDir = join(paths.repoRoot, "packages", "shared");
const roles = parseRoles(process.argv.slice(2));
const children: { name: string; child: ChildProcess }[] = [];
let shuttingDown = false;

const dotEnv = loadRuntimeDotEnv({ path: join(paths.appRoot, ".env") });
banner(
  dotEnv.loaded
    ? `Loaded ${dotEnv.path} (${dotEnv.applied.length} variables${
        dotEnv.ignored.length > 0 ? `, ${dotEnv.ignored.length} already set in the shell` : ""
      })`
    : `No ${dotEnv.path}; using the shell environment only. Copy .env.example to .env to change that.`
);

borrowDeliveryCredential();

installShutdownHandlers();
await startSharedWatch();
const configModule = await import("../src/config.js");
preflightConfiguration(roles);
for (const role of roles) {
  startWorker(role);
}
startReadinessWatch(roles);

/**
 * ONE Ably key on this machine, in the file that already holds it.
 *
 * The activities worker and the Nest server must present the SAME Ably
 * credential — the worker publishes the turn, the server signs the browser's
 * token for the same app — and `apps/server/.env` is where a developer already
 * puts it, because the server refuses to boot without it. Requiring a second
 * copy in `apps/studio-agent-runtime/.env` bought nothing and cost everything:
 * a fresh clone that had done the documented server setup still could not run
 * `npm run dev -w studio-agent-runtime`, because the preflight (correctly)
 * refuses to start the activities role without the key. Two copies of a root
 * credential is also two things to rotate, and one of them will be missed.
 *
 * So the launcher borrows it, for LOCAL DEVELOPMENT ONLY, and says so. This
 * lives in the launcher and not in `runtime-env.ts` on purpose: the deployed
 * worker gets its key from the CSI-projected secret and must never go looking
 * for another app's environment file.
 *
 * Precedence, unchanged: the shell wins, then this app's own `.env`, then this.
 * Exactly one variable is read — see {@link readDotEnvValue} for why it is not
 * a whole-file load.
 */
function borrowDeliveryCredential(): void {
  if (process.env.ABLY_API_KEY) {
    return;
  }
  const serverEnv = join(paths.repoRoot, "apps", "server", ".env");
  const borrowed = readDotEnvValue(serverEnv, "ABLY_API_KEY");
  if (!borrowed) {
    // Not a failure here — `preflightConfiguration` owns the refusal, with the
    // schema's own message. This only adds the sentence that says where to fix
    // it, because "ABLY_API_KEY is required" does not say which of two files.
    banner(
      [
        `No ABLY_API_KEY in ${join(paths.appRoot, ".env")} or ${serverEnv}.`,
        "Studio Agent delivery IS Ably, so the activities worker will refuse to start.",
        "Put the complete key (<appId>.<keyId>:<secret>) in apps/server/.env — both the",
        "server and this runtime read it from there locally.",
      ].join("\n[dev-stack] ")
    );
    return;
  }
  process.env.ABLY_API_KEY = borrowed;
  banner(`ABLY_API_KEY not set here; borrowed it from ${serverEnv} for this local stack.`);
}

/**
 * A configuration mistake must surface once, before any worker is started,
 * rather than as one dead worker beside one live worker.
 */
function preflightConfiguration(selected: readonly RuntimeWorkerRole[]): void {
  try {
    const processConfigs = RUNTIME_WORKER_ROLES.map((role) =>
      configModule.loadRuntimeProcessConfig(role)
    );
    const started = processConfigs.filter((entry) => selected.includes(entry.role));
    configModule.assertRoleEndpointsAreDistinct(started);
    if (started.length === 1) {
      warnAboutLatentEndpointCollision(processConfigs);
    }
    // The role's own list of boot requirements, from config.ts. Keeping a
    // second copy here is what let the delivery credential go unchecked.
    for (const role of selected) {
      configModule.preflightRuntimeConfiguration(role);
    }
    for (const config of started) {
      banner(
        `${config.role}: health http://${displayHost(config.healthHost)}:${
          config.healthPort
        }  metrics ${config.metricsBindAddress}`
      );
    }
  } catch (error) {
    fail(
      [
        "The local runtime configuration is incomplete, so nothing was started.",
        describeError(error),
        `Edit ${join(paths.appRoot, ".env")} (see .env.example) and run this command again.`,
      ].join("\n")
    );
  }
}

/**
 * Starting one role is legal, but a pinned port in the shared `.env` is still a
 * trap: the second role would fail to bind whenever somebody starts it.
 */
function warnAboutLatentEndpointCollision(configs: readonly RuntimeProcessConfig[]): void {
  try {
    configModule.assertRoleEndpointsAreDistinct(configs);
  } catch (error) {
    banner(`WARNING: ${describeError(error).split("\n").join(" ")}`);
  }
}

/**
 * `@repo/shared` is consumed as built JavaScript, so no worker can run against
 * its sources. One `tsc --watch` both produces the first build and keeps it in
 * step afterwards, and nothing else starts until that first build succeeds — a
 * worker started against an absent or broken build is a stale stack by
 * construction.
 */
function startSharedWatch(): Promise<void> {
  banner("Building @repo/shared (tsc --watch) ...");
  return new Promise<void>((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        fail(`@repo/shared did not finish compiling within ${SHARED_BUILD_TIMEOUT_MS}ms.`);
      }
    }, SHARED_BUILD_TIMEOUT_MS);
    timeout.unref();
    track(
      "shared",
      spawn(resolveTypescriptCompiler(), ["--watch", "--preserveWatchOutput"], {
        cwd: sharedPackageDir,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      }),
      (line) => {
        const match = /Found (\d+) error/.exec(line);
        if (!match || settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (Number(match[1]) > 0) {
          fail(
            "@repo/shared does not compile, so no worker was started: they load its build output, not its sources."
          );
        }
        banner("@repo/shared built; its output is watched from here on.");
        resolve();
      }
    );
  });
}

function startWorker(role: RuntimeWorkerRole): void {
  const entrypoint = join("src", role === "control" ? "worker-control.ts" : "worker-activities.ts");
  track(
    role,
    spawn(
      resolveBin("tsx"),
      [
        "watch",
        "--clear-screen=false",
        // The worker loads @repo/shared from its build output; tsc --watch
        // rewrites it, and this makes that rewrite restart the worker.
        "--include",
        join(sharedPackageDir, "dist", "**", "*.js"),
        entrypoint,
      ],
      {
        cwd: paths.appRoot,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      }
    )
  );
}

/**
 * Says out loud whether each started role is actually serving. `/ready` is false
 * while a worker is starting, draining, failing, or running stale code.
 */
function startReadinessWatch(selected: readonly RuntimeWorkerRole[]): void {
  const configs = selected.map((role) => configModule.loadRuntimeProcessConfig(role));
  const lastStatus = new Map<RuntimeWorkerRole, string>();
  const poll = async (): Promise<void> => {
    for (const config of configs) {
      const status = await probeReadiness(config.healthHost, config.healthPort);
      if (lastStatus.get(config.role) !== status) {
        lastStatus.set(config.role, status);
        banner(`${config.role} /ready -> ${status}`);
      }
    }
  };
  const timer = setInterval(() => void poll(), READINESS_POLL_INTERVAL_MS);
  timer.unref();
}

async function probeReadiness(host: string, port: number): Promise<string> {
  try {
    const response = await fetch(`http://${displayHost(host)}:${port}/ready`, {
      signal: AbortSignal.timeout(1_500),
    });
    const body = (await response.json()) as { status?: string; staleReasons?: string[] };
    const stale = body.staleReasons?.length ? ` (${body.staleReasons.join("; ")})` : "";
    return `${response.status} ${body.status ?? "unknown"}${stale}`;
  } catch {
    return "unreachable";
  }
}

function track(name: string, child: ChildProcess, onLine?: (line: string) => void): void {
  children.push({ name, child });
  prefixOutput(name, child, onLine);
  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    fail(`${name} exited (${code ?? signal}); stopping the whole local stack.`);
  });
}

function prefixOutput(name: string, child: ChildProcess, onLine?: (line: string) => void): void {
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) {
      continue;
    }
    let buffered = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        process.stdout.write(`[${name}] ${line}\n`);
        onLine?.(line);
      }
    });
    stream.on("end", () => {
      if (buffered.length > 0) {
        process.stdout.write(`[${name}] ${buffered}\n`);
        buffered = "";
      }
    });
  }
}

function installShutdownHandlers(): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => shutdown(0));
  }
}

/**
 * Ctrl-C drains: every worker gets SIGTERM and Temporal is allowed to finish
 * in-flight tasks. The process only exits once the children are gone, so no
 * orphaned worker survives to poll a task queue behind the developer's back.
 */
function shutdown(exitCode: number): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  banner("Stopping the local stack ...");
  signalChildren();
  const deadline = setTimeout(() => process.exit(exitCode), 15_000);
  const poll = setInterval(() => {
    if (children.every(({ child }) => child.exitCode !== null || child.signalCode !== null)) {
      clearTimeout(deadline);
      clearInterval(poll);
      process.exit(exitCode);
    }
  }, 100);
  void poll;
}

function signalChildren(): void {
  for (const { child } of children) {
    if (child.pid === undefined || child.exitCode !== null) {
      continue;
    }
    try {
      // Detached children lead their own process group; `tsx watch` runs the
      // worker as its own child, so the whole group has to go.
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

function parseRoles(argv: readonly string[]): RuntimeWorkerRole[] {
  const requested = argv.filter((value) => !value.startsWith("-"));
  if (requested.length === 0 || requested.includes("all")) {
    return [...RUNTIME_WORKER_ROLES];
  }
  const unknown = requested.filter(
    (value) => !RUNTIME_WORKER_ROLES.includes(value as RuntimeWorkerRole)
  );
  if (unknown.length > 0) {
    fail(`Unknown role(s): ${unknown.join(", ")}. Expected control, activities, or all.`);
  }
  return requested as RuntimeWorkerRole[];
}

function resolveTypescriptCompiler(): string {
  return createRequire(join(sharedPackageDir, "package.json")).resolve("typescript/bin/tsc");
}

function resolveBin(name: string): string {
  return join(paths.repoRoot, "node_modules", ".bin", name);
}

function displayHost(host: string): string {
  return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

function banner(message: string): void {
  process.stdout.write(`[dev-stack] ${message}\n`);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fail(message: string): never {
  process.stderr.write(`\n[dev-stack] ${message}\n\n`);
  shuttingDown = true;
  signalChildren();
  // A partially started stack is the defect this launcher exists to prevent, so
  // the failure path takes everything down immediately.
  process.exit(1);
}
