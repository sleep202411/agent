import { ForbiddenException } from '@nestjs/common';
import {
  ADMIN_PERMISSION_KEYS,
  ADMIN_ROLE_KEYS,
} from '../admin-auth/admin-auth.constants';
import type { AdminActor } from '../admin-auth/admin-auth.types';

const ACTOR_UPLOAD_KIND = 'ai_reference_image';

export function adminMayUploadMediaKind(
  admin: AdminActor,
  kind: string,
): boolean {
  if (admin.roleKeys?.includes(ADMIN_ROLE_KEYS.SuperAdmin)) return true;
  const granted = new Set(admin.permissions);
  if (granted.has(ADMIN_PERMISSION_KEYS.MediaRead)) return true;
  return (
    kind === ACTOR_UPLOAD_KIND &&
    granted.has(ADMIN_PERMISSION_KEYS.AiActorsWrite)
  );
}

export function assertAdminMayUploadMediaKind(
  admin: AdminActor,
  kind: string,
): void {
  if (adminMayUploadMediaKind(admin, kind)) return;
  throw new ForbiddenException({
    code: 'ADMIN_PERMISSION_DENIED',
    msg: '当前后台账号没有执行该操作的权限。',
  });
}
