import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  parseJinlingShotProductionPack,
  type JinlingShotProductionPack,
} from "../../src/features/jinling-rumeng/production/shot-production-contract";
import type { SeedAudioProviderConfig } from "./environment";
import { RunnerError } from "./errors";
import { canonicalJson } from "./fingerprint";

const execFileAsync = promisify(execFile);
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export type SeedAudioTask = JinlingShotProductionPack["audioTasks"][number];

type SeedAudioResponse = {
  audio?: string;
  duration?: number;
  original_duration?: number;
  subtitle?: {
    text?: string;
    sentences?: Array<{
      start_time?: number;
      end_time?: number;
      text?: string;
      words?: Array<{ start_time?: number; end_time?: number; text?: string }>;
    }>;
  };
};

type SeedAudioJournal = {
  journalVersion: 1;
  strategy: "seedaudio-production";
  taskId: string;
  fingerprint: string;
  state: "SUBMITTING" | "REVIEW" | "UNKNOWN";
  startedAt: string;
  updatedAt: string;
  result?: SeedAudioProductionResult;
};

export type SeedAudioProductionResult = {
  taskId: string;
  fingerprint: string;
  status: "REVIEW";
  sourcePath: string;
  masterPath: string;
  subtitlePath: string;
  sourceSha256: string;
  masterSha256: string;
  durationSeconds: number;
  sampleRateHz: 48000;
  bitDepth: 24;
  channels: 1;
  alreadyStaged: boolean;
};

export async function loadSeedAudioProductionPack(
  packPath: string
): Promise<JinlingShotProductionPack> {
  let source: string;
  try {
    source = await readFile(packPath, "utf8");
  } catch {
    throw new RunnerError("MANIFEST_MISSING", "Unable to read the Seed Audio production pack.");
  }
  try {
    return parseJinlingShotProductionPack(JSON.parse(source));
  } catch {
    throw new RunnerError("MANIFEST_INVALID", "The Seed Audio production pack is invalid.");
  }
}

export function selectSeedAudioTask(
  pack: JinlingShotProductionPack,
  taskId: string
): SeedAudioTask {
  const task = pack.audioTasks.find((candidate) => candidate.taskId === taskId);
  if (!task) throw new RunnerError("ASSET_INVALID", `Unknown Seed Audio task ${taskId}.`);
  return task;
}

export function buildSeedAudioDescriptor(
  task: SeedAudioTask,
  referenceSha256?: string
): { fingerprint: string; request: Record<string, unknown> } {
  const isDriver = task.speakerId === "VOICE-DRIVER";
  const isGateStaff = task.speakerId === "CHAR-GATE" || task.speakerId === "CHAR-MESSENGER";
  const request = {
    model: "seed-audio-1.0",
    text_prompt: composeVoicePrompt(task, Boolean(referenceSha256)),
    ...(referenceSha256 ? { reference_sha256: referenceSha256 } : {}),
    audio_config: {
      format: "wav",
      sample_rate: 48000,
      pitch_rate: isDriver ? -1 : 0,
      speech_rate: isDriver ? -4 : isGateStaff ? 6 : -8,
      loudness_rate: 0,
      enable_subtitle: true,
    },
    watermark: {},
  };
  return {
    fingerprint: createHash("sha256").update(canonicalJson({ task, request })).digest("hex"),
    request,
  };
}

export async function inspectReferenceAudio(referencePath: string): Promise<{
  audioData: string;
  sha256: string;
}> {
  const bytes = await readFile(referencePath).catch(() => {
    throw new RunnerError("ASSET_INVALID", "Unable to read the Seed Audio voice reference.");
  });
  if (bytes.length === 0 || bytes.length > MAX_REFERENCE_BYTES) {
    throw new RunnerError("ASSET_INVALID", "Seed Audio voice reference must be 1 byte to 10 MiB.");
  }
  if (!isWav(bytes)) {
    throw new RunnerError(
      "ASSET_INVALID",
      "The production runner currently accepts WAV references only."
    );
  }
  return {
    audioData: bytes.toString("base64"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function runSeedAudioProduction(input: {
  task: SeedAudioTask;
  confirmedFingerprint: string;
  provider: SeedAudioProviderConfig;
  workRoot: string;
  reference?: { audioData: string; sha256: string };
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<SeedAudioProductionResult> {
  const descriptor = buildSeedAudioDescriptor(input.task, input.reference?.sha256);
  if (descriptor.fingerprint !== input.confirmedFingerprint) {
    throw new RunnerError("JOURNAL_CONFLICT", "Fingerprint confirmation is stale; run plan again.");
  }
  const reviewDir = path.join(input.workRoot, "seedaudio-review", input.task.taskId);
  const journalPath = path.join(
    input.workRoot,
    "seedaudio-journal",
    `${descriptor.fingerprint}.json`
  );
  const existing = await readJournal(journalPath);
  if (existing?.state === "REVIEW" && existing.result) {
    const repaired = await normalizeStagedResult(input.task, existing.result);
    if (repaired !== existing.result) {
      await writeJournal(journalPath, {
        ...existing,
        result: repaired,
        updatedAt: new Date().toISOString(),
      });
    }
    return { ...repaired, alreadyStaged: true };
  }
  if (existing) {
    throw new RunnerError(
      "PROVIDER_RESULT_UNKNOWN",
      "A prior Seed Audio request stopped during submission; refusing a duplicate billed request."
    );
  }

  const now = new Date().toISOString();
  const journal: SeedAudioJournal = {
    journalVersion: 1,
    strategy: "seedaudio-production",
    taskId: input.task.taskId,
    fingerprint: descriptor.fingerprint,
    state: "SUBMITTING",
    startedAt: now,
    updatedAt: now,
  };
  await claimJournal(journalPath, journal);

  try {
    const requestBody = {
      ...descriptor.request,
      ...(input.reference ? { references: [{ audio_data: input.reference.audioData }] } : {}),
    };
    delete (requestBody as { reference_sha256?: string }).reference_sha256;
    const response = await (input.fetchImpl ?? fetch)(
      `${input.provider.apiBaseUrl}/api/v3/tts/create`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": input.provider.apiKey,
          "X-Api-Request-Id": randomUUID(),
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(input.timeoutMs ?? 120_000),
      }
    );
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_RESPONSE_BYTES) {
      throw new RunnerError("OUTPUT_INVALID", "Seed Audio response exceeds the safe size limit.");
    }
    const responseText = await response.text();
    if (Buffer.byteLength(responseText) > MAX_RESPONSE_BYTES) {
      throw new RunnerError("OUTPUT_INVALID", "Seed Audio response exceeds the safe size limit.");
    }
    if (!response.ok) {
      throw new RunnerError("PROVIDER_REJECTED", `Seed Audio returned HTTP ${response.status}.`);
    }
    const providerResult = parseProviderResponse(responseText);
    const sourceBytes = Buffer.from(providerResult.audio, "base64");
    if (!isWav(sourceBytes)) {
      throw new RunnerError("OUTPUT_INVALID", "Seed Audio returned an invalid WAV payload.");
    }
    await mkdir(reviewDir, { recursive: true });
    const sourcePath = path.join(reviewDir, `${descriptor.fingerprint}-source.wav`);
    const masterPath = path.join(reviewDir, `${descriptor.fingerprint}-master.wav`);
    const subtitlePath = path.join(reviewDir, `${descriptor.fingerprint}-subtitles.json`);
    const targetSubtitle = extractTargetSubtitle(providerResult.subtitle, input.task.text);
    await atomicWrite(sourcePath, sourceBytes);
    await transcodeMaster(sourcePath, masterPath, targetSubtitle.clipEndSeconds);
    const inspected = await verifyMaster(masterPath);
    await atomicWrite(
      subtitlePath,
      Buffer.from(`${JSON.stringify(targetSubtitle.subtitle, null, 2)}\n`)
    );
    const masterBytes = await readFile(masterPath);
    const result: SeedAudioProductionResult = {
      taskId: input.task.taskId,
      fingerprint: descriptor.fingerprint,
      status: "REVIEW",
      sourcePath,
      masterPath,
      subtitlePath,
      sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
      masterSha256: createHash("sha256").update(masterBytes).digest("hex"),
      durationSeconds: inspected.durationSeconds,
      sampleRateHz: 48000,
      bitDepth: 24,
      channels: 1,
      alreadyStaged: false,
    };
    await writeJournal(journalPath, {
      ...journal,
      state: "REVIEW",
      result,
      updatedAt: new Date().toISOString(),
    });
    return result;
  } catch (error) {
    await writeJournal(journalPath, {
      ...journal,
      state: "UNKNOWN",
      updatedAt: new Date().toISOString(),
    });
    if (error instanceof RunnerError) throw error;
    throw new RunnerError(
      "PROVIDER_RESULT_UNKNOWN",
      "Seed Audio request result is unknown; no automatic retry was attempted."
    );
  }
}

function composeVoicePrompt(task: SeedAudioTask, usesReference: boolean): string {
  const identity =
    task.speakerId === "VOICE-DRIVER"
      ? "an older Mandarin Chinese male carriage driver; plain, steady, weathered and natural; never a theatrical narrator"
      : "a Mandarin Chinese female voice whose age is difficult to identify; calm, distant, restrained and natural; never horror, whisper-ASMR or sweet idol acting";
  const referenceInstruction = usesReference
    ? "Use @Audio1 only as the exact speaker identity and vocal-timbre reference. "
    : "";
  return `${referenceInstruction}Generate one clean isolated voice line with no music, ambience, sound effects or second voice. The speaker is ${identity}. Performance direction: ${task.performance} Speak exactly these Chinese words and nothing else: “${task.text}”`;
}

function parseProviderResponse(
  source: string
): Required<Pick<SeedAudioResponse, "audio">> & SeedAudioResponse {
  let parsed: SeedAudioResponse;
  try {
    parsed = JSON.parse(source) as SeedAudioResponse;
  } catch {
    throw new RunnerError("OUTPUT_INVALID", "Seed Audio returned invalid JSON.");
  }
  if (typeof parsed.audio !== "string" || parsed.audio.length === 0) {
    throw new RunnerError("OUTPUT_INVALID", "Seed Audio response is missing the audio payload.");
  }
  return parsed as Required<Pick<SeedAudioResponse, "audio">> & SeedAudioResponse;
}

function extractTargetSubtitle(
  subtitle: SeedAudioResponse["subtitle"],
  expectedText: string
): {
  subtitle: NonNullable<SeedAudioResponse["subtitle"]>;
  clipEndSeconds: number;
} {
  const sentences = subtitle?.sentences;
  if (!Array.isArray(sentences) || sentences.length === 0) {
    throw new RunnerError("OUTPUT_INVALID", "Seed Audio response has no subtitle timing data.");
  }
  const normalizedExpected = normalizeSpokenText(expectedText);
  let accumulated = "";
  const selected: NonNullable<SeedAudioResponse["subtitle"]>["sentences"] = [];
  for (const sentence of sentences) {
    accumulated += normalizeSpokenText(sentence.text ?? "");
    selected.push(sentence);
    if (accumulated === normalizedExpected) {
      const endTime = sentence.end_time;
      if (!Number.isFinite(endTime) || Number(endTime) <= 0) {
        throw new RunnerError(
          "OUTPUT_INVALID",
          "Seed Audio target subtitle has no valid end time."
        );
      }
      const nextStart = sentences[selected.length]?.start_time;
      const paddedEndMs = Number(endTime) + 80;
      const clipEndMs = Number.isFinite(nextStart)
        ? Math.min(paddedEndMs, Number(nextStart) - 30)
        : paddedEndMs;
      return {
        subtitle: { text: expectedText, sentences: selected },
        clipEndSeconds: clipEndMs / 1_000,
      };
    }
    if (!normalizedExpected.startsWith(accumulated)) break;
  }
  throw new RunnerError(
    "OUTPUT_INVALID",
    "Seed Audio did not reproduce the locked dialogue exactly before its reference segment."
  );
}

function normalizeSpokenText(value: string): string {
  return value.replace(/[\s，。！？；：、“”‘’—…,.!?;:'"-]/g, "");
}

async function normalizeStagedResult(
  task: SeedAudioTask,
  result: SeedAudioProductionResult
): Promise<SeedAudioProductionResult> {
  let subtitle: SeedAudioResponse["subtitle"];
  try {
    subtitle = JSON.parse(
      await readFile(result.subtitlePath, "utf8")
    ) as SeedAudioResponse["subtitle"];
  } catch {
    throw new RunnerError("OUTPUT_INVALID", "Unable to read staged Seed Audio subtitles.");
  }
  const targetSubtitle = extractTargetSubtitle(subtitle, task.text);
  if (subtitle?.text === task.text) {
    await verifyMaster(result.masterPath);
    return result;
  }
  await transcodeMaster(result.sourcePath, result.masterPath, targetSubtitle.clipEndSeconds);
  await atomicWrite(
    result.subtitlePath,
    Buffer.from(`${JSON.stringify(targetSubtitle.subtitle, null, 2)}\n`)
  );
  const inspected = await verifyMaster(result.masterPath);
  const masterBytes = await readFile(result.masterPath);
  return {
    ...result,
    masterSha256: createHash("sha256").update(masterBytes).digest("hex"),
    durationSeconds: inspected.durationSeconds,
    alreadyStaged: true,
  };
}

async function transcodeMaster(
  sourcePath: string,
  masterPath: string,
  clipEndSeconds: number
): Promise<void> {
  const tempPath = `${masterPath}.tmp.wav`;
  await rm(tempPath, { force: true });
  try {
    await execFileAsync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      sourcePath,
      "-t",
      clipEndSeconds.toFixed(3),
      "-map_metadata",
      "-1",
      "-ac",
      "1",
      "-ar",
      "48000",
      "-c:a",
      "pcm_s24le",
      tempPath,
    ]);
    await rename(tempPath, masterPath);
  } catch {
    await rm(tempPath, { force: true });
    throw new RunnerError("OUTPUT_INVALID", "Unable to derive the 24-bit mono Seed Audio master.");
  }
}

async function verifyMaster(masterPath: string): Promise<{ durationSeconds: number }> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_name,sample_rate,channels,duration",
      "-of",
      "json",
      masterPath,
    ]));
  } catch {
    throw new RunnerError("OUTPUT_INVALID", "Unable to inspect the Seed Audio master.");
  }
  const stream = (
    JSON.parse(stdout) as {
      streams?: Array<{
        codec_name?: string;
        sample_rate?: string;
        channels?: number;
        duration?: string;
      }>;
    }
  ).streams?.[0];
  const durationSeconds = Number(stream?.duration);
  if (
    stream?.codec_name !== "pcm_s24le" ||
    stream.sample_rate !== "48000" ||
    stream.channels !== 1 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    throw new RunnerError(
      "OUTPUT_INVALID",
      "Seed Audio master does not satisfy 48 kHz/24-bit/mono."
    );
  }
  return { durationSeconds };
}

function isWav(bytes: Buffer): boolean {
  return (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WAVE"
  );
}

async function readJournal(journalPath: string): Promise<SeedAudioJournal | null> {
  try {
    return JSON.parse(await readFile(journalPath, "utf8")) as SeedAudioJournal;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw new RunnerError("JOURNAL_CONFLICT", "Unable to read the Seed Audio journal.");
  }
}

async function claimJournal(journalPath: string, journal: SeedAudioJournal): Promise<void> {
  await mkdir(path.dirname(journalPath), { recursive: true });
  const handle = await open(journalPath, "wx").catch(() => {
    throw new RunnerError("JOURNAL_CONFLICT", "Seed Audio journal already exists.");
  });
  try {
    await handle.writeFile(`${JSON.stringify(journal, null, 2)}\n`);
  } finally {
    await handle.close();
  }
}

async function writeJournal(journalPath: string, journal: SeedAudioJournal): Promise<void> {
  await atomicWrite(journalPath, Buffer.from(`${JSON.stringify(journal, null, 2)}\n`));
}

async function atomicWrite(destination: string, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  const tempPath = `${destination}.${randomUUID()}.tmp`;
  await writeFile(tempPath, bytes, { flag: "wx", mode: 0o600 });
  await rename(tempPath, destination);
}

export const __test = {
  parseProviderResponse,
  composeVoicePrompt,
  extractTargetSubtitle,
  isWav,
};
