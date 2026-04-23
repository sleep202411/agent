"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldGroup, FieldError } from "@/components/ui/field";
import { useTranslations } from "@/src/i18n/i18n";
import { ApiRequestError } from "@/src/lib/api";
import { emailRegister, sendEmailCode } from "@/src/lib/auth/api";
import { AuthSection } from "../_components/auth-section";
import { SendCodeButton } from "../_components/send-code-button";
import { handleAuthSuccess } from "../_components/post-auth";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 6;

export default function RegisterPage() {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [recommendationCode, setRecommendationCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const emailOk = EMAIL_PATTERN.test(email.trim());
  const canSubmit =
    emailOk && code.trim().length > 0 && password.length >= MIN_PASSWORD_LEN && !submitting;

  const handleSendCode = async () => {
    if (!emailOk) {
      toast.warning(t("emailInvalid"));
      throw new Error("email-invalid");
    }
    try {
      await sendEmailCode(email.trim());
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
    setError(null);
    setSubmitting(true);
    try {
      const result = await emailRegister({
        email: email.trim(),
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
    <AuthSection
      title={t("createAccount")}
      subtitle={t("registerSubtitle")}
      footer={
        <>
          {t("hasAccount")}{" "}
          <Link href="/login" className="text-primary hover:underline">
            {t("goLogin")}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">{t("emailLabel")}</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("emailPlaceholder")}
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
                required
              />
              <SendCodeButton onSend={handleSendCode} disabled={!emailOk} />
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="password">{t("passwordLabel")}</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("passwordPlaceholder")}
              required
              minLength={MIN_PASSWORD_LEN}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="invite">{t("inviteCodeLabel")}</FieldLabel>
            <Input
              id="invite"
              value={recommendationCode}
              onChange={(e) => setRecommendationCode(e.target.value)}
              placeholder={t("inviteCodePlaceholder")}
            />
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
          <Button type="submit" disabled={!canSubmit} className="w-full">
            {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {t("register")}
          </Button>
        </FieldGroup>
      </form>
    </AuthSection>
  );
}
