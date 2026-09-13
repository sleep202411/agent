import { CURRENT_CELL } from '../../common/region/current-cell';
import type { Cell } from '../../common/region/region.types';
import type { StorageProviderId } from './storage.types';

export function outputStorageProviderForCell(
  cell: Cell,
  override = '',
): StorageProviderId {
  if (
    override &&
    !['aliyun_oss', 's3_compatible', 'azure_blob'].includes(override)
  ) {
    throw new Error(`Unknown OUTPUT_STORAGE_PROVIDER "${override}"`);
  }
  if (cell === 'cn' && override && override !== 'aliyun_oss') {
    throw new Error('The CN cell requires OUTPUT_STORAGE_PROVIDER=aliyun_oss');
  }
  return (override ||
    (cell === 'cn' ? 'aliyun_oss' : 's3_compatible')) as StorageProviderId;
}

export const OUTPUT_STORAGE_PROVIDER = outputStorageProviderForCell(
  CURRENT_CELL,
  process.env.OUTPUT_STORAGE_PROVIDER?.trim(),
);
