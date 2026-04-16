/**
 * Authenticated user info attached to request by AuthGuard.
 *
 * Fields mirror the Java `/user/query/user/info` response.
 * When we migrate to direct Redis session lookup, only
 * AuthService.validateToken() changes — this type stays stable.
 */
export interface AuthUser {
  userId: string;
  userName?: string;
  nickName?: string;
  email?: string;
  phone?: string;
  headImg?: string;
  userLevel?: string; // "free" | "pro" | "enterprise" etc.
}

/**
 * Express Request augmented with auth info.
 */
export interface AuthenticatedRequest extends Request {
  user: AuthUser;
  /** Raw cookie string forwarded from the client */
  rawCookie: string;
}
