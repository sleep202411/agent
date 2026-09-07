"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { IconBrandApple, IconBrandGooglePlay, IconDownload } from "@tabler/icons-react";
import { APP_DOWNLOADS_BY_SITE } from "@repo/shared";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTranslations } from "@/src/i18n/i18n";

const siteRegion = process.env.NEXT_PUBLIC_SITE_REGION;
if (siteRegion !== "cn" && siteRegion !== "global" && siteRegion !== "com") {
  throw new Error("NEXT_PUBLIC_SITE_REGION must be set to cn, global, or com for App downloads");
}

export const APP_DOWNLOADS = APP_DOWNLOADS_BY_SITE[siteRegion === "cn" ? "cn" : "global"];

export function AppDownloadMenu({
  className,
  triggerRef,
}: {
  className?: string;
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const [qrCodes, setQrCodes] = useState<string[]>();
  const [qrFailed, setQrFailed] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const contentRef = useRef<HTMLDivElement>(null);
  const openedByHover = useRef(false);

  const keepOpen = () => {
    clearTimeout(closeTimer.current);
    openedByHover.current = true;
    setOpen(true);
  };
  const closeSoon = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      if (!contentRef.current?.contains(document.activeElement)) setOpen(false);
    }, 180);
  };

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  useEffect(() => {
    if (!open || qrCodes) return;
    let cancelled = false;
    import("qrcode")
      .then(({ default: QRCode }) =>
        Promise.all(
          APP_DOWNLOADS.map(({ href }) => QRCode.toDataURL(href, { width: 240, margin: 4 }))
        )
      )
      .then((urls) => {
        if (!cancelled) setQrCodes(urls);
      })
      .catch(() => {
        if (!cancelled) setQrFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, qrCodes]);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        clearTimeout(closeTimer.current);
        openedByHover.current = false;
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className={className}
          onMouseEnter={keepOpen}
          onMouseLeave={closeSoon}
        >
          {t("app")}
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        align="end"
        sideOffset={12}
        aria-label={t("appDownloadTitle")}
        className="z-[70] w-[28rem] max-w-[calc(100vw-2rem)] gap-4 rounded-2xl bg-zinc-950 p-4 text-center text-white shadow-xl ring-0"
        onMouseEnter={keepOpen}
        onMouseLeave={closeSoon}
        onOpenAutoFocus={(event) => {
          if (openedByHover.current) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          if (openedByHover.current) event.preventDefault();
        }}
      >
        <div>
          <p className="text-sm font-semibold">{t("appDownloadTitle")}</p>
          <p className="mt-1 text-xs text-white/55">{t("appScanToDownload")}</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {APP_DOWNLOADS.map((item, index) => {
            const Icon =
              item.platform === "ios"
                ? IconBrandApple
                : item.download
                  ? IconDownload
                  : IconBrandGooglePlay;
            return (
              <div key={item.platform} className="flex min-w-0 flex-col gap-3">
                <div className="grid aspect-square w-full place-items-center overflow-hidden rounded-xl bg-white">
                  {qrCodes?.[index] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={qrCodes[index]}
                      alt={t("appQrAlt", { platform: t(item.labelKey) })}
                      width={240}
                      height={240}
                      className="size-full"
                    />
                  ) : (
                    <span className="px-4 text-xs text-zinc-500">
                      {qrFailed ? t("appQrUnavailable") : t("appQrLoading")}
                    </span>
                  )}
                </div>
                <a
                  href={item.href}
                  download={item.download}
                  target={item.download ? undefined : "_blank"}
                  rel={item.download ? undefined : "noopener noreferrer"}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-white px-3 text-sm font-medium text-black transition-colors hover:bg-zinc-200"
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {t(item.labelKey)}
                </a>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
