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
import { emailLogin } from "@/src/lib/auth/api";
import { AuthSection } from "../_components/auth-section";
import { handleAuthSuccess } from "../_components/post-auth";

export default function LoginPage() {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting;

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await emailLogin({ email: email.trim(), pwd: password });
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
    <AuthSection
      title={t("welcomeBack")}
      subtitle={t("loginSubtitle")}
      footer={
        <>
          {t("noAccount")}{" "}
          <Link href="/register" className="text-primary hover:underline">
            {t("goRegister")}
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
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="password">{t("passwordLabel")}</FieldLabel>
              <Link
                href="/forgot-password"
                className="text-xs text-muted-foreground hover:text-primary"
              >
                {t("forgotPassword")}
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("passwordPlaceholder")}
              required
            />
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
          <Button type="submit" disabled={!canSubmit} className="w-full">
            {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {t("login")}
          </Button>
        </FieldGroup>
      </form>
    </AuthSection>
  );
}
