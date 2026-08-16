import { access, readFile } from 'node:fs/promises';
import { AiGenerationWorkerService } from './worker.service';

describe('AiGenerationWorkerService video output truth', () => {
  it('probes the exact spooled bytes and persists measured metadata', async () => {
    let spoolPath = '';
    const store = {
      createAiOutputAsset: jest.fn().mockResolvedValue('asset-1'),
    };
    const storage = {
      uploadFromFile: jest.fn(async (input: { filePath: string }) => {
        await expect(readFile(input.filePath)).resolves.toEqual(
          Buffer.from('provider-video-bytes'),
        );
        return {
          url: 'https://media.example.test/video.mp4',
          provider: 'azure_blob',
          bucket: 'media',
          region: 'eastus2',
          storagePath: 'outputs/video.mp4',
          bytes: 20,
        };
      }),
    };
    const videoProbe = {
      probeFile: jest.fn(async (filePath: string) => {
        spoolPath = filePath;
        await expect(readFile(filePath)).resolves.toEqual(
          Buffer.from('provider-video-bytes'),
        );
        return {
          width: 1920,
          height: 1080,
          durationMs: 8375,
          durationSeconds: 8,
          durationSecondsExact: 8.375,
          contentType: 'video/mp4',
          fileExtension: 'mp4',
          videoCodec: 'h264',
          audioCodecs: [],
          browserSafeMp4: true,
        };
      }),
    };
    const mediaAssetReadiness = {
      enqueueAutomaticChecks: jest.fn().mockResolvedValue(undefined),
    };
    const worker = new AiGenerationWorkerService(
      store as never,
      {} as never,
      {} as never,
      storage as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      mediaAssetReadiness as never,
      videoProbe as never,
      {} as never,
      {} as never,
    );
    const workerInternals = worker as unknown as {
      uploadOutputs: (
        job: Record<string, unknown>,
        outputs: Array<Record<string, unknown>>,
      ) => Promise<
        Array<{
          width?: number;
          height?: number;
          durationSeconds?: number;
          mimeType: string;
        }>
      >;
    };

    const outputs = await workerInternals.uploadOutputs(
      {
        id: 'job-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        type: 'video',
        provider: 'provider',
        modelId: 'model',
        deployment: 'deployment',
        canonicalModelId: 'canonical-model',
        providerBindingId: 'binding',
        createdAt: '2026-07-17T12:00:00.000Z',
      },
      [
        {
          index: 0,
          type: 'video',
          buffer: Buffer.from('provider-video-bytes'),
          mimeType: 'video/provider-claimed',
          ext: 'bin',
          width: 640,
          height: 360,
          durationSeconds: 5,
        },
      ],
    );

    expect(videoProbe.probeFile).toHaveBeenCalledTimes(1);
    expect(storage.uploadFromFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: spoolPath,
        contentType: 'video/mp4',
        filename: 'job-1-0.mp4',
      }),
    );
    expect(store.createAiOutputAsset).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'job-1' }),
      expect.objectContaining({
        contentType: 'video/mp4',
        width: 1920,
        height: 1080,
        durationMs: 8375,
        durationSeconds: 8,
        videoMetadata: {
          videoCodec: 'h264',
          audioCodecs: [],
          browserSafeMp4: true,
        },
      }),
    );
    expect(mediaAssetReadiness.enqueueAutomaticChecks).toHaveBeenCalledWith(
      'asset-1',
    );
    expect(outputs[0]).toMatchObject({
      width: 1920,
      height: 1080,
      durationSeconds: 8,
      mimeType: 'video/mp4',
    });
    await expect(access(spoolPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
