#!/usr/bin/env -S npx tsx

import { createHash } from "node:crypto";
import path from "node:path";
import {
  hasConfiguredCredential,
  loadRunnerEnvironment,
  providerEnabled,
  resolveSeedanceProviderConfig,
  resolveSeedreamProviderConfig,
} from "./environment";
import { RunnerError, safeErrorForConsole } from "./errors";
import { resolveFizzdragonCloudConfig, runFizzdragonReferenceTrial } from "./fizzdragon-cloud";
import { runFizzdragonSeedanceTrial } from "./fizzdragon-seedance-cloud";
import {
  isReferenceTrialEligible,
  isSeedanceReferenceTrialEligible,
  loadProductionManifest,
  selectSeedanceAsset,
  selectSeedreamAsset,
} from "./manifest-loader";
import { DEFAULT_MANIFEST_PATH, DEFAULT_WORK_ROOT, REPO_ROOT, repoRelative } from "./paths";
import {
  providerTimeoutMsFromSeconds,
  runSeedreamReferenceTrial,
} from "./seedream-reference-trial";
import { runSeedanceReferenceTrial } from "./seedance-reference-trial";

type Command =
  | "validate"
  | "plan"
  | "seedream-reference-trial"
  | "seedance-reference-trial"
  | "fizzdragon-reference-trial"
  | "fizzdragon-seedance-trial";

interface CliOptions {
  command: Command;
  manifestPath: string;
  assetId?: string;
  confirmedFingerprint?: string;
  workRoot: string;
  maxOutputBytes: number;
  providerTimeoutMs: number;
}

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

async function main(): Promise<void> {
  try {
    const options = parseArguments(process.argv.slice(2));
    const loaded = await loadProductionManifest(options.manifestPath, REPO_ROOT);

    if (options.command === "validate") {
      printJson({
        ok: true,
        command: options.command,
        manifestPath: printablePath(loaded.manifestPath),
        manifestSha256: loaded.manifestSha256,
        manifestId: loaded.manifest.manifestId,
        manifestStatus: loaded.manifest.status,
        sceneId: loaded.manifest.sceneId,
        assetCount: loaded.manifest.assets.length,
        seedreamAssetCount: loaded.seedreamAssets.length,
        seedanceAssetCount: loaded.seedanceAssets.length,
        referenceCount: loaded.seedreamAssets.reduce(
          (total, candidate) => total + candidate.references.length,
          0
        ),
      });
      return;
    }

    const environment = await loadRunnerEnvironment(REPO_ROOT);
    if (options.command === "plan") {
      const candidates = options.assetId
        ? [
            loaded.seedreamAssets.find(
              (candidate) => candidate.asset.assetId === options.assetId
            ) ??
              loaded.seedanceAssets.find(
                (candidate) => candidate.asset.assetId === options.assetId
              ) ??
              (() => {
                throw new RunnerError(
                  "ASSET_INVALID",
                  `Asset ${options.assetId} is not a runnable Seedream or Seedance asset.`
                );
              })(),
          ]
        : [...loaded.seedreamAssets, ...loaded.seedanceAssets];
      printJson({
        ok: true,
        command: options.command,
        manifestPath: printablePath(loaded.manifestPath),
        manifestId: loaded.manifest.manifestId,
        manifestStatus: loaded.manifest.status,
        plans: candidates.map((candidate) => ({
          assetId: candidate.asset.assetId,
          assetStatus: candidate.asset.status,
          eligibleForReferenceTrial:
            candidate.asset.source.strategy === "seedream"
              ? isReferenceTrialEligible(loaded.manifest.status, candidate.asset)
              : isSeedanceReferenceTrialEligible(loaded.manifest.status, candidate.asset),
          fingerprint: candidate.fingerprint,
          provider: "byteplus-modelark",
          model: candidate.asset.source.model,
          endpointId: candidate.asset.source.endpointId,
          mode: candidate.asset.source.mode,
          generationParams: candidate.asset.source.generationParams,
          credentialEnv: candidate.asset.source.credentialEnv,
          credentialConfigured: hasConfiguredCredential(candidate.asset.source, environment),
          enabledConfigured: providerEnabled(candidate.asset.source, environment),
          prompt: {
            characters: candidate.descriptor.prompt.length,
            sha256: createHash("sha256").update(candidate.descriptor.prompt).digest("hex"),
          },
          request: candidate.descriptor.request,
          providerTimeoutSeconds: options.providerTimeoutMs / 1_000,
          references: candidate.references.map((reference) => ({
            assetId: reference.assetId,
            role: reference.role,
            format: reference.format,
            bytes: reference.bytes,
            sha256: reference.sha256,
          })),
          stagedStatus: "REVIEW",
        })),
      });
      return;
    }

    if (!options.assetId) {
      throw new RunnerError(
        "USAGE",
        `${options.command} requires one explicit --asset identifier.`
      );
    }
    if (!options.confirmedFingerprint) {
      throw new RunnerError(
        "USAGE",
        `${options.command} requires --confirm-fingerprint from the current plan.`
      );
    }
    const result =
      options.command === "seedance-reference-trial" ||
      options.command === "fizzdragon-seedance-trial"
        ? await (async () => {
            const selected = selectSeedanceAsset(loaded, options.assetId!);
            return options.command === "fizzdragon-seedance-trial"
              ? runFizzdragonSeedanceTrial({
                  loaded,
                  selected,
                  confirmedFingerprint: options.confirmedFingerprint!,
                  config: resolveFizzdragonCloudConfig(environment),
                  workRoot: options.workRoot,
                  maxOutputBytes: options.maxOutputBytes,
                })
              : runSeedanceReferenceTrial({
                  loaded,
                  selected,
                  confirmedFingerprint: options.confirmedFingerprint!,
                  provider: resolveSeedanceProviderConfig(selected.asset.source, environment),
                  workRoot: options.workRoot,
                  maxOutputBytes: options.maxOutputBytes,
                  taskTimeoutMs: options.providerTimeoutMs,
                });
          })()
        : await (async () => {
            const selected = selectSeedreamAsset(loaded, options.assetId!);
            if (options.confirmedFingerprint !== selected.fingerprint) {
              throw new RunnerError(
                "JOURNAL_CONFLICT",
                "Fingerprint confirmation does not match the current plan; run plan again."
              );
            }
            return options.command === "fizzdragon-reference-trial"
              ? runFizzdragonReferenceTrial({
                  loaded,
                  selected,
                  confirmedFingerprint: options.confirmedFingerprint,
                  config: resolveFizzdragonCloudConfig(environment),
                  workRoot: options.workRoot,
                  maxOutputBytes: options.maxOutputBytes,
                })
              : runSeedreamReferenceTrial({
                  loaded,
                  selected,
                  confirmedFingerprint: options.confirmedFingerprint,
                  provider: resolveSeedreamProviderConfig(selected.asset.source, environment),
                  workRoot: options.workRoot,
                  repoRoot: REPO_ROOT,
                  maxOutputBytes: options.maxOutputBytes,
                  providerTimeoutMs: options.providerTimeoutMs,
                });
          })();
    printJson({ ok: true, command: options.command, ...result });
  } catch (error) {
    printJson({ ok: false, error: safeErrorForConsole(error) });
    process.exitCode = 1;
  }
}

function parseArguments(args: string[]): CliOptions {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage());
    process.exit(0);
  }
  const command = args[0];
  if (
    command !== "validate" &&
    command !== "plan" &&
    command !== "seedream-reference-trial" &&
    command !== "seedance-reference-trial" &&
    command !== "fizzdragon-reference-trial" &&
    command !== "fizzdragon-seedance-trial"
  ) {
    throw new RunnerError(
      "USAGE",
      "Expected validate, plan, seedream-reference-trial, seedance-reference-trial, fizzdragon-reference-trial, or fizzdragon-seedance-trial."
    );
  }

  let manifestPath = DEFAULT_MANIFEST_PATH;
  let assetId: string | undefined;
  let confirmedFingerprint: string | undefined;
  let workRoot = DEFAULT_WORK_ROOT;
  let maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES;
  let providerTimeoutMs = providerTimeoutMsFromSeconds(undefined);
  const seenFlags = new Set<string>();
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    if (seenFlags.has(flag)) {
      throw new RunnerError("USAGE", `Option ${flag} may only be provided once.`);
    }
    seenFlags.add(flag);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new RunnerError("USAGE", `${flag} requires a value.`);
    }
    index += 1;
    switch (flag) {
      case "--manifest":
        manifestPath = path.resolve(value);
        break;
      case "--asset":
        assetId = value;
        break;
      case "--confirm-fingerprint":
        confirmedFingerprint = value;
        break;
      case "--work-root":
        workRoot = path.resolve(value);
        break;
      case "--max-output-bytes":
        maxOutputBytes = parsePositiveInteger(value, flag);
        break;
      case "--provider-timeout-seconds":
        providerTimeoutMs = providerTimeoutMsFromSeconds(value);
        break;
      default:
        throw new RunnerError("USAGE", `Unknown option ${flag}.`);
    }
  }

  const allowedWorkParent = path.join(REPO_ROOT, "tmp");
  if (!isWithin(allowedWorkParent, workRoot)) {
    throw new RunnerError(
      "SECURITY_REJECTED",
      "Work root must remain inside the repository tmp directory."
    );
  }
  if (maxOutputBytes > 512 * 1024 * 1024) {
    throw new RunnerError("USAGE", "--max-output-bytes cannot exceed 512 MiB.");
  }
  return {
    command,
    manifestPath,
    ...(assetId ? { assetId } : {}),
    ...(confirmedFingerprint ? { confirmedFingerprint } : {}),
    workRoot,
    maxOutputBytes,
    providerTimeoutMs,
  };
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new RunnerError("USAGE", `${flag} must be a positive integer.`);
  }
  return parsed;
}

function printablePath(absolutePath: string): string {
  return isWithin(REPO_ROOT, absolutePath) ? repoRelative(absolutePath) : absolutePath;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage(): string {
  return `Jinling production runner\n\nUsage:\n  tsx cli.ts validate [--manifest PATH]\n  tsx cli.ts plan [--manifest PATH] [--asset ASSET_ID]\n  tsx cli.ts fizzdragon-reference-trial --asset ASSET_ID --confirm-fingerprint SHA256 [--manifest PATH]\n  tsx cli.ts fizzdragon-seedance-trial --asset ASSET_ID --confirm-fingerprint SHA256 [--manifest PATH]\n  tsx cli.ts seedream-reference-trial --asset ASSET_ID --confirm-fingerprint SHA256 [--manifest PATH] [--provider-timeout-seconds SECONDS]\n  tsx cli.ts seedance-reference-trial --asset ASSET_ID --confirm-fingerprint SHA256 [--manifest PATH] [--provider-timeout-seconds SECONDS]\n\nDefaults:\n  manifest: ${repoRelative(DEFAULT_MANIFEST_PATH)}\n  work root: ${repoRelative(DEFAULT_WORK_ROOT)}\n  provider/task timeout: ${providerTimeoutMsFromSeconds(undefined) / 1_000} seconds\n\nGeneration commands stage REVIEW output only and never mark an asset APPROVED.\n`;
}

void main();
