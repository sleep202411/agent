"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import { Button } from "@/components/ui/button";
import { crewApi } from "../_hooks/api";

export function JoinFanCommunity({ crewId }: { crewId: string }) {
  const { user } = useCurrentUser();
  return (
    <FanAction key={`${crewId}:${user?.id ?? "guest"}`} crewId={crewId} signedIn={Boolean(user)} />
  );
}
function FanAction({ crewId, signedIn }: { crewId: string; signedIn: boolean }) {
  const t = useTranslations("crewFans");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const { open } = useAuthDialog();
  const operation = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () => () => {
      operation.current?.abort();
      operation.current = null;
    },
    []
  );
  async function join() {
    if (!signedIn) {
      open();
      return;
    }
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setError(null);
    try {
      const result = await crewApi.post<{ conversationId: string }>(
        `/crews/${encodeURIComponent(crewId)}/fan-community`,
        { signal: controller.signal }
      );
      if (!controller.signal.aborted)
        router.push(localizePath(`/messages/${encodeURIComponent(result.conversationId)}`, locale));
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setPending(false);
      }
    }
  }
  return (
    <div className="space-y-2">
      <Button disabled={pending} onClick={() => void join()}>
        {pending ? t("joining") : t("join")}
      </Button>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
