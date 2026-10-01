import { useEffect, useRef } from "react";
import type { EnrollmentFrameProps } from "./enrollment-frame-policy";
export function EnrollmentFrame({
  uri,
  characterId,
  callbackOrigin,
  title,
  onComplete,
  onError,
}: EnrollmentFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        !frame.current?.contentWindow ||
        event.source !== frame.current.contentWindow ||
        event.origin !== callbackOrigin
      )
        return;
      const data: unknown = event.data;
      if (
        typeof data === "object" &&
        data !== null &&
        "type" in data &&
        "characterId" in data &&
        data.type === "character-enrollment-callback" &&
        data.characterId === characterId
      )
        onComplete();
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [characterId, callbackOrigin, onComplete]);
  return (
    <iframe
      ref={frame}
      src={uri}
      title={title}
      allow="camera; microphone"
      sandbox="allow-scripts allow-same-origin allow-forms"
      referrerPolicy="no-referrer"
      onError={onError}
      style={{ width: "100%", height: 560, border: 0, borderRadius: 8 }}
    />
  );
}
