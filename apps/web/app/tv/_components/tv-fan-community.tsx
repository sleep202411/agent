"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { IconUsers } from "@tabler/icons-react";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { api } from "@/src/lib/api";
import { crewApi } from "@/app/(site)/crews/_hooks/api";
import { crewKeys } from "@/app/(site)/crews/_hooks/shared";

export function TvFanCommunity({ ipId }: { ipId: string }) {
  const { user, isLoading } = useCurrentUser();
  if (isLoading) return null;
  return <FanEntry key={`${ipId}:${user?.id ?? "guest"}`} ipId={ipId} userId={user?.id ?? null} />;
}

function FanEntry({ ipId, userId }: { ipId: string; userId: string | null }) {
  const t = useTranslations("tv");
  const tc = useTranslations("common");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const { open } = useAuthDialog();
  const client = useQueryClient();
  const active = useRef(false);
  const operation = useRef<AbortController | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const origin = useQuery({
    queryKey: ["tv", "crew-origin", ipId, userId],
    queryFn: ({ signal }) =>
      api.get<{ crew: { id: string; name: string } | null }>(
        `/aurora/ip-commerce/ips/${encodeURIComponent(ipId)}/crew`,
        { signal, cache: "no-store" }
      ),
  });
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      operation.current?.abort();
    };
  }, []);

  async function join() {
    if (
      !active.current ||
      operation.current ||
      origin.isFetching ||
      origin.isError ||
      !origin.data?.crew
    )
      return;
    if (!userId) {
      open();
      return;
    }
    const crewId = origin.data.crew.id;
    const controller = new AbortController();
    operation.current = controller;
    setJoining(true);
    setError(null);
    try {
      await crewApi.post(`/crews/${encodeURIComponent(crewId)}/fan-community`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || !active.current) return;
      void client.invalidateQueries({ queryKey: [...crewKeys.mine, userId] });
      router.push(
        localizePath(
          `/crews?view=mine&crew=${encodeURIComponent(crewId)}&tab=chat&channel=community`,
          locale
        )
      );
    } catch (cause) {
      if (!controller.signal.aborted && active.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        if (active.current) setJoining(false);
      }
    }
  }

  if (origin.isPending || (!origin.data?.crew && !origin.isError)) return null;
  return (
    <div className="flex max-w-full flex-col items-start gap-2">
      {origin.data?.crew ? (
        <button
          type="button"
          onClick={() => void join()}
          disabled={joining || origin.isFetching || origin.isError}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white/10 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:opacity-50"
        >
          <IconUsers className="size-4" />
          {t("joinFanGroup")}
        </button>
      ) : null}
      {origin.isError || error ? (
        <div role="alert" className="max-w-xs text-sm text-red-400">
          {error ?? (origin.error instanceof Error ? origin.error.message : tc("loadFailed"))}
          {origin.isError ? (
            <button
              type="button"
              disabled={origin.isFetching}
              className="ml-2 underline"
              onClick={() => void origin.refetch()}
            >
              {tc("retry")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
