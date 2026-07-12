#!/usr/bin/env -S npx tsx

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseJinlingShotProductionPack } from "../../src/features/jinling-rumeng/production/shot-production-contract";
import { DEFAULT_WORK_ROOT, WEB_ROOT } from "./paths";

const execFileAsync = promisify(execFile);
const PACK_PATH = path.join(
  WEB_ROOT,
  "src/features/jinling-rumeng/production/manifests/s01-p00-sc01-production-v1.json"
);

type Sentence = { start_time: number; end_time: number; text: string };

const sessions = [
  {
    sessionId: "voice-ledger-session-v1",
    assignments: [
      { taskId: "S01-P00-B01-VO-01-AUDIO-V1", sentenceIndexes: [0] },
      { taskId: "S01-P00-B01-VO-02-AUDIO-V1", sentenceIndexes: [1] },
      { taskId: "S01-P00-B02-VO-01-AUDIO-V1", sentenceIndexes: [2] },
      { taskId: "S01-P00-B03-VO-01-AUDIO-V1", sentenceIndexes: [3] },
      { taskId: "S01-SC01-C01B-VO-01-AUDIO-V1", sentenceIndexes: [4] },
    ],
  },
  {
    sessionId: "voice-driver-session-v1",
    assignments: [
      { taskId: "S01-SC01-B01-VO-01-AUDIO-V1", sentenceIndexes: [0, 1] },
      { taskId: "S01-SC01-C01A-VO-01-AUDIO-V1", sentenceIndexes: [2] },
    ],
  },
] as const;

async function main(): Promise<void> {
  const pack = parseJinlingShotProductionPack(JSON.parse(await readFile(PACK_PATH, "utf8")));
  const taskMap = new Map(pack.audioTasks.map((task) => [task.taskId, task]));
  const reviewRoot = path.join(DEFAULT_WORK_ROOT, "seedaudio-session-review");
  const results: Array<Record<string, unknown>> = [];

  for (const session of sessions) {
    const sessionRoot = path.join(DEFAULT_WORK_ROOT, "seedaudio-sessions", session.sessionId);
    const sourcePath = path.join(sessionRoot, "source.wav");
    const sourceBytes = await readFile(sourcePath);
    const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
    const subtitle = JSON.parse(
      await readFile(path.join(sessionRoot, "subtitles.json"), "utf8")
    ) as {
      sentences?: Sentence[];
    };
    const sentences = subtitle.sentences;
    if (!sentences) throw new Error(`${session.sessionId} has no subtitle sentences`);

    for (const assignment of session.assignments) {
      const task = taskMap.get(assignment.taskId);
      if (!task) throw new Error(`Unknown audio task ${assignment.taskId}`);
      const selected = assignment.sentenceIndexes.map((index) => sentences[index]);
      if (selected.some((sentence) => !sentence)) {
        throw new Error(`${assignment.taskId} has a missing session sentence`);
      }
      const actualText = selected.map((sentence) => sentence.text).join("");
      if (normalize(actualText) !== normalize(task.text)) {
        throw new Error(`${assignment.taskId} does not exactly match the locked dialogue`);
      }
      const startSeconds = Math.max(0, selected[0].start_time / 1_000 - 0.12);
      const endSeconds = selected[selected.length - 1].end_time / 1_000 + 0.25;
      const descriptor = {
        sessionId: session.sessionId,
        sourceSha256,
        taskId: assignment.taskId,
        text: task.text,
        startSeconds,
        endSeconds,
        delivery: task.delivery,
      };
      const fingerprint = createHash("sha256").update(JSON.stringify(descriptor)).digest("hex");
      const taskRoot = path.join(reviewRoot, assignment.taskId);
      await mkdir(taskRoot, { recursive: true });
      const masterPath = path.join(taskRoot, `${fingerprint}-master.wav`);
      await execFileAsync("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-ss",
        startSeconds.toFixed(3),
        "-i",
        sourcePath,
        "-t",
        (endSeconds - startSeconds).toFixed(3),
        "-map_metadata",
        "-1",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-c:a",
        "pcm_s24le",
        masterPath,
      ]);
      const masterBytes = await readFile(masterPath);
      const result = {
        ...descriptor,
        fingerprint,
        status: "REVIEW",
        masterPath,
        masterSha256: createHash("sha256").update(masterBytes).digest("hex"),
      };
      await writeFile(
        path.join(taskRoot, `${fingerprint}-record.json`),
        `${JSON.stringify(result, null, 2)}\n`
      );
      results.push(result);
    }
  }

  process.stdout.write(`${JSON.stringify({ ok: true, results }, null, 2)}\n`);
}

function normalize(value: string): string {
  return value.replace(/[\s，。！？；：、“”‘’—…,.!?;:'"-]/g, "");
}

void main();
