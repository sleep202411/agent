import { useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { documentUrl, type MapFrameProps } from "./frame-types";
export function MapFrame({ ref, url, channel, title, onMessage, onError }: MapFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const origin = new URL(url).origin;
  const uri = useMemo(() => documentUrl(url, channel, window.location.origin), [url, channel]);
  useImperativeHandle(
    ref,
    () => ({
      send(raw) {
        frame.current?.contentWindow?.postMessage(raw, origin);
      },
    }),
    [origin]
  );
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source === frame.current?.contentWindow && event.origin === origin)
        onMessage(event.data);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [origin, onMessage]);
  return (
    <iframe
      ref={frame}
      src={uri}
      title={title}
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="strict-origin-when-cross-origin"
      onError={onError}
      style={{ width: "100%", height: "100%", border: 0 }}
    />
  );
}
