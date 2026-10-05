import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';

const Probe = z.object({
  streams: z
    .array(
      z.object({
        codec_type: z.string(),
        width: z.number().optional(),
        height: z.number().optional(),
        duration: z.string().optional(),
        start_time: z.string().optional(),
      }),
    )
    .max(32),
  format: z.object({ duration: z.string(), format_name: z.string() }),
});
const Options = z.strictObject({
  directory: z.string().min(1),
  filenames: z
    .array(z.string().regex(/^input-\d+\.(mp4|webm)$/))
    .min(1)
    .max(100),
  width: z
    .number()
    .int()
    .min(64)
    .max(1920)
    .refine((n) => n % 2 === 0),
  height: z
    .number()
    .int()
    .min(64)
    .max(1920)
    .refine((n) => n % 2 === 0),
});
const FPS = 30;
const MAX_OUTPUT_BYTES = 512 * 1024 * 1024;
/** Local-only renderer. The caller must authorize, pin and spool source assets
 * into its private directory first; this module never accepts network URLs. */
export async function renderLocalStoryboard(
  raw: z.input<typeof Options>,
  signal: AbortSignal,
) {
  const input = Options.parse(raw);
  signal.throwIfAborted();
  const directory = await realpath(input.directory);
  const sources: {
    path: string;
    frames: number;
    audio: boolean;
    videoStart: number;
  }[] = [];
  let totalBytes = 0,
    totalFrames = 0;
  const deadline = AbortSignal.any([
    signal,
    AbortSignal.timeout(10 * 60 * 1000),
  ]);
  for (const filename of input.filenames) {
    deadline.throwIfAborted();
    const path = join(directory, filename);
    if ((await realpath(path)) !== path)
      throw new Error('Storyboard input must be an owned local file.');
    const info = await stat(path);
    totalBytes += info.size;
    if (
      !info.isFile() ||
      !info.size ||
      info.size > 512 * 1024 * 1024 ||
      totalBytes > 2 * 1024 * 1024 * 1024
    )
      throw new Error('Storyboard input exceeds the render size limit.');
    const probe = await inspect(path, deadline);
    const videos = probe.streams.filter((s) => s.codec_type === 'video');
    const video = videos[0];
    const duration = Number(video?.duration ?? probe.format.duration);
    if (
      videos.length !== 1 ||
      !video.width ||
      !video.height ||
      video.width * video.height > 3840 * 2160 ||
      !Number.isFinite(Number(video.start_time ?? '0')) ||
      !Number.isFinite(duration) ||
      duration <= 0
    )
      throw new Error(
        'Storyboard input must contain one supported video stream.',
      );
    const frames = Math.max(1, Math.round(duration * FPS));
    totalFrames += frames;
    if (totalFrames > 600 * FPS)
      throw new Error('Storyboard export exceeds the ten-minute render limit.');
    sources.push({
      path,
      frames,
      audio: probe.streams.some((s) => s.codec_type === 'audio'),
      videoStart: Number(video.start_time ?? '0'),
    });
  }
  const outputDirectory = await mkdtemp(
    join(tmpdir(), 'fizz-storyboard-render-'),
  );
  const path = join(outputDirectory, 'storyboard.mp4');
  const dispose = () => rm(outputDirectory, { recursive: true, force: true });
  try {
    const args = [
      '-nostdin',
      '-copyts',
      '-v',
      'error',
      '-y',
      '-filter_complex_threads',
      '1',
    ];
    for (const source of sources)
      args.push(
        '-threads',
        '1',
        '-protocol_whitelist',
        'file',
        '-format_whitelist',
        'mov,matroska',
        '-i',
        source.path,
      );
    const filters: string[] = [];
    sources.forEach((source, i) => {
      const duration = source.frames / FPS;
      filters.push(
        `[${i}:v:0]setpts=PTS-STARTPTS,scale=${input.width}:${input.height}:force_original_aspect_ratio=decrease,pad=${input.width}:${input.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},tpad=stop_mode=clone:stop_duration=0.034,trim=end_frame=${source.frames},setpts=PTS-STARTPTS[v${i}]`,
      );
      filters.push(
        source.audio
          ? `[${i}:a:0]asetpts=PTS-${source.videoStart}/TB,aresample=48000:async=1:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${duration}[a${i}]`
          : `anullsrc=r=48000:cl=stereo,atrim=duration=${duration}[a${i}]`,
      );
    });
    filters.push(
      sources.map((_, i) => `[v${i}][a${i}]`).join('') +
        `concat=n=${sources.length}:v=1:a=1[v][a]`,
    );
    args.push(
      '-filter_complex',
      filters.join(';'),
      '-map',
      '[v]',
      '-map',
      '[a]',
      '-c:v',
      'libx264',
      '-threads',
      '1',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      '48000',
      '-movflags',
      '+faststart',
      '-fs',
      String(MAX_OUTPUT_BYTES),
      path,
    );
    await execute(
      process.env.MEDIA_FFMPEG_PATH?.trim() || 'ffmpeg',
      args,
      deadline,
    );
    const output = await inspect(path, deadline);
    const info = await stat(path);
    const renderedVideo = output.streams.find((s) => s.codec_type === 'video');
    if (
      !renderedVideo?.duration ||
      !Number.isFinite(Number(renderedVideo.duration)) ||
      !Number.isFinite(Number(output.format.duration)) ||
      Math.abs(Number(renderedVideo.duration) - totalFrames / FPS) > 1 / FPS ||
      info.size >= MAX_OUTPUT_BYTES ||
      Math.abs(Number(output.format.duration) - totalFrames / FPS) > 1 / FPS
    )
      throw new Error(
        'Storyboard render did not produce the complete sequence.',
      );
    return {
      path,
      sizeBytes: info.size,
      durationMs: Math.round((totalFrames / FPS) * 1000),
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
async function inspect(path: string, signal: AbortSignal) {
  const body = await execute(
    process.env.MEDIA_FFPROBE_PATH?.trim() || 'ffprobe',
    [
      '-v',
      'error',
      '-threads',
      '1',
      '-protocol_whitelist',
      'file',
      '-format_whitelist',
      'mov,matroska',
      '-show_entries',
      'stream=codec_type,width,height,duration,start_time:format=duration,format_name',
      '-of',
      'json',
      path,
    ],
    signal,
  );
  try {
    return Probe.parse(JSON.parse(body));
  } catch {
    throw new Error('Storyboard media inspection returned invalid metadata.');
  }
}
function execute(
  binary: string,
  args: string[],
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        signal,
        timeout: 600000,
        killSignal: 'SIGKILL',
        maxBuffer: 1024 * 1024,
      },
      (error, stdout) => {
        if (error)
          reject(
            new Error(
              signal.aborted
                ? 'Storyboard render cancelled or timed out.'
                : 'Storyboard media processing failed. Verify the source videos and server encoder configuration.',
            ),
          );
        else resolve(stdout);
      },
    );
  });
}
