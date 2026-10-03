import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../auth';
import { AiGenerationService } from './ai-generation.service';
import type { AiJob, AiSubmitJobBody } from './types';

function harness() {
  const original: AiJob = {
    id: 'original',
    modelId: 'chosen-model',
    schemaVersion: 'schema-1',
    userId: 'owner',
    status: 'failed',
    workspaceId: 'workspace',
    normalizedInput: { prompt: 'Reviewed prompt' },
    logs: [],
    type: 'image',
    provider: 'fixture',
    deployment: 'fixture',
    canonicalModelId: null,
    providerBindingId: null,
    stage: 'failed',
    input: { prompt: 'Reviewed prompt' },
    prompt: 'Reviewed prompt',
    idempotencyKey: 'original-key',
    outputs: [],
    queueName: 'ai-image-generation',
    queuePosition: 0,
    attempt: 1,
    createdAt: '2026-10-03T00:00:00Z',
    queuedAt: '2026-10-03T00:00:00Z',
    updatedAt: '2026-10-03T00:00:00Z',
    metrics: {},
  };
  const rows = new Map<string, AiJob>();
  const access = jest.fn(() => Promise.resolve(original));
  const submit = jest.fn((_user: AuthUser, body: AiSubmitJobBody) => {
    const key = body.idempotencyKey!;
    if (!rows.has(key))
      rows.set(key, {
        ...original,
        id: 'replacement',
        retryOfJobId: original.id,
        idempotencyKey: key,
        status: 'in_queue',
        stage: 'queued',
      });
    return Promise.resolve({ request_id: rows.get(key)!.id });
  });
  const service = Object.assign(Object.create(AiGenerationService.prototype), {
    getEditableJob: access,
    store: {
      findRetryForJob: jest.fn((_owner: string, parent: string) =>
        Promise.resolve(
          [...rows.values()].find((row) => row.retryOfJobId === parent),
        ),
      ),
      findByIdempotency: jest.fn(
        (_owner: string, _model: string, key: string) =>
          Promise.resolve(rows.get(key)),
      ),
    },
    submitJob: submit,
  }) as AiGenerationService;
  return { service, original, rows, access, submit };
}
const owner = { userId: 'owner' } as AuthUser;

describe('generation retry recovery', () => {
  it('recovers a historical retry created with a random key before the fix', async () => {
    const h = harness();
    h.rows.set('old-random-key', {
      ...h.original,
      id: 'historical-replacement',
      retryOfJobId: 'original',
      idempotencyKey: 'old-random-key',
    });
    await expect(h.service.retryJob(owner, 'original')).resolves.toMatchObject({
      request_id: 'historical-replacement',
    });
    expect(h.submit).not.toHaveBeenCalled();
  });

  it('recovers an accepted retry after a lost response without submitting or charging again', async () => {
    const h = harness();
    const accept = h.submit.getMockImplementation()!;
    h.submit.mockImplementationOnce(async (...args) => {
      await accept(...args);
      throw new Error('Response lost after acceptance');
    });
    await expect(h.service.retryJob(owner, 'original')).rejects.toThrow(
      'Response lost',
    );
    await expect(h.service.retryJob(owner, 'original')).resolves.toMatchObject({
      request_id: 'replacement',
    });
    expect(h.submit).toHaveBeenCalledTimes(1);
    expect(h.access).toHaveBeenCalledTimes(2);
  });

  it('uses the same repository reservation key for concurrent retries and a new key for the next failed attempt', async () => {
    const h = harness();
    await Promise.all([
      h.service.retryJob(owner, 'original'),
      h.service.retryJob(owner, 'original'),
    ]);
    expect(h.rows.size).toBe(1);
    expect(
      new Set(h.submit.mock.calls.map(([, body]) => body.idempotencyKey)).size,
    ).toBe(1);
    h.original.id = 'replacement';
    await h.service.retryJob(owner, 'replacement');
    expect(h.rows.size).toBe(2);
  });

  it.each(['in_queue', 'in_progress', 'completed'] as const)(
    'does not create a retry for a %s job',
    async (status) => {
      const h = harness();
      h.original.status = status;
      await expect(
        h.service.retryJob(owner, 'original'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(h.submit).not.toHaveBeenCalled();
    },
  );

  it('rechecks permissions before returning a previously accepted retry', async () => {
    const h = harness();
    await h.service.retryJob(owner, 'original');
    h.access.mockRejectedValueOnce(
      new ForbiddenException('Membership revoked'),
    );
    await expect(h.service.retryJob(owner, 'original')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(h.submit).toHaveBeenCalledTimes(1);
  });

  it('retains the original model, reviewed input, scope and trusted retry lineage', async () => {
    const h = harness();
    await h.service.retryJob(owner, 'original');
    expect(h.submit).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({
        modelId: 'chosen-model',
        schemaVersion: 'schema-1',
        workspaceId: 'workspace',
        input: { prompt: 'Reviewed prompt' },
      }),
      undefined,
      expect.objectContaining({ retryOfJobId: 'original' }),
    );
  });
});
