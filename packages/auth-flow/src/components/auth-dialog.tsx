"use client";

/**
 * The sign-in dialog — the whole product's one auth surface.
 *
 * `apps/web` and `apps/studio` render THIS component with the same
 * markup, the same steps and the same look; only `t`, `transport` and
 * what happens on success differ. Copy lives in the host app's message
 * files (see `keys.ts`); nothing here is a user-facing string.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type InputHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";

import { authErrorTranslationKey, type AuthError } from "../errors";
import { maskIdentifier } from "../identifier";
import {
  CODE_LENGTH,
  isSessionEstablished,
  resumesSentCode,
  type AuthMode,
  type AuthStep,
  type AuthStepConfig,
} from "../machine";
import type { AuthTranslate, AuthTranslationKey } from "../keys";
import type { AuthTransport } from "../transport";
import type { AuthSession } from "../types";
import { useAuthFlow, type AuthFlowAnalytics, type AuthFlowController } from "../use-auth-flow";
import { CodeInput } from "./code-input";
import {
  BackIcon,
  CameraIcon,
  CloseIcon,
  ErrorNotice,
  EyeIcon,
  Field,
  IconButton,
  PrimaryButton,
  QuietButton,
  Spinner,
  TextInput,
  cx,
} from "./primitives";

export type IdentifierInputRenderer = (
  props: Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
    onValueChange: (value: string) => void;
  }
) => ReactNode;

export interface AuthDialogProps {
  /** Optional host input UI, used only for sign-in (never password reset). */
  renderSignInIdentifier?: IdentifierInputRenderer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Host app's translator, typed against the package's key union. */
  t: AuthTranslate;
  /** How this app reaches Java (web adds its cell prefix). */
  transport: AuthTransport;
  /** Fired once, with the established session. */
  onSuccess: (session: AuthSession) => void;
  /** Per-app opt-out of the two onboarding steps. Both default to on. */
  steps?: Partial<AuthStepConfig>;
  /**
   * Open straight into the password-reset flow. `/forgot-password` is
   * the only caller — every other entry starts on the code flow, where
   * there is no password to have forgotten.
   */
  initialMode?: AuthMode;
  /** Optional post-login session probe; see `useAuthFlow`. */
  verifySession?: () => Promise<boolean>;
  /** Turn the stored avatar path into a displayable URL (OSS base differs per app). */
  resolveAvatarUrl?: (path: string) => string;
  /** Prefill, e.g. from `?recommendationCode=` on a referral link. */
  initialIdentifier?: string;
  initialInviteCode?: string;
  resendCooldown?: number;
  onEvent?: (event: AuthFlowAnalytics) => void;
  /** Logo lockup above the title. Same asset in both apps. */
  brand?: ReactNode;
  /** Terms / privacy line — links are app-routed, so the app renders it. */
  legal?: ReactNode;
}

export function AuthDialog({
  open,
  onOpenChange,
  t,
  transport,
  onSuccess,
  steps,
  initialMode,
  verifySession,
  resolveAvatarUrl,
  initialIdentifier,
  initialInviteCode,
  resendCooldown,
  onEvent,
  brand,
  legal,
  renderSignInIdentifier,
}: AuthDialogProps) {
  const flow = useAuthFlow({
    transport,
    onSuccess,
    steps,
    initialMode,
    verifySession,
    initialIdentifier,
    initialInviteCode,
    resendCooldown,
    onEvent,
    active: open,
  });

  // Portals need a DOM; the dialog is a client component but still gets
  // server-rendered once by the App Router.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const panelRef = useRef<HTMLDivElement>(null);
  /** Set when a press STARTS on the backdrop; see the handlers below. */
  const pressedBackdrop = useRef(false);
  const dismissable = flow.can.dismiss;
  const dismiss = () => {
    if (!dismissable) return;
    // On `profile` / `invite` the sign-in has ALREADY happened — the cookie
    // is written and the user is authenticated. Closing there is "skip the
    // rest", not "cancel", so it walks the flow to its terminal step and
    // `onSuccess` tells the host about the session it now has. Only a
    // dismiss before any session is a plain close.
    if (isSessionEstablished(flow.state)) {
      flow.actions.dismiss();
      return;
    }
    onOpenChange(false);
  };

  useDialogShell({ open: open && mounted, panelRef, dismissable, onDismiss: dismiss });

  const titleId = useId();
  const subtitleId = useId();
  const errorId = useId();

  if (!mounted || !open) return null;
  // The terminal step has already handed the session to the host app; do
  // not paint a frame of an empty dialog while it closes us.
  if (flow.state.step === "done") return null;

  const copy = stepCopy(flow.state.step, flow.state.mode);
  const account = flow.state.account ? maskIdentifier(flow.state.account) : flow.state.identifier;

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // Only a press that starts AND ends on the backdrop dismisses —
        // dragging a text selection out of the panel must not close it,
        // and neither must releasing on the backdrop after pressing
        // inside. Both halves are checked because `click` alone fires
        // with the drag's ORIGIN inside the panel.
        const startedOutside = pressedBackdrop.current;
        pressedBackdrop.current = false;
        if (startedOutside && event.target === event.currentTarget) dismiss();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitleId}
        className={cx(
          "relative w-full max-w-[440px] rounded-2xl bg-popover p-6 shadow-2xl shadow-black/60",
          "duration-200 animate-in fade-in-0 zoom-in-95 sm:p-7"
        )}
      >
        <div className="absolute top-4 right-4 left-4 flex items-center justify-between">
          {flow.can.goBack ? (
            <IconButton label={t("back")} onClick={flow.actions.back} type="button">
              <BackIcon />
            </IconButton>
          ) : (
            <span />
          )}
          <IconButton label={t("close")} onClick={dismiss} disabled={!dismissable} type="button">
            <CloseIcon />
          </IconButton>
        </div>

        <div className="flex flex-col items-center pt-6 text-center">
          {brand ? <div className="mb-5">{brand}</div> : null}
          <h2 id={titleId} className="text-xl font-semibold text-foreground">
            {t(copy.title)}
          </h2>
          <p id={subtitleId} className="mt-1.5 text-sm text-muted-foreground">
            {t(copy.subtitle, { account })}
          </p>
        </div>

        <div className="mt-7">
          <StepBody
            renderSignInIdentifier={
              flow.state.mode === "signin" ? renderSignInIdentifier : undefined
            }
            flow={flow}
            t={t}
            errorId={errorId}
            resolveAvatarUrl={resolveAvatarUrl}
          />
        </div>

        {legal ? (
          <div className="mt-6 text-center text-[11px] leading-4 text-muted-foreground">
            {legal}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

interface StepCopy {
  title: AuthTranslationKey;
  subtitle: AuthTranslationKey;
}

/** Per-step header copy, so the shell stays identical across steps. */
const STEP_COPY: Record<AuthStep, StepCopy> = {
  identifier: { title: "identifierTitle", subtitle: "identifierSubtitle" },
  code: { title: "codeTitle", subtitle: "codeSubtitle" },
  password: { title: "passwordTitle", subtitle: "passwordSubtitle" },
  reset_password: { title: "resetPasswordTitle", subtitle: "resetPasswordSubtitle" },
  profile: { title: "profileTitle", subtitle: "profileSubtitle" },
  invite: { title: "inviteTitle", subtitle: "inviteSubtitle" },
  done: { title: "identifierTitle", subtitle: "identifierSubtitle" },
};

/**
 * The identifier and code steps are shared by both modes, and only the
 * identifier step has to say which one the user is in — "we'll send you
 * a code" is true either way, but "to sign in" and "to set a new
 * password" are not.
 */
function stepCopy(step: AuthStep, mode: AuthMode): StepCopy {
  if (step === "identifier" && mode === "reset") {
    return { title: "resetTitle", subtitle: "resetSubtitle" };
  }
  return STEP_COPY[step];
}

function StepBody({
  renderSignInIdentifier,
  flow,
  t,
  errorId,
  resolveAvatarUrl,
}: {
  flow: AuthFlowController;
  t: AuthTranslate;
  errorId: string;
  resolveAvatarUrl?: (path: string) => string;
  renderSignInIdentifier?: IdentifierInputRenderer;
}) {
  const { state, actions, can } = flow;
  const error = state.error ? <FlowError error={state.error} t={t} id={errorId} /> : null;
  const describedBy = state.error ? errorId : undefined;

  switch (state.step) {
    case "identifier":
      return (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            actions.submitIdentifier();
          }}
        >
          <IdentifierField
            renderInput={renderSignInIdentifier}
            id="auth-identifier"
            t={t}
            autoFocus
            value={state.identifier}
            disabled={state.pending}
            invalid={Boolean(state.error)}
            describedBy={describedBy}
            onChange={actions.setIdentifier}
            // The cooldown is global to the dialog, so it applies here
            // too — say so, live, instead of letting Continue look free
            // and then refusing. But NOT while the field still holds the
            // identifier the live code went to: that Continue resumes the
            // code step without a send, so a countdown there would be
            // telling the user to wait for something that costs nothing.
            hint={
              state.resendSeconds > 0 && !resumesSentCode(state)
                ? t("codeResendCountdown", { seconds: state.resendSeconds })
                : undefined
            }
          />
          {error}
          <PrimaryButton
            type="submit"
            disabled={!can.submitIdentifier}
            busy={state.pending}
            busyLabel={t("busy")}
          >
            {t("continue")}
          </PrimaryButton>
          {state.mode === "signin" ? (
            <div className="flex justify-center">
              <QuietButton type="button" onClick={actions.usePassword} disabled={state.pending}>
                {t("usePasswordInstead")}
              </QuietButton>
            </div>
          ) : null}
        </form>
      );

    case "code":
      return (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            actions.submitCode();
          }}
        >
          <CodeInput
            value={state.code}
            length={CODE_LENGTH}
            disabled={state.pending}
            invalid={Boolean(state.error)}
            label={t("codeInputLabel")}
            cellLabel={(index) => t("codeCellLabel", { index })}
            describedBy={describedBy}
            onChange={actions.setCode}
            onSubmit={actions.submitCode}
          />
          {error ?? (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {t("codeSent")}
            </p>
          )}
          <PrimaryButton
            type="submit"
            disabled={!can.submitCode}
            busy={state.pending}
            busyLabel={t("busy")}
          >
            {t("verify")}
          </PrimaryButton>
          <div className="flex items-center justify-between">
            <QuietButton type="button" onClick={actions.back} disabled={state.pending}>
              {t("codeEditIdentifier")}
            </QuietButton>
            <QuietButton type="button" onClick={actions.resendCode} disabled={!can.resendCode}>
              {state.resendSeconds > 0
                ? t("codeResendCountdown", { seconds: state.resendSeconds })
                : t("codeResend")}
            </QuietButton>
          </div>
        </form>
      );

    case "password":
      return (
        <PasswordStep
          renderSignInIdentifier={renderSignInIdentifier}
          flow={flow}
          t={t}
          errorId={errorId}
        >
          {error}
        </PasswordStep>
      );

    case "reset_password":
      return (
        <ResetPasswordStep flow={flow} t={t} errorId={errorId}>
          {error}
        </ResetPasswordStep>
      );

    case "profile":
      return (
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            actions.submitProfile();
          }}
        >
          <AvatarPicker
            t={t}
            uploading={state.uploadingAvatar}
            src={
              state.avatarPath ? (resolveAvatarUrl?.(state.avatarPath) ?? state.avatarPath) : null
            }
            onPick={actions.uploadAvatar}
          />
          <Field label={t("nicknameLabel")} htmlFor="auth-nickname">
            <TextInput
              id="auth-nickname"
              autoFocus
              autoComplete="nickname"
              aria-describedby={describedBy}
              aria-invalid={state.error ? true : undefined}
              placeholder={t("nicknamePlaceholder")}
              value={state.nickname}
              disabled={state.pending}
              onChange={(event) => actions.setNickname(event.target.value)}
            />
          </Field>
          {error}
          <PrimaryButton
            type="submit"
            disabled={!can.submitProfile}
            busy={state.pending}
            busyLabel={t("busy")}
          >
            {t("profileSubmit")}
          </PrimaryButton>
          <div className="flex justify-center">
            <QuietButton type="button" onClick={actions.skipProfile} disabled={state.pending}>
              {t("skip")}
            </QuietButton>
          </div>
        </form>
      );

    case "invite":
      return (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            actions.submitInvite();
          }}
        >
          <Field label={t("inviteLabel")} htmlFor="auth-invite">
            <TextInput
              id="auth-invite"
              autoFocus
              autoCapitalize="characters"
              aria-describedby={describedBy}
              aria-invalid={state.error ? true : undefined}
              placeholder={t("invitePlaceholder")}
              value={state.inviteCode}
              disabled={state.pending}
              onChange={(event) => actions.setInviteCode(event.target.value)}
            />
          </Field>
          {error}
          <PrimaryButton
            type="submit"
            disabled={!can.submitInvite}
            busy={state.pending}
            busyLabel={t("busy")}
          >
            {t("inviteSubmit")}
          </PrimaryButton>
          <div className="flex justify-center">
            <QuietButton type="button" onClick={actions.skipInvite} disabled={state.pending}>
              {t("skip")}
            </QuietButton>
          </div>
        </form>
      );

    default:
      return null;
  }
}

/**
 * One identifier control for every step that has one.
 *
 * The field deliberately stays a plain text input. Switching the mobile
 * keyboard from email to telephone mode after a numeric prefix traps users
 * who are entering digit-first email addresses: once the keyboard becomes a
 * dial pad, they can no longer continue with "@". Validation still decides
 * whether the completed value is a phone number or email on submit.
 */
function IdentifierField({
  renderInput,
  id,
  t,
  value,
  disabled,
  invalid,
  describedBy,
  onChange,
  hint,
  autoFocus,
}: {
  renderInput?: IdentifierInputRenderer;
  id: string;
  t: AuthTranslate;
  value: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  autoFocus?: boolean;
}) {
  const inputProps: InputHTMLAttributes<HTMLInputElement> = {
    id,
    type: "text",
    autoFocus,
    autoComplete: "username",
    "aria-describedby": describedBy,
    "aria-invalid": invalid || undefined,
    placeholder: t("identifierPlaceholder"),
    value,
    disabled,
    onChange: (event) => onChange(event.target.value),
  };
  return (
    <Field label={t("identifierLabel")} htmlFor={id} hint={hint}>
      {renderInput ? (
        renderInput({ ...inputProps, onValueChange: onChange })
      ) : (
        <TextInput {...inputProps} />
      )}
    </Field>
  );
}

function PasswordStep({
  renderSignInIdentifier,
  flow,
  t,
  errorId,
  children,
}: {
  renderSignInIdentifier?: IdentifierInputRenderer;
  flow: AuthFlowController;
  t: AuthTranslate;
  errorId: string;
  children: ReactNode;
}) {
  const { state, actions, can } = flow;
  const describedBy = state.error ? errorId : undefined;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        actions.submitPassword();
      }}
    >
      <IdentifierField
        renderInput={renderSignInIdentifier}
        id="auth-password-identifier"
        t={t}
        value={state.identifier}
        disabled={state.pending}
        onChange={actions.setIdentifier}
      />
      <PasswordField
        id="auth-password"
        t={t}
        label={t("passwordLabel")}
        placeholder={t("passwordPlaceholder")}
        autoComplete="current-password"
        autoFocus
        value={state.password}
        disabled={state.pending}
        invalid={Boolean(state.error)}
        describedBy={describedBy}
        onChange={actions.setPassword}
      />
      {children}
      <PrimaryButton
        type="submit"
        disabled={!can.submitPassword}
        busy={state.pending}
        busyLabel={t("busy")}
      >
        {t("signIn")}
      </PrimaryButton>
      {/*
        The ONLY entry to the reset flow, and it lives here because this
        is the only step where a password exists to be forgotten — the
        code flow signs the same user in without one.
      */}
      <div className="flex items-center justify-between">
        <QuietButton type="button" onClick={actions.useCode} disabled={state.pending}>
          {t("useCodeInstead")}
        </QuietButton>
        <QuietButton type="button" onClick={actions.startReset} disabled={state.pending}>
          {t("forgotPassword")}
        </QuietButton>
      </div>
    </form>
  );
}

/**
 * The reset flow's last step: choose the password, twice.
 *
 * Java checks the code and stores the password in ONE call, so pressing
 * submit here is what verifies the code — a wrong one lands the user
 * back on the code step (see `submitNewPassword`) rather than leaving
 * them staring at a code error above two password fields.
 */
function ResetPasswordStep({
  flow,
  t,
  errorId,
  children,
}: {
  flow: AuthFlowController;
  t: AuthTranslate;
  errorId: string;
  children: ReactNode;
}) {
  const { state, actions, can } = flow;
  const describedBy = state.error ? errorId : undefined;
  const mismatch = state.confirmPassword.length > 0 && state.confirmPassword !== state.newPassword;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        actions.submitNewPassword();
      }}
    >
      <PasswordField
        id="auth-new-password"
        t={t}
        label={t("newPasswordLabel")}
        placeholder={t("newPasswordPlaceholder")}
        autoComplete="new-password"
        autoFocus
        value={state.newPassword}
        disabled={state.pending}
        invalid={Boolean(state.error)}
        describedBy={describedBy}
        onChange={actions.setNewPassword}
      />
      <PasswordField
        id="auth-confirm-password"
        t={t}
        label={t("confirmPasswordLabel")}
        placeholder={t("confirmPasswordPlaceholder")}
        autoComplete="new-password"
        value={state.confirmPassword}
        disabled={state.pending}
        invalid={mismatch || Boolean(state.error)}
        onChange={actions.setConfirmPassword}
        // Live, before submit: retyping a password you cannot see is
        // where this goes wrong, and finding out on submit wastes the
        // code's lifetime. A plain span, not `ErrorNotice` — an
        // aria-live region that fires on every keystroke of a matching
        // retype is noise, and the submit button already states the
        // gate by staying disabled.
        hint={
          mismatch ? (
            <span className="text-destructive">{t("errorPasswordMismatch")}</span>
          ) : undefined
        }
      />
      {children}
      <PrimaryButton
        type="submit"
        disabled={!can.submitNewPassword}
        busy={state.pending}
        busyLabel={t("busy")}
      >
        {t("resetSubmit")}
      </PrimaryButton>
    </form>
  );
}

function PasswordField({
  id,
  t,
  label,
  placeholder,
  autoComplete,
  autoFocus,
  value,
  disabled,
  invalid,
  describedBy,
  hint,
  onChange,
}: {
  id: string;
  t: AuthTranslate;
  label: string;
  placeholder: string;
  autoComplete: "current-password" | "new-password";
  autoFocus?: boolean;
  value: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  hint?: ReactNode;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="relative">
        <TextInput
          id={id}
          autoFocus={autoFocus}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="pr-11"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={visible ? t("passwordHide") : t("passwordShow")}
          onClick={() => setVisible((current) => !current)}
          className="absolute inset-y-0 right-3 flex items-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <EyeIcon off={visible} />
        </button>
      </div>
    </Field>
  );
}

function AvatarPicker({
  t,
  src,
  uploading,
  onPick,
}: {
  t: AuthTranslate;
  src: string | null;
  uploading: boolean;
  onPick: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        aria-label={t("avatarChange")}
        disabled={uploading}
        onClick={() => input.current?.click()}
        className={cx(
          "relative size-20 overflow-hidden rounded-full bg-muted text-muted-foreground",
          "transition-colors hover:bg-accent hover:text-foreground",
          "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-60"
        )}
      >
        {src ? (
          // Plain <img>, not next/image: the avatar URL is whatever the
          // host app's OSS base resolves to, and next/image would demand
          // per-app remote-pattern config for a 80px preview.
          <img src={src} alt="" className="size-full object-cover" />
        ) : null}
        <span className="absolute inset-0 flex items-center justify-center">
          {uploading ? <Spinner label={t("avatarUploading")} /> : src ? null : <CameraIcon />}
        </span>
      </button>
      <span className="text-xs text-muted-foreground">{t("avatarLabel")}</span>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset so re-picking the same file fires `change` again.
          event.target.value = "";
          if (file) onPick(file);
        }}
      />
    </div>
  );
}

function FlowError({ error, t, id }: { error: AuthError; t: AuthTranslate; id: string }) {
  const { message, detail } = errorText(error, t);
  return (
    <ErrorNotice id={id} detail={detail}>
      {message}
    </ErrorNotice>
  );
}

/**
 * What the user reads, and what the server actually said.
 *
 * `mapServerMessage` is a substring heuristic standing in for the error
 * codes Java has not shipped, so its verdict is never allowed to be the
 * user's only information: whenever Java sent a message, that message is
 * rendered too. An unmapped or ambiguous failure arrives as
 * `server_error` and IS the message; a mapped one gets our localized
 * sentence with the upstream text beneath it, so a mis-map costs a
 * redundant line instead of the actionable detail.
 */
export function errorText(
  error: AuthError,
  t: AuthTranslate
): { message: string; detail?: string } {
  const localized = t(authErrorTranslationKey(error.code));
  if (!error.serverMessage) return { message: localized };
  if (error.code === "server_error") return { message: error.serverMessage };
  if (error.serverMessage.trim() === localized.trim()) return { message: localized };
  return { message: localized, detail: error.serverMessage };
}

/**
 * Modal shell behaviour: Escape to dismiss, body scroll lock, focus into
 * the panel on open, focus restored to the opener on close, and Tab
 * cycling contained inside the panel.
 */
function useDialogShell({
  open,
  panelRef,
  dismissable,
  onDismiss,
}: {
  open: boolean;
  panelRef: React.RefObject<HTMLDivElement | null>;
  dismissable: boolean;
  onDismiss: () => void;
}) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const dismissableRef = useRef(dismissable);
  dismissableRef.current = dismissable;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (dismissableRef.current) dismissRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((node) => node.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      // Give focus back to whatever opened us, so keyboard users are not
      // dropped at the top of the document.
      opener?.focus?.();
    };
  }, [open, panelRef]);
}
