import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { SeedanceProviderConfig } from "./environment";
import { RunnerError } from "./errors";
import { composeSeedancePrompt } from "./fingerprint";
import { referenceAsDataUrl } from "./image-file";
import {
  isSeedanceReferenceTrialEligible,
  type LoadedProductionManifest,
  type LoadedSeedanceAsset,
} from "./manifest-loader";
import { repoRelative } from "./paths";
import {
  deriveExactFrameMaster,
  downloadProviderVideo,
  inspectLocalMp4,
  verifyVideoMaster,
} from "./video-file";

const MIN_POLL_INTERVAL_MS = 5_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const TERMINAL = new Set(["succeeded", "failed", "cancelled", "expired"]);

type SeedanceTask = {
  id?: string;
  status?: string;
  content?: { video_url?: string };
  error?: { code?: string; message?: string } | null;
};

type SeedanceJournal = {
  journalVersion: 1;
  strategy: "seedance-reference-trial";
  assetId: string;
  fingerprint: string;
  manifestSha256: string;
  endpointId: string;
  state: "SUBMITTING" | "PROVIDER_ACCEPTED" | "REVIEW" | "FAILED" | "UNKNOWN";
  taskId?: string;
  result?: Omit<SeedanceTrialResult, "alreadyStaged">;
  failure?: { category: string; taskStatus?: string; providerCode?: string };
  startedAt: string;
  updatedAt: string;
};

export type SeedanceTrialResult = {
  assetId: string;
  fingerprint: string;
  taskId: string;
  status: "REVIEW";
  providerSourcePath: string;
  providerSourceSha256: string;
  providerSourceBytes: number;
  sourcePath: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  codec: string;
  pixelFormat: string | null;
  framesPerSecond: number;
  frameCount: number;
  durationSeconds: number;
  audioStreamCount: number;
  alreadyStaged: boolean;
};

export async function runSeedanceReferenceTrial(input: {
  loaded: LoadedProductionManifest;
  selected: LoadedSeedanceAsset;
  confirmedFingerprint: string;
  provider: SeedanceProviderConfig;
  workRoot: string;
  maxOutputBytes: number;
  pollIntervalMs?: number;
  taskTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<SeedanceTrialResult> {
  if (input.confirmedFingerprint !== input.selected.fingerprint) {
    throw new RunnerError("JOURNAL_CONFLICT", "Fingerprint confirmation is stale; run plan again.");
  }
  const { asset } = input.selected;
  if (!isSeedanceReferenceTrialEligible(input.loaded.manifest.status, asset)) {
    throw new RunnerError(
      "ASSET_INVALID",
      "Seedance asset is not eligible for a controlled reference trial."
    );
  }
  const journalFile = path.join(
    input.workRoot,
    "seedance-journal",
    `${input.selected.fingerprint}.json`
  );
  let journal = await readSeedanceJournal(journalFile, input.selected.fingerprint);
  let claimedByThisProcess = false;
  if (journal) assertJournalContext(journal, input);
  if (journal?.state === "REVIEW" && journal.result) {
    return revalidateStagedResult(input, journal.result);
  }
  if (journal?.state === "FAILED" || journal?.state === "UNKNOWN") {
    throw new RunnerError(
      "JOURNAL_CONFLICT",
      `This fingerprint has a terminal ${journal.state} Seedance journal.`
    );
  }
  if (!journal) {
    const now = new Date().toISOString();
    journal = {
      journalVersion: 1,
      strategy: "seedance-reference-trial",
      assetId: asset.assetId,
      fingerprint: input.selected.fingerprint,
      manifestSha256: input.loaded.manifestSha256,
      endpointId: asset.source.endpointId,
      state: "SUBMITTING",
      startedAt: now,
      updatedAt: now,
    };
    await claimJournal(journalFile, journal);
    claimedByThisProcess = true;
  }
  assertJournalContext(journal, input);

  const fetchImpl = input.fetchImpl ?? fetch;
  let taskId = journal.taskId;
  if (!taskId) {
    if (journal.state !== "SUBMITTING") {
      throw new RunnerError(
        "JOURNAL_CONFLICT",
        "Seedance journal is missing its provider task id."
      );
    }
    if (!claimedByThisProcess) {
      await updateJournal(journalFile, journal, {
        state: "UNKNOWN",
        failure: { category: "orphaned-submission" },
      });
      throw new RunnerError(
        "PROVIDER_RESULT_UNKNOWN",
        "A prior Seedance process stopped during submission; refusing a duplicate request."
      );
    }
    const request = await buildSeedanceRequest(input.selected);
    let created: SeedanceTask;
    try {
      created = await requestJson<SeedanceTask>(
        fetchImpl,
        input.provider,
        "/contents/generations/tasks",
        { method: "POST", body: JSON.stringify(request) }
      );
    } catch (error) {
      if (error instanceof RunnerError && error.code === "PROVIDER_REJECTED") {
        await updateJournal(journalFile, journal, {
          state: "FAILED",
          failure: { category: "provider-rejected" },
        });
        throw error;
      }
      await updateJournal(journalFile, journal, {
        state: "UNKNOWN",
        failure: { category: "submit-result-unknown" },
      });
      throw error;
    }
    if (!isTaskId(created.id)) {
      await updateJournal(journalFile, journal, {
        state: "UNKNOWN",
        failure: { category: "missing-task-id" },
      });
      throw new RunnerError("PROVIDER_RESULT_UNKNOWN", "Seedance create returned no task id.");
    }
    taskId = created.id;
    journal = await updateJournal(journalFile, journal, {
      state: "PROVIDER_ACCEPTED",
      taskId,
    });
  }

  const task = await waitForTask({
    fetchImpl,
    provider: input.provider,
    taskId,
    pollIntervalMs: Math.max(input.pollIntervalMs ?? 10_000, MIN_POLL_INTERVAL_MS),
    timeoutMs: input.taskTimeoutMs ?? 3_600_000,
    sleep: input.sleep ?? delay,
  });
  if (task.status !== "succeeded") {
    await updateJournal(journalFile, journal, {
      state: "FAILED",
      failure: {
        category: "provider-task",
        taskStatus: safeToken(task.status ?? "unknown"),
        ...(task.error?.code ? { providerCode: safeToken(task.error.code) } : {}),
      },
    });
    throw new RunnerError("PROVIDER_REJECTED", "Seedance task did not succeed.", {
      taskStatus: safeToken(task.status ?? "unknown"),
      ...(task.error?.code ? { providerCode: safeToken(task.error.code) } : {}),
    });
  }
  const videoUrl = task.content?.video_url;
  if (!videoUrl)
    throw new RunnerError("OUTPUT_INVALID", "Succeeded Seedance task has no video URL.");

  const sourcePath = path.join(
    input.workRoot,
    "seedance-review",
    asset.assetId,
    `${input.selected.fingerprint}.mp4`
  );
  const downloaded = await inspectLocalMp4(sourcePath, input.maxOutputBytes).catch(
    async (error) => {
      if (!isMissingFile(error)) throw error;
      return downloadProviderVideo(videoUrl, {
        destinationPath: sourcePath,
        maxBytes: input.maxOutputBytes,
      });
    }
  );
  const masterPath = path.join(
    input.workRoot,
    "seedance-review",
    asset.assetId,
    `${input.selected.fingerprint}-master.mp4`
  );
  await inspectLocalMp4(masterPath, input.maxOutputBytes).catch(async (error) => {
    if (!isMissingFile(error)) throw error;
    await deriveExactFrameMaster({
      sourcePath,
      destinationPath: masterPath,
      frameCount: asset.delivery.frameCount,
      audio: asset.delivery.audio,
    });
    return inspectLocalMp4(masterPath, input.maxOutputBytes);
  });
  const master = await inspectLocalMp4(masterPath, input.maxOutputBytes);
  const verified = await verifyVideoMaster(masterPath, {
    width: asset.delivery.width,
    height: asset.delivery.height,
    codec: asset.delivery.videoCodec,
    framesPerSecond: asset.delivery.framesPerSecond,
    frameCount: asset.delivery.frameCount,
    durationSeconds: asset.source.generationParams.durationSeconds,
    audio: asset.delivery.audio,
  });
  await chmod(sourcePath, 0o444);
  await chmod(masterPath, 0o444);
  const result: Omit<SeedanceTrialResult, "alreadyStaged"> = {
    assetId: asset.assetId,
    fingerprint: input.selected.fingerprint,
    taskId,
    status: "REVIEW",
    providerSourcePath: repoRelative(sourcePath),
    providerSourceSha256: downloaded.sha256,
    providerSourceBytes: downloaded.bytes,
    sourcePath: repoRelative(masterPath),
    sha256: master.sha256,
    bytes: master.bytes,
    ...verified,
  };
  await updateJournal(journalFile, journal, { state: "REVIEW", result });
  return { ...result, alreadyStaged: false };
}

async function revalidateStagedResult(
  input: {
    selected: LoadedSeedanceAsset;
    workRoot: string;
    maxOutputBytes: number;
  },
  result: Omit<SeedanceTrialResult, "alreadyStaged">
): Promise<SeedanceTrialResult> {
  const { asset } = input.selected;
  const providerSourcePath = path.join(
    input.workRoot,
    "seedance-review",
    asset.assetId,
    `${input.selected.fingerprint}.mp4`
  );
  const masterPath = path.join(
    input.workRoot,
    "seedance-review",
    asset.assetId,
    `${input.selected.fingerprint}-master.mp4`
  );
  const [providerSource, master] = await Promise.all([
    inspectLocalMp4(providerSourcePath, input.maxOutputBytes),
    inspectLocalMp4(masterPath, input.maxOutputBytes),
  ]);
  if (
    providerSource.sha256 !== result.providerSourceSha256 ||
    providerSource.bytes !== result.providerSourceBytes ||
    master.sha256 !== result.sha256 ||
    master.bytes !== result.bytes
  ) {
    throw new RunnerError(
      "JOURNAL_CONFLICT",
      "Staged Seedance media no longer matches its immutable journal hashes."
    );
  }
  const verified = await verifyVideoMaster(masterPath, {
    width: asset.delivery.width,
    height: asset.delivery.height,
    codec: asset.delivery.videoCodec,
    framesPerSecond: asset.delivery.framesPerSecond,
    frameCount: asset.delivery.frameCount,
    durationSeconds: asset.source.generationParams.durationSeconds,
    audio: asset.delivery.audio,
  });
  return {
    ...result,
    providerSourcePath: repoRelative(providerSourcePath),
    sourcePath: repoRelative(masterPath),
    ...verified,
    alreadyStaged: true,
  };
}

async function buildSeedanceRequest(
  selected: LoadedSeedanceAsset
): Promise<Record<string, unknown>> {
  const { asset } = selected;
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: composeSeedancePrompt(asset) },
  ];
  for (const [index, reference] of selected.references.entries()) {
    const url = await referenceAsDataUrl(reference.absolutePath, reference, 30 * 1024 * 1024);
    content.push({
      type: "image_url",
      image_url: { url },
      role:
        asset.source.mode === "image-to-video"
          ? "first_frame"
          : asset.source.mode === "first-last-frame-to-video"
            ? index === 0
              ? "first_frame"
              : "last_frame"
            : "reference_image",
    });
  }
  return {
    model: asset.source.endpointId,
    content,
    resolution: asset.source.generationParams.resolution,
    ratio: asset.source.generationParams.ratio,
    duration: asset.source.generationParams.durationSeconds,
    generate_audio: asset.source.generationParams.generateAudio,
    watermark: asset.source.generationParams.watermark,
  };
}

async function waitForTask(input: {
  fetchImpl: typeof fetch;
  provider: SeedanceProviderConfig;
  taskId: string;
  pollIntervalMs: number;
  timeoutMs: number;
  sleep: (milliseconds: number) => Promise<void>;
}): Promise<SeedanceTask> {
  const started = Date.now();
  while (true) {
    const task = await requestJson<SeedanceTask>(
      input.fetchImpl,
      input.provider,
      `/contents/generations/tasks/${encodeURIComponent(input.taskId)}`,
      { method: "GET" }
    );
    if (TERMINAL.has(task.status ?? "")) return task;
    if (Date.now() - started >= input.timeoutMs) {
      throw new RunnerError(
        "PROVIDER_RESULT_UNKNOWN",
        "Seedance task did not reach a terminal state before the polling deadline."
      );
    }
    await input.sleep(input.pollIntervalMs);
  }
}

async function requestJson<T>(
  fetchImpl: typeof fetch,
  provider: SeedanceProviderConfig,
  pathname: string,
  init: RequestInit
): Promise<T> {
  const url = new URL(`${provider.apiBaseUrl}${pathname}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      redirect: "error",
      signal: controller.signal,
    });
  } catch {
    throw new RunnerError("PROVIDER_RESULT_UNKNOWN", "Seedance API transport failed.");
  } finally {
    clearTimeout(timer);
  }
  const raw = await response.text();
  if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) {
    throw new RunnerError("OUTPUT_INVALID", "Seedance API response exceeded the JSON limit.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RunnerError("PROVIDER_RESULT_UNKNOWN", "Seedance API returned non-JSON.");
  }
  if (!response.ok) {
    const error = parsed as {
      error?: { code?: unknown; message?: unknown };
      message?: unknown;
    };
    const providerMessage = safeProviderMessage(error.error?.message ?? error.message);
    throw new RunnerError("PROVIDER_REJECTED", "Seedance API rejected the request.", {
      httpStatus: response.status,
      ...(typeof error.error?.code === "string"
        ? { providerCode: safeToken(error.error.code) }
        : {}),
      ...(providerMessage ? { providerMessage } : {}),
    });
  }
  return parsed as T;
}

async function readSeedanceJournal(
  filePath: string,
  fingerprint: string
): Promise<SeedanceJournal | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as SeedanceJournal;
    if (
      parsed.journalVersion !== 1 ||
      parsed.strategy !== "seedance-reference-trial" ||
      parsed.fingerprint !== fingerprint
    ) {
      throw new RunnerError("JOURNAL_CONFLICT", "Seedance journal is invalid.");
    }
    return parsed;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    if (error instanceof RunnerError) throw error;
    throw new RunnerError("JOURNAL_CONFLICT", "Seedance journal cannot be read.");
  }
}

async function claimJournal(filePath: string, journal: SeedanceJournal): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const handle = await open(filePath, "wx", 0o600).catch((error) => {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      throw new RunnerError("JOURNAL_CONFLICT", "Another Seedance runner owns this fingerprint.");
    }
    throw error;
  });
  await handle.writeFile(`${JSON.stringify(journal, null, 2)}\n`);
  await handle.sync();
  await handle.close();
}

async function updateJournal(
  filePath: string,
  journal: SeedanceJournal,
  patch: Partial<SeedanceJournal>
): Promise<SeedanceJournal> {
  const next = { ...journal, ...patch, updatedAt: new Date().toISOString() };
  const partPath = `${filePath}.${process.pid}.part`;
  await rm(partPath, { force: true });
  const handle = await open(partPath, "wx", 0o600);
  await handle.writeFile(`${JSON.stringify(next, null, 2)}\n`);
  await handle.sync();
  await handle.close();
  await rename(partPath, filePath);
  return next;
}

function assertJournalContext(
  journal: SeedanceJournal,
  input: {
    loaded: LoadedProductionManifest;
    selected: LoadedSeedanceAsset;
  }
): void {
  if (
    journal.assetId !== input.selected.asset.assetId ||
    journal.endpointId !== input.selected.asset.source.endpointId ||
    journal.manifestSha256 !== input.loaded.manifestSha256
  ) {
    throw new RunnerError("JOURNAL_CONFLICT", "Seedance journal context has changed.");
  }
}

function isTaskId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9:_-]{6,160}$/i.test(value);
}

function safeToken(value: string): string {
  return /^[a-z0-9:_-]{1,100}$/i.test(value) ? value : "UNKNOWN";
}

function safeProviderMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const message = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, 240);
  return message || null;
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export const __test = { buildSeedanceRequest, requestJson };
