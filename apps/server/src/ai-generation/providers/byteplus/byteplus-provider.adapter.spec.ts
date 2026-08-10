import { BytePlusProviderAdapter } from './byteplus-provider.adapter';
import type { BytePlusImageRuntimeConfig } from './byteplus-runtime';

const runtime = {
  endpointId: 'dreamina-seedance-2-5-260628',
  type: 'video',
  enabled: true,
  outputPolicy: { watermark: false },
} as unknown as BytePlusImageRuntimeConfig;

function adapterWith(task: Record<string, unknown>) {
  const client = {
    createVideoTask: jest.fn().mockResolvedValue({
      status: 200,
      headers: {},
      body: { id: 'task-25' },
    }),
    getVideoTask: jest.fn().mockResolvedValue({ body: task }),
  };
  const adapter = new BytePlusProviderAdapter(
    { config: {} } as never,
    { getRuntimeConfig: jest.fn().mockResolvedValue(runtime) } as never,
    client as never,
    {} as never,
  );
  return { adapter, client };
}

describe('BytePlus Seedance 2.5 provider accounting', () => {
  it('persists the video-input class and prices actual completion tokens', async () => {
    const { adapter, client } = adapterWith({
      status: 'succeeded',
      content: { video_url: 'https://cdn.example.com/result.mov' },
      output_format: 'mov',
      duration: 5,
      usage: { completion_tokens: 108_900, total_tokens: 108_900 },
    });

    const start = await adapter.startGeneration(
      'seedance-2-5',
      {
        prompt: 'Follow Video 1 camera motion.',
        referenceVideos: [{ url: 'https://cdn.example.com/reference.mp4' }],
        outputFormat: 'mov',
      },
      { jobId: 'job-25' } as never,
    );

    expect(start.kind).toBe('pending');
    if (start.kind !== 'pending') throw new Error('Expected pending task');
    expect(start.providerJobId).toBe(
      'dreamina-seedance-2-5-260628::task-25::video-input',
    );
    expect(client.createVideoTask).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ output_format: 'mov' }),
    );

    const poll = await adapter.pollStatus(start.providerJobId);
    expect(poll.kind).toBe('completed');
    if (poll.kind !== 'completed') throw new Error('Expected completed task');
    expect(poll.outputs[0]).toMatchObject({
      mimeType: 'video/quicktime',
      ext: 'mov',
    });
    expect(poll.costAccounting).toMatchObject({
      billableUnits: 108_900,
      unitPrice: 6.4,
      inputClass: 'with_reference_video',
      providerCostUsd: 0.69696,
    });
  });

  it('uses the no-video token rate when the task has no video reference', async () => {
    const { adapter } = adapterWith({
      status: 'succeeded',
      content: { video_url: 'https://cdn.example.com/result.mp4' },
      duration: 5,
      usage: { completion_tokens: 108_900 },
    });

    const start = await adapter.startGeneration(
      'seedance-2-5',
      { prompt: 'A quiet harbor at dawn.' },
      { jobId: 'job-25-no-video' } as never,
    );
    if (start.kind !== 'pending') throw new Error('Expected pending task');

    const poll = await adapter.pollStatus(start.providerJobId);
    if (poll.kind !== 'completed') throw new Error('Expected completed task');
    expect(poll.costAccounting).toMatchObject({
      unitPrice: 10.7,
      inputClass: 'without_reference_video',
      providerCostUsd: 1.16523,
    });
  });
});
