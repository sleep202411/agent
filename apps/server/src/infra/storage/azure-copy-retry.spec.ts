import { AzureBlobStorageService } from './azure-blob-storage.service';

const original = { bucket: 'public', storageKey: 'clip.mp4' };
const quarantine = { bucket: 'quarantine', storageKey: 'clip.mp4' };
function fixture() {
  const getProperties = jest.fn().mockResolvedValue({ copyStatus: 'pending' });
  const deleteIfExists = jest.fn().mockResolvedValue({ succeeded: true });
  const beginCopyFromURL = jest.fn();
  const service = Object.create(
    AzureBlobStorageService.prototype,
  ) as AzureBlobStorageService;
  Object.assign(service, {
    service: {},
    quarantineContainer: 'quarantine',
    containerClient: () => ({
      getBlobClient: () => ({
        exists: jest.fn().mockResolvedValue(true),
        getProperties,
        deleteIfExists,
        beginCopyFromURL,
      }),
    }),
  });
  return {
    service,
    getProperties,
    deleteIfExists,
    beginCopyFromURL,
  };
}

describe.each(['restrict', 'restore'] as const)(
  '%s copy retry boundaries',
  (operation) => {
    const invoke = (s: AzureBlobStorageService) =>
      operation === 'restrict'
        ? s.restrictObject(original)
        : s.restoreObject(quarantine, original);
    it.each(['pending', 'failed', 'aborted'])(
      'rejects %s, retains source, then converges on success',
      async (copyStatus) => {
        const f = fixture();
        f.getProperties.mockResolvedValue({ copyStatus });
        await expect(invoke(f.service)).rejects.toMatchObject({
          response: { code: 'AZURE_BLOB_COPY_INCOMPLETE' },
        });
        expect(f.deleteIfExists).not.toHaveBeenCalled();
        f.getProperties.mockResolvedValue({ copyStatus: 'success' });
        await expect(invoke(f.service)).resolves.toMatchObject({
          relocated: true,
        });
        expect(f.deleteIfExists).toHaveBeenCalledTimes(1);
        expect(f.beginCopyFromURL).not.toHaveBeenCalled();
      },
    );
    it('propagates property-read errors and preserves source', async () => {
      const f = fixture();
      const error = new Error('destination properties unavailable');
      f.getProperties.mockRejectedValue(error);
      await expect(invoke(f.service)).rejects.toBe(error);
      expect(f.deleteIfExists).not.toHaveBeenCalled();
    });
    it('retries a failed source deletion only after rechecking the completed copy', async () => {
      const f = fixture();
      f.getProperties.mockResolvedValue({ copyStatus: 'success' });
      f.deleteIfExists.mockRejectedValueOnce(new Error('delete interrupted'));
      await expect(invoke(f.service)).rejects.toThrow('delete interrupted');
      await expect(invoke(f.service)).resolves.toMatchObject({
        relocated: true,
      });
      expect(f.getProperties).toHaveBeenCalledTimes(2);
      expect(f.deleteIfExists).toHaveBeenCalledTimes(2);
      expect(f.beginCopyFromURL).not.toHaveBeenCalled();
    });
  },
);
