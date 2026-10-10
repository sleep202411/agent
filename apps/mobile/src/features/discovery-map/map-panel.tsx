import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { uuid } from "expo-modules-core";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { MapFrame } from "./map-frame";
import type { MapFrameHandle } from "./frame-types";
import type { DiscoveryMapConfig } from "./config";
import type { GpsMapFeature, GpsViewport } from "./content-gps-map-types";
import { createMapSession } from "./session";
type Props = {
  config: DiscoveryMapConfig;
  viewport: GpsViewport;
  features: GpsMapFeature[];
  onViewport(value: GpsViewport): void;
  onSelect(id: string): void;
};
export function MapPanel(props: Props) {
  const [revision, setRevision] = useState(0);
  return <PanelSession key={revision} {...props} retry={() => setRevision((v) => v + 1)} />;
}
function PanelSession({ retry, ...props }: Props & { retry(): void }) {
  const t = useTranslations();
  const [channel] = useState(() => uuid.v4());
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const frame = useRef<MapFrameHandle>(null);
  const controller = useRef<ReturnType<typeof createMapSession> | null>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  useEffect(() => {
    const current = latest.current;
    const timer = setTimeout(() => {
      controller.current?.destroy();
      setStatus("error");
    }, 45000);
    const session = createMapSession({
      channel,
      config: current.config,
      initialViewport: current.viewport,
      send: (raw) => frame.current?.send(raw),
      onLoaded: () => {
        clearTimeout(timer);
        setStatus("ready");
      },
      onError: () => {
        clearTimeout(timer);
        setStatus("error");
      },
      onViewport: (value) => latest.current.onViewport(value),
      onActivate: (feature) => {
        const currentFeature = latest.current.features.find((item) => item.id === feature.id);
        if (!currentFeature || JSON.stringify(currentFeature) !== JSON.stringify(feature)) return;
        if (feature.entityId) latest.current.onSelect(feature.entityId);
        else session.focus(feature);
      },
    });
    controller.current = session;
    session.setFeatures(current.features);
    return () => {
      clearTimeout(timer);
      session.destroy();
      controller.current = null;
    };
  }, [channel]);
  useEffect(() => {
    controller.current?.setFeatures(props.features);
  }, [props.features]);
  return (
    <View style={{ gap: 8 }}>
      {status !== "error" && (
        <View style={{ height: 300, overflow: "hidden", borderRadius: 8 }}>
          <MapFrame
            ref={frame}
            url={props.config.documentUrl}
            channel={channel}
            title={t("discoveryMap.title")}
            onMessage={(raw) => controller.current?.receive(raw)}
            onError={() => {
              controller.current?.destroy();
              setStatus("error");
            }}
          />
        </View>
      )}
      {status === "loading" && <ActivityIndicator accessibilityLabel={t("discoveryMap.loading")} />}
      {status === "error" ? (
        <View>
          <ThemedText accessibilityRole="alert">{t("discoveryMap.error")}</ThemedText>
          <MapAction text={t("discoveryMap.retry")} onPress={retry} />
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <MapAction
            text={t("discoveryMap.zoomIn")}
            onPress={() => controller.current?.zoom(1)}
            disabled={status !== "ready"}
          />
          <MapAction
            text={t("discoveryMap.zoomOut")}
            onPress={() => controller.current?.zoom(-1)}
            disabled={status !== "ready"}
          />
        </View>
      )}
    </View>
  );
}

function MapAction({
  text,
  onPress,
  disabled = false,
}: {
  text: string;
  onPress(): void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: 44, padding: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText>{text}</ThemedText>
    </Pressable>
  );
}
