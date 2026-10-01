"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ContentGpsOwnerSuggestionsPanel } from "./content-gps-owner-suggestions";
import { z } from "zod";
import { ContentGpsPointSchema } from "@repo/shared/content-gps";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { api, ApiRequestError } from "@/src/lib/api";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";

const point = ContentGpsPointSchema.omit({ provider: true, providerPlaceId: true });
const base = {
  id: z.uuid(),
  kind: z.enum(["story_setting", "production_origin"]),
  label: z.string().trim().min(1).max(300),
};
const locationsSchema = z
  .array(
    z.discriminatedUnion("status", [
      z.strictObject({ ...base, status: z.literal("resolved"), point }),
      z.strictObject({
        ...base,
        status: z.enum(["ambiguous", "fictional", "unresolved"]),
        point: z.null(),
      }),
    ])
  )
  .max(100)
  .refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length);
const requestSchema = z.strictObject({
  requestId: z.uuid(),
  expectedVersion: z.number().int().min(0).max(2147483646),
  locations: locationsSchema,
});
const responseSchema = z.object({
  version: z.number().int().min(0),
  locations: locationsSchema.nullable(),
  requestId: z.uuid().nullable(),
});
type Request = z.infer<typeof requestSchema>;
type Result = z.infer<typeof responseSchema>;
type Draft = {
  id: string;
  kind: "story_setting" | "production_origin";
  label: string;
  status: "resolved" | "ambiguous" | "fictional" | "unresolved";
  latitude: string;
  longitude: string;
  coordinateSystem: "WGS84" | "GCJ02";
  precision: "country" | "region" | "city" | "place";
};
const drafts = (locations: Request["locations"]): Draft[] =>
  locations.map((row) => ({
    ...row,
    latitude: row.point ? String(row.point.latitude) : "",
    longitude: row.point ? String(row.point.longitude) : "",
    coordinateSystem: row.point?.coordinateSystem ?? "WGS84",
    precision: row.point?.precision ?? "city",
  }));

export function ContentGpsOwnerEditor({ ipId, ownerId }: { ipId: string; ownerId?: string }) {
  const { user } = useCurrentUser();
  if (!user || !ownerId || String(user.id) !== ownerId) return null;
  return <Editor key={`${user.id}:${ipId}`} ipId={ipId} userId={String(user.id)} />;
}

function Editor({ ipId, userId }: { ipId: string; userId: string }) {
  const t = useTranslations("contentGpsOwner");
  const locale = useLocale();
  const client = useQueryClient();
  const path = `/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}/content-gps/locations`;
  const key = `content-gps-owner:${userId}:${ipId}`;
  const [result, setResult] = useState<Result | null>(null);
  const [rows, setRows] = useState<Draft[]>([]);
  const [pending, setPending] = useState<Request | null>(null);
  const [busy, setBusy] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const operation = useRef<AbortController | null>(null);

  function failure(cause: unknown) {
    setError(cause instanceof Error ? cause.message : String(cause));
    if (cause instanceof ApiRequestError && [401, 403, 404].includes(cause.status)) {
      setDenied(true);
      setRows([]);
      setResult(null);
      setPending(null);
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Access is still cleared in memory. */
      }
    }
  }
  async function load(discard = false) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const value = responseSchema.parse(await api.get(path, { signal: controller.signal }));
      if (controller.signal.aborted) return;
      const stored = sessionStorage.getItem(key);
      const recovered = !discard && stored ? requestSchema.parse(JSON.parse(stored)) : null;
      // Reconcile a lost reply, but do not confuse a different writer's newer
      // revision with acknowledgment of our request. Its retry will return 409.
      const outstanding = recovered && value.requestId !== recovered.requestId ? recovered : null;
      if (!outstanding) sessionStorage.removeItem(key);
      setPending(outstanding);
      setRows(drafts(outstanding?.locations ?? value.locations ?? []));
      setResult(value);
      setBlocked(false);
      setDenied(false);
    } catch (cause) {
      if (!controller.signal.aborted) failure(cause);
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      operation.current?.abort();
      operation.current = null;
    };
    // This component is keyed by account/IP; both its storage and requests reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (operation.current || !result || blocked || denied) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError(null);
    setSaved(false);
    let request = pending;
    try {
      if (!request) {
        const locations = rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          label: row.label,
          status: row.status,
          point:
            row.status === "resolved"
              ? {
                  latitude: row.latitude.trim() ? Number(row.latitude) : NaN,
                  longitude: row.longitude.trim() ? Number(row.longitude) : NaN,
                  coordinateSystem: row.coordinateSystem,
                  precision: row.precision,
                }
              : null,
        }));
        const parsed = locationsSchema.safeParse(locations);
        if (!parsed.success) throw new Error(t("invalid"));
        request = {
          requestId: crypto.randomUUID(),
          expectedVersion: result.version,
          locations: parsed.data,
        };
        // Persist before dispatch. Failure to store must not send an unrecoverable write.
        sessionStorage.setItem(key, JSON.stringify(request));
        setPending(request);
      }
      await api.put(path, { signal: controller.signal, data: request });
      if (controller.signal.aborted) return;
      sessionStorage.removeItem(key);
      setPending(null);
      setBlocked(true);
      // A replay may acknowledge an older revision: always read the current one.
      const current = responseSchema.parse(await api.get(path, { signal: controller.signal }));
      if (controller.signal.aborted) return;
      setResult(current);
      setRows(drafts(current.locations ?? []));
      setBlocked(false);
      setSaved(true);
      void client.invalidateQueries({
        predicate: (query) =>
          ["content-gps-cards", "content-gps-overview"].includes(String(query.queryKey[0])),
      });
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (cause instanceof ApiRequestError && [400, 409].includes(cause.status)) {
          sessionStorage.removeItem(key);
          setPending(null);
          if (cause.status === 409) setBlocked(true);
        }
        failure(cause);
      }
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setBusy(false);
      }
    }
  }
  function change(index: number, patch: Partial<Draft>) {
    setSaved(false);
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  const selectClass = "mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-3";
  return (
    <section aria-label={t("title")} className="min-w-0 space-y-3 text-sm">
      <h3 className="font-medium">{t("title")}</h3>
      <p className="text-muted-foreground">{t("description")}</p>
      {busy && <p role="status">{t("loading")}</p>}
      {saved && <p role="status">{t("saved")}</p>}
      {error && (
        <p role="alert" className="break-words text-red-400">
          {error}
        </p>
      )}
      {pending && !denied && <p>{t("pending")}</p>}
      {!denied && result && (
        <ContentGpsOwnerSuggestionsPanel
          key={`${ipId}:${userId}:${locale}:${result.version}`}
          ipId={ipId}
          userId={userId}
          ownerVersion={result.version}
          disabled={busy || Boolean(pending) || blocked}
          existing={rows}
          onDenied={failure}
          onAdd={(location) => {
            if (busy || pending || blocked || rows.length >= 100) return;
            const point = location.point
              ? {
                  latitude: location.point.latitude,
                  longitude: location.point.longitude,
                  coordinateSystem: location.point.coordinateSystem,
                  precision: location.point.precision,
                }
              : null;
            const next = locationsSchema.parse([
              {
                id: crypto.randomUUID(),
                kind: location.kind,
                label: location.label,
                status: location.status,
                point,
              },
            ]);
            setRows((current) => [...current, ...drafts(next)]);
            setSaved(false);
          }}
        />
      )}
      {!denied && result && (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy || Boolean(pending) || blocked} className="min-w-0 space-y-4">
            {rows.map((row, index) => (
              <fieldset key={row.id} className="min-w-0 space-y-3 rounded-xl bg-muted/30 p-3">
                <legend>{t("location", { number: index + 1 })}</legend>
                <label className="block">
                  {t("label")}
                  <Input
                    className="min-h-11"
                    required
                    maxLength={300}
                    value={row.label}
                    onChange={(event) => change(index, { label: event.target.value })}
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label>
                    {t("kind")}
                    <NativeSelect
                      disabled={busy || Boolean(pending) || blocked}
                      className={selectClass}
                      aria-label={t("kind")}
                      value={row.kind}
                      onChange={(value) => change(index, { kind: value as Draft["kind"] })}
                    >
                      {["story_setting", "production_origin"].map((v) => (
                        <NativeSelectOption key={v} value={v}>
                          {t(v)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </label>
                  <label>
                    {t("status")}
                    <NativeSelect
                      disabled={busy || Boolean(pending) || blocked}
                      className={selectClass}
                      aria-label={t("status")}
                      value={row.status}
                      onChange={(value) => change(index, { status: value as Draft["status"] })}
                    >
                      {["unresolved", "resolved", "ambiguous", "fictional"].map((v) => (
                        <NativeSelectOption key={v} value={v}>
                          {t(v)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </label>
                </div>
                {row.status === "resolved" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label>
                      {t("latitude")}
                      <Input
                        className="min-h-11"
                        required
                        type="number"
                        step="any"
                        min={-90}
                        max={90}
                        value={row.latitude}
                        onChange={(event) => change(index, { latitude: event.target.value })}
                      />
                    </label>
                    <label>
                      {t("longitude")}
                      <Input
                        className="min-h-11"
                        required
                        type="number"
                        step="any"
                        min={-180}
                        max={180}
                        value={row.longitude}
                        onChange={(event) => change(index, { longitude: event.target.value })}
                      />
                    </label>
                    <label>
                      {t("coordinates")}
                      <NativeSelect
                        disabled={busy || Boolean(pending) || blocked}
                        className={selectClass}
                        aria-label={t("coordinates")}
                        value={row.coordinateSystem}
                        onChange={(value) =>
                          change(index, { coordinateSystem: value as Draft["coordinateSystem"] })
                        }
                      >
                        {["WGS84", "GCJ02"].map((v) => (
                          <NativeSelectOption key={v} value={v}>
                            {v}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </label>
                    <label>
                      {t("precision")}
                      <NativeSelect
                        disabled={busy || Boolean(pending) || blocked}
                        className={selectClass}
                        aria-label={t("precision")}
                        value={row.precision}
                        onChange={(value) =>
                          change(index, { precision: value as Draft["precision"] })
                        }
                      >
                        {["country", "region", "city", "place"].map((v) => (
                          <NativeSelectOption key={v} value={v}>
                            {t(v)}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </label>
                  </div>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSaved(false);
                    setRows((current) => current.filter((_, i) => i !== index));
                  }}
                >
                  {t("remove")}
                </Button>
              </fieldset>
            ))}
            {!rows.length && <p>{t(result.version ? "empty" : "unset")}</p>}
            <Button
              type="button"
              variant="outline"
              disabled={rows.length >= 100}
              onClick={() => {
                try {
                  const id = crypto.randomUUID();
                  setSaved(false);
                  setRows((current) => [
                    ...current,
                    {
                      id,
                      label: "",
                      kind: "story_setting",
                      status: "unresolved",
                      latitude: "",
                      longitude: "",
                      coordinateSystem: "WGS84",
                      precision: "city",
                    },
                  ]);
                } catch (cause) {
                  failure(cause);
                }
              }}
            >
              {t("add")}
            </Button>
          </fieldset>
          <Button type="submit" disabled={busy || blocked}>
            {t(pending ? "retrySave" : "save")}
          </Button>
        </form>
      )}
      <Button type="button" variant="outline" disabled={busy} onClick={() => void load(true)}>
        {t(result && !denied ? "discard" : "reload")}
      </Button>
    </section>
  );
}
