"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { IconLoader2 } from "@tabler/icons-react";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { useCreatorDetail } from "@/app/(site)/creators/_hooks/use-creator";
import { ServicesTab } from "@/app/(site)/creators/_components/center/tabs/services-tab";
import { CreatorLocationEditor } from "@/app/(site)/creators/_components/creator-location-editor";

/** Preserve owner service management outside the IP-first profile portfolio. */
export default function ProfileServicesPage() {
  const { user, isFetched } = useCurrentUser();
  const { open } = useAuthDialog();
  const router = useRouter();
  const locale = useLocale() as Locale;
  const t = useTranslations("creatorCenter");
  const tc = useTranslations("common");
  const { data: creator, isLoading, error, isFetching, refetch } = useCreatorDetail(user?.id ?? "");

  useEffect(() => {
    if (!isFetched || user) return;
    open({ mode: "stay", onDismiss: () => router.replace(localizePath("/", locale)) });
  }, [isFetched, user, open, router, locale]);

  if (!user || isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <IconLoader2 className="size-6 animate-spin" />
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 md:px-8">
      <Link
        className="text-sm text-muted-foreground hover:text-foreground"
        href={localizePath("/profile", locale)}
      >
        {t("cta.backToProfile")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("cta.manageServices")}</h1>
      <CreatorLocationEditor />
      {error ? (
        <div className="space-y-3">
          <p role="alert" className="break-words text-sm text-red-400">
            {error.message}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            {tc("retry")}
          </Button>
        </div>
      ) : creator ? (
        <ServicesTab key={user.id} creator={creator} isOwner />
      ) : (
        <p>{t("notFoundDesc")}</p>
      )}
    </main>
  );
}
