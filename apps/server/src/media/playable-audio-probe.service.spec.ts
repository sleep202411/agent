import * as childProcess from 'node:child_process';
import {
  PlayableAudioProbeService,
  parsePlayableAudioFfprobeOutput,
} from './playable-audio-probe.service';

describe('parsePlayableAudioFfprobeOutput', () => {
  it('derives durable MP3 metadata from ffprobe output', () => {
    expect(
      parsePlayableAudioFfprobeOutput(
        JSON.stringify({
          streams: [
            {
              codec_type: 'audio',
              codec_name: 'mp3',
              sample_rate: '24000',
              channels: 1,
              duration: '2.345',
            },
          ],
          format: { format_name: 'mp3', duration: '2.345' },
        }),
      ),
    ).toMatchObject({
      durationMs: 2345,
      durationSeconds: 2,
      durationSecondsExact: 2.345,
      contentType: 'audio/mpeg',
      fileExtension: 'mp3',
      audioCodec: 'mp3',
      sampleRate: 24000,
      channels: 1,
    });
  });
});

jest.mock('node:child_process', () => ({ execFile: jest.fn() }));

describe('audio probe process failures', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each([
    [
      { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' },
      'MEDIA_AUDIO_PROBE_OUTPUT_LIMIT',
      503,
    ],
    [{ code: 'ENOENT' }, 'MEDIA_AUDIO_PROBE_UNAVAILABLE', 503],
    [{ code: 'EACCES' }, 'MEDIA_AUDIO_PROBE_UNAVAILABLE', 503],
    [{ code: 'EPERM' }, 'MEDIA_AUDIO_PROBE_UNAVAILABLE', 503],
    [{ killed: true, signal: 'SIGTERM' }, 'MEDIA_AUDIO_PROBE_TIMEOUT', 503],
    [{ code: 1 }, 'MEDIA_AUDIO_INVALID', 422],
  ] as const)(
    'classifies %j without declaring uninspected media invalid',
    async (error, code, status) => {
      jest
        .mocked(childProcess.execFile)
        .mockImplementation((...args: unknown[]) => {
          const callback = args.at(-1) as (
            error: unknown,
            stdout: string,
            stderr: string,
          ) => void;
          callback(error, '', 'fixture failure');
          return {} as childProcess.ChildProcess;
        });
      const result = new PlayableAudioProbeService().probeFile(
        '/local/fixture.mp3',
      );
      await expect(result).rejects.toMatchObject({ status });
      await expect(result).rejects.toHaveProperty('response.code', code);
    },
  );
});
