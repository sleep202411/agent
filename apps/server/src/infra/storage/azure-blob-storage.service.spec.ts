import { AzureBlobStorageService } from './azure-blob-storage.service';

describe(AzureBlobStorageService.name, () => {
  const previousConnectionString = process.env.AZURE_BLOB_CONNECTION_STRING;

  afterEach(() => {
    if (previousConnectionString === undefined) {
      delete process.env.AZURE_BLOB_CONNECTION_STRING;
    } else {
      process.env.AZURE_BLOB_CONNECTION_STRING = previousConnectionString;
    }
  });

  it('treats a whitespace-only connection string as unconfigured', async () => {
    process.env.AZURE_BLOB_CONNECTION_STRING = '   ';

    const service = new AzureBlobStorageService();

    await expect(service.isHealthy()).resolves.toBe(false);
  });
});
