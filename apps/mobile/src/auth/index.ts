export { AuthProvider } from "./auth-provider";
export {
  cancelPendingAuthRequest,
  completeAuthSheet,
  openAuthSheet,
  releasePendingAuthRequest,
  requireAuthenticated,
  skipAuthSheet,
} from "./auth-sheet";
export { useAuth } from "./use-auth";
export { useAuthGate, useLoginGateOnFocus } from "./use-auth-gate";
export {
  clearAuthSession,
  clearIsNewUserFlag,
  continueWithCode,
  getAuthSnapshot,
  hydrateAuthSession,
  refreshCurrentUser,
  resetPasswordAndSignIn,
  saveAccountPassword,
  saveOnboardingNickname,
  signIn,
  signOut,
  submitInviteCode,
} from "./auth-store";
export {
  isEmailIdentifier,
  isValidAccountPassword,
  maskIdentifier,
  normalizeIdentifier,
  resetPasswordWithIdentifier,
  sendLoginCode,
  sendResetCode,
  sendVerificationCode,
  type NormalizedIdentifier,
} from "./auth-service";
export {
  armResendDeadline,
  hydrateResendClock,
  readResendDeadline,
  RESEND_COOLDOWN_SECONDS,
  secondsUntilResend,
} from "./resend-clock";
export {
  clearPendingCode,
  hydratePendingCode,
  readPendingCode,
  writePendingCode,
  type AuthCodeMode,
  type PendingCode,
} from "./pending-code";
export type { AuthSession, AuthState, AuthUser, SignInCredentials } from "./types";
