/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest asymmetric matchers */
import { ImmTranscodeService } from './imm-transcode.service';

const oss = {
  get: jest.fn(),
  list: jest.fn(),
  copy: jest.fn(),
  deleteMulti: jest.fn(),
};
const rpc = { request: jest.fn() };

jest.mock('ali-oss', () => jest.fn().mockImplementation(() => oss));
jest.mock('@alicloud/pop-core', () => ({
  RPCClient: jest.fn().mockImplementation(() => rpc),
}));

const ASSET_ID = '019f60f4-b101-70d4-8000-00000000b001';
const PREFIX = `hls/${ASSET_ID}/`;
const ENV_KEYS = [
  'IMM_REGION',
  'IMM_PROJECT_NAME',
  'IMM_ENDPOINT',
  'IMM_ACCESS_KEY_ID',
  'IMM_ACCESS_KEY_SECRET',
  'OSS_ACCESS_KEY_ID',
  'OSS_ACCESS_KEY_SECRET',
  'OSS_BUCKET',
  'OSS_REGION',
  'IMM_SET_HLS_CACHE_CONTROL',
] as const;

function configure(
  overrides: Partial<Record<(typeof ENV_KEYS)[number], string>> = {},
) {
  const values: Partial<Record<(typeof ENV_KEYS)[number], string>> = {
    IMM_REGION: 'cn-hangzhou',
    IMM_PROJECT_NAME: 'fizzdragon-cn',
    OSS_ACCESS_KEY_ID: 'ak',
    OSS_ACCESS_KEY_SECRET: 'sk',
    OSS_BUCKET: 'fizzdragon-ai-outputs',
    OSS_REGION: 'oss-cn-hangzhou',
    ...overrides,
  };
  for (const key of ENV_KEYS) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  return new ImmTranscodeService();
}

function text(content: string) {
  return { content: Buffer.from(content, 'utf8') };
}

function listing(names: string[], size = 100) {
  return {
    objects: names.map((name) => ({ name, size })),
    isTruncated: false,
    nextMarker: null,
  };
}

const MASTER = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-STREAM-INF:BANDWIDTH=2200000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
  '1080p.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=1100000,RESOLUTION=1280x720',
  '720p.m3u8',
  '',
].join('\n');

function rendition(name: string, durations: number[]) {
  return [
    '#EXTM3U',
    '#EXT-X-TARGETDURATION:6',
    ...durations.flatMap((seconds, index) => [
      `#EXTINF:${seconds.toFixed(3)},`,
      `${name}-${index}.ts`,
    ]),
    '#EXT-X-ENDLIST',
  ].join('\n');
}

describe('ImmTranscodeService', () => {
  const saved = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  describe('configuration', () => {
    it('is configured only with region, project, keys and the OSS read-back', () => {
      expect(configure().isConfigured()).toBe(true);
      expect(configure({ IMM_REGION: undefined }).isConfigured()).toBe(false);
      expect(configure({ IMM_PROJECT_NAME: undefined }).isConfigured()).toBe(
        false,
      );
    });

    it('names every missing variable at once, with no silent region/project default', () => {
      const service = configure({
        IMM_REGION: undefined,
        IMM_PROJECT_NAME: undefined,
        OSS_ACCESS_KEY_SECRET: undefined,
        OSS_BUCKET: undefined,
      });
      expect(() => service.assertConfigured('story playback HLS')).toThrow(
        'story playback HLS requires: IMM_REGION, IMM_PROJECT_NAME, IMM_ACCESS_KEY_SECRET|OSS_ACCESS_KEY_SECRET, OSS_BUCKET',
      );
      expect(() => configure().assertConfigured('x')).not.toThrow();
    });

    it('accepts the IMM key pair as an alias of the OSS one', () => {
      const service = configure({
        OSS_ACCESS_KEY_ID: undefined,
        OSS_ACCESS_KEY_SECRET: undefined,
        IMM_ACCESS_KEY_ID: 'imm-ak',
        IMM_ACCESS_KEY_SECRET: 'imm-sk',
      });
      expect(() => service.assertConfigured('x')).not.toThrow();
    });
  });

  describe('getTaskStatus', () => {
    it("surfaces IMM's error code for a failed task", async () => {
      rpc.request.mockResolvedValueOnce({
        Status: 'Failed',
        Code: 'InvalidParameter.Video',
        Message: 'source has no video stream',
      });
      await expect(configure().getTaskStatus('task-1')).resolves.toEqual({
        state: 'failed',
        raw: 'Failed',
        errorCode: 'InvalidParameter.Video',
        errorMessage: 'source has no video stream',
      });
    });

    it('reads a failed task that pop-core raised because of its top-level Code', async () => {
      const raised = Object.assign(new Error('bad input, URL: https://imm'), {
        code: 'InvalidParameter',
        data: {
          Status: 'Failed',
          Code: 'InvalidParameter',
          Message: 'bad input',
        },
      });
      rpc.request.mockRejectedValueOnce(raised);
      await expect(configure().getTaskStatus('task-1')).resolves.toMatchObject({
        state: 'failed',
        errorCode: 'InvalidParameter',
        errorMessage: 'bad input',
      });
    });

    it('rethrows a transport or API error that carries no task status', async () => {
      const raised = Object.assign(new Error('Throttling'), {
        code: 'Throttling',
        data: { Code: 'Throttling', Message: 'slow down' },
      });
      rpc.request.mockRejectedValueOnce(raised);
      await expect(configure().getTaskStatus('task-1')).rejects.toBe(raised);
    });
  });

  describe('finalizeHls', () => {
    it('measures tiers, segments, durations, bytes and missing keys', async () => {
      oss.get.mockImplementation((key: string) =>
        Promise.resolve(
          key === `${PREFIX}master.m3u8`
            ? text(MASTER)
            : key === `${PREFIX}1080p.m3u8`
              ? text(rendition('1080p', [6, 6, 2.5]))
              : text(rendition('720p', [6, 6, 2.5])),
        ),
      );
      oss.list.mockResolvedValueOnce({
        objects: [
          { name: `${PREFIX}master.m3u8`, size: 200 },
          { name: `${PREFIX}1080p.m3u8`, size: 300 },
          { name: `${PREFIX}1080p-0.ts`, size: 1000 },
          { name: `${PREFIX}1080p-1.ts`, size: 1000 },
          { name: `${PREFIX}1080p-2.ts`, size: 500 },
          { name: `${PREFIX}720p.m3u8`, size: 300 },
          { name: `${PREFIX}720p-0.ts`, size: 600 },
          { name: `${PREFIX}720p-1.ts`, size: 600 },
          // 720p-2.ts is missing; an unreferenced leftover still counts.
          { name: `${PREFIX}stray.tmp`, size: 7 },
        ],
        isTruncated: false,
        nextMarker: null,
      });

      const result = await configure().finalizeHls(ASSET_ID);

      expect(result.masterObjectKey).toBe(`${PREFIX}master.m3u8`);
      expect(result.renditions).toEqual([
        {
          name: '1080p',
          playlistKey: `${PREFIX}1080p.m3u8`,
          width: 1920,
          height: 1080,
          segmentCount: 3,
          durationSeconds: 14.5,
          maxSegmentSeconds: 6,
        },
        {
          name: '720p',
          playlistKey: `${PREFIX}720p.m3u8`,
          width: 1280,
          height: 720,
          segmentCount: 3,
          durationSeconds: 14.5,
          maxSegmentSeconds: 6,
        },
      ]);
      expect(result.totalBytes).toBe(4507n);
      expect(result.missingKeys).toEqual([`${PREFIX}720p-2.ts`]);
      expect(result.objectKeys).toHaveLength(9);
      expect(oss.list).toHaveBeenCalledWith(
        expect.objectContaining({ prefix: PREFIX, 'max-keys': 1000 }),
        expect.anything(),
      );
      // Judging and the Cache-Control pass belong to the caller now.
      expect(oss.copy).not.toHaveBeenCalled();
    });

    it('reports a single short segment as-is (a 5 s clip is a valid output)', async () => {
      oss.get.mockImplementation((key: string) =>
        Promise.resolve(
          key.endsWith('master.m3u8')
            ? text(
                '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=854x480\n480p.m3u8\n',
              )
            : text(rendition('480p', [5])),
        ),
      );
      oss.list.mockResolvedValueOnce(
        listing([
          `${PREFIX}master.m3u8`,
          `${PREFIX}480p.m3u8`,
          `${PREFIX}480p-0.ts`,
        ]),
      );
      const result = await configure().finalizeHls(ASSET_ID);
      expect(result.renditions).toEqual([
        expect.objectContaining({
          name: '480p',
          width: 854,
          height: 480,
          segmentCount: 1,
          durationSeconds: 5,
          maxSegmentSeconds: 5,
        }),
      ]);
      expect(result.missingKeys).toEqual([]);
    });

    it('returns no rendition for a master that lists none', async () => {
      oss.get.mockResolvedValue(text('#EXTM3U\n'));
      oss.list.mockResolvedValueOnce(listing([`${PREFIX}master.m3u8`]));
      const result = await configure().finalizeHls(ASSET_ID);
      expect(result.renditions).toEqual([]);
    });

    it('pages the listing by marker until it is no longer truncated', async () => {
      oss.get.mockImplementation((key: string) =>
        Promise.resolve(
          key.endsWith('master.m3u8')
            ? text('#EXTM3U\n480p.m3u8\n')
            : text(rendition('480p', [6])),
        ),
      );
      oss.list
        .mockResolvedValueOnce({
          objects: [{ name: `${PREFIX}480p-0.ts`, size: 10 }],
          isTruncated: true,
          nextMarker: `${PREFIX}480p-0.ts`,
        })
        .mockResolvedValueOnce({
          objects: [
            { name: `${PREFIX}480p.m3u8`, size: 1 },
            { name: `${PREFIX}master.m3u8`, size: 1 },
          ],
          isTruncated: false,
          nextMarker: null,
        });
      const result = await configure().finalizeHls(ASSET_ID);
      expect(oss.list).toHaveBeenCalledTimes(2);
      expect((oss.list.mock.calls[1] as [unknown])[0]).toEqual(
        expect.objectContaining({ marker: `${PREFIX}480p-0.ts` }),
      );
      expect(result.totalBytes).toBe(12n);
      expect(result.renditions[0]).toMatchObject({ width: null, height: null });
    });
  });

  describe('applyHlsCacheControl', () => {
    it('re-sets Cache-Control and Content-Type on every object, unless disabled', async () => {
      oss.list.mockResolvedValue(
        listing([`${PREFIX}master.m3u8`, `${PREFIX}480p-0.ts`]),
      );
      oss.copy.mockResolvedValue({});
      await configure().applyHlsCacheControl(ASSET_ID);
      expect(oss.copy).toHaveBeenCalledWith(
        `${PREFIX}480p-0.ts`,
        `${PREFIX}480p-0.ts`,
        {
          headers: expect.objectContaining({
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Content-Type': 'video/MP2T',
          }),
        },
      );
      oss.copy.mockClear();
      await configure({
        IMM_SET_HLS_CACHE_CONTROL: 'false',
      }).applyHlsCacheControl(ASSET_ID);
      expect(oss.copy).not.toHaveBeenCalled();
    });
  });

  describe('deleteHlsOutput', () => {
    const FAR = () => Date.now() + 60_000;

    it('refuses a non-UUID asset id and a bucket it is not bound to', async () => {
      const service = configure();
      await expect(
        service.deleteHlsOutput('../media', 'fizzdragon-ai-outputs', FAR()),
      ).rejects.toThrow('is not a UUID');
      await expect(
        service.deleteHlsOutput(ASSET_ID, 'other-bucket', FAR()),
      ).rejects.toThrow('bound to "fizzdragon-ai-outputs"');
      expect(oss.list).not.toHaveBeenCalled();
    });

    it('refuses to delete when the listing returns a key outside the prefix', async () => {
      oss.list.mockResolvedValueOnce(
        listing([`${PREFIX}480p-0.ts`, 'media/cn/other.mp4']),
      );
      await expect(
        configure().deleteHlsOutput(ASSET_ID, 'fizzdragon-ai-outputs', FAR()),
      ).rejects.toThrow('returned media/cn/other.mp4');
      expect(oss.deleteMulti).not.toHaveBeenCalled();
    });

    it('re-lists from the start of the prefix until it is empty', async () => {
      oss.list
        .mockResolvedValueOnce(listing([`${PREFIX}a.ts`, `${PREFIX}b.ts`]))
        .mockResolvedValueOnce(listing([`${PREFIX}c.ts`]))
        .mockResolvedValueOnce(listing([]));
      oss.deleteMulti.mockResolvedValue({});
      await expect(
        configure().deleteHlsOutput(ASSET_ID, 'fizzdragon-ai-outputs', FAR()),
      ).resolves.toEqual({ deleted: 3, complete: true });
      expect(oss.list).toHaveBeenCalledTimes(3);
      for (const [query] of oss.list.mock.calls) {
        expect(query).toEqual({ prefix: PREFIX, 'max-keys': 1000 });
      }
      expect(oss.deleteMulti).toHaveBeenNthCalledWith(
        1,
        [`${PREFIX}a.ts`, `${PREFIX}b.ts`],
        expect.objectContaining({ quiet: true }),
      );
    });

    it('reports an already-empty prefix as complete', async () => {
      oss.list.mockResolvedValueOnce(listing([]));
      await expect(
        configure().deleteHlsOutput(ASSET_ID, 'fizzdragon-ai-outputs', 0),
      ).resolves.toEqual({ deleted: 0, complete: true });
    });

    it('stops at the deadline with progress reported', async () => {
      oss.list.mockResolvedValue(listing([`${PREFIX}a.ts`]));
      oss.deleteMulti.mockResolvedValue({});
      await expect(
        configure().deleteHlsOutput(
          ASSET_ID,
          'fizzdragon-ai-outputs',
          Date.now() - 1,
        ),
      ).resolves.toEqual({ deleted: 1, complete: false });
      expect(oss.deleteMulti).toHaveBeenCalledTimes(1);
    });

    it('treats a prefix that never empties as a runaway', async () => {
      const page = Array.from(
        { length: 1000 },
        (_, index) => `${PREFIX}${index}.ts`,
      );
      oss.list.mockResolvedValue(listing(page));
      oss.deleteMulti.mockResolvedValue({});
      await expect(
        configure().deleteHlsOutput(ASSET_ID, 'fizzdragon-ai-outputs', FAR()),
      ).rejects.toThrow(`HLS prefix ${PREFIX} exceeds 20000 objects`);
      expect(oss.deleteMulti).toHaveBeenCalledTimes(20);
    });
  });
});
