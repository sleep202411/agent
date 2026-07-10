"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { IconLoader2, IconX } from "@tabler/icons-react";
import { login } from "@/lib/auth";
import { buildWebHref, WEB_PATHS } from "@/lib/web-base";
import { useSiteRegion } from "@/app/_components/region-provider";

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
  const siteRegion = useSiteRegion();
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
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fizzstudio-login-title"
        aria-describedby="fizzstudio-login-subtitle"
        className="relative flex h-[min(620px,calc(100dvh-2rem))] max-h-[calc(100vh-2rem)] w-full max-w-[480px] overflow-hidden rounded-3xl bg-[oklch(0.16_0_0)] shadow-2xl shadow-black/60 duration-200 animate-in fade-in-0 zoom-in-95 lg:max-w-[980px]"
      >
        {/* Form panel */}
        <div className="flex min-w-0 flex-1 overflow-y-auto">
          <div className="m-auto flex w-full flex-col items-center px-6 py-8 sm:px-10 lg:px-12">
            <Image
              src="/logo.png"
              alt={tc("fizzDragon")}
              width={439}
              height={78}
              className="h-8 w-auto"
            />
            <h2 id="fizzstudio-login-title" className="mt-5 text-[22px] font-semibold leading-7">
              {t("welcomeTitle")}
            </h2>
            <p id="fizzstudio-login-subtitle" className="mt-1.5 text-sm text-muted-foreground">
              {t("welcomeSubtitle")}
            </p>

            <form onSubmit={submit} className="mt-7 w-full max-w-[360px] space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-white/70">
                  {t("identifierLabel")}
                </span>
                <input
                  type="text"
                  autoFocus
                  autoComplete="username"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  placeholder={t("identifierPlaceholder")}
                  className="h-11 w-full rounded-xl bg-input/25 px-3.5 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 sm:text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 flex items-center justify-between gap-4 text-xs font-medium text-white/70">
                  <span>{t("passwordLabel")}</span>
                  <a
                    href={buildWebHref(siteRegion, locale, WEB_PATHS.forgotPassword)}
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
                  className="h-11 w-full rounded-xl bg-input/25 px-3.5 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 sm:text-sm"
                />
              </label>

              {error && <p className="text-xs text-destructive">{error}</p>}

              <button
                type="submit"
                disabled={!canSubmit}
                // Brand red as the hero CTA — sanctioned case-by-case accent.
                className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#E52227] text-sm font-semibold text-white shadow-lg shadow-[#E52227]/25 transition-colors hover:bg-[#c91e22] disabled:opacity-40"
              >
                {submitting && <IconLoader2 className="size-4 animate-spin" stroke={2} />}
                {t("signIn")}
              </button>
            </form>

            <div className="mt-6 max-w-sm space-y-3 text-center text-[11px] leading-4 text-muted-foreground">
              <p>
                {t.rich("registerPrompt", {
                  register: (chunks) => (
                    <a
                      href={buildWebHref(siteRegion, locale, WEB_PATHS.register)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-white/80 underline-offset-2 transition-colors hover:text-white hover:underline"
                    >
                      {chunks}
                    </a>
                  ),
                })}
              </p>
              <div className="space-y-0.5">
                <p>
                  {t.rich("termsNotice", {
                    terms: (chunks) => (
                      <a
                        href={buildWebHref(siteRegion, locale, WEB_PATHS.terms)}
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
                        href={buildWebHref(siteRegion, locale, WEB_PATHS.privacy)}
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
        </div>

        {/* Hero artwork */}
        <div className="relative hidden w-[420px] shrink-0 lg:block">
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
          className="absolute top-3 right-3 z-10 flex size-11 items-center justify-center rounded-full bg-black/45 text-white/80 backdrop-blur-md transition-colors hover:bg-black/65 hover:text-white sm:size-8"
        >
          <IconX className="size-4.5 sm:size-4" stroke={1.8} />
        </button>
      </div>
    </div>,
    document.body
  );
}
