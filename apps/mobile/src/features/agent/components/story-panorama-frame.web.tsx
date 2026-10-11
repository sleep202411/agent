import { useEffect, useRef } from "react";
import { readPanoramaEvent, type PanoramaFrameProps } from "../lib/story-panorama-document";
export function StoryPanoramaFrame({ html, title, sessionId, onEvent }: PanoramaFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== ref.current?.contentWindow) return;
      const value = readPanoramaEvent(event.data, sessionId);
      if (value) onEvent(value.type, value.detail);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [sessionId, onEvent]);
  return (
    <iframe
      ref={ref}
      srcDoc={html}
      title={title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      onError={() => onEvent("error")}
      style={{ border: 0, width: "100%", height: "100%", flex: 1 }}
    />
  );
}
