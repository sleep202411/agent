import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveRuntimePaths } from "./runtime-paths.js";

export interface DotEnvLoadResult {
  path: string;
  /** true when the file existed and was parsed */
  loaded: boolean;
  /** keys the file contributed to `process.env` */
  applied: readonly string[];
  /** keys the file declared but an already-set process variable kept */
  ignored: readonly string[];
}

export interface LoadRuntimeDotEnvOptions {
  path?: string;
  environment?: NodeJS.ProcessEnv;
  loadEnvFile?: (path: string) => void;
}

/**
 * Loads `apps/studio-agent-runtime/.env` into `process.env`.
 *
 * Both worker roles read configuration from the process environment, and every
 * documented local command is a bare `node dist/worker-*.js` /
 * `tsx src/worker-*.ts`. Requiring a `--env-file` flag on every invocation made
 * those documented commands die on values that were sitting in this app's own
 * `.env`, so the runtime loads the file itself.
 *
 * Real environment variables always win: `process.loadEnvFile` never replaces an
 * already-set variable, which keeps container, Helm, and shell configuration
 * authoritative. The production image ships no `.env` at all, so there the call
 * is a no-op that is reported once at startup.
 */
export function loadRuntimeDotEnv(options: LoadRuntimeDotEnvOptions = {}): DotEnvLoadResult {
  const path = options.path ?? join(resolveRuntimePaths().appRoot, ".env");
  const environment = options.environment ?? process.env;
  const loadEnvFile = options.loadEnvFile ?? ((target: string) => process.loadEnvFile(target));

  if (!existsSync(path)) {
    return { path, loaded: false, applied: [], ignored: [] };
  }

  const preset = new Set(Object.keys(environment));
  try {
    loadEnvFile(path);
  } catch (error) {
    throw new Error(
      `Failed to parse the runtime environment file ${path}: ${describeError(error)}`,
      { cause: error }
    );
  }
  return {
    path,
    loaded: true,
    applied: Object.keys(environment).filter((key) => !preset.has(key)),
    ignored: declaredEnvKeys(path).filter((key) => preset.has(key)),
  };
}

/**
 * Key names only. Values are secrets and never leave the process, so reporting
 * scans for `KEY=` assignments instead of parsing values.
 */
export function declaredEnvKeys(path: string): string[] {
  const keys = new Set<string>();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match?.[1]) {
      keys.add(match[1]);
    }
  }
  return [...keys];
}

/**
 * Read ONE variable out of a dotenv file, without loading the rest of it.
 *
 * The local launcher uses this to borrow `ABLY_API_KEY` from the server's
 * `.env`. Reading one key rather than calling `process.loadEnvFile` is the
 * whole point: that file also holds `DATABASE_URL`, `ALIBABA_API_KEY` and
 * everything else the API server needs, and several of those names are ALSO
 * read by this runtime — loading it wholesale would silently reconfigure the
 * worker from a file that is not its own.
 *
 * Returns undefined for an absent file or an absent key. Never throws on a
 * missing file: the caller's job is to explain what to do about it.
 */
export function readDotEnvValue(path: string, key: string): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  let found: string | undefined;
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=(.*)$`);
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = pattern.exec(line);
    if (!match) continue;
    // Last assignment wins, which is what dotenv parsers do.
    found = unquote((match[1] ?? "").trim());
  }
  return found === "" ? undefined : found;
}

function unquote(value: string): string {
  const quoted = /^(["'])([\s\S]*)\1$/.exec(value);
  return quoted?.[2] ?? value;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
