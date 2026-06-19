"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { IconLanguage } from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GlassRim } from "@/components/ui/glass-rim";
import { isValidLocale, LOCALE_OPTIONS } from "@/i18n/config";

/**
 * Standalone language switcher (globe button) for the studio header — visible
 * whether or not the user is signed in, so the login screen has it too. With
 * URL routing, selecting a locale navigates to the same path under the new
 * prefix (next-intl also syncs the NEXT_LOCALE cookie).
 */
export function LocaleSwitcher() {
  const t = useTranslations("localeSwitcher");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function selectLocale(next: string) {
    if (!isValidLocale(next) || next === locale) return;
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("label")}
        disabled={pending}
        className="relative flex size-9 items-center justify-center rounded-full bg-secondary text-white/80 backdrop-blur-md backdrop-saturate-150 transition-colors outline-none hover:bg-accent hover:text-white focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-accent data-[state=open]:text-white"
      >
        <GlassRim />
        <IconLanguage className="size-5" stroke={1.8} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-40 p-1.5">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
