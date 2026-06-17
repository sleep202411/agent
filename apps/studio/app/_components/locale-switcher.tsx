"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { IconLanguage } from "@tabler/icons-react";
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { isValidLocale, LOCALE_OPTIONS } from "@/i18n/config";

/**
 * Language picker, rendered as a submenu inside the account dropdown. With
 * URL-based routing, switching navigates to the same path under the new locale
 * prefix (e.g. /en-US/canvas → /zh-CN/canvas); next-intl also syncs the
 * NEXT_LOCALE cookie so the choice persists across visits.
 */
export function LocaleSwitcher() {
  const t = useTranslations("localeSwitcher");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const current = LOCALE_OPTIONS.find((o) => o.value === locale)?.label;

  function selectLocale(next: string) {
    if (!isValidLocale(next) || next === locale) return;
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2.5 rounded-lg p-2 text-sm" disabled={pending}>
        <IconLanguage className="size-4.5" stroke={1.8} />
        <span className="flex-1">{t("label")}</span>
        <span className="text-xs text-muted-foreground">{current}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-40">
        <DropdownMenuRadioGroup value={locale} onValueChange={selectLocale}>
          {LOCALE_OPTIONS.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className="rounded-lg text-sm"
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
