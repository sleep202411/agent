import { MediaAssetProviderSyncService } from './media-asset-provider-sync.service';
import { CharacterProviderSyncService } from './character-provider-sync.service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(
  Sync:
    | typeof CharacterProviderSyncService
    | typeof MediaAssetProviderSyncService,
) {
  const assets = jest.fn().mockResolvedValue([]);
  const groups = jest.fn().mockResolvedValue([]);
  const service = new Sync(
    {
      aiProviderExternalAsset: { findMany: assets },
      aiProviderMediaAssetMirror: { findMany: assets },
      aiProviderAssetGroup: { findMany: groups },
      aiProviderMediaAssetGroup: { findMany: groups },
    } as never,
    {
      config: { assetsPlaneEnabled: true, mediaAssetRegistrationEnabled: true },
    } as never,
    {} as never,
    {} as never,
  );
  const maintenance = service as unknown as {
    reconcileTeardowns(): Promise<void>;
    sweepStaleMirrors(): Promise<void>;
    reportBackpressure(): Promise<void>;
    transition(): Promise<void>;
    enqueueCriticalTeardown(args: {
      externalAssetIds: string[];
      externalGroupIds: string[];
    }): Promise<void>;
    queue(): { getWaitingCount(): Promise<number> };
  };
  const transition = jest.spyOn(maintenance, 'transition').mockResolvedValue();
  const teardown = jest
    .spyOn(maintenance, 'enqueueCriticalTeardown')
    .mockResolvedValue();
  const queue = jest
    .spyOn(maintenance, 'queue')
    .mockReturnValue({ getWaitingCount: () => Promise.resolve(0) });
  return { service, maintenance, assets, groups, transition, teardown, queue };
}
describe.each([CharacterProviderSyncService, MediaAssetProviderSyncService])(
  '%p maintenance shutdown',
  (Sync) => {
    it('rejects later sweep, teardown and metric starts', async () => {
      const f = fixture(Sync);
      await f.service.onApplicationShutdown();
      await f.maintenance.sweepStaleMirrors();
      await f.maintenance.reconcileTeardowns();
      await f.maintenance.reportBackpressure();
      expect(f.assets).not.toHaveBeenCalled();
      expect(f.groups).not.toHaveBeenCalled();
      expect(f.queue).not.toHaveBeenCalled();
    });
    it('stops reconciliation after an abandoned asset read', async () => {
      const f = fixture(Sync),
        read = deferred<unknown[]>();
      f.assets.mockReturnValue(read.promise);
      const running = f.maintenance.reconcileTeardowns();
      await f.service.onApplicationShutdown();
      read.resolve([{ externalAssetId: 'asset' }]);
      await running;
      expect(f.groups).not.toHaveBeenCalled();
      expect(f.teardown).not.toHaveBeenCalled();
    });
    it('does not enqueue teardown from a delayed group read', async () => {
      const f = fixture(Sync),
        read = deferred<unknown[]>();
      f.groups.mockReturnValue(read.promise);
      const running = f.maintenance.reconcileTeardowns();
      await Promise.resolve();
      expect(f.groups).toHaveBeenCalledTimes(1);
      await f.service.onApplicationShutdown();
      read.resolve([{ externalGroupId: 'group' }]);
      await running;
      expect(f.teardown).not.toHaveBeenCalled();
    });
    it('does not transition candidates returned after shutdown', async () => {
      const f = fixture(Sync),
        read = deferred<unknown[]>();
      f.assets.mockReturnValue(read.promise);
      const running = f.maintenance.sweepStaleMirrors();
      await f.service.onApplicationShutdown();
      read.resolve([{ id: 'a' }, { id: 'b' }]);
      await running;
      expect(f.transition).not.toHaveBeenCalled();
    });
    it('finishes the active transition without starting another candidate', async () => {
      const f = fixture(Sync),
        active = deferred<void>();
      f.assets.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      f.transition.mockReturnValueOnce(active.promise);
      const running = f.maintenance.sweepStaleMirrors();
      await Promise.resolve();
      expect(f.transition).toHaveBeenCalledTimes(1);
      await f.service.onApplicationShutdown();
      active.resolve();
      await running;
      expect(f.transition).toHaveBeenCalledTimes(1);
    });
  },
);
