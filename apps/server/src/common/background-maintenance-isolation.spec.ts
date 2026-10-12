import { WithdrawalProofsService } from '../creator-withdrawals/withdrawal-proofs.service';
import { RevenueContractsService } from '../creator-withdrawals/revenue-contracts.service';
import { CdnPurgeWorkerService } from '../media/cdn-purge-worker.service';
import { MediaProcessingWorkerService } from '../media/media-processing-worker.service';
import { MediaTakedownWorkerService } from '../media/media-takedown-worker.service';
import { EpisodeUploadService } from '../media/episode-upload.service';
import { CrewAssetUploadCleanupWorker } from '../crews/assets/upload-cleanup.worker';
import { CrewAgreementSendWorker } from '../crews/agreements/agreement-send.worker';
import { CrewAgreementArchiveWorker } from '../crews/agreements/agreement-archive.worker';
import { CrewTaskOverdueWorker } from '../crews/tasks/task-overdue.worker';
import { CopilotQuotaService } from '../copilot/copilot-quota.service';
import { CreatorGeocodingService } from '../creator-services/creator-geocoding';
import { ContentGpsGeocodingService } from '../ip-commerce/content-gps-geocoding';
import { AlertingService } from './alerting/alerting.service';
import { AdminAuthService } from '../admin-auth/admin-auth.service';

const workers = [
  [WithdrawalProofsService, 'onApplicationBootstrap', 'drainCleanup'],
  [RevenueContractsService, 'onApplicationBootstrap', 'drainCleanup'],
  [CdnPurgeWorkerService, 'onApplicationBootstrap', 'drainOnce'],
  [MediaProcessingWorkerService, 'onApplicationBootstrap', 'drainOnce'],
  [MediaTakedownWorkerService, 'onApplicationBootstrap', 'drainOnce'],
  [EpisodeUploadService, 'onModuleInit', 'sweepExpired'],
  [CrewAssetUploadCleanupWorker, 'onApplicationBootstrap', 'drainOnce'],
  [CrewAgreementSendWorker, 'onApplicationBootstrap', 'drainOnce'],
  [CrewAgreementArchiveWorker, 'onApplicationBootstrap', 'drainOnce'],
  [CrewTaskOverdueWorker, 'onApplicationBootstrap', 'drainOnce'],
  [CopilotQuotaService, 'onModuleInit', 'drainPendingAttempts'],
] as const;

describe('paused background maintenance', () => {
  const original = process.env.BACKGROUND_TASKS_ENABLED;

  beforeEach(() => {
    process.env.BACKGROUND_TASKS_ENABLED = 'false';
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    if (original === undefined) delete process.env.BACKGROUND_TASKS_ENABLED;
    else process.env.BACKGROUND_TASKS_ENABLED = original;
  });

  it.each(workers)(
    '%p cannot start, sweep directly or resume after shutdown',
    async (Service, bootstrap, drain) => {
      // Real constructors and entry points; any dependency access is an error,
      // so even a metadata read or provider-enabled check fails this boundary.
      const accessed = jest.fn(() => {
        throw new Error('A paused worker touched a dependency');
      });
      const dependency = new Proxy({}, { get: accessed });
      const service = Reflect.construct(
        Service,
        Array(Service.length).fill(dependency),
      ) as Record<string, () => unknown>;

      await service[bootstrap]();
      await service[drain]();
      jest.advanceTimersByTime(120_000);
      await service.onModuleDestroy?.();
      await service.onApplicationShutdown?.();
      await service[bootstrap]();
      await service[drain]();
      expect(accessed).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it.each([CreatorGeocodingService, ContentGpsGeocodingService])(
    '%p does not clean database records on startup',
    (Service) => {
      const write = jest.fn();
      const service = Reflect.construct(Service, [
        { $executeRaw: write },
        {},
      ]) as { onModuleInit(): void; onModuleDestroy(): void };
      service.onModuleInit();
      jest.advanceTimersByTime(120_000);
      service.onModuleDestroy();
      expect(write).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('does not send operational alerts or consume shared dedupe keys', async () => {
    const dedupe = jest.fn();
    const fetchSpy = jest.spyOn(global, 'fetch');
    const service = new AlertingService({ set: dedupe } as never);
    const event = {
      kind: 'application.error',
      source: 'migration-validation',
      severity: 'error',
      title: 'Fixture failure',
    } as Parameters<AlertingService['notify']>[0];
    try {
      service.notify(event);
      await service.dispatch(event);
      expect(dedupe).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('does not seed or overwrite copied admin accounts on startup', async () => {
    const accessed = jest.fn(() => {
      throw new Error('Paused admin bootstrap touched the database');
    });
    const service = new AdminAuthService(
      new Proxy({}, { get: accessed }) as never,
    );
    await service.onModuleInit();
    expect(accessed).not.toHaveBeenCalled();
  });
});
