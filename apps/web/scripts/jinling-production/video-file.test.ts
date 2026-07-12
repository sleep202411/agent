import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { verifyVideoMaster } from "./video-file";

const execFileAsync = promisify(execFile);

test("fully decodes and verifies an exact silent H.264 master", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jinling-video-contract-"));
  const videoPath = path.join(directory, "fixture.mp4");
  try {
    await execFileAsync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=320x180:r=24:d=1",
      "-frames:v",
      "24",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-an",
      "-movflags",
      "+faststart",
      videoPath,
    ]);
    const verified = await verifyVideoMaster(videoPath, {
      width: 320,
      height: 180,
      codec: "h264",
      framesPerSecond: { numerator: 24, denominator: 1 },
      frameCount: 24,
      durationSeconds: 1,
      audio: false,
    });
    assert.deepEqual(
      {
        width: verified.width,
        height: verified.height,
        codec: verified.codec,
        framesPerSecond: verified.framesPerSecond,
        frameCount: verified.frameCount,
        audioStreamCount: verified.audioStreamCount,
      },
      {
        width: 320,
        height: 180,
        codec: "h264",
        framesPerSecond: 24,
        frameCount: 24,
        audioStreamCount: 0,
      }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
