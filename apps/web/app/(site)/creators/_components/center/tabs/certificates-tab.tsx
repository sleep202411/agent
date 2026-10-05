"use client";

/**
 * CertificatesTab — public credibility surface for issued creator
 * certificates backed by the Nest certificate registry.
 */
import { useEffect, useState } from "react";
import {
  IconAward,
  IconCalendar,
  IconCertificate,
  IconDownload,
  IconId,
  IconShieldCheck,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import type { Creator } from "@/app/(site)/creators/_hooks/use-creator";
import { useCreatorCertificates } from "@/app/(site)/creators/_hooks/use-certificates";
import type { CreatorCertificate } from "@/app/(site)/creators/_data/certificates";

interface CertificatesTabProps {
  creator: Creator;
  isOwner: boolean;
}

export function CertificatesTab({ creator, isOwner }: CertificatesTabProps) {
  const t = useTranslations("creatorCenter");
  const locale = useLocale() as Locale;
  const common = useTranslations("common");
  const {
    data: certificates = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useCreatorCertificates(creator.id);
  const featured = certificates[0];
  const [previewCertificate, setPreviewCertificate] = useState<CreatorCertificate | null>(null);

  if (isLoading) {
    return <CertificatesSkeleton />;
  }

  if (isError) {
    return (
      <div role="alert" className="space-y-3 rounded-2xl bg-card/40 px-6 py-8">
        <p className="break-words text-sm text-muted-foreground">
          {error?.message || common("loadFailed")}
        </p>
        <Button size="sm" variant="outline" disabled={isFetching} onClick={() => void refetch()}>
          {isFetching ? common("loading") : common("retry")}
        </Button>
      </div>
    );
  }

  if (!featured) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-card/40 px-6 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
          <IconCertificate className="size-5" />
        </div>
        <div className="max-w-md space-y-1.5">
          <h3 className="text-sm font-semibold text-foreground">
            {isOwner ? t("certificates.emptyOwnerTitle") : t("certificates.emptyVisitorTitle")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {isOwner ? t("certificates.emptyOwnerBody") : t("certificates.emptyVisitorBody")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl bg-card">
        <div className="p-5 sm:p-6">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
              <IconShieldCheck className="size-3.5" />
              {t("certificates.verified")}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              <IconSparkles className="size-3.5" />
              {t("certificates.publicSignal")}
            </span>
          </div>

          <div className="max-w-3xl space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t("certificates.eyebrow")}
            </p>
            <h3 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {t("certificates.heading", { name: creator.name })}
            </h3>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {t("certificates.body")}
            </p>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Metric
              label={t("certificates.metricActive")}
              value={String(certificates.length)}
              detail={t("certificates.metricActiveDetail")}
            />
            <Metric
              label={t("certificates.metricLatest")}
              value={formatDate(featured.issuedAt, locale, "short")}
              detail={featured.title}
            />
            <Metric
              label={t("certificates.metricIssuer")}
              value={featured.issuer}
              detail={t("certificates.metricIssuerDetail")}
            />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
        {certificates.map((certificate) => (
          <CertificateCard
            key={certificate.id}
            certificate={certificate}
            locale={locale}
            onOpen={() => setPreviewCertificate(certificate)}
          />
        ))}
      </div>

      <CertificatePreviewDialog
        certificate={previewCertificate}
        onOpenChange={(open) => {
          if (!open) setPreviewCertificate(null);
        }}
      />
    </div>
  );
}

function CertificatesSkeleton() {
  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl bg-card">
        <div className="space-y-4 p-5 sm:p-6">
          <div className="h-6 w-32 animate-pulse rounded-full bg-secondary" />
          <div className="h-8 w-2/3 animate-pulse rounded-lg bg-secondary" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-secondary" />
          <div className="grid gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-20 animate-pulse rounded-xl bg-secondary" />
            ))}
          </div>
        </div>
      </section>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="aspect-[3/4] animate-pulse rounded-2xl bg-card" />
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/35 px-4 py-3">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tracking-tight text-foreground">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{detail}</div>
    </div>
  );
}

function CertificateCard({
  certificate,
  locale,
  onOpen,
}: {
  certificate: CreatorCertificate;
  locale: Locale;
  onOpen: () => void;
}) {
  const t = useTranslations("creatorCenter");
  return (
    <article className="overflow-hidden rounded-2xl bg-card transition-transform hover:-translate-y-0.5">
      <button
        type="button"
        className="block w-full cursor-zoom-in text-left"
        aria-label={t("certificates.viewCertificate")}
        onClick={onOpen}
      >
        <CertificateImagePreview certificate={certificate} compact />
      </button>
      <div className="p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
            <IconShieldCheck className="size-3.5" />
            {t("certificates.verified")}
          </span>
        </div>
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
          {certificate.title}
        </h3>
        {certificate.description ? (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {certificate.description}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5 border-t border-border px-3 py-2.5 text-[11px]">
        {certificate.program ? (
          <InfoLine
            icon={<IconAward className="size-3.5" />}
            label={t("certificates.program")}
            value={certificate.program}
          />
        ) : null}
        <InfoLine
          icon={<IconCalendar className="size-3.5" />}
          label={t("certificates.issuedAt")}
          value={formatDate(certificate.issuedAt, locale)}
        />
        <InfoLine
          icon={<IconId className="size-3.5" />}
          label={t("certificates.certNo")}
          value={certificate.certNo}
          mono
        />
      </div>
    </article>
  );
}

function CertificatePreviewDialog({
  certificate,
  onOpenChange,
}: {
  certificate: CreatorCertificate | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("creatorCenter");
  const imageUrl = certificate?.imageUrl;
  const handleDownload = async () => {
    if (!certificate?.imageUrl) return;

    const fileName = certificateDownloadName(certificate);
    try {
      const response = await fetch(certificate.imageUrl);
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      triggerBrowserDownload(objectUrl, fileName);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch {
      triggerBrowserDownload(certificate.imageUrl, fileName, true);
    }
  };

  useEffect(() => {
    if (!certificate) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [certificate, onOpenChange]);

  if (!certificate) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/80 backdrop-blur-sm"
        aria-label={t("certificates.closePreview")}
        onClick={() => onOpenChange(false)}
      />

      <div className="relative flex max-h-[94dvh] w-[min(96vw,1280px)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-background shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground sm:text-base">
              {certificate.title}
            </h2>
            <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
              {certificate.certNo}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {imageUrl ? (
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-secondary"
                onClick={() => void handleDownload()}
              >
                <IconDownload className="size-4" />
                <span className="hidden sm:inline">{t("certificates.downloadCertificate")}</span>
              </button>
            ) : null}
            <button
              type="button"
              className="inline-flex size-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label={t("certificates.closePreview")}
              onClick={() => onOpenChange(false)}
            >
              <IconX className="size-4" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-2 sm:p-4">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={certificate.title}
              className="max-h-[calc(94dvh-86px)] w-auto max-w-full object-contain"
            />
          ) : (
            <div className="w-full max-w-5xl">
              <CertificateImagePreview certificate={certificate} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function certificateDownloadName(certificate: CreatorCertificate): string {
  return `${certificate.certNo}.png`;
}

function triggerBrowserDownload(url: string, fileName: string, openInNewTab = false) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  if (openInNewTab) {
    link.target = "_blank";
    link.rel = "noreferrer";
  }
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function CertificateImagePreview({
  certificate,
  compact = false,
}: {
  certificate: CreatorCertificate;
  compact?: boolean;
}) {
  const t = useTranslations("creatorCenter");
  const imageUrl = certificate.imageUrl;

  if (imageUrl) {
    return (
      <div
        className={cn(
          "relative overflow-hidden bg-secondary",
          compact ? "aspect-[16/9]" : "aspect-[16/9] w-full rounded-xl"
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={certificate.title}
          className="size-full object-cover"
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden border border-white/10 bg-[linear-gradient(112deg,#090506_0%,#15080c_42%,#101622_100%)] shadow-[0_22px_70px_rgba(0,0,0,0.28)]",
        compact ? "aspect-[16/9]" : "aspect-[16/9] w-full rounded-xl"
      )}
    >
      <div className="absolute -left-8 bottom-0 h-28 w-40 rotate-[-18deg] rounded-[45%] bg-sky-300/20 blur-xl" />
      <div className="absolute -right-10 top-2 h-32 w-48 rotate-12 rounded-[45%] bg-primary/25 blur-xl" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.08)_0,transparent_18%,transparent_82%,rgba(255,255,255,0.08)_100%)]" />

      <div className={cn("relative flex h-full flex-col", compact ? "p-4" : "p-6")}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <p
              className={cn(
                "font-black leading-none tracking-[-0.06em] text-white",
                compact ? "text-xl" : "text-3xl"
              )}
            >
              {t("certificates.previewGraduation")}
            </p>
            <p
              className={cn(
                "font-black leading-none tracking-[-0.04em] text-white",
                compact ? "text-xl" : "text-3xl"
              )}
            >
              {t("certificates.previewCertificate")}
            </p>
          </div>
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white/80">
            <IconCertificate className="size-5" />
          </div>
        </div>

        <div className="mt-auto grid grid-cols-[1fr_auto] items-end gap-4">
          <div className="min-w-0">
            <p
              className={cn(
                "line-clamp-1 font-semibold text-white",
                compact ? "text-xs" : "text-sm"
              )}
            >
              {certificate.title}
            </p>
            <p className="mt-1 truncate font-mono text-[10px] text-white/65">
              {certificate.certNo}
            </p>
          </div>
          <IconShieldCheck className="size-4 text-emerald-300" />
        </div>
      </div>
    </div>
  );
}

function InfoLine({
  icon,
  label,
  value,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-16 text-muted-foreground">{label}</span>
      <span
        className={cn("min-w-0 flex-1 truncate text-right text-foreground", mono && "font-mono")}
      >
        {value}
      </span>
    </div>
  );
}

function formatDate(value: string, locale: Locale, mode: "short" | "long" = "long"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: mode === "short" ? "short" : "long",
    day: mode === "short" ? undefined : "numeric",
  }).format(date);
}
