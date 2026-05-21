"use client";

/**
 * Self-profile route. Mounts the same shell the public creator
 * page uses, with `creatorId = currentUser.id` so the shell's
 * own owner-detection switches it into owner mode (CTAs, edit
 * affordances, etc).
 *
 * The historical profile page lived here as a dedicated layout
 * with per-section dialogs (KYC alert, publish work dialog,
 * project edit dialog, social link editor). Those dialog files
 * still exist under `_hooks/` and `*-dialog.tsx`; they get
 * re-wired into the CreatorCenter sections as Phase 1b lands.
 */
import { IconLoader2 } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { useCurrentUser } from "@/src/hooks/use-user";
import { CreatorCenter } from "@/app/(site)/creators/_components/center/creator-center";

export default function ProfilePage() {
  const t = useTranslations("creatorCenter");
  const router = useRouter();
  const locale = useLocale() as Locale;
  const { user, isLoading, isFetched } = useCurrentUser();

  // Not logged in: bounce to login. Server-side gating happens in
  // the layout; this is the client-side recovery if the cookie is
  // gone by the time the page renders.
  useEffect(() => {
    if (isFetched && !user) {
      router.replace(localizePath("/login", locale));
    }
  }, [isFetched, user, router, locale]);

  if (isLoading || !user) {
    return (
      <div className="flex h-[calc(100dvh-56px)] items-center justify-center">
        <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <CreatorCenter creatorId={user.id} />;
}
