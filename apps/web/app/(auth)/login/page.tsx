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
import posthog from "posthog-js";
import { ApiRequestError } from "@/src/lib/api";
import { emailLogin, phoneLogin } from "@/src/lib/auth/api";
import { axonLogin } from "@/src/lib/axon";
import { AuthSection, isPhoneIdentifier } from "../_components/auth-section";
import { PasswordInput } from "../_components/password-input";
import { AgreementCheckbox } from "../_components/agreement-checkbox";
import { handleAuthSuccess } from "../_components/post-auth";

export default function LoginPage() {
  const t = useTranslations("auth");
  const locale = useLocale() as Locale;
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmedId = identifier.trim();
  const canSubmit = trimmedId.length > 0 && password.length > 0 && !submitting;

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    if (!agreed) {
      toast.warning(t("agreementRequired"));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result = isPhoneIdentifier(trimmedId)
        ? await phoneLogin({ phone: trimmedId, pwd: password })
        : await emailLogin({ email: trimmedId, pwd: password });
      toast.success(t("loginSuccess"));
      const userId = String(result.user?.userId ?? trimmedId);
      posthog.identify(userId, {
        email: result.user?.email,
        phone: result.user?.phone,
        nickname: result.user?.nickname,
      });
      posthog.capture("user_logged_in", {
        method: isPhoneIdentifier(trimmedId) ? "phone" : "email",
      });
      axonLogin({ user_id: userId, email: result.user?.email?.toLowerCase() });
      handleAuthSuccess("login", result);
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : t("loginError");
      setError(message);
      posthog.captureException(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthSection title={t("welcomeBack")} subtitle={t("loginSubtitle")}>
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
              size="default"
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">{t("passwordLabel")}</FieldLabel>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("passwordPlaceholder")}
              size="default"
              required
            />
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
          <AgreementCheckbox checked={agreed} onCheckedChange={setAgreed} />
          <Button type="submit" size="lg" disabled={!canSubmit} className="w-full">
            {submitting ? <IconLoader2 className="size-3 animate-spin" /> : null}
            {t("login")}
          </Button>
        </FieldGroup>
      </form>

      <div className="mt-6 space-y-2 text-sm">
        <div>
          <Link
            href={localizePath("/forgot-password", locale)}
            className="font-semibold text-foreground hover:text-primary"
          >
            {t("forgotPassword")}
          </Link>
        </div>
        <div className="text-muted-foreground">
          {t("noAccount")}{" "}
          <Link
            href={localizePath("/register", locale)}
            className="font-semibold text-foreground hover:text-primary"
          >
            {t("goRegister")}
          </Link>
        </div>
      </div>
    </AuthSection>
  );
}
