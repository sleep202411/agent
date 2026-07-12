import { mkdir, rm } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import { Readable } from "node:stream";
import { deriveReviewPng, finalizeImmutableSource } from "./derive-review-image";
import { RunnerError } from "./errors";
import {
  referenceAsDataUrl,
  verifyImageDimensions,
  writeBase64ImageAtomically,
  type StoredImage,
} from "./image-file";
import {
  claimJournal,
  newJournal,
  readJournal,
  RESULT_UNKNOWN_REASONS,
  writeJournal,
  type JournalSourceArtifact,
  type ProductionJournal,
  type ResultUnknownReason,
} from "./journal";
import {
  isReferenceTrialEligible,
  type LoadedProductionManifest,
  type LoadedSeedreamAsset,
} from "./manifest-loader";
import { repoRelative } from "./paths";
import { secureDownloadProviderImage } from "./secure-download";
import type { SeedreamProviderConfig } from "./environment";

const MAX_PROVIDER_RESPONSE_BYTES = 96 * 1024 * 1024;
const MAX_REFERENCE_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_REFERENCE_BYTES = 30 * 1024 * 1024;
export const DEFAULT_PROVIDER_TIMEOUT_SECONDS = 1_800;
export const MIN_PROVIDER_TIMEOUT_SECONDS = 600;
export const MAX_PROVIDER_TIMEOUT_SECONDS = 3_600;

interface SeedreamProviderResponse {
  id?: unknown;
  data?: unknown;
  error?: unknown;
  message?: unknown;
}

export interface SeedreamReferenceTrialResult {
  assetId: string;
  fingerprint: string;
  status: "REVIEW";
  sourcePath: string;
  sourceSha256: string;
  sourceBytes: number;
  sourceMimeType: string;
  sourceFormat: "png" | "jpg" | "webp";
  derivedPath: string;
  derivedSha256: string;
  derivedBytes: number;
  derivedMimeType: "image/png";
  derivationPurpose: "review-only";
  derivationMethod: "lanczos3";
  sourceWidth: number;
  sourceHeight: number;
  derivedWidth: number;
  derivedHeight: number;
  alreadyStaged: boolean;
}

export async function runSeedreamReferenceTrial(input: {
  loaded: LoadedProductionManifest;
  selected: LoadedSeedreamAsset;
  confirmedFingerprint: string;
  provider: SeedreamProviderConfig;
  workRoot: string;
  repoRoot: string;
  maxOutputBytes: number;
  providerTimeoutMs: number;
}): Promise<SeedreamReferenceTrialResult> {
  const { asset } = input.selected;
  if (!isReferenceTrialEligible(input.loaded.manifest.status, asset)) {
    throw new RunnerError(
      "ASSET_INVALID",
      "Seedream trial is not explicitly admitted by the manifest submission gate."
    );
  }
  const derivation = asset.source.generationParams.derivation;
  if (!derivation) {
    throw new RunnerError(
      "ASSET_INVALID",
      "Reference trial requires an explicit review-only Lanczos3 derivation."
    );
  }
  if (input.confirmedFingerprint !== input.selected.fingerprint) {
    throw new RunnerError(
      "JOURNAL_CONFLICT",
      "Fingerprint confirmation does not match the current plan; run plan again."
    );
  }

  const priorJournal = await readJournal(input.workRoot, input.selected.fingerprint);
  if (priorJournal) {
    if (priorJournal.state === "REVIEW" && priorJournal.result) {
      return {
        assetId: priorJournal.assetId,
        fingerprint: priorJournal.fingerprint,
        status: "REVIEW",
        sourcePath: priorJournal.result.sourcePath,
        sourceSha256: priorJournal.result.sourceSha256,
        sourceBytes: priorJournal.result.sourceBytes,
        sourceMimeType: priorJournal.result.sourceMimeType,
        sourceFormat: priorJournal.result.sourceFormat,
        derivedPath: priorJournal.result.derivedPath,
        derivedSha256: priorJournal.result.derivedSha256,
        derivedBytes: priorJournal.result.derivedBytes,
        derivedMimeType: priorJournal.result.derivedMimeType,
        derivationPurpose: priorJournal.result.derivationPurpose,
        derivationMethod: priorJournal.result.derivationMethod,
        sourceWidth: priorJournal.result.sourceWidth,
        sourceHeight: priorJournal.result.sourceHeight,
        derivedWidth: priorJournal.result.derivedWidth,
        derivedHeight: priorJournal.result.derivedHeight,
        alreadyStaged: true,
      };
    }
    throw new RunnerError(
      "JOURNAL_CONFLICT",
      `Fingerprint already has a ${priorJournal.state} journal; refusing to submit a duplicate task.`
    );
  }

  const sourceTemporaryPath = path.join(
    input.workRoot,
    "source",
    asset.assetId,
    `${input.selected.fingerprint}.provider-source`
  );
  const derivedPath = path.join(
    input.workRoot,
    "review",
    asset.assetId,
    `${input.selected.fingerprint}.png`
  );
  await mkdir(path.dirname(sourceTemporaryPath), { recursive: true });
  await mkdir(path.dirname(derivedPath), { recursive: true });

  // Re-read and hash every reference before claiming/submitting. Validation
  // failures here are non-billable and must not strand a SUBMITTING journal.
  const requestBody = await buildProviderRequest(input.selected);

  let journal = newJournal({
    assetId: asset.assetId,
    fingerprint: input.selected.fingerprint,
    model: asset.source.model,
    endpointId: asset.source.endpointId,
    manifest: {
      schemaVersion: input.loaded.manifest.schemaVersion,
      manifestId: input.loaded.manifest.manifestId,
      manifestSha256: input.loaded.manifestSha256,
      contentVersion: input.loaded.manifest.contentVersion,
      promptVersion: input.loaded.manifest.promptVersion,
    },
  });
  await claimJournal(input.workRoot, journal);

  let response: Response;
  let responseBody: SeedreamProviderResponse;
  try {
    ({ response, body: responseBody } = await postSeedream(input.provider, requestBody, {
      timeoutMs: input.providerTimeoutMs,
    }));
  } catch (error) {
    const diagnostic = unknownResultDiagnostic(error, input.providerTimeoutMs);
    await transitionJournal(input.workRoot, journal, {
      state: "UNKNOWN",
      ...(diagnostic.providerRequestId ? { providerRequestId: diagnostic.providerRequestId } : {}),
      failure: diagnostic.failure,
    });
    if (error instanceof RunnerError) throw error;
    throw new RunnerError(
      "PROVIDER_RESULT_UNKNOWN",
      "Seedream request ended without a trustworthy provider result; do not resubmit automatically."
    );
  }

  const providerRequestId = safeIdentifier(responseBody.id) ?? safeRequestId(response.headers);
  if (!response.ok) {
    const providerCode = safeProviderCode(responseBody.error);
    const providerMessage = safeProviderMessage(
      errorMessage(responseBody.error) ?? responseBody.message
    );
    await transitionJournal(input.workRoot, journal, {
      state: "FAILED",
      ...(providerRequestId ? { providerRequestId } : {}),
      failure: {
        category: "provider-rejected",
        httpStatus: response.status,
        ...(providerCode ? { providerCode } : {}),
      },
    });
    throw new RunnerError("PROVIDER_REJECTED", "Seedream rejected the reference trial.", {
      httpStatus: response.status,
      ...(providerCode ? { providerCode } : {}),
      ...(providerMessage ? { providerMessage } : {}),
    });
  }

  journal = await transitionJournal(input.workRoot, journal, {
    state: "PROVIDER_ACCEPTED",
    ...(providerRequestId ? { providerRequestId } : {}),
  });

  let source: StoredImage;
  try {
    const downloaded = await storeProviderOutput({
      responseBody,
      destinationPath: sourceTemporaryPath,
      maxOutputBytes: input.maxOutputBytes,
    });
    source = await finalizeImmutableSource(
      downloaded,
      path.join(
        input.workRoot,
        "source",
        asset.assetId,
        `${input.selected.fingerprint}.${downloaded.format}`
      )
    );
  } catch (error) {
    await rm(sourceTemporaryPath, { force: true }).catch(() => undefined);
    await transitionJournal(input.workRoot, journal, {
      state: "FAILED",
      failure: { category: "download" },
    });
    throw error instanceof RunnerError
      ? error
      : new RunnerError("DOWNLOAD_FAILED", "Seedream output could not be staged.");
  }

  let sourceVerified: Awaited<ReturnType<typeof verifyImageDimensions>>;
  try {
    sourceVerified = await verifyImageDimensions(source.path, {
      width: asset.source.generationParams.width,
      height: asset.source.generationParams.height,
    });
  } catch (error) {
    await transitionJournal(input.workRoot, journal, {
      state: "FAILED",
      failure: { category: "verification" },
    });
    throw error instanceof RunnerError
      ? error
      : new RunnerError("OUTPUT_INVALID", "Seedream source dimension verification failed.");
  }

  const sourceRecord: JournalSourceArtifact = {
    stagedPath: repoRelative(source.path),
    sha256: source.sha256,
    bytes: source.bytes,
    mimeType: source.mimeType,
    format: source.format,
    width: sourceVerified.width,
    height: sourceVerified.height,
    codec: sourceVerified.codec,
    pixelFormat: sourceVerified.pixelFormat,
  };
  journal = await transitionJournal(input.workRoot, journal, {
    state: "SOURCE_STAGED",
    source: sourceRecord,
  });

  try {
    assertExpectedProviderFormat(source.format, asset.source.generationParams.outputFormat);
  } catch (error) {
    await transitionJournal(input.workRoot, journal, {
      state: "FAILED",
      failure: { category: "verification" },
    });
    throw error;
  }

  try {
    const derived = await deriveReviewPng({
      source,
      destinationPath: derivedPath,
      maxBytes: input.maxOutputBytes,
      derivation,
    });
    const verified = await verifyImageDimensions(derived.path, {
      width: asset.delivery.width,
      height: asset.delivery.height,
    });
    const result: NonNullable<ProductionJournal["result"]> = {
      status: "REVIEW",
      sourcePath: sourceRecord.stagedPath,
      sourceSha256: source.sha256,
      sourceBytes: source.bytes,
      sourceMimeType: source.mimeType,
      sourceFormat: source.format,
      derivedPath: repoRelative(derived.path),
      derivedSha256: derived.sha256,
      derivedBytes: derived.bytes,
      derivedMimeType: "image/png",
      derivationPurpose: derivation.purpose,
      derivationMethod: derivation.method,
      sourceWidth: sourceVerified.width,
      sourceHeight: sourceVerified.height,
      sourceCodec: sourceVerified.codec,
      sourcePixelFormat: sourceVerified.pixelFormat,
      derivedWidth: verified.width,
      derivedHeight: verified.height,
      derivedCodec: verified.codec,
      derivedPixelFormat: verified.pixelFormat,
    };
    await transitionJournal(input.workRoot, journal, {
      state: "REVIEW",
      result,
    });
    return {
      assetId: asset.assetId,
      fingerprint: input.selected.fingerprint,
      status: "REVIEW",
      sourcePath: result.sourcePath,
      sourceSha256: result.sourceSha256,
      sourceBytes: result.sourceBytes,
      sourceMimeType: result.sourceMimeType,
      sourceFormat: result.sourceFormat,
      derivedPath: result.derivedPath,
      derivedSha256: result.derivedSha256,
      derivedBytes: result.derivedBytes,
      derivedMimeType: result.derivedMimeType,
      derivationPurpose: result.derivationPurpose,
      derivationMethod: result.derivationMethod,
      sourceWidth: result.sourceWidth,
      sourceHeight: result.sourceHeight,
      derivedWidth: result.derivedWidth,
      derivedHeight: result.derivedHeight,
      alreadyStaged: false,
    };
  } catch (error) {
    await rm(derivedPath, { force: true }).catch(() => undefined);
    await transitionJournal(input.workRoot, journal, {
      state: "FAILED",
      failure: { category: "verification" },
    });
    throw error instanceof RunnerError
      ? error
      : new RunnerError("OUTPUT_INVALID", "Seedream output verification failed.");
  }
}

export async function buildProviderRequest(
  selected: LoadedSeedreamAsset
): Promise<Record<string, unknown>> {
  const totalReferenceBytes = selected.references.reduce(
    (total, reference) => total + reference.bytes,
    0
  );
  if (totalReferenceBytes > MAX_TOTAL_REFERENCE_BYTES) {
    throw new RunnerError(
      "ASSET_INVALID",
      "Reference trial exceeds the combined local reference size limit."
    );
  }
  const images = await Promise.all(
    selected.references.map((reference) =>
      referenceAsDataUrl(reference.absolutePath, reference, MAX_REFERENCE_BYTES)
    )
  );
  if (selected.asset.source.mode === "reference-edit" && images.length === 0) {
    throw new RunnerError("ASSET_INVALID", "Reference trial has no reference image.");
  }

  const body: Record<string, unknown> = {
    model: selected.asset.source.endpointId,
    prompt: selected.descriptor.prompt,
    size: selected.descriptor.request.size,
    response_format: selected.descriptor.request.responseFormat,
    watermark: selected.descriptor.request.watermark,
  };
  if (images.length > 0) {
    body.image = images.length === 1 ? images[0] : images;
  }
  if (selected.asset.source.model === "seedream-5-pro") {
    body.output_format = selected.descriptor.request.outputFormat;
  } else {
    body.stream = false;
    body.sequential_image_generation = "disabled";
  }
  return body;
}

export function assertExpectedProviderFormat(
  actualFormat: StoredImage["format"],
  expectedFormat: "png" | "jpeg"
): void {
  const expectedMagicFormat = expectedFormat === "jpeg" ? "jpg" : expectedFormat;
  if (actualFormat === expectedMagicFormat) return;

  throw new RunnerError(
    "OUTPUT_INVALID",
    `Seedream source format mismatch: expected ${expectedFormat}, received ${actualFormat}. The immutable provider source was preserved for diagnosis.`,
    {
      expectedFormat,
      actualFormat,
    }
  );
}

export interface PostSeedreamOptions {
  timeoutMs: number;
  fetchImpl?: SeedreamHttpTransport;
}

export type SeedreamHttpTransport = (endpoint: string, init: RequestInit) => Promise<Response>;

export async function postSeedream(
  provider: SeedreamProviderConfig,
  body: Record<string, unknown>,
  options: PostSeedreamOptions
): Promise<{ response: Response; body: SeedreamProviderResponse }> {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new RunnerError("CONFIG_MISSING", "Provider response timeout must be positive.");
  }
  const endpoint = `${provider.apiBaseUrl}/images/generations`;
  const controller = new AbortController();
  const startedAt = Date.now();
  let reachedClientDeadline = false;
  let response: Response | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reachedClientDeadline = true;
        controller.abort();
        reject(new Error("provider-response-deadline"));
      }, options.timeoutMs);
    });
    const request = (async () => {
      response = await (options.fetchImpl ?? nodeHttpsTransport)(endpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const bytes = await readLimitedBody(response, MAX_PROVIDER_RESPONSE_BYTES);
      let parsed: unknown;
      try {
        parsed = JSON.parse(bytes.toString("utf8"));
      } catch {
        throw providerResultUnknown({
          safeMessage: "Seedream returned a non-JSON response; do not resubmit automatically.",
          transportReason: "non-json-response",
          startedAt,
          timeoutMs: options.timeoutMs,
          response,
        });
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw providerResultUnknown({
          safeMessage:
            "Seedream returned an invalid response object; do not resubmit automatically.",
          transportReason: "invalid-response",
          startedAt,
          timeoutMs: options.timeoutMs,
          response,
        });
      }
      return { response, body: parsed as SeedreamProviderResponse };
    })();
    return await Promise.race([request, deadline]);
  } catch (error) {
    if (error instanceof RunnerError && error.details) throw error;
    const transportReason = reachedClientDeadline
      ? "client-timeout"
      : error instanceof RunnerError
        ? "invalid-response"
        : classifyTransportFailure(error);
    throw providerResultUnknown({
      safeMessage:
        error instanceof RunnerError
          ? error.message
          : "Seedream request timed out or lost transport state; do not resubmit automatically.",
      transportReason,
      startedAt,
      timeoutMs: options.timeoutMs,
      response,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function nodeHttpsTransport(endpoint: string, init: RequestInit): Promise<Response> {
  const url = new URL(endpoint);
  if (url.protocol !== "https:") {
    throw new RunnerError("SECURITY_REJECTED", "Provider transport requires HTTPS.");
  }
  if (typeof init.body !== "string") {
    throw new RunnerError("CONFIG_MISSING", "Provider request body must be JSON text.");
  }
  const body = Buffer.from(init.body, "utf8");
  const requestHeaders = new Headers(init.headers);
  requestHeaders.set("Content-Length", String(body.byteLength));

  return new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: init.method ?? "POST",
        headers: Object.fromEntries(requestHeaders.entries()),
        signal: init.signal ?? undefined,
      },
      (incoming) => {
        const status = incoming.statusCode;
        if (status === undefined) {
          incoming.destroy();
          reject(new RunnerError("PROVIDER_RESULT_UNKNOWN", "Provider omitted HTTP status."));
          return;
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) headers.append(name, item);
          } else if (value !== undefined) {
            headers.set(name, value);
          }
        }
        const hasNoBody = status === 204 || status === 205 || status === 304;
        const responseBody = hasNoBody
          ? null
          : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>);
        resolve(
          new Response(responseBody, {
            status,
            statusText: incoming.statusMessage,
            headers,
          })
        );
      }
    );
    request.once("error", reject);
    request.end(body);
  });
}

export function providerTimeoutMsFromSeconds(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PROVIDER_TIMEOUT_SECONDS * 1_000;
  if (!/^\d+$/.test(value)) throw invalidProviderTimeout();
  const seconds = Number(value);
  if (
    !Number.isSafeInteger(seconds) ||
    seconds < MIN_PROVIDER_TIMEOUT_SECONDS ||
    seconds > MAX_PROVIDER_TIMEOUT_SECONDS
  ) {
    throw invalidProviderTimeout();
  }
  return seconds * 1_000;
}

export function classifyTransportFailure(error: unknown): ResultUnknownReason {
  const code = nestedErrorCode(error);
  if (["UND_ERR_SOCKET", "ECONNRESET", "EPIPE", "ECONNABORTED"].includes(code ?? "")) {
    return "remote-closed";
  }
  if (["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "ETIMEDOUT"].includes(code ?? "")) {
    return "transport-timeout";
  }
  return "network-failure";
}

function providerResultUnknown(input: {
  safeMessage: string;
  transportReason: ResultUnknownReason;
  startedAt: number;
  timeoutMs: number;
  response?: Response;
}): RunnerError {
  const providerRequestId = input.response ? safeRequestId(input.response.headers) : undefined;
  return new RunnerError("PROVIDER_RESULT_UNKNOWN", input.safeMessage, {
    transportReason: input.transportReason,
    elapsedMs: Math.max(0, Date.now() - input.startedAt),
    configuredTimeoutMs: input.timeoutMs,
    ...(input.response ? { httpStatus: input.response.status } : {}),
    ...(providerRequestId ? { providerRequestId } : {}),
  });
}

function unknownResultDiagnostic(
  error: unknown,
  fallbackTimeoutMs: number
): {
  providerRequestId?: string;
  failure: NonNullable<ProductionJournal["failure"]>;
} {
  const details = error instanceof RunnerError ? error.details : undefined;
  const transportReason = isResultUnknownReason(details?.transportReason)
    ? details.transportReason
    : "network-failure";
  const providerRequestId = safeIdentifier(details?.providerRequestId) ?? undefined;
  return {
    ...(providerRequestId ? { providerRequestId } : {}),
    failure: {
      category: "result-unknown",
      transportReason,
      elapsedMs: safeNonNegativeInteger(details?.elapsedMs) ?? 0,
      configuredTimeoutMs:
        safeNonNegativeInteger(details?.configuredTimeoutMs) ?? fallbackTimeoutMs,
      ...(safeHttpStatus(details?.httpStatus) !== undefined
        ? { httpStatus: safeHttpStatus(details?.httpStatus) }
        : {}),
    },
  };
}

function nestedErrorCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    const record = current as Record<string, unknown>;
    if (typeof record.code === "string" && /^[A-Z0-9_]{1,64}$/.test(record.code)) {
      return record.code;
    }
    current = record.cause;
  }
  return undefined;
}

function isResultUnknownReason(value: unknown): value is ResultUnknownReason {
  return RESULT_UNKNOWN_REASONS.includes(value as ResultUnknownReason);
}

function safeNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function safeHttpStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

function invalidProviderTimeout(): RunnerError {
  return new RunnerError(
    "USAGE",
    `--provider-timeout-seconds must be an integer from ${MIN_PROVIDER_TIMEOUT_SECONDS} to ${MAX_PROVIDER_TIMEOUT_SECONDS}.`
  );
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const buffer = Buffer.from(next.value);
      total += buffer.byteLength;
      if (total > maxBytes) {
        throw new RunnerError(
          "PROVIDER_RESULT_UNKNOWN",
          "Seedream response exceeded the safe response size limit."
        );
      }
      chunks.push(buffer);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function storeProviderOutput(input: {
  responseBody: SeedreamProviderResponse;
  destinationPath: string;
  maxOutputBytes: number;
}): Promise<StoredImage> {
  const item = firstOutputItem(input.responseBody.data);
  if (!item) {
    throw new RunnerError("OUTPUT_INVALID", "Seedream returned no image output.");
  }
  if (typeof item.b64_json === "string" && item.b64_json.length > 0) {
    return writeBase64ImageAtomically({
      base64: item.b64_json,
      destinationPath: input.destinationPath,
      maxBytes: input.maxOutputBytes,
    });
  }
  if (typeof item.url === "string" && item.url.length > 0) {
    return secureDownloadProviderImage(item.url, {
      destinationPath: input.destinationPath,
      maxBytes: input.maxOutputBytes,
    });
  }
  throw new RunnerError("OUTPUT_INVALID", "Seedream output omitted both URL and image data.");
}

function firstOutputItem(value: unknown): { url?: unknown; b64_json?: unknown } | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const candidate = item as { url?: unknown; b64_json?: unknown };
      if (typeof candidate.url === "string" || typeof candidate.b64_json === "string") {
        return candidate;
      }
    }
  }
  return null;
}

async function transitionJournal(
  workRoot: string,
  journal: ProductionJournal,
  update: Pick<ProductionJournal, "state"> &
    Partial<Pick<ProductionJournal, "providerRequestId" | "source" | "result" | "failure">>
): Promise<ProductionJournal> {
  const next: ProductionJournal = {
    ...journal,
    ...update,
    updatedAt: new Date().toISOString(),
  };
  await writeJournal(workRoot, next);
  return next;
}

function safeRequestId(headers: Headers): string | undefined {
  return (
    safeIdentifier(headers.get("x-request-id")) ??
    safeIdentifier(headers.get("request-id")) ??
    undefined
  );
}

function safeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(trimmed) ? trimmed : null;
}

function safeProviderCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return safeIdentifier((value as { code?: unknown }).code) ?? undefined;
}

export function safeProviderMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [token]")
    .replace(/[A-Za-z0-9_~+./=-]{32,}/g, "[token]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  return sanitized || undefined;
}

function errorMessage(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return (value as { message?: unknown }).message;
}
