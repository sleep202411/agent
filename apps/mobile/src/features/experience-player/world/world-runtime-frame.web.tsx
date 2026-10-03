import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { worldCommandSchema } from "../../../../world-player/protocol";
import type { WorldRuntimeFrameHandle, WorldRuntimeFrameProps } from "./world-runtime-frame-types";

export const WorldRuntimeFrame = forwardRef<WorldRuntimeFrameHandle, WorldRuntimeFrameProps>(
  function WorldRuntimeFrame({ html, title, onMessage, onError }, ref) {
    const frame = useRef<HTMLIFrameElement>(null);
    useImperativeHandle(
      ref,
      () => ({
        send(message) {
          const target = frame.current?.contentWindow;
          if (!target) throw new Error("World playback surface is not mounted.");
          // The sandbox deliberately has an opaque origin; the receiver verifies
          // both its parent window and the per-document session ID.
          target.postMessage(JSON.stringify(worldCommandSchema.parse(message)), "*");
        },
      }),
      []
    );
    useLayoutEffect(() => {
      const receive = (event: MessageEvent) => {
        if (frame.current?.contentWindow && event.source === frame.current.contentWindow)
          onMessage(event.data);
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
        allow="autoplay"
        referrerPolicy="no-referrer"
        onError={() => onError(new Error("World playback surface could not load."))}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          flex: 1,
          border: 0,
          background: "#000000",
        }}
      />
    );
  }
);
