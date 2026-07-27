"use client";

/**
 * Account & security — set or change the account password.
 *
 * Wired to Java's `POST /user/set/password` (form-encoded `password`,
 * optional `oldPassword`) through the same `AuthClient` the sign-in
 * dialog uses, so the envelope handling and the Chinese-message
 * fallback behave identically in both places.
 *
 * Why a password still exists at all: the one-button flow signs people
 * in with a code and never asks for one, but "use password instead" is
 * the entry legacy accounts rely on, and it is the only way in when a
 * user loses access to the phone or mailbox on the account. Setting one
 * here is what keeps that door open.
 *
 * First-set vs change
 * ───────────────────
 * `oldPassword` is sent ONLY when the user says they already have one.
 * Java has no `hasPassword` flag on the user-info payload — a code-only
 * account and a password account are indistinguishable to us — so this
 * cannot be inferred and the user is asked directly rather than being
 * guessed at and shown a Chinese rejection. If Java ever exposes the
 * flag, drop the toggle and derive it.
 *
 * This deliberately uses the app's own shadcn dialog rather than
 * anything from `@repo/auth-flow`: that package owns the SIGN-IN
 * surface shared with studio, and this is an account-settings panel
 * that belongs to web's 个人中心.
 */

import { useMemo, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { AuthClient, AuthRequestError, errorText } from "@repo/auth-flow";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { createWebAuthTransport } from "@/src/lib/auth/transport";

const MIN_PASSWORD_LEN = 6;

export function AccountSecurityDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("accountSecurity");
  const authT = useTranslations("auth");
  const locale = useLocale();

  const client = useMemo(() => new AuthClient(createWebAuthTransport(locale)), [locale]);

  const [hasExistingPassword, setHasExistingPassword] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const passwordsMatch = password === confirmPassword;
  const canSubmit =
    password.length >= MIN_PASSWORD_LEN &&
    passwordsMatch &&
    (!hasExistingPassword || oldPassword.length > 0) &&
    !submitting;

  const reset = () => {
    setHasExistingPassword(false);
    setOldPassword("");
    setPassword("");
    setConfirmPassword("");
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      await client.setPassword(password, hasExistingPassword ? oldPassword : undefined);
      toast.success(t("saved"));
      handleOpenChange(false);
    } catch (thrown) {
      // Java answers business failures with a localized `msg` and no
      // machine-readable code, so the package's classification is a
      // heuristic guess. `errorText` is the same rule the dialog uses:
      // an unmapped failure IS the server's message, and a mapped one
      // keeps it alongside — never flattened away, which is the
      // repo-wide rule for this backend (DESIGN.md § Error Toasts).
      if (thrown instanceof AuthRequestError) {
        const { message, detail } = errorText(thrown.error, authT);
        setError(detail ? `${message} ${detail}` : message);
      } else {
        setError(authT("errorServer"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="p-4">
          <FieldGroup>
            <label className="flex cursor-pointer items-start gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={hasExistingPassword}
                onCheckedChange={(value) => setHasExistingPassword(value === true)}
                className="mt-0.5"
              />
              <span className="leading-relaxed">{t("hasExistingPassword")}</span>
            </label>

            {hasExistingPassword ? (
              <Field>
                <FieldLabel htmlFor="old-password">{t("currentPasswordLabel")}</FieldLabel>
                <Input
                  id="old-password"
                  type="password"
                  autoComplete="current-password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder={t("currentPasswordPlaceholder")}
                  required
                />
              </Field>
            ) : null}

            <Field>
              <FieldLabel htmlFor="new-password">{t("newPasswordLabel")}</FieldLabel>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("newPasswordPlaceholder")}
                minLength={MIN_PASSWORD_LEN}
                required
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="confirm-new-password">{t("confirmPasswordLabel")}</FieldLabel>
              <Input
                id="confirm-new-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t("confirmPasswordPlaceholder")}
                minLength={MIN_PASSWORD_LEN}
                required
              />
              {confirmPassword.length > 0 && !passwordsMatch ? (
                <FieldError>{t("passwordMismatch")}</FieldError>
              ) : null}
            </Field>

            {error ? <FieldError>{error}</FieldError> : null}

            <Button type="submit" size="lg" disabled={!canSubmit} className="w-full">
              {submitting ? <IconLoader2 className="size-3 animate-spin" /> : null}
              {t("submit")}
            </Button>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
