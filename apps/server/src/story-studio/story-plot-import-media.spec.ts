import { type Prisma } from '@prisma/client';
import { parseStoryPlotImportValue } from './story-plot-import';
import { resolveStoryPlotImportMedia } from './story-plot-import-media';

const MEDIA = '019a0331-5000-7000-8000-000000000001';
function fixture(durationMs: number | null = 8400) {
  const candidate = {
    asset: {
      id: MEDIA,
      kind: 'video',
      status: 'ready',
      moderationStatus: 'approved',
      deletedAt: null,
      durationSeconds: null,
      variants: [{ durationMs, durationSeconds: null }],
    },
  };
  const findUnique = jest.fn().mockResolvedValue(candidate);
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    storyCandidateAsset: { findUnique },
  };
  const plot = parseStoryPlotImportValue({
    entryNodeId: 'opening',
    assets: [],
    nodes: [
      {
        id: 'opening',
        type: 'scene',
        title: 'Opening',
        next: null,
        storyboard: {
          clips: ['first', 'second'].map((id) => ({
            id,
            kind: 'video',
            title: id,
            prompt: 'A scene',
            durationMs: 1000,
            videoFile: 'opening.mp4',
          })),
        },
      },
    ],
  });
  const bindings = ['first', 'second'].map((clipId) => ({
    nodeId: 'opening',
    clipId,
    mediaAssetId: MEDIA,
  }));
  return {
    tx,
    candidate,
    findUnique,
    plot,
    bindings,
    resolve: (media = bindings) =>
      resolveStoryPlotImportMedia(
        tx as unknown as Prisma.TransactionClient,
        'project-1',
        plot,
        media,
      ),
  };
}

describe('plot import media validation', () => {
  it('reuses one validated source across clips and adopts authoritative duration without mutating the input', async () => {
    const f = fixture();
    const result = await f.resolve();
    expect(f.findUnique).toHaveBeenCalledTimes(1);
    expect(f.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          storyProjectId_mediaAssetId: {
            storyProjectId: 'project-1',
            mediaAssetId: MEDIA,
          },
        },
      }),
    );
    expect(result.plot.nodes[0]).toMatchObject({
      storyboard: { clips: [{ durationMs: 8400 }, { durationMs: 8400 }] },
    });
    expect(f.plot.nodes[0]).toMatchObject({
      storyboard: { clips: [{ durationMs: 1000 }, { durationMs: 1000 }] },
    });
    expect(result.mediaByClip.size).toBe(2);
    expect(f.tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      f.findUnique.mock.invocationCallOrder[0],
    );
  });
  it('allows a prompt-only import without ZIP media', async () => {
    const f = fixture();
    await f.resolve([]);
    expect(f.findUnique).not.toHaveBeenCalled();
    expect(f.tx.$executeRaw).not.toHaveBeenCalled();
  });
  it.each(['duplicate', 'missing', 'unknown'])(
    'rejects %s bindings before touching media',
    async (kind) => {
      const f = fixture();
      const bindings =
        kind === 'duplicate'
          ? [f.bindings[0], f.bindings[0]]
          : kind === 'missing'
            ? [f.bindings[0]]
            : [{ ...f.bindings[0], clipId: 'not-in-file' }];
      await expect(f.resolve(bindings)).rejects.toMatchObject({
        code: 'media',
      });
      expect(f.findUnique).not.toHaveBeenCalled();
    },
  );
  it('rejects media from another project', async () => {
    const f = fixture();
    f.findUnique.mockResolvedValue(null);
    await expect(f.resolve()).rejects.toMatchObject({ status: 400 });
  });
  it.each([null, 0, 100, 8400.5, 3_600_001])(
    'rejects invalid duration metadata: %s',
    async (duration) => {
      await expect(fixture(duration).resolve()).rejects.toMatchObject({
        code: 'duration',
      });
    },
  );
  it('rejects a scene that exceeds the timeline limit after real durations are applied', async () => {
    await expect(fixture(2_000_000).resolve()).rejects.toMatchObject({
      code: 'duration',
      path: '$.nodes[0].storyboard.clips',
    });
  });
  it.each(['not-ready', 'blocked', 'wrong-kind'])(
    'rejects %s candidate media',
    async (state) => {
      const f = fixture();
      const candidate = f.candidate;
      if (state === 'not-ready') candidate.asset.status = 'processing';
      if (state === 'blocked') candidate.asset.moderationStatus = 'blocked';
      if (state === 'wrong-kind') candidate.asset.kind = 'image';
      f.findUnique.mockResolvedValue(candidate);
      await expect(f.resolve()).rejects.toMatchObject({ status: 400 });
    },
  );
});
