"use client";

import { regionLabel } from "@repo/shared/regions";
import type { CreatorLocationProfile } from "@repo/shared/creator-location";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { ApiRequestError } from "@/src/lib/api";
import type { Creator } from "../../_hooks/use-creator";
import { usePublicStudioProfile } from "../../_hooks/use-public-studio-profile";
import { ServicesTab } from "./tabs/services-tab";

/** Public service offers are independent of optional studio location metadata. Owner
 * editing remains at /profile/services and is never enabled by this panel. */
export function PublicStudioServices({ creator }: { creator: Creator }) {
  const { user, isLoading } = useCurrentUser();
  const locale = useLocale();
  if (isLoading) return null;
  return (
    <Panel
      key={`${creator.id}:${user?.id ?? "guest"}:${locale}`}
      creator={creator}
      viewerId={user ? String(user.id) : null}
    />
  );
}

function Panel({ creator, viewerId }: { creator: Creator; viewerId: string | null }) {
  const t = useTranslations("creatorStudio");
  const locale = useLocale();
  const query = usePublicStudioProfile(creator.id, viewerId);
  const place = (city: NonNullable<CreatorLocationProfile["basedIn"]>) =>
    `${city.city}, ${regionLabel(city.countryCode, locale)}`;
  const unavailable = query.error instanceof ApiRequestError && query.error.status === 404;
  return (
    <section id="services" aria-label={t("title")} className="min-w-0 space-y-4">
      {unavailable ? null : query.isFetching ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("loading")}
        </p>
      ) : query.error ? (
        <div className="space-y-3">
          <p role="alert" className="break-words text-sm text-red-400">
            {query.error.message}
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => void query.refetch()}
          >
            {t("retry")}
          </Button>
        </div>
      ) : query.data ? (
        <>
          <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
            {query.data.showOnMap && query.data.basedIn && (
              <div>
                <dt className="text-muted-foreground">{t("basedIn")}</dt>
                <dd>{place(query.data.basedIn)}</dd>
              </div>
            )}
            {query.data.serves.length > 0 && (
              <div className="min-w-0">
                <dt className="text-muted-foreground">{t("serves")}</dt>
                <dd className="break-words">{query.data.serves.map(place).join(" · ")}</dd>
              </div>
            )}
            {query.data.remote && (
              <div>
                <dt className="text-muted-foreground">{t("delivery")}</dt>
                <dd>{t("remote")}</dd>
              </div>
            )}
          </dl>
        </>
      ) : null}
      <ServicesTab creator={creator} isOwner={false} />
    </section>
  );
}
