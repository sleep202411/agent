/**
 * Every string the dialog renders, as a closed key list.
 *
 * The package ships no copy of its own — `apps/web` (i18next) and
 * `apps/studio` (next-intl) each own the wording in their own message
 * files and pass a `t` typed as `AuthTranslate`. Because the key type is
 * a union, a typo or a key the package added later fails to compile at
 * the call site instead of rendering a raw key in production.
 *
 * The union is DERIVED from the runtime array so the two can never
 * drift, and apps can use the array to assert their message file covers
 * the whole surface (see README § Wiring `t`).
 */

export const AUTH_TRANSLATION_KEYS = [
  // Shell
  "close",
  "back",
  "busy",

  // Step 1 — identifier
  "identifierTitle",
  "identifierSubtitle",
  "identifierLabel",
  "identifierPlaceholder",
  "continue",
  "usePasswordInstead",

  // Step 2 — code
  "codeTitle",
  /** vars: `{account}` — already masked by the package. */
  "codeSubtitle",
  "codeInputLabel",
  /** vars: `{index}` — 1-based, for the per-cell accessible name. */
  "codeCellLabel",
  "codeEditIdentifier",
  "codeResend",
  /** vars: `{seconds}` */
  "codeResendCountdown",
  "codeSent",
  "verify",

  // Secondary entry — password (legacy accounts, never auto-registers)
  "passwordTitle",
  /** vars: `{account}` */
  "passwordSubtitle",
  "passwordLabel",
  "passwordPlaceholder",
  "passwordShow",
  "passwordHide",
  "signIn",
  "useCodeInstead",
  /** Reset entry point. Shown ONLY in the password step. */
  "forgotPassword",

  // Password reset — identifier → code → new password → signed in
  "resetTitle",
  "resetSubtitle",
  "resetPasswordTitle",
  /** vars: `{account}` */
  "resetPasswordSubtitle",
  "newPasswordLabel",
  "newPasswordPlaceholder",
  "confirmPasswordLabel",
  "confirmPasswordPlaceholder",
  "resetSubmit",

  // Step 3 — profile (new accounts only)
  "profileTitle",
  "profileSubtitle",
  "avatarLabel",
  "avatarChange",
  "avatarUploading",
  "nicknameLabel",
  "nicknamePlaceholder",
  "profileSubmit",
  "skip",

  // Step 4 — invite (new accounts only)
  "inviteTitle",
  "inviteSubtitle",
  "inviteLabel",
  "inviteOptionalHint",
  "continueWithoutInvite",
  "invitePlaceholder",
  "inviteSubmit",

  // Errors — one per AuthErrorCode
  "errorIdentifierRequired",
  "errorIdentifierInvalid",
  "errorCodeRequired",
  "errorPasswordRequired",
  "errorPasswordTooShort",
  "errorPasswordMismatch",
  "errorNicknameRequired",
  "errorInviteCodeRequired",
  "errorAvatarNotAnImage",
  "errorResendCooldown",
  "errorCodeIncorrect",
  "errorCodeExpired",
  "errorCredentialsIncorrect",
  "errorAccountNotFound",
  "errorAccountDisabled",
  "errorRateLimited",
  "errorPasswordRejected",
  "errorInviteCodeInvalid",
  "errorNetwork",
  "errorInvalidResponse",
  "errorTokenMissing",
  "errorSessionUnverified",
  "errorServer",
] as const;

export type AuthTranslationKey = (typeof AUTH_TRANSLATION_KEYS)[number];

/**
 * Both i18n stacks in this repo expose exactly this signature —
 * next-intl's `useTranslations(ns)` natively, i18next through
 * `apps/web/src/i18n/i18n.ts`'s wrapper — so neither app needs an adapter.
 */
export type AuthTranslate = (
  key: AuthTranslationKey,
  vars?: Record<string, string | number>
) => string;
