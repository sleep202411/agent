import { MediaStorageProvider } from '@prisma/client';
import type { Cell } from '../../common/region/region.types';

export const CREW_ASSET_MAX_BYTES = 5 * 1024 * 1024 * 1024;

export function crewAssetStorageProviderForCell(
  cell: Cell,
): MediaStorageProvider {
  return cell === 'cn'
    ? MediaStorageProvider.aliyun_oss
    : MediaStorageProvider.s3_compatible;
}
