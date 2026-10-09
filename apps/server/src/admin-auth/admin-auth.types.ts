import type { Request } from 'express';

export type AdminSiteScopeValue = 'global' | 'cn' | 'all';

export interface AdminActor {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  status: string;
  siteScope: AdminSiteScopeValue;
  /** Bound Web/Java user id for lecturer-scoped Academy tools; null for operators. */
  platformUserId?: string | null;
  sessionId: string;
  roleKeys: string[];
  requireMfa: boolean;
  mfaEnabledAt?: string | null;
  permissions: string[];
}

export interface AdminAuthenticatedRequest extends Request {
  admin?: AdminActor;
  adminSessionToken?: string;
}

export interface AdminRequestContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface AdminAuthResult {
  user: Omit<AdminActor, 'sessionId'>;
  session: {
    id: string;
    expiresAt: string;
  };
}
