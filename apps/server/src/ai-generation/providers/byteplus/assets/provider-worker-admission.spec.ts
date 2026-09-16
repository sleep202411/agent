import { CharacterProviderSyncService } from './character-provider-sync.service';
import { MediaAssetProviderSyncService } from './media-asset-provider-sync.service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

for (const kind of ['character', 'media'] as const) {
  describe(`${kind} provider worker admission`, () => {
    function fixture() {
      const findUnique = jest.fn();
      const getAsset = jest.fn().mockResolvedValue({ Status: 'Active' });
      const args = [
        {
          aiProviderExternalAsset: { findUnique },
          aiProviderMediaAssetMirror: { findUnique },
        } as never,
        {} as never,
        { getAsset } as never,
        {} as never,
      ] as const;
      const service =
        kind === 'character'
          ? new CharacterProviderSyncService(...args)
          : new MediaAssetProviderSyncService(...args);
      const worker = service as unknown as {
        processAssetsJob(job: object): Promise<void>;
        transition(row: unknown, status: string, patch: object): Promise<void>;
      };
      const transition = jest.spyOn(worker, 'transition').mockResolvedValue();
      const job = {
        data: { op: 'poll', mirrorId: 'mirror', externalAssetRowId: 'mirror' },
      };
      return { service, worker, findUnique, getAsset, transition, job };
    }
    it.each(['pending', 'active', 'failed', 'disabled', 'deleted'])(
      'does not poll %s mirrors',
      async (status) => {
        const f = fixture();
        f.findUnique.mockResolvedValue({
          status,
          externalAssetId: 'provider',
          assetGroup: { status: 'active' },
        });
        await f.worker.processAssetsJob(f.job);
        expect(f.getAsset).not.toHaveBeenCalled();
        expect(f.transition).not.toHaveBeenCalled();
      },
    );
    it('continues a current processing mirror', async () => {
      const f = fixture();
      f.findUnique.mockResolvedValue({
        status: 'processing',
        externalAssetId: 'provider',
        assetGroup: { status: 'active' },
      });
      await f.worker.processAssetsJob(f.job);
      expect(f.getAsset).toHaveBeenCalledWith('provider');
      expect(f.transition).toHaveBeenCalledTimes(1);
    });
    it('stops a candidate read that returns after shutdown', async () => {
      const f = fixture();
      const read = deferred<object>();
      f.findUnique.mockReturnValue(read.promise);
      const pending = f.worker.processAssetsJob(f.job);
      await f.service.onApplicationShutdown();
      read.resolve({
        status: 'processing',
        externalAssetId: 'provider',
        assetGroup: { status: 'active' },
      });
      await pending;
      expect(f.getAsset).not.toHaveBeenCalled();
      await f.worker.processAssetsJob(f.job);
      expect(f.findUnique).toHaveBeenCalledTimes(1);
    });
  });
}
