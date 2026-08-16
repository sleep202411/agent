import { access, readFile } from 'node:fs/promises';
import { AiGenerationWorkerService } from './worker.service';

describe('AiGenerationWorkerService audio output truth', () => {
  it('probes exact spooled bytes and persists measured audio metadata', async () => {
    let spoolPath = '';
    const store = {
      createAiOutputAsset: jest.fn().mockResolvedValue('asset-audio-1'),
    };
    const storage = {
      uploadFromFile: jest.fn(async (input: { filePath: string }) => {
        await expect(readFile(input.filePath)).resolves.toEqual(
          Buffer.from('provider-audio-bytes'),
        );
        return {
          url: 'https://media.example.test/audio.mp3',
          provider: 's3_compatible',
          bucket: 'media',
          region: 'auto',
          storagePath: 'outputs/audio.mp3',
          bytes: 20,
        };
      }),
    };
    const audioProbe = {
      probeFile: jest.fn(async (filePath: string) => {
        spoolPath = filePath;
        await expect(readFile(filePath)).resolves.toEqual(
          Buffer.from('provider-audio-bytes'),
        );
        return {
          durationMs: 4321,
          durationSeconds: 4,
          durationSecondsExact: 4.321,
          contentType: 'audio/mpeg',
          fileExtension: 'mp3',
          audioCodec: 'mp3',
          sampleRate: 24000,
          channels: 1,
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
      {} as never,
      audioProbe as never,
      {} as never,
    );
    const workerInternals = worker as unknown as {
      uploadOutputs: (
        job: Record<string, unknown>,
        outputs: Array<Record<string, unknown>>,
      ) => Promise<
        Array<{
          durationSeconds?: number;
          mimeType: string;
        }>
      >;
    };

    const outputs = await workerInternals.uploadOutputs(
      {
        id: 'job-audio-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        type: 'audio',
        provider: 'byteplus-seed-speech',
        modelId: 'seed-tts-2-0',
        deployment: 'seed-tts-2.0',
        canonicalModelId: 'canonical-audio',
        providerBindingId: 'binding-audio',
        createdAt: '2026-08-13T12:00:00.000Z',
      },
      [
        {
          index: 0,
          type: 'audio',
          buffer: Buffer.from('provider-audio-bytes'),
          mimeType: 'application/octet-stream',
          ext: 'bin',
        },
      ],
    );

    expect(storage.uploadFromFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: spoolPath,
        contentType: 'audio/mpeg',
        filename: 'job-audio-1-0.mp3',
      }),
    );
    expect(store.createAiOutputAsset).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'job-audio-1' }),
      expect.objectContaining({
        type: 'audio',
        contentType: 'audio/mpeg',
        durationMs: 4321,
        durationSeconds: 4,
        audioMetadata: {
          audioCodec: 'mp3',
          sampleRate: 24000,
          channels: 1,
        },
      }),
    );
    expect(mediaAssetReadiness.enqueueAutomaticChecks).toHaveBeenCalledWith(
      'asset-audio-1',
    );
    expect(outputs[0]).toMatchObject({
      durationSeconds: 4,
      mimeType: 'audio/mpeg',
    });
    await expect(access(spoolPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
