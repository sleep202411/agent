import type { Request } from 'express';

/**
 * Authenticated user info attached to request by AuthGuard.
 *
 * Fields mirror the Java `/user/query/user/info` response.
 * When we migrate to direct Redis session lookup, only
 * AuthService session validation changes — this type stays stable.
 */
export interface AuthUser {
  userId: string;
  userName?: string;
  nickName?: string;
  email?: string;
  phone?: string;
  headImg?: string;
  /** Java `user_level.id` values from `/user/query/user/info` `level`. */
  levelIds?: number[];
}

/** The selected user and their exact verified credential, for server use only. */
export interface AuthSessionContext {
  user: AuthUser;
  /** Sensitive: never serialize or log this credential. */
  cookie: string;
}

/**
 * Express Request augmented with auth info.
 */
export interface AuthenticatedRequest extends Request {
  user: AuthUser;
  /** Credential selected by AuthGuard for this authenticated user. */
  rawCookie: string;
}
