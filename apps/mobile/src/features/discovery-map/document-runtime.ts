import { GpsMapError, type GpsMapFactory, type GpsMapHandle } from "./content-gps-map-types";
import { readMapCommand, type MapEvent } from "./protocol";

/** The document owns no session, API calls, or navigation. Only validated map
 * geometry and public labels cross this channel; all search remains in Mobile. */
export function mountMapDocument(
  container: HTMLElement,
  channel: string,
  createMap: GpsMapFactory,
  send: (event: MapEvent) => void
) {
  const controller = new AbortController();
  let handle: GpsMapHandle | undefined;
  let initialized = false,
    sequence = -1,
    featureSequence = -1;
  let system: "WGS84" | "GCJ02" | undefined;
  const fail = (error: unknown) => {
    if (controller.signal.aborted) return;
    controller.abort();
    handle?.destroy();
    send({ type: "error", reason: error instanceof GpsMapError ? error.reason : "load" });
  };
  const receive = async (raw: unknown) => {
    if (controller.signal.aborted) return;
    const command = readMapCommand(raw, channel);
    if (!command || command.sequence <= sequence) return;
    // An early update must not prevent the initialization handshake.
    if (command.type !== "initialize" && !handle) return;
    if (command.type === "initialize" && initialized) return;
    sequence = command.sequence;
    try {
      if (command.type === "initialize") {
        initialized = true;
        system = command.viewport.coordinateSystem;
        const created = await createMap({
          container,
          config: command.config,
          initialViewport: command.viewport,
          signal: controller.signal,
          onViewport: (viewport) => {
            if (!controller.signal.aborted) send({ type: "viewport", viewport });
          },
          onActivate: (feature) => {
            if (!controller.signal.aborted)
              send({ type: "activate", id: feature.id, sequence: featureSequence });
          },
          onError: fail,
        });
        if (controller.signal.aborted) {
          created.destroy();
          return;
        }
        handle = created;
        send({ type: "loaded" });
      } else if (command.type === "features") {
        if (
          command.features.some((feature) => feature.coordinateSystem !== system) ||
          new Set(command.features.map((feature) => feature.id)).size !== command.features.length
        )
          throw new GpsMapError("coordinates");
        featureSequence = command.sequence;
        handle!.setFeatures(command.features);
      } else if (command.type === "zoom") handle!.zoomBy(command.delta);
      else handle!.focus(command.latitude, command.longitude);
    } catch (error) {
      fail(error);
    }
  };
  send({ type: "ready" });
  return {
    receive,
    destroy() {
      controller.abort();
      handle?.destroy();
      container.replaceChildren();
    },
  };
}
