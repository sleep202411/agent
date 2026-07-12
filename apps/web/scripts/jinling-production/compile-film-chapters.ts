#!/usr/bin/env -S npx tsx

import { spawn } from "node:child_process";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { JINLING_STORY_CHAPTERS } from "../../src/features/jinling-rumeng/content/fast-story";
import { JINLING_FILM_EDIT_BRIDGES_V3 } from "../../src/features/jinling-rumeng/production/s01-film-cut-v2";
import { WEB_ROOT } from "./paths";

const FILM_ROOT = path.join(WEB_ROOT, "public/jinling-rumeng/production/story/film-cut-v2");
const OUTPUT_ROOT = path.join(FILM_ROOT, "chapters");
const FRAME_TRANSITION_SECONDS = 1 / 24;
const EDIT_BRIDGE_SECONDS = 0.24;

async function main(): Promise<void> {
  const requested = parseChapter(process.argv.slice(2));
  const chapters = requested
    ? JINLING_STORY_CHAPTERS.filter((chapter) => chapter.chapterId === requested)
    : JINLING_STORY_CHAPTERS;
  await mkdir(OUTPUT_ROOT, { recursive: true });

  for (const chapter of chapters) {
    const inputs = chapter.clips.map((clip) => path.join(FILM_ROOT, `${clip.clipId}.mp4`));
    for (const input of inputs) await requireFile(input);
    const destination = path.join(OUTPUT_ROOT, `${chapter.chapterId}.mp4`);
    await compileChapter({
      chapterId: chapter.chapterId,
      clipIds: chapter.clips.map((clip) => clip.clipId),
      inputs,
      destination,
    });
    process.stdout.write(
      `${JSON.stringify({ event: "chapter-compiled", chapterId: chapter.chapterId, destination })}\n`
    );
  }
}

async function compileChapter(input: {
  chapterId: string;
  clipIds: readonly string[];
  inputs: readonly string[];
  destination: string;
}): Promise<void> {
  const part = `${input.destination}.${process.pid}.part.mp4`;
  await rm(part, { force: true });
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  input.inputs.forEach((file) => args.push("-i", file));

  const filters: string[] = [];
  input.inputs.forEach((_, index) => {
    filters.push(`[${index}:v]settb=AVTB,setpts=PTS-STARTPTS[v${index}]`);
    filters.push(`[${index}:a]aresample=48000,asetpts=PTS-STARTPTS[a${index}]`);
  });

  let video = "v0";
  let audio = "a0";
  let timelineSeconds = 15;
  for (let index = 1; index < input.inputs.length; index += 1) {
    const shotId = input.clipIds[index]!.toUpperCase();
    const bridge = JINLING_FILM_EDIT_BRIDGES_V3[shotId];
    const duration = bridge ? EDIT_BRIDGE_SECONDS : FRAME_TRANSITION_SECONDS;
    const nextVideo = `vx${index}`;
    const nextAudio = `ax${index}`;
    filters.push(
      `[${video}][v${index}]xfade=transition=fade:duration=${duration.toFixed(6)}:offset=${(
        timelineSeconds - duration
      ).toFixed(6)}[${nextVideo}]`
    );
    filters.push(
      `[${audio}][a${index}]acrossfade=d=${duration.toFixed(6)}:c1=tri:c2=tri[${nextAudio}]`
    );
    timelineSeconds += 15 - duration;
    video = nextVideo;
    audio = nextAudio;
  }

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    `[${video}]`,
    "-map",
    `[${audio}]`,
    "-r",
    "24",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    part
  );
  await run("ffmpeg", args);
  await verifyMaster(part);
  await rename(part, input.destination);
}

async function verifyMaster(filePath: string): Promise<void> {
  const output = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,avg_frame_rate",
    "-of",
    "json",
    filePath,
  ]);
  const parsed = JSON.parse(output) as {
    streams?: Array<{ width?: number; height?: number; avg_frame_rate?: string }>;
  };
  const stream = parsed.streams?.[0];
  if (stream?.width !== 1280 || stream.height !== 720 || stream.avg_frame_rate !== "24/1") {
    throw new Error(`Compiled chapter master failed delivery verification: ${filePath}`);
  }
}

async function run(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

async function requireFile(filePath: string): Promise<void> {
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) throw new Error(`Required chapter clip is missing: ${filePath}`);
}

function parseChapter(args: string[]): string | null {
  const index = args.indexOf("--chapter");
  if (index === -1) return null;
  const value = args[index + 1];
  if (!JINLING_STORY_CHAPTERS.some((chapter) => chapter.chapterId === value)) {
    throw new Error("--chapter must be one of c1, c2, c3, c4");
  }
  return value!;
}

void main();
