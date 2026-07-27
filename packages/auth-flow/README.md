# @repo/auth-flow

Sign-in is **one experience** across FizzDragon. `apps/web` and `apps/studio`
render the same dialog — same steps, same markup, same look. This package owns
all of it; the apps inject only what genuinely differs: their translator, their
HTTP path space, and what happens after success.

## The flow

One "Continue" button, no register/login split:

1. **identifier** — one field, phone or email, auto-detected → `GET /user/new/getCode`
2. **code** — 6 cells, resend countdown, back-to-edit → `POST /user/new/login`
   (a brand-new account is created automatically; the response says `isNewUser`)
3. **profile** — avatar + nickname, skippable, new accounts only
4. **invite** — optional invite code, skippable, new accounts only

Secondary entry: **use password instead** (`type=pwd`) for legacy accounts. That
path never auto-registers, which is exactly why it is secondary.

### Password reset

Reached **only from the password step** — the code flow signs the same user in
without a password, so there is nothing there to have forgotten — or by opening
the dialog with `initialMode="reset"` (`apps/web`'s `/forgot-password` route).

1. **identifier** → `GET /user/getCode?phone=…` / `GET /user/email/getCode?email=…`
2. **code** — collected, not verified: Java has no endpoint that checks it alone
3. **reset_password** — new password + confirm, min 6 chars →
   `POST /user/reset/password` / `POST /user/email/reset/password`, which answers
   with a session envelope, so the user ends up **signed in holding a password
   they know**

These are the older, un-migrated endpoints — Java never folded reset into
`/user/new/*` — and they are exactly what the deleted `/forgot-password` page
spoke. A wrong code surfaces on submit and returns the user to the code step.

### The send-code cooldown

`getCode` is unauthenticated and bills a real SMS per call, so the cooldown is a
spend control. It is **one deadline, global to the browser tab** — not per
identifier — stored outside React in `resend-clock.ts` (`sessionStorage`, with an
in-memory mirror for Safari private mode). Nothing that re-enters the flow can
restart it: going back and editing the identifier, closing and reopening the
dialog, switching between the code / password / reset entries, or a full remount
all inherit the live deadline.

Per-identifier was rejected deliberately: the expensive abuse is spraying codes at
many numbers, and cycling the field is the cheapest possible bypass of a
per-identifier gate. Re-submitting the identifier a live code was already sent to
needs no send at all, so the common "let me re-read that" correction stays
instant; a **different** identifier inside the window is refused with
`resend_cooldown`, and the identifier step shows the countdown **only when
Continue would actually spend a send** — telling a user to wait for something
free is the one thing a countdown must never do.

"The identifier a live code was sent to" means the account **and** the mode. The
two modes ask different Java endpoints for their code and Java scopes each one to
the call that spends it, so a sign-in code cannot complete a reset; the reducer
records `sentMode` alongside the account and a mismatch is a real second send,
refused as one. Without it, `forgot password?` (which carries the identifier over
from the password step) resumed the sign-in code into the reset flow and dead-ended
the user for the rest of the window.

### Resuming a dismissed code

The cooldown surviving a close is what makes the flow spend-safe; it is also what
made the most ordinary first-run mistake fatal — the SMS lands, the user closes
the dialog to read it, reopens, and can neither enter the code nor ask for a new
one. So the fact that a code is outstanding survives the close too
(`pending-code.ts`): reopening lands back on the **code step**, on the account the
code went to, with nothing else from the previous attempt.

It is valid for exactly as long as the cooldown, because that window _is_ the
trap — once it lapses, Continue sends a fresh code and there is no dead end to
rescue anyone from. A longer window would also mean guessing Java's (undocumented)
code lifetime, and guessing long drops the user onto a code step holding an SMS
that may already be dead. A code the current mode cannot spend, or a host-supplied
`initialIdentifier` addressing a different account, is not resumed.

## Usage

```tsx
import { AuthDialog, createFetchTransport, type AuthTranslate } from "@repo/auth-flow";

const raw = useTranslations("auth"); // next-intl in studio, the i18next wrapper in web
const t: AuthTranslate = (key, vars) => raw(key, vars);

<AuthDialog
  open={open}
  onOpenChange={setOpen}
  t={t}
  transport={createFetchTransport({
    // apps/web only — its Java calls carry a per-cell path prefix.
    resolvePath: (path) => `${process.env.NEXT_PUBLIC_API_CONTENT_PREFIX ?? ""}${path}`,
    headers: () => ({ "accept-language": locale }),
  })}
  steps={{ profile: true, invite: true }}
  onSuccess={(session) => {
    // web: navigate to ?redirect= · studio: just close
    setOpen(false);
  }}
/>;
```

### `AuthDialogProps`

| Prop                | Type                                 | Notes                                                                    |
| ------------------- | ------------------------------------ | ------------------------------------------------------------------------ |
| `open`              | `boolean`                            | Closing resets the whole machine.                                        |
| `onOpenChange`      | `(open: boolean) => void`            | Called by Escape, the backdrop, and the close button.                    |
| `t`                 | `AuthTranslate`                      | Typed against the key union below.                                       |
| `transport`         | `AuthTransport`                      | How this app reaches Java. `createFetchTransport` is the reference impl. |
| `onSuccess`         | `(session: AuthSession) => void`     | Fires once, after the last enabled step.                                 |
| `steps`             | `Partial<AuthStepConfig>`            | `{ profile, invite }`, both default `true`.                              |
| `initialMode`       | `"signin" \| "reset"`                | Open straight into the reset flow. Defaults to `"signin"`.               |
| `verifySession`     | `() => Promise<boolean>`             | Optional post-login probe (studio: `/aurora/users/me`).                  |
| `resolveAvatarUrl`  | `(path: string) => string`           | Turns the stored avatar path into a URL (OSS base differs per app).      |
| `initialIdentifier` | `string`                             | Prefill.                                                                 |
| `initialInviteCode` | `string`                             | Prefill from `?recommendationCode=`.                                     |
| `resendCooldown`    | `number`                             | Seconds; defaults to 60.                                                 |
| `onEvent`           | `(event: AuthFlowAnalytics) => void` | `code_sent` / `signed_in` / `registered` / `profile_saved` / …           |
| `brand`             | `ReactNode`                          | Logo lockup above the title.                                             |
| `legal`             | `ReactNode`                          | Terms/privacy line — links are app-routed, so the app renders it.        |

### Also exported

- **Machine** (pure, unit-tested): `authFlowReducer`, `createInitialState`,
  `validateIdentifier`, `sanitizeCode`, `stepAfterLogin`, `addressesSentAccount`,
  `resumesSentCode`, the `canSubmit*` / `canDismiss` / `canGoBack` selectors,
  `CODE_LENGTH`, `MIN_PASSWORD_LENGTH`, `DEFAULT_RESEND_SECONDS`.
- **Hook**: `useAuthFlow` — the same machine plus the async calls and the
  countdown timer, for a host that wants its own chrome.
- **Cooldown clock**: `readResendDeadline`, `armResendDeadline`, `secondsUntil`
  (and `clearResendDeadline`, which exists for tests).
- **Outstanding code**: `readPendingCode`, `writePendingCode`, `clearPendingCode`,
  `PendingCode`.
- **Java client**: `AuthClient`, `AuthRequestError`, `toAuthError`.
- **Transport**: `createFetchTransport`, `AuthTransport`, `AuthRequest`,
  `AuthResponse`, `AuthTransportError`, `isJsonObject`.
- **Identifier**: `normalizeIdentifier`, `detectIdentifierKind`, `maskIdentifier`.
- **Session**: `readSessionToken`, `readEnvelope`, `readIsNewUser`, `readUserId`,
  `persistSessionCookie`, `clearSessionCookie`, `SESSION_COOKIE_NAME`.
- **Errors**: `AuthErrorCode`, `mapServerMessage`, `authErrorTranslationKey`.
- **Keys**: `AUTH_TRANSLATION_KEYS`, `AuthTranslationKey`, `AuthTranslate`.

## Wiring `t`

The package ships **no user-facing strings**. `AuthTranslationKey` is a closed
union derived from `AUTH_TRANSLATION_KEYS`, so a key the package adds later
fails to compile at the call site instead of rendering a raw key in production.

To also catch a _missing translation_, assert your message file against the list
once per app:

```ts
import { AUTH_TRANSLATION_KEYS, type AuthTranslationKey } from "@repo/auth-flow";
import en from "@/messages/en-US.json";

// Compile error if a key is missing from the `auth` namespace.
const _covered: Record<AuthTranslationKey, string> = en.auth;
void _covered;
void AUTH_TRANSLATION_KEYS;
```

### The full key list

Interpolation uses `{name}` in both stacks (next-intl natively; i18next is
configured with `{`/`}` delimiters in `apps/web/src/i18n/i18n.ts`).

| Key                          | Vars        | English reference copy                                      |
| ---------------------------- | ----------- | ----------------------------------------------------------- |
| `close`                      | —           | Close                                                       |
| `back`                       | —           | Back                                                        |
| `busy`                       | —           | Working…                                                    |
| `identifierTitle`            | —           | Sign in or create an account                                |
| `identifierSubtitle`         | —           | Enter your phone or email — we'll send you a code.          |
| `identifierLabel`            | —           | Phone or email                                              |
| `identifierPlaceholder`      | —           | you@example.com                                             |
| `continue`                   | —           | Continue                                                    |
| `usePasswordInstead`         | —           | Use password instead                                        |
| `codeTitle`                  | —           | Enter your code                                             |
| `codeSubtitle`               | `{account}` | We sent a 6-digit code to {account}.                        |
| `codeInputLabel`             | —           | Verification code                                           |
| `codeCellLabel`              | `{index}`   | Digit {index}                                               |
| `codeEditIdentifier`         | —           | Change                                                      |
| `codeResend`                 | —           | Resend code                                                 |
| `codeResendCountdown`        | `{seconds}` | Resend in {seconds}s                                        |
| `codeSent`                   | —           | Didn't get it? Check your spam folder.                      |
| `verify`                     | —           | Verify                                                      |
| `passwordTitle`              | —           | Sign in with password                                       |
| `passwordSubtitle`           | `{account}` | For accounts that already have a password.                  |
| `passwordLabel`              | —           | Password                                                    |
| `passwordPlaceholder`        | —           | Enter your password                                         |
| `passwordShow`               | —           | Show password                                               |
| `passwordHide`               | —           | Hide password                                               |
| `signIn`                     | —           | Sign in                                                     |
| `useCodeInstead`             | —           | Use a verification code instead                             |
| `forgotPassword`             | —           | Forgot password?                                            |
| `resetTitle`                 | —           | Reset your password                                         |
| `resetSubtitle`              | —           | Enter your phone or email — we'll send you a code.          |
| `resetPasswordTitle`         | —           | Choose a new password                                       |
| `resetPasswordSubtitle`      | `{account}` | Setting a new password for {account}.                       |
| `newPasswordLabel`           | —           | New password                                                |
| `newPasswordPlaceholder`     | —           | At least 6 characters                                       |
| `confirmPasswordLabel`       | —           | Confirm new password                                        |
| `confirmPasswordPlaceholder` | —           | Type it again                                               |
| `resetSubmit`                | —           | Set password and sign in                                    |
| `profileTitle`               | —           | Set up your profile                                         |
| `profileSubtitle`            | —           | Pick a nickname and a photo. You can change both later.     |
| `avatarLabel`                | —           | Profile photo                                               |
| `avatarChange`               | —           | Change profile photo                                        |
| `avatarUploading`            | —           | Uploading photo                                             |
| `nicknameLabel`              | —           | Nickname                                                    |
| `nicknamePlaceholder`        | —           | How should we call you?                                     |
| `profileSubmit`              | —           | Continue                                                    |
| `skip`                       | —           | Skip for now                                                |
| `inviteTitle`                | —           | Got an invite code?                                         |
| `inviteSubtitle`             | —           | Add it now to credit whoever invited you.                   |
| `inviteLabel`                | —           | Invite code                                                 |
| `invitePlaceholder`          | —           | Enter invite code                                           |
| `inviteSubmit`               | —           | Apply code                                                  |
| `errorIdentifierRequired`    | —           | Enter your phone number or email address.                   |
| `errorIdentifierInvalid`     | —           | That doesn't look like a phone number or an email address.  |
| `errorCodeRequired`          | —           | Enter the 6-digit code.                                     |
| `errorPasswordRequired`      | —           | Enter your password.                                        |
| `errorPasswordTooShort`      | —           | Use at least 6 characters.                                  |
| `errorPasswordMismatch`      | —           | The two passwords don't match.                              |
| `errorNicknameRequired`      | —           | Pick a nickname, or skip this step.                         |
| `errorInviteCodeRequired`    | —           | Enter an invite code, or skip this step.                    |
| `errorAvatarNotAnImage`      | —           | Pick an image file.                                         |
| `errorResendCooldown`        | —           | A code was just sent. Wait for the countdown…               |
| `errorCodeIncorrect`         | —           | That code isn't right. Check it and try again.              |
| `errorCodeExpired`           | —           | That code has expired. Send a new one.                      |
| `errorCredentialsIncorrect`  | —           | Wrong account or password.                                  |
| `errorAccountNotFound`       | —           | We couldn't find that account.                              |
| `errorAccountDisabled`       | —           | This account is locked. Contact support.                    |
| `errorRateLimited`           | —           | Too many attempts. Wait a moment and try again.             |
| `errorPasswordRejected`      | —           | That password was rejected.                                 |
| `errorInviteCodeInvalid`     | —           | That invite code isn't valid.                               |
| `errorNetwork`               | —           | Couldn't reach the server. Check your connection.           |
| `errorInvalidResponse`       | —           | The server sent something we couldn't read. Try again.      |
| `errorTokenMissing`          | —           | Signed in, but no session was issued. Try again.            |
| `errorSessionUnverified`     | —           | Signed in, but the session couldn't be verified. Try again. |
| `errorServer`                | —           | Something went wrong. Try again.                            |

### Error mapping is a stopgap, and behaves like one

Java's `/user/*` auth surface returns `code !== 200` with a localized `msg` and
**no machine-readable error code**. Until it ships one, `mapServerMessage` is a
substring heuristic — so it is built to fail safe:

- **Deterministic.** Every rule carries an explicit priority; the highest match
  wins. Declaration order changes nothing, so adding a rule cannot silently flip
  an existing verdict.
- **Step-aware.** Rules are scoped to the `AuthOperation` that produced the
  failure, because the same words mean different things per call: "密码错误" is
  wrong credentials on `password_login` and a rejected NEW password on
  `reset_password`; anything about a code on `send_code` is a delivery failure,
  never "the code you typed is wrong" (nothing has been typed yet).
- **Ambiguity is not a guess.** Two different codes tied at the top priority —
  "账号不存在或已被禁用" — map to `server_error`, i.e. Java's own words.
- **The server text always reaches the user.** `errorText` renders the upstream
  message underneath the localized line for every mapped code, and _as_ the line
  for unmapped ones (root `DESIGN.md` § Error Toasts). A mis-map costs a
  redundant sentence, never the only actionable detail the user had.

Delete the heuristics the day Java ships real error codes.

## Tailwind v4 content scanning

Tailwind v4 scans source files, and it does **not** follow into workspace
packages on its own — without the directive below every class in this package is
stripped and the dialog renders unstyled. This failure is silent. Both apps
declare it next to the existing `experience-player-react` line:

- `apps/web/app/globals.css` → `@source "../../../packages/auth-flow/src";`
- `apps/studio/app/globals.css` → `@source "../../../packages/auth-flow/src";`

## Styling rules

Semantic tokens only — `bg-popover`, `bg-input/30`, `text-foreground`,
`text-muted-foreground`, `bg-muted` / `bg-accent` for quiet fills, `bg-primary`
for the hero action, `destructive` for errors. No hex, no `dark:` variants (both
apps are permanently dark), no borders on controls or panels — separation comes
from tone steps and shadow, per `apps/studio/DESIGN.md` rules 2 and 4, the
stricter of the two design files. Brand red is never referenced here; whichever
app maps `--primary` to it gets it from its own token.

The package ships its own primitives (`primitives.tsx`) rather than importing
shadcn from an app: shadcn lives in each app's own source, and pulling web's
version into studio would import its borders and its red `--primary`.

## Tests

```
npm test -w @repo/auth-flow    # vitest, matching packages/experience-player-react
```

Covers identifier detection + normalization (including `+86` / spacing / the
`+1`-vs-CN-mobile collision), `readSessionToken` across all four observed Java
shapes, the envelope check, server-message → error-code mapping (priority,
step-awareness, ambiguity), the Java client contract for both sign-in and reset,
the transport's split of a dropped connection from an unreadable body, the machine
(step routing, back navigation, pending/error handling, the reset flow, reset,
mode-bound codes), the outstanding-code record and its expiry, the `CodeInput`
caret and delete, and — through the real hook — the `onSuccess` once-per-open
contract, prefill survival, the unverified-session rollback, and every route back
to a code send.
