import { chmod, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { deriveReviewPng, finalizeImmutableSource } from "./derive-review-image";
import { RunnerError } from "./errors";
import { composeSeedreamPrompt } from "./fingerprint";
import { inspectLocalReferenceImage, writeStreamToPartFile } from "./image-file";
import type { LoadedProductionManifest, LoadedSeedreamAsset } from "./manifest-loader";
import { repoRelative } from "./paths";
import { type StoredVideo, writeMp4Stream } from "./video-file";

const PUBLIC_BASE_URL = "https://studio.fizzdragon.com";
export const FIZZDRAGON_MIN_POLL_INTERVAL_MS = 5_000;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const TERMINAL = new Set(["completed", "failed", "cancelled", "expired"]);

export interface FizzdragonCloudConfig {
  baseUrl: typeof PUBLIC_BASE_URL;
  satoken: string;
  workspaceId: string;
  pollIntervalMs: number;
  jobTimeoutMs: number;
}

export interface FizzdragonCloudResult {
  assetId: string;
  fingerprint: string;
  status: "REVIEW";
  jobId: string;
  referenceMediaAssetIds: string[];
  sourcePath: string;
  sourceSha256: string;
  sourceBytes: number;
  sourceWidth: number;
  sourceHeight: number;
  derivedPath: string;
  derivedSha256: string;
  derivedBytes: number;
  derivedWidth: number;
  derivedHeight: number;
  alreadyStaged: boolean;
}

interface CloudJournal {
  journalVersion: 1;
  strategy: "fizzdragon-cloud-job";
  assetId: string;
  fingerprint: string;
  idempotencyKey: string;
  workspaceId: string;
  manifestSha256: string;
  schemaVersion: string;
  state: "CLAIMED" | "REFERENCES_READY" | "JOB_SUBMITTED" | "REVIEW" | "FAILED" | "UNKNOWN";
  referenceMediaAssetIds: string[];
  jobId?: string;
  result?: Omit<FizzdragonCloudResult, "alreadyStaged">;
  failure?: { category: string; jobStatus?: string; errorCode?: string };
  startedAt: string;
  updatedAt: string;
}

interface CloudJob {
  id: string;
  status: string;
  stage?: string;
  outputs?: Array<{
    assetId?: string;
    url?: string;
    accessUrl?: string;
    width?: number;
    height?: number;
    mimeType?: string;
    bytes?: number;
  }>;
  error?: { code?: string; userMessage?: string; message?: string };
}

interface ProviderAssetStatus {
  assetId: string;
  status: string;
  statusReason?: string | null;
  updatedAt: string;
}

export function resolveFizzdragonCloudConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env
): FizzdragonCloudConfig {
  const satoken = environment.FIZZDRAGON_SATOKEN?.trim();
  const workspaceId = environment.FIZZDRAGON_WORKSPACE_ID?.trim();
  if (!satoken) throw new RunnerError("CONFIG_MISSING", "FIZZDRAGON_SATOKEN is required.");
  if (!workspaceId || !isUuid(workspaceId)) {
    throw new RunnerError("CONFIG_MISSING", "FIZZDRAGON_WORKSPACE_ID must be a UUID.");
  }
  return {
    baseUrl: PUBLIC_BASE_URL,
    satoken,
    workspaceId,
    pollIntervalMs: parseBoundedInteger(
      environment.FIZZDRAGON_POLL_INTERVAL_MS,
      5_000,
      5_000,
      60_000,
      "FIZZDRAGON_POLL_INTERVAL_MS"
    ),
    jobTimeoutMs: parseBoundedInteger(
      environment.FIZZDRAGON_JOB_TIMEOUT_MS,
      1_800_000,
      60_000,
      3_600_000,
      "FIZZDRAGON_JOB_TIMEOUT_MS"
    ),
  };
}

export async function runFizzdragonReferenceTrial(input: {
  loaded: LoadedProductionManifest;
  selected: LoadedSeedreamAsset;
  confirmedFingerprint: string;
  config: FizzdragonCloudConfig;
  workRoot: string;
  maxOutputBytes: number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<FizzdragonCloudResult> {
  if (input.confirmedFingerprint !== input.selected.fingerprint) {
    throw new RunnerError("JOURNAL_CONFLICT", "Fingerprint confirmation is stale; run plan again.");
  }
  const { asset } = input.selected;
  const orchestration = asset.source.orchestration;
  if (orchestration.publicBaseUrl !== input.config.baseUrl) {
    throw new RunnerError("SECURITY_REJECTED", "Manifest cloud base URL is not allowlisted.");
  }
  if (orchestration.imageSize !== asset.delivery.aspectRatio) {
    throw new RunnerError("ASSET_INVALID", "Cloud imageSize must match the delivery aspect ratio.");
  }

  const api = new FizzdragonApi(input.config, input.fetchImpl ?? fetch);
  await api.assertCatalogContract(orchestration.catalogModelId, orchestration.schemaVersion);
  const journalFile = cloudJournalPath(input.workRoot, input.selected.fingerprint);
  let journal = await readCloudJournal(journalFile, input.selected.fingerprint);
  if (journal?.state === "REVIEW" && journal.result) {
    return { ...journal.result, alreadyStaged: true };
  }
  if (journal?.state === "FAILED") {
    throw new RunnerError(
      "JOURNAL_CONFLICT",
      "This fingerprint has a terminal FAILED cloud journal."
    );
  }
  if (!journal) {
    const now = new Date().toISOString();
    journal = {
      journalVersion: 1,
      strategy: "fizzdragon-cloud-job",
      assetId: asset.assetId,
      fingerprint: input.selected.fingerprint,
      idempotencyKey: `jinling-${input.selected.fingerprint}`,
      workspaceId: input.config.workspaceId,
      manifestSha256: input.loaded.manifestSha256,
      schemaVersion: orchestration.schemaVersion,
      state: "CLAIMED",
      referenceMediaAssetIds: [],
      startedAt: now,
      updatedAt: now,
    };
    await claimCloudJournal(journalFile, journal);
  }
  assertJournalContext(journal, input);

  if (journal.referenceMediaAssetIds.length === 0) {
    const uploaded: Array<{ refId: string; label: string; assetId: string; url: string }> = [];
    for (const reference of input.selected.references) {
      const media = await api.uploadReference(reference.absolutePath, reference.assetId);
      uploaded.push({ refId: reference.assetId, label: reference.role, ...media });
    }
    journal = await updateCloudJournal(journalFile, journal, {
      state: "REFERENCES_READY",
      referenceMediaAssetIds: uploaded.map((reference) => reference.assetId),
    });
  }

  let jobId = journal.jobId;
  if (!jobId) {
    const referenceMediaAssetIds = journal.referenceMediaAssetIds;
    await api.waitForProviderAssets(referenceMediaAssetIds, input.config.jobTimeoutMs, input.sleep);
    const referenceBindings = await Promise.all(
      input.selected.references.map(async (reference, index) => ({
        refId: reference.assetId,
        kind: "image",
        label: reference.role,
        order: index,
        assetId: referenceMediaAssetIds[index],
        url: await api.mediaAccessUrl(referenceMediaAssetIds[index]!),
      }))
    );
    const prompt = composeSeedreamPrompt(asset);
    let submitted: { request_id: string };
    try {
      submitted = await api.post<{ request_id: string }>("/aurora/ai/jobs", {
        context: {
          workspaceId: input.config.workspaceId,
          documentBlockId: asset.assetId,
          sourceSurface: orchestration.sourceSurface,
        },
        idempotencyKey: journal.idempotencyKey,
        input: {
          prompt,
          imageSize: orchestration.imageSize,
          resolution: orchestration.resolution,
          referenceImages: referenceBindings.map((binding) => ({
            url: binding.url,
            refId: binding.refId,
            label: binding.label,
            assetId: binding.assetId,
          })),
        },
        promptDocument: { version: 1, nodes: [{ type: "text", text: prompt }] },
        referenceBindings,
        modelId: orchestration.catalogModelId,
        schemaVersion: orchestration.schemaVersion,
      });
    } catch (error) {
      await updateCloudJournal(journalFile, journal, {
        state: "UNKNOWN",
        failure: { category: "submit-result-unknown" },
      });
      throw error;
    }
    if (!isUuid(submitted.request_id)) {
      throw new RunnerError("PROVIDER_RESULT_UNKNOWN", "Cloud submit returned no valid job id.");
    }
    jobId = submitted.request_id;
    journal = await updateCloudJournal(journalFile, journal, {
      state: "JOB_SUBMITTED",
      jobId,
    });
  }

  const job = await api.waitForJob(jobId, input.config.jobTimeoutMs, input.sleep);
  if (job.status !== "completed") {
    await updateCloudJournal(journalFile, journal, {
      state: "FAILED",
      failure: {
        category: "cloud-job",
        jobStatus: safeToken(job.status),
        ...(job.error?.code ? { errorCode: safeToken(job.error.code) } : {}),
      },
    });
    throw new RunnerError("PROVIDER_REJECTED", "FizzDragon cloud generation did not complete.", {
      jobStatus: safeToken(job.status),
      ...(job.error?.code ? { providerCode: safeToken(job.error.code) } : {}),
    });
  }
  const output = job.outputs?.[0];
  if (!output) throw new RunnerError("OUTPUT_INVALID", "Completed cloud job has no output.");
  const outputUrl = api.resolveOutputUrl(output.url ?? output.accessUrl);
  const sourceTemporaryPath = path.join(
    input.workRoot,
    "fizzdragon-source",
    asset.assetId,
    `${input.selected.fingerprint}.download`
  );
  await mkdir(path.dirname(sourceTemporaryPath), { recursive: true });
  const downloaded = await api.downloadImage(outputUrl, sourceTemporaryPath, input.maxOutputBytes);
  const sourcePath = path.join(
    input.workRoot,
    "fizzdragon-source",
    asset.assetId,
    `${input.selected.fingerprint}.${downloaded.format}`
  );
  const source = await finalizeImmutableSource(downloaded, sourcePath);
  const metadata = await sharp(source.path).metadata();
  if (!metadata.width || !metadata.height) {
    throw new RunnerError("OUTPUT_INVALID", "Cloud output dimensions are unavailable.");
  }
  assertAspectRatio(metadata.width, metadata.height, orchestration.imageSize);

  const derivedPath = path.join(
    input.workRoot,
    "fizzdragon-review",
    asset.assetId,
    `${input.selected.fingerprint}.png`
  );
  const derived = await deriveReviewPng({
    source,
    destinationPath: derivedPath,
    maxBytes: input.maxOutputBytes,
    derivation: {
      purpose: "review-only",
      method: "lanczos3",
      sourceDimensions: { width: metadata.width, height: metadata.height },
      targetDimensions: { width: asset.delivery.width, height: asset.delivery.height },
    },
  });
  await chmod(derived.path, 0o444);
  const result: Omit<FizzdragonCloudResult, "alreadyStaged"> = {
    assetId: asset.assetId,
    fingerprint: input.selected.fingerprint,
    status: "REVIEW",
    jobId,
    referenceMediaAssetIds: journal.referenceMediaAssetIds,
    sourcePath: repoRelative(source.path),
    sourceSha256: source.sha256,
    sourceBytes: source.bytes,
    sourceWidth: metadata.width,
    sourceHeight: metadata.height,
    derivedPath: repoRelative(derived.path),
    derivedSha256: derived.sha256,
    derivedBytes: derived.bytes,
    derivedWidth: asset.delivery.width,
    derivedHeight: asset.delivery.height,
  };
  await updateCloudJournal(journalFile, journal, { state: "REVIEW", result });
  return { ...result, alreadyStaged: false };
}

export class FizzdragonApi {
  constructor(
    private readonly config: FizzdragonCloudConfig,
    private readonly fetchImpl: typeof fetch
  ) {}

  async assertCatalogContract(modelId: string, schemaVersion: string): Promise<void> {
    const catalog = await this.get<Record<string, unknown>>("/aurora/ai/models");
    const models = Array.isArray(catalog.models) ? catalog.models : [];
    const model = models.find((candidate): candidate is Record<string, unknown> =>
      Boolean(
        candidate && typeof candidate === "object" && (candidate as { id?: unknown }).id === modelId
      )
    );
    if (!model || model.enabled !== true || model.schemaVersion !== schemaVersion) {
      throw new RunnerError(
        "ASSET_INVALID",
        "Live FizzDragon model catalog does not match the reviewed manifest lock."
      );
    }
  }

  async uploadReference(
    filePath: string,
    refId: string
  ): Promise<{ assetId: string; url: string }> {
    const inspected = await inspectLocalReferenceImage(filePath, 30 * 1024 * 1024);
    const signed = await this.post<{
      uploadUrl: string;
      method: "PUT";
      headers: Record<string, string>;
      storageKey: string;
    }>("/aurora/media/upload-url", {
      kind: "ai_reference_image",
      contentType: inspected.mimeType,
      fileName: `${safeToken(refId)}.${inspected.format}`,
      sizeBytes: inspected.bytes,
    });
    assertExternalHttpsUrl(signed.uploadUrl);
    const bytes = await readFile(filePath);
    const put = await this.fetchImpl(signed.uploadUrl, {
      method: signed.method,
      headers: { "Content-Type": inspected.mimeType, ...signed.headers },
      body: bytes,
      redirect: "error",
    });
    if (!put.ok) throw new RunnerError("PROVIDER_REJECTED", "Reference storage upload failed.");
    const confirmed = await this.post<{ mediaAssetId: string; url: string }>(
      "/aurora/media/confirm",
      { storageKey: signed.storageKey, kind: "ai_reference_image", contentType: inspected.mimeType }
    );
    if (!isUuid(confirmed.mediaAssetId)) {
      throw new RunnerError("OUTPUT_INVALID", "Reference confirmation returned no valid asset id.");
    }
    return { assetId: confirmed.mediaAssetId, url: confirmed.url };
  }

  async mediaAccessUrl(assetId: string): Promise<string> {
    const result = await this.get<{ url: string }>(
      `/aurora/media/assets/${encodeURIComponent(assetId)}/access?variantKey=original`
    );
    assertExternalHttpsUrl(result.url);
    return result.url;
  }

  async downloadMediaVideo(
    url: string,
    destinationPath: string,
    maxBytes: number
  ): Promise<StoredVideo> {
    // The URL is minted by FizzDragon's authenticated media-access endpoint,
    // validated as public HTTPS above, and may point at either regional OSS.
    // Redirects remain disabled so the signed origin cannot escape afterward.
    assertExternalHttpsUrl(url);
    const response = await this.fetchImpl(url, {
      headers: { Accept: "video/mp4,application/octet-stream" },
      redirect: "error",
    });
    if (!response.ok || !response.body) {
      throw new RunnerError("DOWNLOAD_FAILED", "FizzDragon media download failed.", {
        httpStatus: response.status,
      });
    }
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new RunnerError("DOWNLOAD_FAILED", "FizzDragon video exceeds the size limit.");
    }
    return writeMp4Stream({
      stream: response.body,
      destinationPath,
      maxBytes,
      responseContentType: response.headers.get("content-type"),
    });
  }

  /**
   * Match the canvas reference lifecycle exactly: confirming an image only
   * enqueues its ModelArk AIGC/virtual-portrait registration. Generation must
   * wait until that mirror is ACTIVE or the provider still receives a plain
   * CDN URL and can reject a human reference before the virtual asset exists.
   */
  async waitForProviderAssets(
    assetIds: string[],
    timeoutMs: number,
    sleep: (milliseconds: number) => Promise<void> = delay
  ): Promise<void> {
    const uniqueAssetIds = [...new Set(assetIds)];
    if (uniqueAssetIds.length === 0) return;
    const started = Date.now();
    while (true) {
      const response = await this.post<{ assets: ProviderAssetStatus[] }>(
        "/aurora/media/provider-assets/status",
        { assetIds: uniqueAssetIds }
      );
      const statuses = new Map(response.assets.map((asset) => [asset.assetId, asset]));
      const failed = uniqueAssetIds
        .map((assetId) => statuses.get(assetId))
        .find(
          (asset) => asset && ["failed", "deleted", "blocked", "rejected"].includes(asset.status)
        );
      if (failed) {
        throw new RunnerError("PROVIDER_REJECTED", "Virtual portrait registration failed.", {
          providerStatus: safeToken(failed.status),
        });
      }
      if (uniqueAssetIds.every((assetId) => statuses.get(assetId)?.status === "active")) return;
      if (Date.now() - started >= timeoutMs) {
        throw new RunnerError(
          "PROVIDER_RESULT_UNKNOWN",
          "Virtual portrait registration did not become active before deadline."
        );
      }
      await sleep(Math.max(this.config.pollIntervalMs, FIZZDRAGON_MIN_POLL_INTERVAL_MS));
    }
  }

  async waitForJob(
    jobId: string,
    timeoutMs: number,
    sleep: (milliseconds: number) => Promise<void> = delay
  ): Promise<CloudJob> {
    const started = Date.now();
    while (true) {
      const job = await this.get<CloudJob>(`/aurora/ai/jobs/${encodeURIComponent(jobId)}`);
      if (TERMINAL.has(job.status)) return job;
      if (Date.now() - started >= timeoutMs) {
        throw new RunnerError(
          "PROVIDER_RESULT_UNKNOWN",
          "Cloud job did not reach a terminal state before deadline."
        );
      }
      await sleep(Math.max(this.config.pollIntervalMs, FIZZDRAGON_MIN_POLL_INTERVAL_MS));
    }
  }

  resolveOutputUrl(value: string | undefined): string {
    if (!value) throw new RunnerError("OUTPUT_INVALID", "Cloud output URL is missing.");
    const resolved = new URL(value, this.config.baseUrl);
    if (resolved.protocol !== "https:") {
      throw new RunnerError("SECURITY_REJECTED", "Cloud output must use HTTPS.");
    }
    const allowed =
      resolved.hostname === "studio.fizzdragon.com" ||
      resolved.hostname === "media.fizzdragon.com" ||
      resolved.hostname.endsWith(".fizzdragon.com");
    if (!allowed)
      throw new RunnerError("SECURITY_REJECTED", "Cloud output host is not allowlisted.");
    return resolved.toString();
  }

  async downloadImage(url: string, destinationPath: string, maxBytes: number) {
    const response = await this.fetchImpl(url, {
      headers: this.headers(false),
      redirect: "error",
    });
    if (!response.ok || !response.body) {
      throw new RunnerError("DOWNLOAD_FAILED", "Cloud output download failed.");
    }
    return writeStreamToPartFile({
      stream: response.body,
      destinationPath,
      responseContentType: response.headers.get("content-type"),
      maxBytes,
    });
  }

  get<T>(pathname: string): Promise<T> {
    return this.request<T>(pathname, { method: "GET" });
  }

  post<T>(pathname: string, body: unknown): Promise<T> {
    return this.request<T>(pathname, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async request<T>(pathname: string, init: RequestInit): Promise<T> {
    const url = new URL(pathname, this.config.baseUrl);
    if (url.origin !== this.config.baseUrl) {
      throw new RunnerError(
        "SECURITY_REJECTED",
        "FizzDragon API request escaped the allowlisted origin."
      );
    }
    const response = await this.fetchImpl(url, {
      ...init,
      headers: { ...this.headers(true), ...(init.headers ?? {}) },
      redirect: "error",
    });
    const raw = await response.text();
    if (Buffer.byteLength(raw) > MAX_JSON_BYTES) {
      throw new RunnerError("OUTPUT_INVALID", "FizzDragon API response exceeded the JSON limit.");
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new RunnerError("PROVIDER_RESULT_UNKNOWN", "FizzDragon API returned non-JSON.");
    }
    const envelope = json as { code?: unknown; data?: unknown; msg?: unknown };
    if (!response.ok || (typeof envelope.code === "number" && envelope.code !== 200)) {
      const providerMessage = safeProviderMessage(envelope.msg);
      throw new RunnerError("PROVIDER_REJECTED", "FizzDragon API rejected the request.", {
        httpStatus: response.status,
        ...(typeof envelope.code === "number" ? { providerCode: envelope.code } : {}),
        ...(providerMessage ? { providerMessage } : {}),
      });
    }
    return (("data" in envelope ? envelope.data : json) ?? {}) as T;
  }

  private headers(workspace: boolean): Record<string, string> {
    return {
      Cookie: `satoken=${this.config.satoken}`,
      Accept: "application/json",
      "accept-language": "en-US",
      ...(workspace ? { "x-fizz-workspace-id": this.config.workspaceId } : {}),
    };
  }
}

function cloudJournalPath(workRoot: string, fingerprint: string): string {
  return path.join(workRoot, "fizzdragon-journal", `${fingerprint}.json`);
}

async function readCloudJournal(
  filePath: string,
  fingerprint: string
): Promise<CloudJournal | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as CloudJournal;
    if (
      parsed.journalVersion !== 1 ||
      parsed.strategy !== "fizzdragon-cloud-job" ||
      parsed.fingerprint !== fingerprint ||
      !Array.isArray(parsed.referenceMediaAssetIds)
    ) {
      throw new RunnerError("JOURNAL_CONFLICT", "Cloud journal is invalid.");
    }
    return parsed;
  } catch (error) {
    if (isMissingFile(error)) return null;
    if (error instanceof RunnerError) throw error;
    throw new RunnerError("JOURNAL_CONFLICT", "Cloud journal cannot be read.");
  }
}

async function claimCloudJournal(filePath: string, journal: CloudJournal): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const handle = await open(filePath, "wx", 0o600).catch((error) => {
    if (isAlreadyExists(error)) {
      throw new RunnerError("JOURNAL_CONFLICT", "Another cloud runner owns this fingerprint.");
    }
    throw error;
  });
  await handle.writeFile(`${JSON.stringify(journal, null, 2)}\n`);
  await handle.sync();
  await handle.close();
}

async function updateCloudJournal(
  filePath: string,
  journal: CloudJournal,
  patch: Partial<CloudJournal>
): Promise<CloudJournal> {
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
  journal: CloudJournal,
  input: {
    loaded: LoadedProductionManifest;
    selected: LoadedSeedreamAsset;
    config: FizzdragonCloudConfig;
  }
): void {
  if (
    journal.assetId !== input.selected.asset.assetId ||
    journal.workspaceId !== input.config.workspaceId ||
    journal.manifestSha256 !== input.loaded.manifestSha256 ||
    journal.schemaVersion !== input.selected.asset.source.orchestration.schemaVersion
  ) {
    throw new RunnerError(
      "JOURNAL_CONFLICT",
      "Cloud journal context differs from the current plan."
    );
  }
}

function assertAspectRatio(width: number, height: number, expected: string): void {
  const [expectedWidth, expectedHeight] = expected.split(":").map(Number);
  const drift = Math.abs(width / height - expectedWidth! / expectedHeight!);
  if (drift > 0.01)
    throw new RunnerError("OUTPUT_INVALID", "Cloud output aspect ratio is invalid.");
}

function assertExternalHttpsUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RunnerError("SECURITY_REJECTED", "Signed media URL is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password || isPrivateHost(url.hostname)) {
    throw new RunnerError("SECURITY_REJECTED", "Signed media URL is not safe for external access.");
  }
}

function isPrivateHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".local") ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string
): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RunnerError("CONFIG_MISSING", `${name} must be ${minimum}-${maximum}.`);
  }
  return parsed;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeToken(value: string): string {
  return /^[a-z0-9:_-]{1,80}$/i.test(value) ? value : "UNKNOWN";
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

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export const __test = { FizzdragonApi, assertExternalHttpsUrl };
