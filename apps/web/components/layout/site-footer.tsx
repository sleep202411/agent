"use client";

import { useMemo } from "react";
import Link from "next/link";
import { IconBrandDiscord, IconBrandWechat, IconBrandWhatsapp } from "@tabler/icons-react";
import type { Icon } from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { siteConfig } from "@/src/config/site";

type LinkKey = string;
type FooterLink = { key: LinkKey; href: string; external?: boolean };
type FooterCol = { titleKey: string; links: FooterLink[] };

type PopoverAlign = "left" | "center" | "right";
type Social = { id: string; label: string; Icon: Icon; qr: string; align: PopoverAlign };

// Each popover anchors so it never escapes the social-row's left/right edges:
// the leftmost pins to its button's left edge, rightmost to the right edge.
const SOCIALS: Social[] = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    Icon: IconBrandWhatsapp,
    qr: "/whatsapp-qr.png",
    align: "left",
  },
  {
    id: "discord",
    label: "Discord",
    Icon: IconBrandDiscord,
    qr: "/discord-qr.png",
    align: "center",
  },
  { id: "wechat", label: "WeChat", Icon: IconBrandWechat, qr: "/wechat-group.png", align: "right" },
];

const ALIGN_CLASS: Record<PopoverAlign, string> = {
  left: "left-0",
  center: "left-1/2 -translate-x-1/2",
  right: "right-0",
};

// Routes are unprefixed; localizePath() prepends the active locale at render time.
const COLUMNS: FooterCol[] = [
  {
    titleKey: "platform.title",
    links: [
      { key: "platform.plaza", href: "/" },
      { key: "platform.crews", href: "/crews" },
      { key: "platform.ips", href: "/ips" },
      { key: "platform.workspace", href: "/login" },
    ],
  },
  {
    titleKey: "company.title",
    links: [
      { key: "company.about", href: "/about" },
      { key: "company.creators", href: "/creators" },
      { key: "company.certificateVerify", href: "/certificates/verify" },
      { key: "company.faq", href: "/faq" },
      { key: "company.contact", href: "mailto:business@fizzdragon.com", external: true },
    ],
  },
  {
    titleKey: "legal.title",
    links: [
      { key: "legal.privacy", href: "/privacy-policy" },
      { key: "legal.terms", href: "/terms-of-service" },
      { key: "legal.refund", href: "/refund-policy" },
    ],
  },
];

export function SiteFooter() {
  const t = useTranslations("footer");
  const locale = useLocale() as Locale;
  // Region check is build-time, baked into the bundle from
  // `NEXT_PUBLIC_SITE_REGION`. SSR and the client agree on the
  // value from the very first render — no flash of "wrong" footer
  // on the .cn deployment like the previous useEffect-based
  // hostname sniff produced.
  const isCnSite = siteConfig.region === "cn";

  const columns = useMemo(
    () =>
      COLUMNS.map((col) => ({
        title: t(col.titleKey),
        links: col.links.map((l) => ({
          label: t(l.key),
          href: l.external ? l.href : localizePath(l.href, locale),
          external: l.external ?? false,
        })),
      })),
    [t, locale]
  );

  return (
    <footer className="mt-20 border-t border-border">
      <div className="mx-auto max-w-screen-2xl px-6 py-12">
        <div className="flex flex-col gap-10 lg:flex-row">
          <div className="flex shrink-0 flex-col lg:w-64 items-start">
            <img src="/logo.png" alt="FizzDragon" className="h-8 w-auto" />
            <div className="relative z-10 mt-8 flex gap-3">
              {SOCIALS.map(({ id, label, Icon, qr, align }) => (
                <div key={id} className="group relative">
                  <button
                    type="button"
                    aria-label={label}
                    className="flex size-9 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-80"
                  >
                    <Icon className="size-4" />
                  </button>
                  <div
                    className={`pointer-events-none absolute bottom-full z-50 mb-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 ${ALIGN_CLASS[align]}`}
                  >
                    <div className="w-max rounded-xl border border-border bg-popover p-2 shadow-lg">
                      <img
                        src={qr}
                        alt={`${label} QR`}
                        width={144}
                        height={144}
                        className="block aspect-square size-36 rounded-md object-contain"
                      />
                      <p className="mt-1.5 text-center text-xs font-medium text-popover-foreground">
                        {label}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-8 space-y-2">
              {/* Singapore IMDA content licence — only shown on the
                  international (.com) site, since the .cn deployment
                  surfaces Chinese ICP filing in its own footer block
                  below. The licence sits above the copyright per the
                  legal team's preferred ordering. */}
              {!isCnSite ? (
                <p className="text-[11px] leading-relaxed text-muted-foreground/80">
                  {t("singaporeLicense")}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {t("copyright", { year: new Date().getFullYear() })}
              </p>
            </div>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-8 lg:grid-cols-3">
            {columns.map((col) => (
              <div key={col.title}>
                <h4 className="mb-4 text-sm font-bold text-foreground">{col.title}</h4>
                <ul className="flex flex-col gap-2.5">
                  {col.links.map((link) =>
                    link.external ? (
                      <li key={link.label}>
                        <a
                          href={link.href}
                          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {link.label}
                        </a>
                      </li>
                    ) : (
                      <li key={link.label}>
                        <Link
                          href={link.href}
                          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {link.label}
                        </Link>
                      </li>
                    )
                  )}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {isCnSite ? (
          <div className="mt-8 pb-8 border-t border-border pt-6 text-center text-xs text-muted-foreground">
            <p>
              © {new Date().getFullYear()} Fizz共创平台 版权所有{" "}
              <a
                href="https://beian.miit.gov.cn/"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-foreground"
              >
                苏ICP备2025193486号-1
              </a>
            </p>
            <p className="mt-1">联系我们：business@fizzdragon.com</p>
          </div>
        ) : null}
      </div>
    </footer>
  );
}
