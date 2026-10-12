import { ForbiddenException } from '@nestjs/common';
import { ADMIN_PERMISSION_KEYS } from '../admin-auth/admin-auth.constants';
import {
  adminMayUploadMediaKind,
  assertAdminMayUploadMediaKind,
} from './admin-media-permissions';
import type { AdminActor } from '../admin-auth/admin-auth.types';

function actor(permissions: string[], roleKeys: string[] = []): AdminActor {
  return {
    id: 'admin-1',
    email: 'ops@example.com',
    displayName: 'Ops',
    status: 'active',
    siteScope: 'all',
    sessionId: 'session-1',
    roleKeys,
    requireMfa: false,
    permissions,
  };
}

it('lets AI-actor editors upload reference photos without media.read', () => {
  expect(
    adminMayUploadMediaKind(
      actor([ADMIN_PERMISSION_KEYS.AiActorsWrite]),
      'ai_reference_image',
    ),
  ).toBe(true);
});

it('does not let AI-actor editors upload other admin media kinds', () => {
  expect(
    adminMayUploadMediaKind(
      actor([ADMIN_PERMISSION_KEYS.AiActorsWrite]),
      'news_cover',
    ),
  ).toBe(false);
  expect(() =>
    assertAdminMayUploadMediaKind(
      actor([ADMIN_PERMISSION_KEYS.AiActorsWrite]),
      'news_cover',
    ),
  ).toThrow(ForbiddenException);
});

it('lets media readers upload any kind', () => {
  expect(
    adminMayUploadMediaKind(
      actor([ADMIN_PERMISSION_KEYS.MediaRead]),
      'news_cover',
    ),
  ).toBe(true);
});
