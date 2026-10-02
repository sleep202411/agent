"use client";

/**
 * Crew detail — single canonical layout backed by `/aurora/crews/:id`.
 *
 * The legacy fizzdragon-web `projectDetail`-backed fallback was deleted
 * once the Nest crew module shipped; everything now resolves through
 * the new endpoint or 404s cleanly.
 */

import { useEffect } from "react";
import { useCrewLinkedIps } from "../_hooks/use-crew-linked-ips";
import { useParams, useRouter } from "next/navigation";
import { IconLoader2 } from "@tabler/icons-react";
import { useCrewDetail } from "@/app/(site)/crews/_hooks/use-crew";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { CrewApiError } from "../_hooks/api";
import { CrewDetail } from "./_components/crew-detail-new";

export default function CrewDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const tc = useTranslations("common");
  const { data: crew, isLoading, isError, error, isFetching, refetch } = useCrewDetail(id);
  const locale = useLocale();
  const router = useRouter();
  const linkedIps = useCrewLinkedIps(
    id,
    Boolean(crew && !isError && crew.listingStatus === "listed")
  );
  const ipId =
    !isError &&
    crew?.listingStatus === "listed" &&
    !linkedIps.isError &&
    linkedIps.data?.length === 1
      ? linkedIps.data[0]?.id
      : undefined;
  useEffect(() => {
    if (ipId) router.replace(`/${locale}/ips/${encodeURIComponent(ipId)}`);
  }, [ipId, locale, router]);
  const unavailable =
    isError && error instanceof CrewApiError && [401, 403, 404].includes(error.status);
  const retry =
    isError && !unavailable ? (
      <div
        role="alert"
        className="flex items-center justify-center gap-3 p-4 text-sm text-destructive"
      >
        <span>{error instanceof Error ? error.message : tc("loadFailed")}</span>
        <Button variant="outline" disabled={isFetching} onClick={() => void refetch()}>
          {tc("retry")}
        </Button>
      </div>
    ) : null;

  if (isLoading || ipId || (crew?.listingStatus === "listed" && linkedIps.isPending && !isError)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (unavailable || (!crew && !retry)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Not found
      </div>
    );
  }

  return (
    <>
      {retry}
      {linkedIps.isError && (
        <div role="alert" className="flex items-center gap-3 p-4">
          <span>{linkedIps.error.message}</span>
          <Button variant="outline" onClick={() => void linkedIps.refetch()}>
            {tc("retry")}
          </Button>
        </div>
      )}
      {crew ? <CrewDetail crew={crew} /> : null}
    </>
  );
}
