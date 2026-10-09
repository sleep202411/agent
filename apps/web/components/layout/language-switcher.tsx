"use client";

import { usePathname, useRouter } from "next/navigation";
import { IconCheck, IconLanguage } from "@tabler/icons-react";
import { useTranslations, useLocale, setLanguage } from "@/src/i18n/i18n";
import { setCurrentLocale, localizePath, stripLocalePrefix } from "@/src/i18n/locale-url";
import { SITE_LOCALE_OPTIONS, type Locale } from "@/src/i18n/config";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname() ?? "/";

  const currentLabel = SITE_LOCALE_OPTIONS.find((o) => o.value === locale)?.label ?? locale;

  const switchLocale = (next: Locale) => {
    if (next === locale) return;
    setCurrentLocale(next);
    setLanguage(next);
    const stripped = stripLocalePrefix(pathname);
    router.replace(localizePath(stripped, next));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("language")}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-sm text-muted-foreground outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            className
          )}
        >
          <IconLanguage className="size-4" />
          <span>{currentLabel}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuLabel>{t("language")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SITE_LOCALE_OPTIONS.map((opt) => {
          const current = opt.value === locale;
          return (
            <DropdownMenuItem
              key={opt.value}
              onSelect={() => switchLocale(opt.value)}
              className="justify-between"
            >
              <span>{opt.label}</span>
              {current ? <IconCheck className="size-4 text-primary" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
