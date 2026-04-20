"use client";

import { useState } from "react";
import { IconMail, IconLock, IconUser, IconShield } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { useAppDispatch } from "@/src/store";
import { login as loginThunk } from "@/src/store/slices/authSlice";
import { emailRegister, sendEmailCode } from "@/src/lib/auth";
import { toast } from "sonner";

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AuthDialog({ open, onOpenChange }: AuthDialogProps) {
  const t = useTranslations("auth");
  const dispatch = useAppDispatch();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [error, setError] = useState("");

  const handleSendCode = async () => {
    if (!email || codeCooldown > 0) return;
    try {
      await sendEmailCode(email);
      setCodeSent(true);
      setCodeCooldown(60);
      const timer = setInterval(() => {
        setCodeCooldown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      toast.success(t("codeSent"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("codeError"));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (mode === "login") {
        await dispatch(loginThunk({ email, pwd: password })).unwrap();
        toast.success(t("loginSuccess"));
        onOpenChange(false);
      } else {
        if (!code) {
          setError(t("codeRequired"));
          setLoading(false);
          return;
        }
        await emailRegister(email, password, code);
        toast.success(t("registerSuccess"));
        setMode("login");
        setCode("");
        setCodeSent(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loginError"));
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode(mode === "login" ? "register" : "login");
    setError("");
    setCode("");
    setCodeSent(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-sm" showCloseButton={false}>
        {/* Banner */}
        <div className="relative h-32 overflow-hidden rounded-t-lg bg-gradient-to-br from-primary/30 via-violet-500/20 to-blue-500/20">
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 50%, hsl(210 100% 60% / 0.4), transparent 50%), radial-gradient(circle at 80% 30%, hsl(280 80% 60% / 0.3), transparent 50%)",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-card" />
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-full bg-black/30 text-white/70 backdrop-blur-sm transition-colors hover:bg-black/50 hover:text-white"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Logo + Header */}
        <div className="-mt-7 px-6 pb-2 text-center">
          <img
            src="https://static.fizzspace.cn/static/pc/logo.png"
            alt="FizzDragon"
            className="mx-auto mb-3 h-14 object-contain drop-shadow-lg"
          />
          <DialogTitle className="text-xl font-bold">
            {mode === "login" ? t("welcomeBack") : t("createAccount")}
          </DialogTitle>
          <DialogDescription className="mt-1">
            {mode === "login" ? t("loginSubtitle") : t("registerSubtitle")}
          </DialogDescription>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3 px-6 pb-5 pt-4">
          {mode === "register" && (
            <Field>
              <FieldLabel required>{t("nameLabel")}</FieldLabel>
              <div className="relative">
                <IconUser className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("namePlaceholder")}
                  required
                  className="h-10 rounded-lg pl-10"
                />
              </div>
            </Field>
          )}

          <Field>
            <FieldLabel required>{t("emailLabel")}</FieldLabel>
            <div className="relative">
              <IconMail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("emailPlaceholder")}
                required
                className="h-10 rounded-lg pl-10"
              />
            </div>
          </Field>

          <Field>
            <FieldLabel required>{t("passwordLabel")}</FieldLabel>
            <div className="relative">
              <IconLock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("passwordPlaceholder")}
                required
                className="h-10 rounded-lg pl-10"
              />
            </div>
          </Field>

          {/* Verification code (register only) */}
          {mode === "register" && (
            <Field>
              <FieldLabel required>{t("codeLabel")}</FieldLabel>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <IconShield className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder={t("codePlaceholder")}
                    maxLength={6}
                    required
                    className="h-10 rounded-lg pl-10"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSendCode}
                  disabled={!email || codeCooldown > 0}
                  className="h-10 shrink-0 rounded-lg px-3 text-xs"
                >
                  {codeCooldown > 0 ? `${codeCooldown}s` : t("sendCode")}
                </Button>
              </div>
            </Field>
          )}

          {mode === "login" && (
            <div className="text-right">
              <button type="button" className="text-xs text-primary hover:underline">
                {t("forgotPassword")}
              </button>
            </div>
          )}

          {error && <FieldError>{error}</FieldError>}

          <Button type="submit" disabled={loading} className="w-full rounded-lg">
            {loading ? t("loading") : mode === "login" ? t("login") : t("register")}
          </Button>
        </form>

        {/* Switch mode */}
        <div className="border-t border-border px-6 py-3 text-center text-sm text-muted-foreground">
          {mode === "login" ? t("noAccount") : t("hasAccount")}{" "}
          <button
            type="button"
            onClick={switchMode}
            className="font-medium text-primary hover:underline"
          >
            {mode === "login" ? t("goRegister") : t("goLogin")}
          </button>
        </div>

        {/* Terms */}
        <div className="px-6 pb-4 text-center text-[11px] leading-relaxed text-muted-foreground/60">
          {t("agreePrefix")}{" "}
          <a href="/terms" className="text-muted-foreground hover:text-foreground">
            {t("terms")}
          </a>{" "}
          {t("and")}{" "}
          <a href="/privacy" className="text-muted-foreground hover:text-foreground">
            {t("privacy")}
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
