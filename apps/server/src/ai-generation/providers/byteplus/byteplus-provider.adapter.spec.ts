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

describe('BytePlus video task failure mapping', () => {
  async function pollFailedTask(task: Record<string, unknown>) {
    const { adapter } = adapterWith(task);
    const start = await adapter.startGeneration(
      'seedance-2-5',
      { prompt: 'Extend Video 1 with a storm rolling in.' },
      { jobId: 'job-failure' } as never,
    );
    if (start.kind !== 'pending') throw new Error('Expected pending task');
    const poll = await adapter.pollStatus(start.providerJobId);
    if (poll.kind !== 'failed') throw new Error('Expected failed task');
    return poll.error;
  }

  it('maps TaskTypeConstraint to a terminal validation error with the upstream rule verbatim', async () => {
    const error = await pollFailedTask({
      status: 'failed',
      error: {
        code: 'InvalidParameter.TaskTypeConstraint',
        message:
          'Video editing tasks require ratio=adaptive and duration=-1; got ratio=16:9.',
      },
    });
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.retryable).toBe(false);
    expect(error.userMessage).toBe(
      'Video editing tasks require ratio=adaptive and duration=-1; got ratio=16:9.',
    );
  });

  it('maps TaskTypeMismatch to a terminal validation error with actionable guidance appended', async () => {
    const error = await pollFailedTask({
      status: 'failed',
      error: {
        code: 'InvalidParameter.TaskTypeMismatch',
        message: 'The task was judged as reference-to-video, not edit.',
      },
    });
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.retryable).toBe(false);
    expect(error.userMessage).toContain(
      'The task was judged as reference-to-video, not edit.',
    );
    expect(error.userMessage).toContain('switch the task type to Auto');
  });

  it('detects the task-type codes from the message alone when the code field is absent', async () => {
    const error = await pollFailedTask({
      status: 'failed',
      error: {
        message: 'InvalidParameter.TaskTypeMismatch: prompt intent mismatch',
      },
    });
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.retryable).toBe(false);
  });

  it('surfaces stable copy for cancelled tasks instead of the raw task JSON', async () => {
    const error = await pollFailedTask({ status: 'cancelled' });
    expect(error.code).toBe('CANCELLED_BY_USER');
    expect(error.retryable).toBe(false);
    expect(error.userMessage).toBe('This generation was cancelled.');
  });

  it('marks expired tasks as a retryable provider timeout', async () => {
    const error = await pollFailedTask({ status: 'expired' });
    expect(error.code).toBe('PROVIDER_TIMEOUT');
    expect(error.retryable).toBe(true);
    expect(error.userMessage).not.toMatch(/^\{/);
  });

  it('falls back to generic copy when a failed task has no error payload', async () => {
    const error = await pollFailedTask({ status: 'failed' });
    expect(error.code).toBe('UNKNOWN');
    expect(error.retryable).toBe(true);
    expect(error.userMessage).toBe('Generation failed. Please try again.');
  });
});

describe('Seedance async task continuity', () => {
  it('polls the same accepted task through queued and running to completed without resubmission', async () => {
    const { adapter, client } = adapterWith({});
    client.getVideoTask
      .mockResolvedValueOnce({ body: { status: 'queued' } })
      .mockResolvedValueOnce({ body: { status: 'running' } })
      .mockResolvedValueOnce({
        body: {
          status: 'succeeded',
          content: { video_url: 'https://cdn.example.com/result.mp4' },
        },
      });
    const start = await adapter.startGeneration(
      'seedance-2-5',
      { prompt: 'A harbor.' },
      { jobId: 'continuity' } as never,
    );
    if (start.kind !== 'pending') throw new Error('Expected accepted task');
    await expect(
      adapter.pollStatus(start.providerJobId),
    ).resolves.toMatchObject({ kind: 'pending', progress: 0.2 });
    await expect(
      adapter.pollStatus(start.providerJobId),
    ).resolves.toMatchObject({ kind: 'pending', progress: 0.55 });
    await expect(
      adapter.pollStatus(start.providerJobId),
    ).resolves.toMatchObject({
      kind: 'completed',
      outputs: [
        expect.objectContaining({
          providerUrl: 'https://cdn.example.com/result.mp4',
        }),
      ],
    });
    expect(client.createVideoTask).toHaveBeenCalledTimes(1);
    expect(client.getVideoTask).toHaveBeenCalledTimes(3);
    for (let call = 1; call <= 3; call++)
      expect(client.getVideoTask).toHaveBeenNthCalledWith(call, {}, 'task-25');
  });
});
it('classifies asynchronous overdue-account failures as non-retryable configuration', async () => {
  const { adapter } = adapterWith({
    status: 'failed',
    error: { code: 'AccountOverdueError', message: 'overdue balance' },
  });
  expect(
    await adapter.pollStatus(
      'dreamina-seedance-2-5-260628::task-25::no-video-input',
    ),
  ).toMatchObject({
    kind: 'failed',
    error: { code: 'PROVIDER_NOT_CONFIGURED', retryable: false },
  });
});
