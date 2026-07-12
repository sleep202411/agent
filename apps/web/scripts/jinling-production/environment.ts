import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ManifestAsset } from "../../src/features/jinling-rumeng/production/asset-manifest";
import { RunnerError } from "./errors";

const DEFAULT_MODELARK_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";
const ALLOWED_MODELARK_API_HOSTS = new Set(["ark.ap-southeast.bytepluses.com"]);
const DEFAULT_SEEDAUDIO_BASE_URL = "https://voice.ap-southeast-1.bytepluses.com";
const ALLOWED_SEEDAUDIO_API_HOSTS = new Set(["voice.ap-southeast-1.bytepluses.com"]);

type SeedreamSource = Extract<ManifestAsset["source"], { strategy: "seedream" }>;
type SeedanceSource = Extract<ManifestAsset["source"], { strategy: "seedance" }>;
type ModelArkSource = SeedreamSource | SeedanceSource;

export interface SeedreamProviderConfig {
  apiKey: string;
  apiBaseUrl: string;
}

export type SeedanceProviderConfig = SeedreamProviderConfig;

export interface SeedAudioProviderConfig {
  apiKey: string;
  apiBaseUrl: string;
}

export async function loadRunnerEnvironment(repoRoot: string): Promise<Record<string, string>> {
  const serverEnvPath = path.join(repoRoot, "apps/server/.env");
  const webEnvPath = path.join(repoRoot, "apps/web/.env.local");
  const serverValues = await readOptionalEnvFile(serverEnvPath, "apps/server/.env");
  const webValues = await readOptionalEnvFile(webEnvPath, "apps/web/.env.local");

  const merged = mergeRunnerEnvironment(serverValues, webValues, process.env);
  return merged;
}

export function mergeRunnerEnvironment(
  serverValues: Readonly<Record<string, string | undefined>>,
  webValues: Readonly<Record<string, string | undefined>>,
  processValues: Readonly<Record<string, string | undefined>>
): Record<string, string> {
  const merged: Record<string, string> = {};
  copyDefinedValues(merged, serverValues);

  // The web app already owns the local BytePlus media-production credential.
  // Map it to the provider-neutral canonical names used by the offline runner.
  // Do not map SEEDANCE_MODEL: every billed request must use the reviewed,
  // versioned endpoint ID from the production manifest.
  const webApiKey = webValues.SEEDANCE_API_KEY?.trim();
  if (webApiKey) merged.BYTEPLUS_MODELARK_API_KEY = webApiKey;
  const webBaseUrl = webValues.SEEDANCE_BASE_URL?.trim();
  if (webBaseUrl) merged.BYTEPLUS_MODELARK_API_BASE_URL = webBaseUrl;

  const seedAudioApiKey = webValues.SEED_AUDIO_API_KEY?.trim();
  if (seedAudioApiKey) merged.SEED_AUDIO_API_KEY = seedAudioApiKey;
  const seedAudioBaseUrl = webValues.SEED_AUDIO_BASE_URL?.trim();
  if (seedAudioBaseUrl) merged.SEED_AUDIO_BASE_URL = seedAudioBaseUrl;

  // Explicit process configuration is the final override for CI or a
  // deliberately isolated production run.
  copyDefinedValues(merged, processValues);
  return merged;
}

function copyDefinedValues(
  target: Record<string, string>,
  source: Readonly<Record<string, string | undefined>>
): void {
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") target[key] = value;
  }
}

export function resolveSeedreamProviderConfig(
  source: SeedreamSource,
  environment: Readonly<Record<string, string>>
): SeedreamProviderConfig {
  if (source.enabledEnv !== "BYTEPLUS_MODELARK_ENABLED") {
    throw new RunnerError(
      "CONFIG_MISSING",
      "Seedream manifests must use the canonical BYTEPLUS_MODELARK_ENABLED name."
    );
  }
  if (source.credentialEnv !== "BYTEPLUS_MODELARK_API_KEY") {
    throw new RunnerError(
      "CONFIG_MISSING",
      "Seedream manifests must use the canonical BYTEPLUS_MODELARK_API_KEY credential name."
    );
  }
  if (source.baseUrlEnv && source.baseUrlEnv !== "BYTEPLUS_MODELARK_API_BASE_URL") {
    throw new RunnerError(
      "CONFIG_MISSING",
      "Seedream manifests must use the canonical BYTEPLUS_MODELARK_API_BASE_URL name."
    );
  }

  const apiKey = environment[source.credentialEnv]?.trim();
  if (!apiKey) {
    throw new RunnerError(
      "CONFIG_MISSING",
      `${source.credentialEnv} is not configured in the process environment or apps/server/.env.`
    );
  }
  if (!providerEnabled(source, environment)) {
    throw new RunnerError(
      "CONFIG_MISSING",
      `${source.enabledEnv} must be explicitly enabled for a Seedream trial.`
    );
  }

  const configuredBaseUrl = source.baseUrlEnv ? environment[source.baseUrlEnv]?.trim() : undefined;
  const apiBaseUrl = validateModelArkBaseUrl(configuredBaseUrl || DEFAULT_MODELARK_BASE_URL);
  return { apiKey, apiBaseUrl };
}

export function resolveSeedanceProviderConfig(
  source: SeedanceSource,
  environment: Readonly<Record<string, string>>
): SeedanceProviderConfig {
  assertCanonicalModelArkSource(source, "Seedance");
  const apiKey = environment[source.credentialEnv]?.trim();
  if (!apiKey) {
    throw new RunnerError(
      "CONFIG_MISSING",
      `${source.credentialEnv} is not configured in the process environment or apps/web/.env.local.`
    );
  }
  if (!providerEnabled(source, environment)) {
    throw new RunnerError(
      "CONFIG_MISSING",
      `${source.enabledEnv} must be explicitly enabled for a Seedance reference trial.`
    );
  }
  const configuredBaseUrl = source.baseUrlEnv ? environment[source.baseUrlEnv]?.trim() : undefined;
  return {
    apiKey,
    apiBaseUrl: validateModelArkBaseUrl(configuredBaseUrl || DEFAULT_MODELARK_BASE_URL),
  };
}

export function resolveSeedAudioProviderConfig(
  environment: Readonly<Record<string, string>>
): SeedAudioProviderConfig {
  const apiKey = environment.SEED_AUDIO_API_KEY?.trim();
  if (!apiKey) {
    throw new RunnerError(
      "CONFIG_MISSING",
      "SEED_AUDIO_API_KEY is not configured in the process environment or apps/web/.env.local."
    );
  }
  return {
    apiKey,
    apiBaseUrl: validateSeedAudioBaseUrl(
      environment.SEED_AUDIO_BASE_URL?.trim() || DEFAULT_SEEDAUDIO_BASE_URL
    ),
  };
}

export function hasConfiguredCredential(
  source: ModelArkSource,
  environment: Readonly<Record<string, string>>
): boolean {
  return Boolean(environment[source.credentialEnv]?.trim());
}

export function providerEnabled(
  source: ModelArkSource,
  environment: Readonly<Record<string, string>>
): boolean {
  return ["1", "true", "yes", "on"].includes(
    (environment[source.enabledEnv] ?? "").trim().toLowerCase()
  );
}

function assertCanonicalModelArkSource(source: ModelArkSource, label: string): void {
  if (source.enabledEnv !== "BYTEPLUS_MODELARK_ENABLED") {
    throw new RunnerError(
      "CONFIG_MISSING",
      `${label} manifests must use the canonical BYTEPLUS_MODELARK_ENABLED name.`
    );
  }
  if (source.credentialEnv !== "BYTEPLUS_MODELARK_API_KEY") {
    throw new RunnerError(
      "CONFIG_MISSING",
      `${label} manifests must use the canonical BYTEPLUS_MODELARK_API_KEY credential name.`
    );
  }
  if (source.baseUrlEnv !== "BYTEPLUS_MODELARK_API_BASE_URL") {
    throw new RunnerError(
      "CONFIG_MISSING",
      `${label} manifests must use the canonical BYTEPLUS_MODELARK_API_BASE_URL name.`
    );
  }
}

export function parseEnvFile(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const originalLine of source.split(/\r?\n/)) {
    const line = originalLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trimStart() : line;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(normalized);
    if (!match) continue;
    result[match[1]] = parseEnvValue(match[2]);
  }
  return result;
}

function parseEnvValue(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    return value
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value.replace(/\s+#.*$/, "").trimEnd();
}

function validateModelArkBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new RunnerError("SECURITY_REJECTED", "ModelArk base URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !ALLOWED_MODELARK_API_HOSTS.has(url.hostname.toLowerCase())
  ) {
    throw new RunnerError(
      "SECURITY_REJECTED",
      "ModelArk base URL must use the allowlisted BytePlus HTTPS endpoint."
    );
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname && pathname !== "/api/v3") {
    throw new RunnerError(
      "SECURITY_REJECTED",
      "ModelArk base URL must be the BytePlus host root or end in /api/v3."
    );
  }
  url.pathname = "/api/v3";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function validateSeedAudioBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new RunnerError("SECURITY_REJECTED", "Seed Audio base URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !ALLOWED_SEEDAUDIO_API_HOSTS.has(url.hostname.toLowerCase())
  ) {
    throw new RunnerError(
      "SECURITY_REJECTED",
      "Seed Audio base URL must use the allowlisted BytePlus Voice HTTPS endpoint."
    );
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new RunnerError("SECURITY_REJECTED", "Seed Audio base URL must not include an API path.");
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function readOptionalEnvFile(
  filePath: string,
  displayPath: string
): Promise<Record<string, string>> {
  try {
    return parseEnvFile(await readFile(filePath, "utf8"));
  } catch (error) {
    if (isMissingFile(error)) return {};
    throw new RunnerError("CONFIG_MISSING", `Unable to read ${displayPath}.`);
  }
}
