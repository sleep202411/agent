"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldError } from "@/components/ui/field";
import { useTranslations } from "@/src/i18n/i18n";
import { ApiRequestError } from "@/src/lib/api";
import { emailRegister, phoneRegister, sendEmailCode, sendPhoneCode } from "@/src/lib/auth/api";
import {
  AuthSection,
  AUTH_INPUT_CLASS,
  AUTH_SUBMIT_CLASS,
  isPhoneIdentifier,
} from "../_components/auth-section";
import { PasswordInput } from "../_components/password-input";
import { SendCodeButton } from "../_components/send-code-button";
import { handleAuthSuccess } from "../_components/post-auth";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 6;

function identifierOk(value: string): boolean {
  return isPhoneIdentifier(value) || EMAIL_PATTERN.test(value.trim());
}

export default function RegisterPage() {
  const t = useTranslations("auth");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recommendationCode, setRecommendationCode] = useState("");
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
      handleAuthSuccess("register", result);
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : t("registerError");
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthSection title={t("createAccount")} subtitle={t("registerSubtitle")}>
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <Field>
            <Input
              id="identifier"
              type="text"
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={t("identifierPlaceholder")}
              className={AUTH_INPUT_CLASS}
              required
            />
          </Field>
          <Field>
            <div className="flex items-center gap-2">
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={t("codePlaceholder")}
                className={AUTH_INPUT_CLASS}
                required
              />
              <SendCodeButton onSend={handleSendCode} disabled={!idOk} />
            </div>
          </Field>
          <Field>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("passwordPlaceholder")}
              required
              minLength={MIN_PASSWORD_LEN}
            />
          </Field>
          <Field>
            <PasswordInput
              id="confirm-password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t("confirmPasswordPlaceholder")}
              required
              minLength={MIN_PASSWORD_LEN}
            />
            {confirmPassword.length > 0 && !passwordsMatch ? (
              <FieldError>{t("passwordMismatch")}</FieldError>
            ) : null}
          </Field>
          <Field>
            <Input
              id="invite"
              value={recommendationCode}
              onChange={(e) => setRecommendationCode(e.target.value)}
              placeholder={t("inviteCodePlaceholder")}
              className={AUTH_INPUT_CLASS}
            />
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
          <Button type="submit" disabled={!canSubmit} className={AUTH_SUBMIT_CLASS}>
            {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {t("register")}
          </Button>
        </FieldGroup>
      </form>

      <div className="mt-6 text-sm text-muted-foreground">
        {t("hasAccount")}{" "}
        <Link href="/login" className="font-semibold text-foreground hover:text-primary">
          {t("goLogin")}
        </Link>
      </div>
    </AuthSection>
  );
}
