import { readMapEvent, type MapCommand } from "./protocol";
import type { GpsMapFeature, GpsViewport } from "./content-gps-map-types";
import type { DiscoveryMapConfig } from "./config";
type WithoutSequence<T> = T extends unknown ? Omit<T, "sequence"> : never;
export function createMapSession(options: {
  channel: string;
  config: DiscoveryMapConfig;
  initialViewport: GpsViewport;
  send: (raw: string) => void;
  onLoaded: () => void;
  onError: () => void;
  onViewport: (value: GpsViewport) => void;
  onActivate: (feature: GpsMapFeature) => void;
}) {
  let disposed = false,
    initialized = false,
    loaded = false,
    sequence = 0,
    featureSequence = -1;
  let features: GpsMapFeature[] = [];
  let lastViewport = JSON.stringify(options.initialViewport);
  const send = (body: WithoutSequence<MapCommand>) => {
    if (disposed) return;
    options.send(
      JSON.stringify({ version: 1, channel: options.channel, ...body, sequence: sequence++ })
    );
  };
  const update = () => {
    if (!loaded || disposed) return;
    featureSequence = sequence;
    send({ type: "features", features });
  };
  return {
    receive(raw: unknown) {
      if (disposed) return;
      const event = readMapEvent(raw, options.channel);
      if (!event) return;
      if (event.type === "ready" && !initialized) {
        initialized = true;
        send({
          type: "initialize",
          config: options.config.provider,
          viewport: options.initialViewport,
        });
      } else if (event.type === "loaded" && initialized && !loaded) {
        loaded = true;
        update();
        options.onLoaded();
      } else if (event.type === "error") {
        disposed = true;
        options.onError();
      } else if (event.type === "viewport" && initialized) {
        if (event.viewport.coordinateSystem !== options.initialViewport.coordinateSystem) return;
        const key = JSON.stringify(event.viewport);
        if (lastViewport !== key) {
          lastViewport = key;
          options.onViewport(event.viewport);
        }
      } else if (event.type === "activate" && loaded && event.sequence === featureSequence) {
        const feature = features.find((item) => item.id === event.id);
        if (feature) options.onActivate(feature);
      }
    },
    setFeatures(next: GpsMapFeature[]) {
      features = next;
      update();
    },
    zoom(delta: -1 | 1) {
      if (loaded) send({ type: "zoom", delta });
    },
    focus(feature: GpsMapFeature) {
      if (loaded)
        send({
          type: "focus",
          latitude: feature.latitude,
          longitude: feature.longitude,
        });
    },
    destroy() {
      disposed = true;
      features = [];
    },
  };
}
