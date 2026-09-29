import * as childProcess from 'node:child_process';
import {
  PlayableVideoProbeService,
  parsePlayableVideoFfprobeOutput,
} from './playable-video-probe.service';

jest.mock('node:child_process', () => ({ execFile: jest.fn() }));

const video = {
  codec_type: 'video',
  codec_name: 'h264',
  profile: 'High',
  level: 40,
  pix_fmt: 'yuv420p',
  width: 640,
  height: 360,
  duration: '2.345',
  disposition: { attached_pic: 0 },
};
const cover = {
  codec_type: 'video',
  codec_name: 'mjpeg',
  width: 128,
  height: 128,
  duration: '9',
  disposition: { attached_pic: 1 },
};
const output = (streams: unknown[]) =>
  JSON.stringify({
    streams,
    format: {
      format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
      duration: '9',
      tags: { major_brand: 'isom' },
    },
  });
describe('video probe stream selection', () => {
  test('ignores leading cover art when measuring playable video', () => {
    expect(
      parsePlayableVideoFfprobeOutput(output([cover, video])),
    ).toMatchObject({
      width: 640,
      height: 360,
      durationMs: 2345,
      videoCodec: 'h264',
      browserSafeMp4: true,
    });
  });
  test('does not admit cover-only media as generic video', () => {
    expect(() =>
      parsePlayableVideoFfprobeOutput(output([cover]), {
        requireBrowserSafeMp4: false,
      }),
    ).toThrow('not a readable video');
  });
  test('retains stream duration, container fallback and rotation behavior', () => {
    expect(
      parsePlayableVideoFfprobeOutput(
        output([{ ...video, side_data_list: [{ rotation: -90 }] }]),
      ),
    ).toMatchObject({ width: 360, height: 640, durationMs: 2345 });
    expect(
      parsePlayableVideoFfprobeOutput(output([{ ...video, duration: 'N/A' }]))
        .durationMs,
    ).toBe(9000);
  });
  test('continues rejecting unsupported codec and audio in strict mode', () => {
    expect(() =>
      parsePlayableVideoFfprobeOutput(
        output([{ ...video, codec_name: 'hevc' }]),
      ),
    ).toThrow('H.264');
    expect(() =>
      parsePlayableVideoFfprobeOutput(
        output([video, { codec_type: 'audio', codec_name: 'opus' }]),
      ),
    ).toThrow('AAC');
  });
  test('retains ordinary streams without disposition metadata and generic measurement', () => {
    expect(
      parsePlayableVideoFfprobeOutput(
        output([{ ...video, disposition: undefined }]),
      ).durationMs,
    ).toBe(2345);
    expect(
      parsePlayableVideoFfprobeOutput(
        output([{ ...video, codec_name: 'hevc' }]),
        { requireBrowserSafeMp4: false },
      ).browserSafeMp4,
    ).toBe(false);
  });
});

describe('video probe process failures', () => {
  afterEach(() => jest.restoreAllMocks());

  test.each([
    [
      { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' },
      'MEDIA_VIDEO_PROBE_OUTPUT_LIMIT',
      503,
    ],
    [{ code: 'ENOENT' }, 'MEDIA_VIDEO_PROBE_UNAVAILABLE', 503],
    [{ code: 'EACCES' }, 'MEDIA_VIDEO_PROBE_UNAVAILABLE', 503],
    [{ code: 'EPERM' }, 'MEDIA_VIDEO_PROBE_UNAVAILABLE', 503],
    [{ killed: true, signal: 'SIGTERM' }, 'MEDIA_VIDEO_PROBE_TIMEOUT', 503],
    [{ code: 1 }, 'MEDIA_VIDEO_INVALID', 422],
  ] as const)(
    'classifies %j without claiming valid media',
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
      const result = new PlayableVideoProbeService().probeFile(
        '/local/fixture.mp4',
      );
      await expect(result).rejects.toMatchObject({ status });
      await expect(result).rejects.toHaveProperty('response.code', code);
    },
  );

  test('measures an hour-long stream without treating process timeout as a media-duration limit', async () => {
    const exec = jest
      .mocked(childProcess.execFile)
      .mockImplementation((...args: unknown[]) => {
        const callback = args.at(-1) as (
          error: null,
          stdout: string,
          stderr: string,
        ) => void;
        callback(null, output([{ ...video, duration: '3601.125' }]), '');
        return {} as childProcess.ChildProcess;
      });
    await expect(
      new PlayableVideoProbeService().probeFile('/local/long.mp4'),
    ).resolves.toMatchObject({
      durationMs: 3601125,
      durationSecondsExact: 3601.125,
    });
    expect(exec).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['/local/long.mp4']),
      expect.objectContaining({ timeout: 60000 }),
      expect.any(Function),
    );
  });
});
