import {
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { execFile } from 'node:child_process';

const FFPROBE_TIMEOUT_MS = 60_000;
const FFPROBE_MAX_OUTPUT_BYTES = 1024 * 1024;

export interface PlayableAudioProbeResult {
  durationMs: number;
  durationSeconds: number;
  durationSecondsExact: number;
  contentType: 'audio/mpeg' | 'audio/wav' | 'audio/ogg';
  fileExtension: 'mp3' | 'wav' | 'ogg';
  audioCodec: string;
  sampleRate: number;
  channels: number;
}

/** Byte-authoritative inspection for generated audio before it enters MediaAsset. */
@Injectable()
export class PlayableAudioProbeService {
  async probeFile(filePath: string): Promise<PlayableAudioProbeResult> {
    const executable = process.env.MEDIA_FFPROBE_PATH?.trim() || 'ffprobe';
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        executable,
        [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_type,codec_name,sample_rate,channels,duration:format=format_name,duration',
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
          if (!error) return resolve(stdout);
          const systemError = error as NodeJS.ErrnoException & {
            killed?: boolean;
            signal?: NodeJS.Signals | null;
          };
          if (systemError.code === 'ENOENT') {
            return reject(
              new ServiceUnavailableException({
                code: 'MEDIA_AUDIO_PROBE_UNAVAILABLE',
                message:
                  'The server audio inspector is unavailable. ffprobe must be installed.',
              }),
            );
          }
          if (systemError.killed || systemError.signal) {
            return reject(
              new ServiceUnavailableException({
                code: 'MEDIA_AUDIO_PROBE_TIMEOUT',
                message: 'The server timed out while inspecting the audio.',
              }),
            );
          }
          reject(invalidAudio());
        },
      );
    });
    return parsePlayableAudioFfprobeOutput(output);
  }
}

export function parsePlayableAudioFfprobeOutput(
  output: string,
): PlayableAudioProbeResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(output) as unknown;
  } catch {
    throw invalidAudio();
  }
  const root = record(decoded);
  const streams = (Array.isArray(root?.streams) ? root.streams : [])
    .map(record)
    .filter((stream): stream is Record<string, unknown> => stream !== null);
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  const format = record(root?.format);
  const formatNames =
    typeof format?.format_name === 'string'
      ? format.format_name.split(',').map((name) => name.trim().toLowerCase())
      : [];
  const durationSecondsExact =
    positiveNumber(audio?.duration) ?? positiveNumber(format?.duration);
  const sampleRate = positiveInteger(audio?.sample_rate);
  const channels = positiveInteger(audio?.channels);
  const audioCodec =
    typeof audio?.codec_name === 'string'
      ? audio.codec_name.trim().toLowerCase()
      : '';
  const media = audioMediaType(formatNames, audioCodec);
  if (!audio || !durationSecondsExact || !sampleRate || !channels || !media) {
    throw invalidAudio();
  }
  return {
    durationMs: Math.max(1, Math.round(durationSecondsExact * 1000)),
    durationSeconds: Math.max(1, Math.round(durationSecondsExact)),
    durationSecondsExact,
    contentType: media.contentType,
    fileExtension: media.fileExtension,
    audioCodec,
    sampleRate,
    channels,
  };
}

function audioMediaType(formatNames: string[], codec: string) {
  if (formatNames.includes('mp3') && codec === 'mp3') {
    return {
      contentType: 'audio/mpeg' as const,
      fileExtension: 'mp3' as const,
    };
  }
  if (formatNames.includes('wav') && codec.startsWith('pcm_')) {
    return { contentType: 'audio/wav' as const, fileExtension: 'wav' as const };
  }
  if (formatNames.includes('ogg') && (codec === 'opus' || codec === 'vorbis')) {
    return { contentType: 'audio/ogg' as const, fileExtension: 'ogg' as const };
  }
  return null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function positiveInteger(value: unknown): number | null {
  const numeric = positiveNumber(value);
  return numeric !== null && Number.isInteger(numeric) ? numeric : null;
}

function invalidAudio(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'MEDIA_AUDIO_INVALID',
    message: 'The file is not readable browser-compatible audio.',
  });
}
