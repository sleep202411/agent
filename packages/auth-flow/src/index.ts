export { AuthDialog, errorText, type AuthDialogProps } from "./components/auth-dialog";
export { CodeInput } from "./components/code-input";

export {
  useAuthFlow,
  type AuthFlowActions,
  type AuthFlowAnalytics,
  type AuthFlowController,
  type AuthMethod,
  type UseAuthFlowOptions,
} from "./use-auth-flow";

export {
  addressesSentAccount,
  authFlowReducer,
  canDismiss,
  canGoBack,
  canResendCode,
  canSubmitCode,
  canSubmitIdentifier,
  canSubmitInvite,
  canSubmitNewPassword,
  canSubmitPassword,
  canSubmitProfile,
  createInitialState,
  isSessionEstablished,
  resumesSentCode,
  sanitizeCode,
  stepAfterLogin,
  validateIdentifier,
  CODE_LENGTH,
  DEFAULT_RESEND_SECONDS,
  DEFAULT_STEP_CONFIG,
  MIN_PASSWORD_LENGTH,
  type AuthFlowEvent,
  type AuthFlowState,
  type AuthMode,
  type AuthStep,
  type AuthStepConfig,
} from "./machine";

export {
  armResendDeadline,
  clearResendDeadline,
  readResendDeadline,
  secondsUntil,
} from "./resend-clock";

export {
  clearPendingCode,
  readPendingCode,
  writePendingCode,
  type PendingCode,
} from "./pending-code";

export { AuthClient, AuthRequestError, toAuthError } from "./client";

export {
  createFetchTransport,
  isJsonObject,
  AuthTransportError,
  type AuthRequest,
  type AuthResponse,
  type AuthTransport,
  type FetchTransportOptions,
} from "./transport";

export { maskIdentifier, normalizeIdentifier } from "./identifier";

export {
  clearSessionCookie,
  persistSessionCookie,
  readEnvelope,
  readIsNewUser,
  readSessionToken,
  readUserId,
  SESSION_COOKIE_NAME,
  type JavaEnvelope,
} from "./session";

export {
  authError,
  authErrorTranslationKey,
  mapServerMessage,
  type AuthError,
  type AuthErrorCode,
  type AuthOperation,
} from "./errors";

export { AUTH_TRANSLATION_KEYS, type AuthTranslate, type AuthTranslationKey } from "./keys";

export type { AuthSession, IdentifierKind, NormalizedIdentifier, SessionToken } from "./types";
