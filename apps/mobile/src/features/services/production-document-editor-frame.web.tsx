import { useEffect, useRef } from "react";
export function DocumentEditorFrame({
  html,
  onMessage,
  onError,
  title,
}: {
  html: string;
  title: string;
  onMessage: (raw: unknown) => void;
  onError: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const receive = (e: MessageEvent) => {
      if (frame.current?.contentWindow && e.source === frame.current.contentWindow)
        onMessage(e.data);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [onMessage]);
  return (
    <iframe
      ref={frame}
      title={title}
      srcDoc={html}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      onError={onError}
      style={{ width: "100%", flex: 1, minHeight: 320, border: 0 }}
    />
  );
}
