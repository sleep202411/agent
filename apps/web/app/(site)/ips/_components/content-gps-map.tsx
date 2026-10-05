"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/src/i18n/i18n";
import { createGpsMap } from "../_data/content-gps-map-provider";
import {
  GpsMapError,
  type GpsMapConfig,
  type GpsMapFactory,
  type GpsMapFeature,
  type GpsMapHandle,
  type GpsViewport,
} from "../_data/content-gps-map-types";

type Props = {
  config: GpsMapConfig | null;
  kind?: "ip" | "creator";
  initialViewport: GpsViewport;
  features: GpsMapFeature[];
  loading: boolean;
  onViewport: (viewport: GpsViewport) => void;
  onSelect: (id: string) => void;
  onVirtualSelect?: (destination: string) => void;
  /** Provider boundary injection for offline acceptance; never a fake production basemap. */
  factory?: GpsMapFactory;
};
export function ContentGpsMap(props: Props) {
  return <ProviderMap key={JSON.stringify(props.config)} {...props} />;
}

function ProviderMap({
  kind = "ip",
  config,
  initialViewport,
  features,
  loading,
  onViewport,
  onSelect,
  onVirtualSelect,
  factory = createGpsMap,
}: Props) {
  const t = useTranslations(kind === "creator" ? "creatorGpsMap" : "contentGpsMap");
  const element = useRef<HTMLDivElement>(null);
  const handle = useRef<GpsMapHandle | null>(null);
  const current = useRef({ features, loading, onViewport, onSelect, onVirtualSelect });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<GpsMapError | null>(null);
  const signature = JSON.stringify(config);
  const initial = useRef(initialViewport);
  useLayoutEffect(() => {
    current.current = { features, loading, onViewport, onSelect, onVirtualSelect };
    try {
      handle.current?.setFeatures(loading ? [] : features);
    } catch (cause) {
      handle.current?.destroy();
      handle.current = null;
      /* eslint-disable react-hooks/set-state-in-effect -- Report a synchronous external SDK failure after clearing its DOM. */
      setError(cause instanceof GpsMapError ? cause : new GpsMapError("load"));
      setStatus("error");
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [features, loading, onViewport, onSelect, onVirtualSelect]);
  useEffect(() => {
    if (!element.current || !signature || signature === "null") return;
    const controller = new AbortController();
    let lastViewport = "";
    const fail = (cause: unknown) => {
      if (controller.signal.aborted) return;
      setError(cause instanceof GpsMapError ? cause : new GpsMapError("load"));
      setStatus("error");
      controller.abort();
      handle.current?.destroy();
      handle.current = null;
    };
    const container = element.current;
    void factory({
      container,
      config: JSON.parse(signature) as GpsMapConfig,
      initialViewport: initial.current,
      signal: controller.signal,
      onViewport: (viewport) => {
        if (controller.signal.aborted) return;
        const key = JSON.stringify(viewport);
        if (lastViewport === key) return;
        lastViewport = key;
        current.current.onViewport(viewport);
      },
      onActivate: (feature) => {
        if (
          controller.signal.aborted ||
          current.current.loading ||
          !current.current.features.some((value) => value.id === feature.id)
        )
          return;
        if (feature.virtualDestination)
          current.current.onVirtualSelect?.(feature.virtualDestination);
        else if (feature.entityId) current.current.onSelect(feature.entityId);
        else handle.current?.focus(feature.latitude, feature.longitude);
      },
      onError: fail,
    })
      .then((value) => {
        if (controller.signal.aborted) {
          value.destroy();
          return;
        }
        handle.current = value;
        value.setFeatures(current.current.loading ? [] : current.current.features);
        setStatus("ready");
      })
      .catch(fail);
    return () => {
      controller.abort();
      handle.current?.destroy();
      handle.current = null;
    };
  }, [signature, factory]);
  return (
    <section aria-label={t("title")} className="min-w-0 space-y-3">
      <div className="relative min-h-80 overflow-hidden rounded-xl bg-muted/20">
        <div ref={element} className="h-[45vh] min-h-80 w-full lg:h-[60vh]" />
        {(!config || status !== "ready") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 p-6 text-center">
            <p
              role={status === "error" ? "alert" : "status"}
              className="max-w-sm text-sm text-muted-foreground"
            >
              {!config
                ? t("unavailable")
                : status === "error"
                  ? t(error?.reason ?? "load")
                  : t("loading")}
            </p>
            {config && status === "error" && (
              <Button
                type="button"
                variant="outline"
                color="muted"
                className="min-h-11"
                onClick={() => window.location.reload()}
              >
                {t("reload")}
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <p>{t("legend")}</p>
        {config && status === "ready" && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              color="muted"
              className="min-h-11 min-w-11"
              aria-label={t("zoomIn")}
              onClick={() => handle.current?.zoomBy(1)}
            >
              +
            </Button>
            <Button
              type="button"
              variant="outline"
              color="muted"
              className="min-h-11 min-w-11"
              aria-label={t("zoomOut")}
              onClick={() => handle.current?.zoomBy(-1)}
            >
              −
            </Button>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("scope")}</p>
    </section>
  );
}
