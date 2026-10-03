"use client";

import { useState, type FormEvent } from "react";
import {
  IconCertificate,
  IconCircleX,
  IconExternalLink,
  IconId,
  IconLoader2,
  IconSearch,
  IconShieldCheck,
  IconShieldX,
} from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import {
  CertificateVerifyApiError,
  certificateErrorDetail,
  verifyCertificate,
  type CertificateVerificationResult,
} from "./_data/api";

export default function CertificateVerificationPage() {
  const t = useTranslations("certificateVerification");
  const locale = useLocale();
  const [certNo, setCertNo] = useState("");
  const [result, setResult] = useState<CertificateVerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const normalized = normalizeCertNo(certNo);
    if (!normalized) {
      setResult(null);
      setError(t("emptyError"));
      return;
    }

    setCertNo(normalized);
    setSubmitting(true);
    setResult(null);
    setError(null);

    try {
      const nextResult = await verifyCertificate(normalized);
      setResult(nextResult);
    } catch (err) {
      setResult(null);
      setError(errorMessageFor(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-56px)] bg-background text-foreground">
      <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-24">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
          <section className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs font-medium text-muted-foreground">
              <IconShieldCheck className="size-3.5 text-primary" />
              {t("eyebrow")}
            </div>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              {t("title")}
            </h1>
            <p className="mt-5 max-w-xl text-base leading-8 text-muted-foreground">
              {t("description")}
            </p>
            <div className="mt-8 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
              <div className="border-l border-border pl-4">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground">
                  {t("exampleLabel")}
                </div>
                <div className="mt-1 font-mono text-sm text-muted-foreground">
                  FD-OPC-2605-8K3Q7P
                </div>
              </div>
              <div className="border-l border-border pl-4">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground">
                  {t("privacyTitle")}
                </div>
                <p className="mt-1 leading-6">{t("privacyNote")}</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-5 flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <IconCertificate className="size-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground">{t("toolTitle")}</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {t("toolDescription")}
                </p>
              </div>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <label className="block text-sm font-medium text-foreground" htmlFor="certNo">
                {t("inputLabel")}
              </label>
              <div className="relative">
                <IconId className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="certNo"
                  value={certNo}
                  disabled={submitting}
                  onChange={(event) => {
                    setCertNo(event.target.value);
                    setResult(null);
                    setError(null);
                  }}
                  placeholder={t("inputPlaceholder")}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="h-12 w-full rounded-xl border border-border bg-background pl-10 pr-3 font-mono text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {submitting ? (
                  <IconLoader2 className="size-4 animate-spin" />
                ) : (
                  <IconSearch className="size-4" />
                )}
                {submitting ? t("verifying") : t("verify")}
              </button>
            </form>
          </section>
        </div>

        {error ? <ErrorPanel message={error} /> : null}
        {result ? <ResultPanel result={result} locale={locale} /> : null}
      </div>
    </main>
  );
}

function ResultPanel({
  result,
  locale,
}: {
  result: CertificateVerificationResult;
  locale: string;
}) {
  const t = useTranslations("certificateVerification");
  const certificate = result.certificate;
  const valid = result.status === "valid";
  const revoked = result.status === "revoked";
  const StatusIcon = valid ? IconShieldCheck : revoked ? IconShieldX : IconCircleX;
  const title = valid ? t("validTitle") : revoked ? t("revokedTitle") : t("notFoundTitle");
  const body = valid ? t("validBody") : revoked ? t("revokedBody") : t("notFoundBody");
  const tone = valid
    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
    : revoked
      ? "border-amber-500/25 bg-amber-500/10 text-amber-300"
      : "border-destructive/25 bg-destructive/10 text-destructive";

  return (
    <section
      className="mt-8 rounded-2xl border border-border bg-card p-5 sm:p-6"
      aria-live="polite"
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${tone}`}
          >
            <StatusIcon className="size-4" />
            {title}
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{body}</p>
        </div>

        <div className="rounded-xl border border-border bg-background px-4 py-3">
          <div className="text-[11px] font-medium text-muted-foreground">{t("certNoLabel")}</div>
          <div className="mt-1 font-mono text-sm font-semibold text-foreground">
            {result.certNo}
          </div>
        </div>
      </div>

      {certificate ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-xl border border-border bg-background">
            <img
              src={certificate.imageUrl}
              alt={t("imageAlt", { title: certificate.title })}
              className="aspect-[4/3] w-full object-cover"
            />
          </div>

          <div>
            <h2 className="text-base font-semibold text-foreground">{t("detailsTitle")}</h2>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <Detail label={t("titleLabel")} value={certificate.title} />
              <Detail label={t("issuerLabel")} value={certificate.issuer} />
              <Detail label={t("issuedAtLabel")} value={formatDate(certificate.issuedAt, locale)} />
              {certificate.revokedAt ? (
                <Detail
                  label={t("revokedAtLabel")}
                  value={formatDate(certificate.revokedAt, locale)}
                />
              ) : null}
              {certificate.revokedReason ? (
                <Detail label={t("revokedReasonLabel")} value={certificate.revokedReason} />
              ) : null}
            </dl>
            <a
              href={certificate.imageUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-foreground transition-colors hover:text-primary"
            >
              <IconExternalLink className="size-4" />
              {t("viewImage")}
            </a>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <section
      className="mt-8 rounded-2xl border border-destructive/25 bg-destructive/10 p-5 text-sm text-destructive"
      aria-live="polite"
    >
      {message}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

function normalizeCertNo(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function errorMessageFor(
  err: unknown,
  t: (key: string, params?: Record<string, string | number | Date>) => string
): string {
  if (err instanceof CertificateVerifyApiError) {
    const detail = certificateErrorDetail(err.body);
    if (detail) return detail;
    if (err.status === 400) return t("formatError");
    if (err.status === 429) return t("rateLimitedError");
  }
  return t("requestError");
}

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}
