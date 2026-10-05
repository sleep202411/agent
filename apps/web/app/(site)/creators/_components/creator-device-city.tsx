"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { CreatorCitySchema } from "@repo/shared/creator-location";
import { regionLabel } from "@repo/shared/regions";
import { Button } from "@/components/ui/button";
import { api, ApiRequestError } from "@/src/lib/api";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
const Result = z.object({
  state: z.enum(["missing", "expired", "completed", "dispatched", "uncertain"]),
  city: CreatorCitySchema.nullable(),
});
export function CreatorDeviceCity({
  disabled,
  confirm,
  onDenied,
}: {
  disabled: boolean;
  confirm: (city: z.infer<typeof CreatorCitySchema>) => void;
  onDenied: (error: unknown) => void;
}) {
  const t = useTranslations("creatorDeviceCity");
  const locale = useLocale();
  const [result, setResult] = useState<z.infer<typeof Result> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const path = "/aurora/creator-location/me/device-city";
  async function run(check: boolean) {
    if (disabled || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let response: unknown;
      if (check && attempt) {
        response = await api.get(`${path}/${attempt}`, { signal: controller.signal });
      } else {
        if (!navigator.geolocation || !window.isSecureContext) throw new Error(t("unsupported"));
        const coords = await new Promise<GeolocationCoordinates>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (position) => resolve(position.coords),
            (failure) => reject(new Error(t(failure.code === 1 ? "denied" : "unavailable"))),
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }
          );
        });
        if (controller.signal.aborted) return;
        const requestId = crypto.randomUUID();
        setAttempt(requestId);
        response = await api.post(path, {
          data: {
            requestId,
            consent: true,
            latitude: coords.latitude,
            longitude: coords.longitude,
            locale,
          },
          signal: controller.signal,
        });
      }
      if (!controller.signal.aborted) setResult(Result.parse(response));
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : String(cause));
        if (cause instanceof ApiRequestError && [401, 403].includes(cause.status)) onDenied(cause);
      }
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground">{t("consent")}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={disabled || busy}
          onClick={() => void run(false)}
        >
          {t("locate")}
        </Button>
        {attempt && (
          <Button
            type="button"
            variant="ghost"
            className="min-h-11"
            disabled={disabled || busy}
            onClick={() => void run(true)}
          >
            {t("check")}
          </Button>
        )}
      </div>
      {busy && <p role="status">{t("loading")}</p>}
      {error && (
        <p role="alert" className="break-words">
          {error}
        </p>
      )}
      {result?.state === "completed" && result.city ? (
        <div className="space-y-2 rounded-lg bg-muted/30 p-3">
          <p>
            {t("suggestion", {
              city: result.city.city,
              country: regionLabel(result.city.countryCode, locale),
            })}
          </p>
          <p className="text-muted-foreground">{t("confirmHint")}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="soft"
              className="min-h-11"
              disabled={disabled || busy}
              onClick={() => {
                confirm(result.city!);
                setResult(null);
                setAttempt(null);
              }}
            >
              {t("confirm")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              onClick={() => {
                setResult(null);
                setAttempt(null);
              }}
            >
              {t("dismiss")}
            </Button>
          </div>
        </div>
      ) : (
        result && <p role="status">{t(result.state)}</p>
      )}
    </div>
  );
}
