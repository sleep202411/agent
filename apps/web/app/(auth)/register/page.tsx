"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldError, FieldLabel } from "@/components/ui/field";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import posthog from "posthog-js";
import { ApiRequestError } from "@/src/lib/api";
import { emailRegister, phoneRegister, sendEmailCode, sendPhoneCode } from "@/src/lib/auth/api";
import { axonSignUp } from "@/src/lib/axon";
import { AuthSection, isPhoneIdentifier } from "../_components/auth-section";
import { PasswordInput } from "../_components/password-input";
import { SendCodeButton } from "../_components/send-code-button";
import { AgreementCheckbox } from "../_components/agreement-checkbox";
import { handleAuthSuccess } from "../_components/post-auth";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 6;

function identifierOk(value: string): boolean {
  return isPhoneIdentifier(value) || EMAIL_PATTERN.test(value.trim());
}

/**
 * A gated link (e.g. /play/interactive-film/[id]?recommendationCode=ABC) reaches
 * the login gate, which stashes the whole path+query in `?redirect=`. When the
 * visitor chooses to register, pull the referrer's code back out of that
 * redirect value so attribution still lands. `searchParams.get("redirect")`
 * returns the already-decoded value, so a plain URLSearchParams parse works.
 */
function referralCodeFromRedirect(redirect: string | null | undefined): string | null {
  if (!redirect) return null;
  const q = redirect.indexOf("?");
  if (q === -1) return null;
  return new URLSearchParams(redirect.slice(q + 1)).get("recommendationCode") ?? null;
}

export default function RegisterPage() {
  const t = useTranslations("auth");
  const locale = useLocale() as Locale;
  const searchParams = useSearchParams();
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // Prefill referral code from `?recommendationCode=`, or — when the user
  // arrived through the login gate — from the code buried inside the
  // `?redirect=` value (a gated play/IP link carries the referrer's code in
  // its own query). Read once at mount via a lazy initializer (both sources
  // live in the URL, so this is SSR/hydration-safe) so later typing isn't
  // clobbered.
  const [recommendationCode, setRecommendationCode] = useState(
    () =>
      searchParams?.get("recommendationCode") ??
      referralCodeFromRedirect(searchParams?.get("redirect")) ??
      ""
  );
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmedId = identifier.trim();
  const idOk = identifierOk(trimmedId);
  const passwordsMatch = password === confirmPassword;
  const canSubmit =
    idOk &&
    code.trim().length > 0 &&
    password.length >= MIN_PASSWORD_LEN &&
    passwordsMatch &&
    !submitting;

  const handleSendCode = async () => {
    if (!idOk) {
      toast.warning(t("identifierInvalid"));
      throw new Error("identifier-invalid");
    }
    try {
      if (isPhoneIdentifier(trimmedId)) await sendPhoneCode(trimmedId);
      else await sendEmailCode(trimmedId);
      toast.success(t("codeSent"));
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : t("codeError");
      toast.error(message);
      throw err;
    }
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    if (!passwordsMatch) {
      setError(t("passwordMismatch"));
      return;
    }
    if (!agreed) {
      toast.warning(t("agreementRequired"));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result = isPhoneIdentifier(trimmedId)
        ? await phoneRegister({
            phone: trimmedId,
            code: code.trim(),
            password,
            recommendationCode: recommendationCode.trim() || undefined,
          })
        : await emailRegister({
            email: trimmedId,
            code: code.trim(),
            password,
            recommendationCode: recommendationCode.trim() || undefined,
          });
      toast.success(t("registerSuccess"));
      const userId = String(result.user?.userId ?? trimmedId);
      posthog.identify(userId, {
        email: result.user?.email,
        phone: result.user?.phone,
        nickname: result.user?.nickname,
      });
      posthog.capture("user_registered", {
        method: isPhoneIdentifier(trimmedId) ? "phone" : "email",
        has_referral_code: Boolean(recommendationCode.trim()),
      });
      axonSignUp(isPhoneIdentifier(trimmedId) ? "phone" : "email", {
        user_id: userId,
        email: result.user?.email?.toLowerCase(),
      });
      handleAuthSuccess("register", result);
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : t("registerError");
      setError(message);
      posthog.captureException(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthSection title={t("createAccount")} subtitle={t("registerSubtitle")}>
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="identifier">{t("identifierPlaceholder")}</FieldLabel>
            <Input
              id="identifier"
              type="text"
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={t("identifierPlaceholder")}
              size="lg"
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="code">{t("codeLabel")}</FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={t("codePlaceholder")}
                size="lg"
                required
              />
              <SendCodeButton onSend={handleSendCode} disabled={!idOk} />
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="password">{t("passwordLabel")}</FieldLabel>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("passwordPlaceholder")}
              size="lg"
              required
              minLength={MIN_PASSWORD_LEN}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="confirm-password">{t("confirmPasswordPlaceholder")}</FieldLabel>
            <PasswordInput
              id="confirm-password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t("confirmPasswordPlaceholder")}
              size="lg"
              required
              minLength={MIN_PASSWORD_LEN}
            />
            {confirmPassword.length > 0 && !passwordsMatch ? (
              <FieldError>{t("passwordMismatch")}</FieldError>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="invite">{t("inviteCodeLabel")}</FieldLabel>
            <Input
              id="invite"
              value={recommendationCode}
              onChange={(e) => setRecommendationCode(e.target.value)}
              placeholder={t("inviteCodePlaceholder")}
              size="lg"
            />
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
          <AgreementCheckbox checked={agreed} onCheckedChange={setAgreed} />
          <Button type="submit" size="lg" disabled={!canSubmit} className="w-full">
            {submitting ? <IconLoader2 className="size-3 animate-spin" /> : null}
            {t("register")}
          </Button>
        </FieldGroup>
      </form>

      <div className="mt-6 text-sm text-muted-foreground">
        {t("hasAccount")}{" "}
        <Link
          href={localizePath("/login", locale)}
          className="font-semibold text-foreground hover:text-primary"
        >
          {t("goLogin")}
        </Link>
      </div>
    </AuthSection>
  );
}
