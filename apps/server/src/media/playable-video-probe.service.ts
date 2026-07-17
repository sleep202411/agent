import {
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { execFile } from 'node:child_process';

const FFPROBE_TIMEOUT_MS = 60 * 1000;
const FFPROBE_MAX_OUTPUT_BYTES = 1024 * 1024;
const MP4_FORMAT_NAMES = new Set(['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2']);
const MP4_MAJOR_BRANDS = new Set([
  'isom',
  'iso2',
  'iso3',
  'iso4',
  'iso5',
  'iso6',
  'iso8',
  'iso9',
  'avc1',
  'mp41',
  'mp42',
  'm4v',
  'dash',
  'cmfc',
  'cmfs',
  'cmfv',
  '3gp4',
  '3gp5',
  '3gp6',
  '3gp7',
  '3g2a',
  '3g2b',
  '3g2c',
  'f4v',
  'msnv',
]);
const BROWSER_SAFE_H264_PIXEL_FORMATS = new Set(['yuv420p', 'yuvj420p']);
const BROWSER_SAFE_H264_PROFILES = new Set([
  'baseline',
  'constrained baseline',
  'main',
  'high',
]);
const MAX_BROWSER_SAFE_H264_LEVEL = 52;

export interface PlayableVideoProbeResult {
  width: number;
  height: number;
  /** Exact measured duration rounded only to the database millisecond unit. */
  durationMs: number;
  /** Legacy display/API field; never use it to reconstruct durationMs. */
  durationSeconds: number;
  durationSecondsExact: number;
  hasAudio: boolean;
  contentType: 'video/mp4' | 'video/webm' | 'video/quicktime';
  fileExtension: 'mp4' | 'webm' | 'mov';
  videoCodec: string;
  audioCodecs: string[];
  browserSafeMp4: boolean;
}

export interface PlayableVideoProbeOptions {
  /** Story playback ingestion requires this; generic AI media only measures. */
  requireBrowserSafeMp4?: boolean;
}

/**
 * Server-trusted inspection for every video that may enter the media ledger.
 * Provider metadata and generation parameters are requests, not facts; this
 * service derives the immutable playback contract from the exact bytes.
 */
@Injectable()
export class PlayableVideoProbeService {
  async probeFile(
    filePath: string,
    options: PlayableVideoProbeOptions = { requireBrowserSafeMp4: true },
  ): Promise<PlayableVideoProbeResult> {
    const executable = process.env.MEDIA_FFPROBE_PATH?.trim() || 'ffprobe';
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        executable,
        [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_type,codec_name,profile,level,pix_fmt,width,height,duration:stream_tags=rotate:stream_side_data=rotation:format=format_name,duration:format_tags=major_brand',
          '-of',
          'json',
          filePath,
        ],
        {
          encoding: 'utf8',
          timeout: FFPROBE_TIMEOUT_MS,
          maxBuffer: FFPROBE_MAX_OUTPUT_BYTES,
        },
        (error, stdout) => {
          if (!error) {
            resolve(stdout);
            return;
          }
          const systemError = error as NodeJS.ErrnoException & {
            killed?: boolean;
            signal?: NodeJS.Signals | null;
          };
          if (systemError.code === 'ENOENT') {
            reject(
              new ServiceUnavailableException({
                code: 'MEDIA_VIDEO_PROBE_UNAVAILABLE',
                message:
                  'The server video inspector is unavailable. ffprobe must be installed.',
              }),
            );
            return;
          }
          if (systemError.killed || systemError.signal) {
            reject(
              new ServiceUnavailableException({
                code: 'MEDIA_VIDEO_PROBE_TIMEOUT',
                message: 'The server timed out while inspecting the video.',
              }),
            );
            return;
          }
          reject(invalidVideo());
        },
      );
    });
    return parsePlayableVideoFfprobeOutput(output, options);
  }
}

export function parsePlayableVideoFfprobeOutput(
  output: string,
  options: PlayableVideoProbeOptions = { requireBrowserSafeMp4: true },
): PlayableVideoProbeResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(output) as unknown;
  } catch {
    throw invalidVideo();
  }
  const root = record(decoded);
  const streams = (Array.isArray(root?.streams) ? root.streams : [])
    .map(record)
    .filter((stream): stream is Record<string, unknown> => stream !== null);
  const stream =
    streams.find((candidate) => candidate.codec_type === 'video') ?? null;
  const format = record(root?.format);
  const formatNames =
    typeof format?.format_name === 'string'
      ? format.format_name.split(',').map((name) => name.trim().toLowerCase())
      : [];
  const formatTags = record(format?.tags);
  const majorBrand =
    typeof formatTags?.major_brand === 'string'
      ? formatTags.major_brand.trim().toLowerCase()
      : '';
  const isMp4Family = formatNames.some((name) => MP4_FORMAT_NAMES.has(name));
  const isBrowserSafeMp4Container =
    isMp4Family && MP4_MAJOR_BRANDS.has(majorBrand);
  const isWebm = formatNames.includes('webm');
  const isQuickTime = isMp4Family && majorBrand === 'qt';
  if (!isBrowserSafeMp4Container && !isWebm && !isQuickTime) {
    throw new UnprocessableEntityException({
      code: 'MEDIA_VIDEO_CONTAINER_UNSUPPORTED',
      message: 'The video bytes use an unsupported container.',
    });
  }
  if (!stream) throw invalidVideo();
  const videoCodec =
    typeof stream.codec_name === 'string'
      ? stream.codec_name.trim().toLowerCase()
      : '';
  const pixelFormat =
    typeof stream.pix_fmt === 'string'
      ? stream.pix_fmt.trim().toLowerCase()
      : '';
  const profile =
    typeof stream.profile === 'string' ? stream.profile.toLowerCase() : '';
  const level = finiteNumber(stream.level);
  const audioCodecs = [
    ...new Set(
      streams.flatMap((candidate) =>
        candidate.codec_type === 'audio' &&
        typeof candidate.codec_name === 'string'
          ? [candidate.codec_name.trim().toLowerCase()]
          : [],
      ),
    ),
  ].sort();
  const browserSafeMp4 =
    isBrowserSafeMp4Container &&
    videoCodec === 'h264' &&
    BROWSER_SAFE_H264_PIXEL_FORMATS.has(pixelFormat) &&
    BROWSER_SAFE_H264_PROFILES.has(profile) &&
    level !== null &&
    Number.isInteger(level) &&
    level >= 10 &&
    level <= MAX_BROWSER_SAFE_H264_LEVEL &&
    audioCodecs.every((codec) => codec === 'aac');

  if (options.requireBrowserSafeMp4 && !isBrowserSafeMp4Container) {
    throw new UnprocessableEntityException({
      code: 'MEDIA_VIDEO_CONTAINER_UNSUPPORTED',
      message: 'The video bytes must use a supported MP4 container brand.',
    });
  }
  if (options.requireBrowserSafeMp4 && videoCodec !== 'h264') {
    throw unsupportedCodec('The video stream must use H.264.');
  }
  if (
    (options.requireBrowserSafeMp4 && typeof stream.pix_fmt !== 'string') ||
    (options.requireBrowserSafeMp4 &&
      !BROWSER_SAFE_H264_PIXEL_FORMATS.has(pixelFormat))
  ) {
    throw unsupportedCodec(
      'The H.264 video stream must use the browser-safe yuv420p pixel format.',
    );
  }
  if (
    (options.requireBrowserSafeMp4 &&
      !BROWSER_SAFE_H264_PROFILES.has(profile)) ||
    (options.requireBrowserSafeMp4 &&
      (level === null ||
        !Number.isInteger(level) ||
        level < 10 ||
        level > MAX_BROWSER_SAFE_H264_LEVEL))
  ) {
    throw unsupportedCodec(
      'The H.264 profile or level is not supported by the player.',
    );
  }
  if (
    options.requireBrowserSafeMp4 &&
    audioCodecs.some((codec) => codec !== 'aac')
  ) {
    throw unsupportedCodec('Every audio stream must use AAC.');
  }
  const rawWidth = positiveInteger(stream.width);
  const rawHeight = positiveInteger(stream.height);
  const durationSecondsExact =
    positiveNumber(stream.duration) ?? positiveNumber(format?.duration);
  if (!rawWidth || !rawHeight || !durationSecondsExact) {
    throw invalidVideo();
  }

  const rotation = readRotation(stream);
  const swapsAxes = rotation === 90 || rotation === 270;
  return {
    width: swapsAxes ? rawHeight : rawWidth,
    height: swapsAxes ? rawWidth : rawHeight,
    durationMs: Math.max(1, Math.round(durationSecondsExact * 1_000)),
    durationSeconds: Math.max(1, Math.round(durationSecondsExact)),
    durationSecondsExact,
    hasAudio: streams.some((candidate) => candidate.codec_type === 'audio'),
    contentType: isBrowserSafeMp4Container
      ? 'video/mp4'
      : isWebm
        ? 'video/webm'
        : 'video/quicktime',
    fileExtension: isBrowserSafeMp4Container ? 'mp4' : isWebm ? 'webm' : 'mov',
    videoCodec,
    audioCodecs,
    browserSafeMp4,
  };
}

function readRotation(stream: Record<string, unknown>): number {
  const sideData = Array.isArray(stream.side_data_list)
    ? stream.side_data_list
    : [];
  const sideRotation = sideData
    .map(record)
    .find((item) => item && finiteNumber(item.rotation) !== null)?.rotation;
  const tags = record(stream.tags);
  const value = finiteNumber(sideRotation ?? tags?.rotate) ?? 0;
  return ((Math.round(value) % 360) + 360) % 360;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function positiveNumber(value: unknown): number | null {
  const numeric = finiteNumber(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

function positiveInteger(value: unknown): number | null {
  const numeric = finiteNumber(value);
  return numeric !== null && Number.isInteger(numeric) && numeric > 0
    ? numeric
    : null;
}

function invalidVideo(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'MEDIA_VIDEO_INVALID',
    message: 'The file is not a readable video.',
  });
}

function unsupportedCodec(message: string): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'MEDIA_VIDEO_CODEC_UNSUPPORTED',
    message,
  });
}
