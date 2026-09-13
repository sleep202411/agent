"use client";
import { useEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import { api } from "@/src/lib/api";
type ReleaseLink = { label: string; url: string };
type Result = { links: ReleaseLink[]; version?: number };
export function IpReleaseLinks({ ipId, editable = false }: { ipId: string; editable?: boolean }) {
  const { user } = useCurrentUser();
  return (
    <LinksPanel
      key={`${ipId}:${user?.id ?? "guest"}:${editable}`}
      ipId={ipId}
      editable={editable}
    />
  );
}
function LinksPanel({ ipId, editable }: { ipId: string; editable: boolean }) {
  const t = useTranslations("ipReleaseLinks");
  const [result, setResult] = useState<Result | null>(null);
  const [links, setLinks] = useState<ReleaseLink[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null);
  const path = `/aurora/ip-commerce/${editable ? "me/" : ""}ips/${encodeURIComponent(ipId)}/release-links`;
  useEffect(() => {
    const controller = new AbortController();
    operation.current = controller;
    api
      .get<Result>(path, { signal: controller.signal, raw: true })
      .then((value) => {
        if (!controller.signal.aborted) {
          setResult(value);
          setLinks(value.links);
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
  async function request(save: boolean) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setError(null);
    try {
      const value = save
        ? await api.put<Result>(path, {
            signal: controller.signal,
            raw: true,
            data: { links, expectedVersion: result?.version },
          })
        : await api.get<Result>(path, { signal: controller.signal, raw: true });
      if (!controller.signal.aborted) {
        setResult(value);
        setLinks(value.links);
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
  function change(index: number, field: keyof ReleaseLink, value: string) {
    setLinks((previous) =>
      previous.map((link, i) => (i === index ? { ...link, [field]: value } : link))
    );
  }
  if (!editable && result && !result.links.length && !error) return null;
  return (
    <section aria-label={t("title")} className="w-full space-y-3 text-sm">
      <h3 className="font-medium">{t("title")}</h3>
      {pending && !result && <p role="status">{t("loading")}</p>}
      {error && (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      )}
      {editable ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void request(true);
          }}
          className="space-y-3"
        >
          <p className="text-muted-foreground">{t("description")}</p>
          {links.map((link, index) => (
            <fieldset key={index} disabled={pending} className="flex flex-wrap items-end gap-3">
              <label className="min-w-32 flex-1">
                {t("label")}
                <input
                  required
                  maxLength={80}
                  value={link.label}
                  onChange={(event) => change(index, "label", event.target.value)}
                  className="mt-1 block min-h-11 w-full rounded-xl border border-input bg-transparent px-3"
                />
              </label>
              <label className="min-w-48 flex-[2]">
                {t("url")}
                <input
                  required
                  type="url"
                  maxLength={2000}
                  value={link.url}
                  onChange={(event) => change(index, "url", event.target.value)}
                  className="mt-1 block min-h-11 w-full rounded-xl border border-input bg-transparent px-3"
                />
              </label>
              <button
                type="button"
                onClick={() => setLinks((previous) => previous.filter((_, i) => i !== index))}
                className="min-h-11 rounded-full px-3 underline"
              >
                {t("remove")}
              </button>
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={pending || !result || links.length >= 20}
              onClick={() => setLinks((previous) => [...previous, { label: "", url: "" }])}
              className="min-h-11 rounded-full border border-input px-4 disabled:opacity-50"
            >
              {t("add")}
            </button>
            <button
              type="submit"
              disabled={pending || !result}
              className="min-h-11 rounded-full bg-primary px-4 text-primary-foreground disabled:opacity-50"
            >
              {t("save")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => void request(false)}
              className="min-h-11 rounded-full px-4 underline disabled:opacity-50"
            >
              {t("reload")}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {result?.links.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center rounded-full bg-white/10 px-4 text-white hover:bg-white/20"
              >
                {link.label} ↗
              </a>
            ))}
          </div>
          {error && (
            <button
              type="button"
              disabled={pending}
              onClick={() => void request(false)}
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
