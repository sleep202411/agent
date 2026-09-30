import { useEffect, useRef } from "react";
import { documentLinkIndex } from "./production-document-links";
export function ProductionDocumentView({
  html,
  title,
  onError,
  onLink,
}: {
  html: string;
  title: string;
  onError: () => void;
  onLink: (index: number) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!frame.current?.contentWindow || event.source !== frame.current.contentWindow) return;
      const index = documentLinkIndex(event.data);
      if (index !== null) onLink(index);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [onLink]);
  return (
    <iframe
      ref={frame}
      title={title}
      srcDoc={html}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      onError={onError}
      style={{ width: "100%", flex: 1, minHeight: 320, border: 0, background: "#0B0D12" }}
    />
  );
}
