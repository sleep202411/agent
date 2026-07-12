import { chmod, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { RunnerError } from "./errors";
import { composeSeedancePrompt } from "./fingerprint";
import { FizzdragonApi, type FizzdragonCloudConfig } from "./fizzdragon-cloud";
import type { LoadedProductionManifest, LoadedSeedanceAsset } from "./manifest-loader";
import { REPO_ROOT, repoRelative } from "./paths";
import { deriveExactFrameMaster, inspectLocalMp4, verifyVideoMaster } from "./video-file";

const CLOUD_MODEL_ID = "seedance-2-0";
const CLOUD_SCHEMA_VERSION = "2026-06-08";

type SeedanceCloudJournal = {
  journalVersion: 1;
  strategy: "fizzdragon-seedance-cloud-job";
  assetId: string;
  fingerprint: string;
  idempotencyKey: string;
  workspaceId: string;
  manifestSha256: string;
  state:
    | "CLAIMED"
    | "REFERENCES_READY"
    | "REFERENCES_ACTIVE"
    | "JOB_SUBMITTED"
    | "REVIEW"
    | "FAILED"
    | "UNKNOWN";
  referenceMediaAssetIds: string[];
  jobId?: string;
  result?: Omit<FizzdragonSeedanceResult, "alreadyStaged">;
  failure?: { category: string; jobStatus?: string; errorCode?: string };
  startedAt: string;
  updatedAt: string;
};

type CloudVideoJob = {
  id: string;
  status: string;
  outputs?: Array<{ assetId?: string; url?: string; accessUrl?: string }>;
  error?: { code?: string; userMessage?: string; message?: string };
};

export type FizzdragonSeedanceResult = {
  assetId: string;
  fingerprint: string;
  status: "REVIEW";
  jobId: string;
  referenceMediaAssetIds: string[];
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

export async function runFizzdragonSeedanceTrial(input: {
  loaded: LoadedProductionManifest;
  selected: LoadedSeedanceAsset;
  confirmedFingerprint: string;
  config: FizzdragonCloudConfig;
  workRoot: string;
  maxOutputBytes: number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<FizzdragonSeedanceResult> {
  if (input.confirmedFingerprint !== input.selected.fingerprint) {
    throw new RunnerError("JOURNAL_CONFLICT", "Fingerprint confirmation is stale; run plan again.");
  }
  const { asset } = input.selected;
  if (asset.source.mode !== "multimodal-to-video" || input.selected.references.length === 0) {
    throw new RunnerError(
      "ASSET_INVALID",
      "FizzDragon virtual-portrait video generation requires multimodal reference images."
    );
  }

  const api = new FizzdragonApi(input.config, input.fetchImpl ?? fetch);
  await api.assertCatalogContract(CLOUD_MODEL_ID, CLOUD_SCHEMA_VERSION);
  const journalFile = path.join(
    input.workRoot,
    "fizzdragon-seedance-journal",
    `${input.selected.fingerprint}.json`
  );
  let journal = await readJournal(journalFile, input.selected.fingerprint);
  if (journal?.state === "REVIEW" && journal.result) {
    return revalidateStagedResult(input, journal.result);
  }
  if (
    (journal?.state === "FAILED" && journal.failure?.category !== "insufficient-compute-points") ||
    (journal?.state === "UNKNOWN" && journal.failure?.category !== "submit-result-unknown")
  ) {
    throw new RunnerError(
      "JOURNAL_CONFLICT",
      `This fingerprint has a terminal ${journal.state} FizzDragon Seedance journal.`
    );
  }
  if (!journal) {
    const now = new Date().toISOString();
    journal = {
      journalVersion: 1,
      strategy: "fizzdragon-seedance-cloud-job",
      assetId: asset.assetId,
      fingerprint: input.selected.fingerprint,
      idempotencyKey: `jinling-video-${input.selected.fingerprint}`,
      workspaceId: input.config.workspaceId,
      manifestSha256: input.loaded.manifestSha256,
      state: "CLAIMED",
      referenceMediaAssetIds: [],
      startedAt: now,
      updatedAt: now,
    };
    await claimJournal(journalFile, journal);
  }
  assertJournalContext(journal, input);

  if (journal.referenceMediaAssetIds.length === 0) {
    const uploadedIds: string[] = [];
    for (const reference of input.selected.references) {
      const uploaded = await api.uploadReference(reference.absolutePath, reference.assetId);
      uploadedIds.push(uploaded.assetId);
    }
    journal = await updateJournal(journalFile, journal, {
      state: "REFERENCES_READY",
      referenceMediaAssetIds: uploadedIds,
    });
  }

  if (journal.state === "REFERENCES_READY" || journal.state === "CLAIMED") {
    await api.waitForProviderAssets(
      journal.referenceMediaAssetIds,
      input.config.jobTimeoutMs,
      input.sleep
    );
    journal = await updateJournal(journalFile, journal, { state: "REFERENCES_ACTIVE" });
  }

  let jobId = journal.jobId;
  if (!jobId) {
    const referenceBindings = await Promise.all(
      input.selected.references.map(async (reference, index) => ({
        refId: reference.assetId,
        kind: "image",
        label: reference.role,
        order: index + 1,
        assetId: journal!.referenceMediaAssetIds[index]!,
        url: await api.mediaAccessUrl(journal!.referenceMediaAssetIds[index]!),
      }))
    );
    const prompt = composeSeedancePrompt(asset);
    let submitted: { request_id: string };
    try {
      submitted = await api.post<{ request_id: string }>("/aurora/ai/jobs", {
        context: {
          workspaceId: input.config.workspaceId,
          projectId: "",
          documentId: "",
          documentBlockId: asset.assetId,
          sourceSurface: "jinling-production",
        },
        idempotencyKey: journal.idempotencyKey,
        input: {
          prompt,
          resolution: asset.source.generationParams.resolution,
          aspectRatio: asset.source.generationParams.ratio,
          duration: String(asset.source.generationParams.durationSeconds),
          generateAudio: asset.source.generationParams.generateAudio,
          referenceImages: referenceBindings.map((binding) => ({
            url: binding.url,
            refId: binding.refId,
            label: binding.label,
            assetId: binding.assetId,
          })),
        },
        promptDocument: { version: 1, nodes: [{ type: "text", text: prompt }] },
        referenceBindings,
        modelId: CLOUD_MODEL_ID,
        schemaVersion: CLOUD_SCHEMA_VERSION,
      });
    } catch (error) {
      if (error instanceof RunnerError && error.code === "PROVIDER_REJECTED") {
        const insufficientCompute =
          typeof error.details?.providerMessage === "string" &&
          error.details.providerMessage.includes("Not enough compute points");
        await updateJournal(journalFile, journal, {
          state: "FAILED",
          failure: {
            category: insufficientCompute ? "insufficient-compute-points" : "provider-rejected",
          },
        });
        throw error;
      }
      await updateJournal(journalFile, journal, {
        state: "UNKNOWN",
        failure: { category: "submit-result-unknown" },
      });
      throw error;
    }
    if (!isUuid(submitted.request_id)) {
      throw new RunnerError("PROVIDER_RESULT_UNKNOWN", "Cloud submit returned no valid job id.");
    }
    jobId = submitted.request_id;
    journal = await updateJournal(journalFile, journal, { state: "JOB_SUBMITTED", jobId });
  }

  const job = (await api.waitForJob(
    jobId,
    input.config.jobTimeoutMs,
    input.sleep
  )) as CloudVideoJob;
  if (job.status !== "completed") {
    await updateJournal(journalFile, journal, {
      state: "FAILED",
      failure: {
        category: "cloud-job",
        jobStatus: safeToken(job.status),
        ...(job.error?.code ? { errorCode: safeToken(job.error.code) } : {}),
      },
    });
    throw new RunnerError("PROVIDER_REJECTED", "FizzDragon Seedance job did not complete.", {
      jobStatus: safeToken(job.status),
    });
  }
  const output = job.outputs?.[0];
  if (!output?.assetId) {
    throw new RunnerError("OUTPUT_INVALID", "Completed cloud video job has no media asset id.");
  }
  const downloadUrl = await api.mediaAccessUrl(output.assetId);
  const providerSourcePath = path.join(
    input.workRoot,
    "fizzdragon-seedance-review",
    asset.assetId,
    `${input.selected.fingerprint}.mp4`
  );
  const downloaded = await inspectLocalMp4(providerSourcePath, input.maxOutputBytes).catch(
    async (error) => {
      if (!isMissingFile(error)) throw error;
      return api.downloadMediaVideo(downloadUrl, providerSourcePath, input.maxOutputBytes);
    }
  );
  const masterPath = path.join(
    input.workRoot,
    "fizzdragon-seedance-review",
    asset.assetId,
    `${input.selected.fingerprint}-master.mp4`
  );
  await inspectLocalMp4(masterPath, input.maxOutputBytes).catch(async (error) => {
    if (!isMissingFile(error)) throw error;
    await deriveExactFrameMaster({
      sourcePath: providerSourcePath,
      destinationPath: masterPath,
      frameCount: asset.delivery.frameCount,
      audio: asset.delivery.audio,
    });
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
  await chmod(providerSourcePath, 0o444);
  await chmod(masterPath, 0o444);
  const result: Omit<FizzdragonSeedanceResult, "alreadyStaged"> = {
    assetId: asset.assetId,
    fingerprint: input.selected.fingerprint,
    status: "REVIEW",
    jobId,
    referenceMediaAssetIds: journal.referenceMediaAssetIds,
    providerSourcePath: repoRelative(providerSourcePath),
    providerSourceSha256: downloaded.sha256,
    providerSourceBytes: downloaded.bytes,
    sourcePath: repoRelative(master.path),
    sha256: master.sha256,
    bytes: master.bytes,
    ...verified,
  };
  await updateJournal(journalFile, journal, { state: "REVIEW", result });
  return { ...result, alreadyStaged: false };
}

async function revalidateStagedResult(
  input: { maxOutputBytes: number },
  result: Omit<FizzdragonSeedanceResult, "alreadyStaged">
): Promise<FizzdragonSeedanceResult> {
  const source = await inspectLocalMp4(
    path.resolve(REPO_ROOT, result.sourcePath),
    input.maxOutputBytes
  );
  if (source.sha256 !== result.sha256 || source.bytes !== result.bytes) {
    throw new RunnerError("JOURNAL_CONFLICT", "Staged cloud Seedance master changed on disk.");
  }
  return { ...result, alreadyStaged: true };
}

async function readJournal(filePath: string, fingerprint: string) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as SeedanceCloudJournal;
    if (
      parsed.journalVersion !== 1 ||
      parsed.strategy !== "fizzdragon-seedance-cloud-job" ||
      parsed.fingerprint !== fingerprint ||
      !Array.isArray(parsed.referenceMediaAssetIds)
    ) {
      throw new RunnerError("JOURNAL_CONFLICT", "Cloud Seedance journal is invalid.");
    }
    return parsed;
  } catch (error) {
    if (isMissingFile(error)) return null;
    if (error instanceof RunnerError) throw error;
    throw new RunnerError("JOURNAL_CONFLICT", "Cloud Seedance journal cannot be read.");
  }
}

async function claimJournal(filePath: string, journal: SeedanceCloudJournal): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const handle = await open(filePath, "wx", 0o600).catch((error) => {
    if (isAlreadyExists(error)) {
      throw new RunnerError(
        "JOURNAL_CONFLICT",
        "Another cloud video runner owns this fingerprint."
      );
    }
    throw error;
  });
  await handle.writeFile(`${JSON.stringify(journal, null, 2)}\n`);
  await handle.sync();
  await handle.close();
}

async function updateJournal(
  filePath: string,
  journal: SeedanceCloudJournal,
  patch: Partial<SeedanceCloudJournal>
): Promise<SeedanceCloudJournal> {
  const next = { ...journal, ...patch, updatedAt: new Date().toISOString() };
  const part = `${filePath}.${process.pid}.part`;
  await rm(part, { force: true });
  await stat(filePath);
  const handle = await open(part, "wx", 0o600);
  await handle.writeFile(`${JSON.stringify(next, null, 2)}\n`);
  await handle.sync();
  await handle.close();
  await rename(part, filePath);
  return next;
}

function assertJournalContext(
  journal: SeedanceCloudJournal,
  input: {
    loaded: LoadedProductionManifest;
    selected: LoadedSeedanceAsset;
    config: FizzdragonCloudConfig;
  }
): void {
  if (
    journal.assetId !== input.selected.asset.assetId ||
    journal.workspaceId !== input.config.workspaceId ||
    journal.manifestSha256 !== input.loaded.manifestSha256
  ) {
    throw new RunnerError("JOURNAL_CONFLICT", "Cloud Seedance journal context changed.");
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeToken(value: string): string {
  return /^[a-z0-9:_-]{1,80}$/i.test(value) ? value : "UNKNOWN";
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}
