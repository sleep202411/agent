import { ForbiddenException } from '@nestjs/common';
import { ADMIN_PERMISSION_KEYS, type AdminActor } from '../admin-auth';
import { CURRENT_CELL } from '../common/region/current-cell';

export function requireRevenueAdmin(admin: AdminActor) {
  if (
    !admin?.id ||
    admin.id.length > 58 ||
    admin.status !== 'active' ||
    !admin.permissions.includes(ADMIN_PERMISSION_KEYS.CreatorRevenueManage) ||
    (admin.siteScope !== 'all' &&
      admin.siteScope !== (CURRENT_CELL === 'cn' ? 'cn' : 'global'))
  )
    throw new ForbiddenException(
      'Creator revenue management permission is required.',
    );
}
