"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  IconBrandApple,
  IconBrandGooglePlay,
  IconDownload,
  IconDeviceMobileDown,
} from "@tabler/icons-react";
import { APP_DOWNLOADS_BY_SITE } from "@repo/shared";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTranslations } from "next-intl";
import { useSiteRegion } from "./region-provider";

export function AppDownloadMenu() {
  const t = useTranslations("shell.nav");
  const downloads = APP_DOWNLOADS_BY_SITE[useSiteRegion()];
  const [open, setOpen] = useState(false);
  const [qrCodes, setQrCodes] = useState<Record<string, string>>({});
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
  const onPointerEnter = (event: PointerEvent) => {
    if (event.pointerType === "mouse") keepOpen();
  };
  const onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType === "mouse") closeSoon();
  };

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  useEffect(() => {
    if (!open || downloads.every(({ href }) => qrCodes[href])) return;
    let cancelled = false;
    import("qrcode")
      .then(({ default: QRCode }) =>
        Promise.all(
          downloads.map(
            async ({ href }) =>
              [href, await QRCode.toDataURL(href, { width: 240, margin: 4 })] as const
          )
        )
      )
      .then((urls) => {
        if (!cancelled) setQrCodes((current) => ({ ...current, ...Object.fromEntries(urls) }));
      })
      .catch(() => {
        if (!cancelled) setQrFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, qrCodes, downloads]);

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
          type="button"
          aria-label={t("downloadApp")}
          className="relative flex size-9 items-center justify-center rounded-xl text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35"
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
        >
          <IconDeviceMobileDown className="size-[18px]" stroke={1.8} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        side="top"
        align="start"
        collisionPadding={12}
        sideOffset={12}
        aria-label={t("appDownloadTitle")}
        className="z-[70] w-[27rem] max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-1.5rem)] overflow-y-auto gap-4 rounded-2xl p-4 text-center shadow-xl"
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
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
          {downloads.map((item) => {
            const Icon =
              item.platform === "ios"
                ? IconBrandApple
                : item.download
                  ? IconDownload
                  : IconBrandGooglePlay;
            return (
              <div key={item.platform} className="flex min-w-0 flex-col gap-3">
                <div className="grid aspect-square w-full place-items-center overflow-hidden rounded-xl bg-white">
                  {qrCodes[item.href] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={qrCodes[item.href]}
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
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-2 text-xs font-medium text-black transition-colors hover:bg-zinc-200"
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
