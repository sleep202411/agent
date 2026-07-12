import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { RunnerError } from "./errors";

export const JOURNAL_VERSION = 1 as const;

export const RESULT_UNKNOWN_REASONS = [
  "client-timeout",
  "remote-closed",
  "transport-timeout",
  "network-failure",
  "non-json-response",
  "invalid-response",
] as const;
export type ResultUnknownReason = (typeof RESULT_UNKNOWN_REASONS)[number];

export type JournalState =
  | "SUBMITTING"
  | "PROVIDER_ACCEPTED"
  | "SOURCE_STAGED"
  | "REVIEW"
  | "FAILED"
  | "UNKNOWN";

export interface JournalSourceArtifact {
  stagedPath: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  format: "png" | "jpg" | "webp";
  width: number;
  height: number;
  codec: string;
  pixelFormat: string | null;
}

export interface ProductionJournal {
  journalVersion: typeof JOURNAL_VERSION;
  assetId: string;
  fingerprint: string;
  provider: "byteplus-modelark";
  strategy: "seedream-reference-trial";
  model: string;
  endpointId: string;
  manifest: {
    schemaVersion: number;
    manifestId: string;
    manifestSha256: string;
    contentVersion: string;
    promptVersion: string;
  };
  state: JournalState;
  startedAt: string;
  updatedAt: string;
  providerRequestId?: string;
  source?: JournalSourceArtifact;
  result?: {
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
    sourceCodec: string;
    sourcePixelFormat: string | null;
    derivedWidth: number;
    derivedHeight: number;
    derivedCodec: string;
    derivedPixelFormat: string | null;
  };
  failure?: {
    category: "provider-rejected" | "result-unknown" | "download" | "verification";
    httpStatus?: number;
    providerCode?: string;
    transportReason?: ResultUnknownReason;
    elapsedMs?: number;
    configuredTimeoutMs?: number;
  };
}

export function journalPath(workRoot: string, fingerprint: string): string {
  assertFingerprint(fingerprint);
  return path.join(workRoot, "journal", `${fingerprint}.json`);
}

export async function readJournal(
  workRoot: string,
  fingerprint: string
): Promise<ProductionJournal | null> {
  const filePath = journalPath(workRoot, fingerprint);
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isProductionJournal(parsed, fingerprint)) {
      throw new RunnerError("JOURNAL_CONFLICT", "Existing production journal is invalid.");
    }
    return parsed;
  } catch (error) {
    if (isMissingFile(error)) return null;
    if (error instanceof RunnerError) throw error;
    throw new RunnerError("JOURNAL_CONFLICT", "Unable to read existing production journal.");
  }
}

export async function writeJournal(workRoot: string, journal: ProductionJournal): Promise<void> {
  assertWritableJournal(journal);
  const filePath = journalPath(workRoot, journal.fingerprint);
  const partPath = `${filePath}.${process.pid}.${randomUUID()}.part`;
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await writeFile(partPath, `${JSON.stringify(journal, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(partPath, filePath);
  } catch (error) {
    await rm(partPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Atomically owns a fingerprint before any billable provider request starts. */
export async function claimJournal(workRoot: string, journal: ProductionJournal): Promise<void> {
  assertWritableJournal(journal);
  const filePath = journalPath(workRoot, journal.fingerprint);
  await mkdir(path.dirname(filePath), { recursive: true });
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(filePath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(journal, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (isAlreadyExists(error)) {
      throw new RunnerError(
        "JOURNAL_CONFLICT",
        "Another runner already owns this production fingerprint."
      );
    }
    await rm(filePath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function newJournal(input: {
  assetId: string;
  fingerprint: string;
  model: string;
  endpointId: string;
  manifest: ProductionJournal["manifest"];
  now?: string;
}): ProductionJournal {
  const now = input.now ?? new Date().toISOString();
  return {
    journalVersion: JOURNAL_VERSION,
    assetId: input.assetId,
    fingerprint: input.fingerprint,
    provider: "byteplus-modelark",
    strategy: "seedream-reference-trial",
    model: input.model,
    endpointId: input.endpointId,
    manifest: input.manifest,
    state: "SUBMITTING",
    startedAt: now,
    updatedAt: now,
  };
}

function isProductionJournal(value: unknown, fingerprint: string): value is ProductionJournal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.journalVersion === JOURNAL_VERSION &&
    typeof record.assetId === "string" &&
    record.fingerprint === fingerprint &&
    record.provider === "byteplus-modelark" &&
    record.strategy === "seedream-reference-trial" &&
    typeof record.model === "string" &&
    typeof record.endpointId === "string" &&
    isManifestProvenance(record.manifest) &&
    isJournalState(record.state) &&
    typeof record.startedAt === "string" &&
    typeof record.updatedAt === "string" &&
    (record.providerRequestId === undefined || isSafeIdentifier(record.providerRequestId)) &&
    (record.source === undefined || isSourceArtifact(record.source)) &&
    (record.result === undefined || isReviewResult(record.result)) &&
    (record.failure === undefined || isJournalFailure(record.failure)) &&
    (record.state === "REVIEW" ? isReviewResult(record.result) : record.result === undefined)
  );
}

function isJournalState(value: unknown): value is JournalState {
  return [
    "SUBMITTING",
    "PROVIDER_ACCEPTED",
    "SOURCE_STAGED",
    "REVIEW",
    "FAILED",
    "UNKNOWN",
  ].includes(String(value));
}

function isSourceArtifact(value: unknown): value is JournalSourceArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.stagedPath === "string" &&
    typeof record.sha256 === "string" &&
    typeof record.bytes === "number" &&
    typeof record.mimeType === "string" &&
    ["png", "jpg", "webp"].includes(String(record.format)) &&
    typeof record.width === "number" &&
    typeof record.height === "number" &&
    typeof record.codec === "string" &&
    (typeof record.pixelFormat === "string" || record.pixelFormat === null)
  );
}

function isReviewResult(value: unknown): value is NonNullable<ProductionJournal["result"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.status === "REVIEW" &&
    typeof record.sourcePath === "string" &&
    typeof record.sourceSha256 === "string" &&
    typeof record.sourceBytes === "number" &&
    typeof record.sourceMimeType === "string" &&
    ["png", "jpg", "webp"].includes(String(record.sourceFormat)) &&
    typeof record.derivedPath === "string" &&
    typeof record.derivedSha256 === "string" &&
    typeof record.derivedBytes === "number" &&
    record.derivedMimeType === "image/png" &&
    record.derivationPurpose === "review-only" &&
    record.derivationMethod === "lanczos3" &&
    typeof record.sourceWidth === "number" &&
    typeof record.sourceHeight === "number" &&
    typeof record.sourceCodec === "string" &&
    (typeof record.sourcePixelFormat === "string" || record.sourcePixelFormat === null) &&
    typeof record.derivedWidth === "number" &&
    typeof record.derivedHeight === "number" &&
    typeof record.derivedCodec === "string" &&
    (typeof record.derivedPixelFormat === "string" || record.derivedPixelFormat === null)
  );
}

function isJournalFailure(value: unknown): value is NonNullable<ProductionJournal["failure"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    ["provider-rejected", "result-unknown", "download", "verification"].includes(
      String(record.category)
    ) &&
    (record.httpStatus === undefined || isNonNegativeInteger(record.httpStatus)) &&
    (record.providerCode === undefined || isSafeIdentifier(record.providerCode)) &&
    (record.transportReason === undefined ||
      RESULT_UNKNOWN_REASONS.includes(record.transportReason as ResultUnknownReason)) &&
    (record.elapsedMs === undefined || isNonNegativeInteger(record.elapsedMs)) &&
    (record.configuredTimeoutMs === undefined || isNonNegativeInteger(record.configuredTimeoutMs))
  );
}

function isManifestProvenance(value: unknown): value is ProductionJournal["manifest"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.schemaVersion === "number" &&
    typeof record.manifestId === "string" &&
    typeof record.manifestSha256 === "string" &&
    typeof record.contentVersion === "string" &&
    typeof record.promptVersion === "string"
  );
}

function assertFingerprint(fingerprint: string): void {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new RunnerError("JOURNAL_CONFLICT", "Production fingerprint is invalid.");
  }
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function assertWritableJournal(journal: ProductionJournal): void {
  assertFingerprint(journal.fingerprint);
  if (!isProductionJournal(journal, journal.fingerprint)) {
    throw new RunnerError(
      "JOURNAL_CONFLICT",
      "Runner journal is invalid; results may only use the target REVIEW contract."
    );
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
