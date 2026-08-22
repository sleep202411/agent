import {
  AiGenerationCompletionObserverRegistry,
  type AiGenerationCompletionObserver,
} from './completion-observer.service';
import type { AiJob } from './types';

describe('AiGenerationCompletionObserverRegistry', () => {
  it('notifies every registered observer and isolates projection failures', async () => {
    const registry = new AiGenerationCompletionObserverRegistry();
    const failed: AiGenerationCompletionObserver = {
      onAiGenerationCompleted: jest
        .fn()
        .mockRejectedValue(new Error('projection unavailable')),
    };
    const succeeded: AiGenerationCompletionObserver = {
      onAiGenerationCompleted: jest.fn().mockResolvedValue(undefined),
    };
    registry.register(failed);
    registry.register(succeeded);
    const job = { id: '11111111-1111-7111-9111-111111111111' } as AiJob;

    await expect(registry.notifyCompleted(job)).resolves.toBeUndefined();

    expect(failed.onAiGenerationCompleted).toHaveBeenCalledWith(job);
    expect(succeeded.onAiGenerationCompleted).toHaveBeenCalledWith(job);
  });

  it('supports unregistering an observer during module shutdown', async () => {
    const registry = new AiGenerationCompletionObserverRegistry();
    const observer: AiGenerationCompletionObserver = {
      onAiGenerationCompleted: jest.fn().mockResolvedValue(undefined),
    };
    const unregister = registry.register(observer);
    unregister();

    await registry.notifyCompleted({ id: 'job-1' } as AiJob);

    expect(observer.onAiGenerationCompleted).not.toHaveBeenCalled();
  });
});
