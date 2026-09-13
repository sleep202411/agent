"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api } from "@/src/lib/api";
type Crew = { id: string; name: string };
type Origin = { crew?: Crew | null; crewId?: string | null; version?: number; choices?: Crew[] };
export function IpCrewOrigin({ ipId, editable = false }: { ipId: string; editable?: boolean }) {
  const { user } = useCurrentUser();
  return (
    <OriginPanel
      key={`${ipId}:${user?.id ?? "guest"}:${editable}`}
      ipId={ipId}
      editable={editable}
      signedIn={Boolean(user)}
    />
  );
}
function OriginPanel({
  ipId,
  editable,
  signedIn,
}: {
  ipId: string;
  editable: boolean;
  signedIn: boolean;
}) {
  const t = useTranslations("ipCrewOrigin");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const { open } = useAuthDialog();
  const [data, setData] = useState<Origin | null>(null);
  const [selected, setSelected] = useState("");
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null);
  const path = `/aurora/ip-commerce/${editable ? "me/" : ""}ips/${encodeURIComponent(ipId)}/crew`;
  useEffect(() => {
    const controller = new AbortController();
    operation.current = controller;
    api
      .get<Origin>(path, { signal: controller.signal, raw: true })
      .then((value) => {
        if (!controller.signal.aborted) {
          setData(value);
          setSelected(value.crewId ?? "");
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (operation.current === controller) {
          operation.current = null;
          setPending(false);
        }
      });
    return () => {
      operation.current?.abort();
      operation.current = null;
    };
  }, [path]);
  async function run(action: "reload" | "save" | "join") {
    if (action === "join" && !signedIn) {
      open();
      return;
    }
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setError(null);
    try {
      if (action === "join") {
        const result = await api.put<{ conversationId: string | null }>(
          `/aurora/ip-commerce/ips/${encodeURIComponent(ipId)}/like`,
          { signal: controller.signal }
        );
        if (!controller.signal.aborted) {
          if (result.conversationId)
            router.push(
              localizePath(`/messages/${encodeURIComponent(result.conversationId)}`, locale)
            );
          else setError(t("noGroup"));
        }
      } else {
        const value =
          action === "save"
            ? await api.put<Origin>(path, {
                signal: controller.signal,
                raw: true,
                data: { crewId: selected || null, expectedVersion: data?.version },
              })
            : await api.get<Origin>(path, { signal: controller.signal, raw: true });
        if (!controller.signal.aborted) {
          setData(value);
          setSelected(value.crewId ?? "");
        }
      }
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
  if (!editable && data && !data.crew && !error) return null;
  return (
    <section aria-label={t("title")} className="w-full space-y-3 text-sm">
      <h3 className="font-medium">{t("title")}</h3>
      {pending && !data && <p role="status">{t("loading")}</p>}
      {error && (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      )}
      {editable ? (
        <>
          <p className="text-muted-foreground">{t("editDescription")}</p>
          <label className="block">
            {t("select")}
            <NativeSelect
              value={selected}
              disabled={pending || !data}
              onChange={setSelected}
              aria-label={t("select")}
              className="mt-1 block min-h-11 w-full rounded-xl border border-input bg-background px-3"
            >
              <NativeSelectOption value="">{t("none")}</NativeSelectOption>
              {selected && !data?.choices?.some((crew) => crew.id === selected) && (
                <NativeSelectOption value={selected}>{t("existing")}</NativeSelectOption>
              )}
              {data?.choices?.map((crew) => (
                <NativeSelectOption key={crew.id} value={crew.id}>
                  {crew.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <button
            type="button"
            disabled={pending || !data}
            onClick={() => void run("save")}
            className="min-h-11 rounded-full bg-primary px-4 text-primary-foreground disabled:opacity-50"
          >
            {t("save")}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => void run("reload")}
            className="ml-2 min-h-11 rounded-full px-4 underline"
          >
            {t("reload")}
          </button>
        </>
      ) : (
        <>
          {data?.crew && (
            <div className="space-y-2">
              <Link
                href={localizePath(`/crews/${encodeURIComponent(data.crew.id)}`, locale)}
                className="underline"
              >
                {data.crew.name}
              </Link>
              <p className="text-white/60">{t("joinDescription")}</p>
              <button
                type="button"
                disabled={pending}
                onClick={() => void run("join")}
                className="min-h-11 rounded-full bg-white px-4 text-black disabled:opacity-50"
              >
                {t("join")}
              </button>
            </div>
          )}
          {error && (
            <button
              type="button"
              disabled={pending}
              onClick={() => void run("reload")}
              className="min-h-11 underline"
            >
              {t("retry")}
            </button>
          )}
        </>
      )}
    </section>
  );
}
