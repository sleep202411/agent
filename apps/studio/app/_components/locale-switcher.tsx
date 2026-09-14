"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { IconLanguage } from "@tabler/icons-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { LOCALE_OPTIONS, isValidLocale } from "@/i18n/config";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Shared by the header entry and the account menu. */
export function LocaleMenuItems() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenuRadioGroup
      value={locale}
      onValueChange={(next) => {
        if (!isValidLocale(next) || next === locale || pending) return;
        const href = `${pathname}${window.location.search}${window.location.hash}`;
        startTransition(() => router.replace(href, { locale: next, scroll: false }));
      }}
    >
      {LOCALE_OPTIONS.map((option) => (
        <DropdownMenuRadioItem
          key={option.value}
          value={option.value}
          disabled={pending}
          className="rounded-lg text-sm"
        >
          {option.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

export function LocaleSwitcher() {
  const t = useTranslations("localeSwitcher");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("label")}
        title={t("label")}
        className="flex size-8 shrink-0 items-center justify-center rounded-[12px] bg-white/[0.08] text-white transition hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-white/35"
      >
        <IconLanguage className="size-4" stroke={1.8} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40 p-1.5">
        <LocaleMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
