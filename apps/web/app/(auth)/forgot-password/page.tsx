"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldError, FieldLabel } from "@/components/ui/field";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { ApiRequestError } from "@/src/lib/api";
import {
  emailResetPassword,
  phoneResetPassword,
  sendEmailCode,
  sendPhoneCode,
} from "@/src/lib/auth/api";
import { AuthSection, isPhoneIdentifier } from "../_components/auth-section";
import { PasswordInput } from "../_components/password-input";
import { SendCodeButton } from "../_components/send-code-button";
import { handleAuthSuccess } from "../_components/post-auth";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 6;

function identifierOk(value: string): boolean {
  return isPhoneIdentifier(value) || EMAIL_PATTERN.test(value.trim());
}

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const locale = useLocale() as Locale;
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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
    setError(null);
    setSubmitting(true);
    try {
      const result = isPhoneIdentifier(trimmedId)
        ? await phoneResetPassword({ phone: trimmedId, code: code.trim(), password })
        : await emailResetPassword({ email: trimmedId, code: code.trim(), password });
      toast.success(t("resetSuccess"));
      handleAuthSuccess("reset", result);
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : t("resetError");
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthSection title={t("resetPasswordTitle")} subtitle={t("resetPasswordSubtitle")}>
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
            <FieldLabel htmlFor="password">{t("newPasswordLabel")}</FieldLabel>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("newPasswordPlaceholder")}
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
          {error ? <FieldError>{error}</FieldError> : null}
          <Button type="submit" size="lg" disabled={!canSubmit} className="w-full">
            {submitting ? <IconLoader2 className="size-3 animate-spin" /> : null}
            {t("resetPasswordSubmit")}
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
