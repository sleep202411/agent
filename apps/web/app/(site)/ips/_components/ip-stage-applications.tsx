"use client";
import { useEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api } from "@/src/lib/api";
type Application = {
  id: string;
  stage: string;
  status: string;
  reason: string;
  reviewReason: string | null;
};
type Result = { state: { stage: string; version: number }; items: Application[] };
export function IpStageApplications({ ipId }: { ipId: string }) {
  const { user } = useCurrentUser();
  return user ? <ApplicationPanel key={`${user.id}:${ipId}`} ipId={ipId} /> : null;
}
function ApplicationPanel({ ipId }: { ipId: string }) {
  const t = useTranslations("ipStageApplications");
  const stageLabel = useTranslations("ipProductionStage");
  const [data, setData] = useState<Result | null>(null);
  const [stage, setStage] = useState("story_testing");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const active = useRef<AbortController | null>(null);
  const replay = useRef<{ payload: string; id: string } | null>(null);
  const path = `/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}/stage-applications`;
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    api
      .get<Result>(path, { raw: true, signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active.current === controller) {
          active.current = null;
          setPending(false);
        }
      });
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [path]);
  async function run(submit: boolean) {
    if (active.current || (submit && !data)) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError(null);
    try {
      if (submit && data) {
        const payload = JSON.stringify({
          stage,
          reason: reason.trim(),
          expectedVersion: data.state.version,
        });
        if (replay.current?.payload !== payload)
          replay.current = { payload, id: crypto.randomUUID() };
        const item = await api.post<Application>(path, {
          raw: true,
          signal: controller.signal,
          data: { ...JSON.parse(payload), id: replay.current.id },
        });
        if (!controller.signal.aborted) {
          setData({
            ...data,
            items: [item, ...data.items.filter((x) => x.id !== item.id)].slice(0, 20),
          });
          setReason("");
          replay.current = null;
        }
      } else {
        const value = await api.get<Result>(path, { raw: true, signal: controller.signal });
        if (!controller.signal.aborted) setData(value);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (active.current === controller) {
        active.current = null;
        setPending(false);
      }
    }
  }
  const awaiting = data?.items.some((item) => item.status === "pending");
  return (
    <section className="space-y-3 text-sm">
      <h3 className="font-medium">{t("title")}</h3>
      <button
        type="button"
        className="underline"
        disabled={pending}
        onClick={() => void run(false)}
      >
        {t("refresh")}
      </button>
      {pending && !data ? <p role="status">{t("loading")}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {data ? (
        <>
          <p>
            {t("current")}: {stageLabel(data.state.stage)}
          </p>
          {awaiting ? (
            <p role="status">{t("awaiting")}</p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(true);
              }}
              className="space-y-2"
            >
              <label className="block">
                {t("target")}
                <NativeSelect
                  aria-label={t("target")}
                  className="ml-2 rounded bg-background p-2"
                  value={stage}
                  onChange={setStage}
                  disabled={pending}
                >
                  {["story_testing", "production", "released"].map((value) => (
                    <NativeSelectOption key={value} value={value}>
                      {stageLabel(value)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label className="block">
                {t("reason")}
                <textarea
                  className="mt-1 block w-full rounded bg-background p-2"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={pending}
                  required
                  maxLength={1000}
                />
              </label>
              <button
                type="submit"
                disabled={pending || !reason.trim() || stage === data.state.stage}
                className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
              >
                {t("submit")}
              </button>
            </form>
          )}
          <h4>{t("history")}</h4>
          {data.items.length ? (
            data.items.map((item) => (
              <article key={item.id} className="space-y-1 py-2">
                <p>
                  {stageLabel(item.stage)} · {t(item.status)}
                </p>
                <p className="whitespace-pre-wrap">{item.reason}</p>
                {item.reviewReason ? (
                  <p className="whitespace-pre-wrap">
                    {t("review")}: {item.reviewReason}
                  </p>
                ) : null}
              </article>
            ))
          ) : (
            <p>{t("empty")}</p>
          )}
        </>
      ) : null}
    </section>
  );
}
