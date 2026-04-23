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
import { emailLogin, phoneLogin } from "@/src/lib/auth/api";
import {
  AuthSection,
  AUTH_INPUT_CLASS,
  AUTH_SUBMIT_CLASS,
  isPhoneIdentifier,
} from "../_components/auth-section";
import { PasswordInput } from "../_components/password-input";
import { handleAuthSuccess } from "../_components/post-auth";

export default function LoginPage() {
  const t = useTranslations("auth");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmedId = identifier.trim();
  const canSubmit = trimmedId.length > 0 && password.length > 0 && !submitting;

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = isPhoneIdentifier(trimmedId)
        ? await phoneLogin({ phone: trimmedId, pwd: password })
        : await emailLogin({ email: trimmedId, pwd: password });
      toast.success(t("loginSuccess"));
      handleAuthSuccess("login", result);
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : t("loginError");
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthSection title={t("welcomeBack")} subtitle={t("loginSubtitle")}>
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
            <PasswordInput
              id="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("passwordPlaceholder")}
              required
            />
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
          <Button type="submit" disabled={!canSubmit} className={AUTH_SUBMIT_CLASS}>
            {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {t("login")}
          </Button>
        </FieldGroup>
      </form>

      <div className="mt-6 space-y-2 text-sm">
        <div>
          <Link
            href="/forgot-password"
            className="font-semibold text-foreground hover:text-primary"
          >
            {t("forgotPassword")}
          </Link>
        </div>
        <div className="text-muted-foreground">
          {t("noAccount")}{" "}
          <Link href="/register" className="font-semibold text-foreground hover:text-primary">
            {t("goRegister")}
          </Link>
        </div>
      </div>
    </AuthSection>
  );
}
