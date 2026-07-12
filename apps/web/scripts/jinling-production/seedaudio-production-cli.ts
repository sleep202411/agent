#!/usr/bin/env -S npx tsx

import { createHash } from "node:crypto";
import path from "node:path";
import { loadRunnerEnvironment, resolveSeedAudioProviderConfig } from "./environment";
import { RunnerError, safeErrorForConsole } from "./errors";
import { DEFAULT_WORK_ROOT, REPO_ROOT, WEB_ROOT } from "./paths";
import {
  buildSeedAudioDescriptor,
  inspectReferenceAudio,
  loadSeedAudioProductionPack,
  runSeedAudioProduction,
  selectSeedAudioTask,
} from "./seedaudio-production";

const DEFAULT_PACK_PATH = path.join(
  WEB_ROOT,
  "src/features/jinling-rumeng/production/manifests/s01-p00-sc01-production-v1.json"
);

async function main(): Promise<void> {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command !== "plan" && command !== "generate") {
      throw new RunnerError(
        "USAGE",
        "Expected plan or generate for the direct Seed Audio production runner."
      );
    }
    const taskId = readFlag(args, "--task");
    const packPath = path.resolve(readOptionalFlag(args, "--pack") ?? DEFAULT_PACK_PATH);
    const workRoot = path.resolve(readOptionalFlag(args, "--work-root") ?? DEFAULT_WORK_ROOT);
    assertInsideRepoTmp(workRoot);
    const referencePathValue = readOptionalFlag(args, "--reference-audio");
    const reference = referencePathValue
      ? await inspectReferenceAudio(path.resolve(referencePathValue))
      : undefined;
    const pack = await loadSeedAudioProductionPack(packPath);
    const task = selectSeedAudioTask(pack, taskId);
    const descriptor = buildSeedAudioDescriptor(task, reference?.sha256);

    if (command === "plan") {
      printJson({
        ok: true,
        command,
        taskId,
        fingerprint: descriptor.fingerprint,
        provider: "byteplus-seed-audio",
        model: "seed-audio-1.0",
        endpoint: "/api/v3/tts/create",
        authHeader: "X-Api-Key",
        referenceSha256: reference?.sha256,
        textSha256: createHash("sha256").update(task.text).digest("hex"),
        delivery: task.delivery,
        stagedStatus: "REVIEW",
      });
      return;
    }

    const confirmedFingerprint = readFlag(args, "--confirm-fingerprint");
    const environment = await loadRunnerEnvironment(REPO_ROOT);
    const result = await runSeedAudioProduction({
      task,
      confirmedFingerprint,
      provider: resolveSeedAudioProviderConfig(environment),
      workRoot,
      ...(reference ? { reference } : {}),
    });
    printJson({ ok: true, command, ...result });
  } catch (error) {
    printJson({ ok: false, error: safeErrorForConsole(error) });
    process.exitCode = 1;
  }
}

function readFlag(args: string[], flag: string): string {
  const value = readOptionalFlag(args, flag);
  if (!value) throw new RunnerError("USAGE", `${flag} is required.`);
  return value;
}

function readOptionalFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  if (args.indexOf(flag, index + 1) >= 0) {
    throw new RunnerError("USAGE", `${flag} may only be provided once.`);
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new RunnerError("USAGE", `${flag} requires a value.`);
  }
  return value;
}

function assertInsideRepoTmp(candidate: string): void {
  const tmpRoot = path.join(REPO_ROOT, "tmp");
  const relative = path.relative(tmpRoot, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new RunnerError("SECURITY_REJECTED", "Work root must remain inside repository tmp.");
  }
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

void main();
