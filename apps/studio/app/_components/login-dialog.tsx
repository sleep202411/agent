"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { IconLoader2, IconX } from "@tabler/icons-react";
import { login } from "@/lib/auth";

const WEB_PATHS = {
  register: "/register",
  forgotPassword: "/forgot-password",
  terms: "/terms-of-service",
  privacy: "/privacy-policy",
} as const;

function buildWebHref(locale: string, path: (typeof WEB_PATHS)[keyof typeof WEB_PATHS]) {
  const safeLocale =
    locale === "zh-CN" || locale === "zh-HK" || locale === "en-US" ? locale : "en-US";
  const origin =
    safeLocale === "zh-CN" ? "https://fizzdragon.fizzspace.cn" : "https://fizzdragon.com";
  return `${origin}/${safeLocale}${path}`;
}

/**
 * Global sign-in dialog (imagine.art layout): form panel + hero artwork.
 * Email / phone + password only — the same Java login the web app uses.
 */
export function LoginDialog({
  onClose,
  onLoggedIn,
}: {
  onClose: () => void;
  onLoggedIn: () => void;
}) {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const canSubmit = identifier.trim().length > 2 && password.length >= 6 && !submitting;

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(identifier, password);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("signInFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <div className="relative flex h-[min(768px,calc(100vh-2rem))] w-full max-w-[1200px] overflow-hidden rounded-3xl bg-[oklch(0.16_0_0)] shadow-2xl shadow-black/60 duration-200 animate-in fade-in-0 zoom-in-95">
        {/* Form panel */}
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center px-8 py-14 sm:px-14">
          <Image src="/logo.png" alt="FizzDragon" width={439} height={78} className="h-9 w-auto" />
          <h2 className="mt-6 text-2xl font-semibold">{t("welcomeTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("welcomeSubtitle")}</p>

          <form onSubmit={submit} className="mt-10 w-full max-w-[420px] space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-white/70">
                {t("identifierLabel")}
              </span>
              <input
                type="text"
                autoFocus
                autoComplete="username"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder={t("identifierPlaceholder")}
                className="h-12 w-full rounded-xl bg-input/25 px-4 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 flex items-center justify-between gap-4 text-xs font-medium text-white/70">
                <span>{t("passwordLabel")}</span>
                <a
                  href={buildWebHref(locale, WEB_PATHS.forgotPassword)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-white/75 underline-offset-2 transition-colors hover:text-white hover:underline"
                >
                  {t("forgotPassword")}
                </a>
              </span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                className="h-12 w-full rounded-xl bg-input/25 px-4 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <button
              type="submit"
              disabled={!canSubmit}
              // Brand red as the hero CTA — sanctioned case-by-case accent.
              className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#E52227] text-sm font-semibold text-white shadow-lg shadow-[#E52227]/25 transition-colors hover:bg-[#c91e22] disabled:opacity-40"
            >
              {submitting && <IconLoader2 className="size-4 animate-spin" stroke={2} />}
              {t("signIn")}
            </button>
          </form>

          <div className="mt-8 max-w-sm space-y-5 text-center text-xs leading-5 text-muted-foreground">
            <p>
              {t.rich("registerPrompt", {
                register: (chunks) => (
                  <a
                    href={buildWebHref(locale, WEB_PATHS.register)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-white/80 underline-offset-2 transition-colors hover:text-white hover:underline"
                  >
                    {chunks}
                  </a>
                ),
              })}
            </p>
            <div className="space-y-1">
              <p>
                {t.rich("termsNotice", {
                  terms: (chunks) => (
                    <a
                      href={buildWebHref(locale, WEB_PATHS.terms)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-white/80 underline-offset-2 transition-colors hover:text-white hover:underline"
                    >
                      {chunks}
                    </a>
                  ),
                })}
              </p>
              <p>
                {t.rich("privacyNotice", {
                  privacy: (chunks) => (
                    <a
                      href={buildWebHref(locale, WEB_PATHS.privacy)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-white/80 underline-offset-2 transition-colors hover:text-white hover:underline"
                    >
                      {chunks}
                    </a>
                  ),
                })}
              </p>
            </div>
          </div>
        </div>

        {/* Hero artwork */}
        <div className="relative hidden w-[520px] shrink-0 md:block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/login-hero-landscape.webp"
            alt=""
            className="absolute inset-0 size-full object-cover"
          />
          {/* Prompt caption */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 pt-10">
            <p className="line-clamp-2 text-[11px] leading-4 text-white/80">{t("heroPrompt")}</p>
            <p className="mt-1.5 text-[10px] font-medium text-white/50">{t("heroCaption")}</p>
          </div>
        </div>

        <button
          type="button"
          aria-label={tc("close")}
          onClick={onClose}
          className="absolute top-4 right-4 z-10 flex size-9 items-center justify-center rounded-full bg-black/45 text-white/80 backdrop-blur-md transition-colors hover:bg-black/65 hover:text-white"
        >
          <IconX className="size-4.5" stroke={1.8} />
        </button>
      </div>
    </div>,
    document.body
  );
}
