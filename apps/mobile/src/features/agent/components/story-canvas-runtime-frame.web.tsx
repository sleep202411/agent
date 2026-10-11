import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { CanvasHostMessage } from "../../../../canvas-editor/protocol";
export type CanvasFrameHandle = { send(message: CanvasHostMessage): void };
export type CanvasFrameProps = {
  html: string;
  title: string;
  onMessage(raw: unknown): void;
  onError(): void;
};
export const CanvasRuntimeFrame = forwardRef<CanvasFrameHandle, CanvasFrameProps>(
  function CanvasRuntimeFrame({ html, title, onMessage, onError }, ref) {
    const frame = useRef<HTMLIFrameElement>(null);
    useImperativeHandle(
      ref,
      () => ({
        send: (message) => frame.current?.contentWindow?.postMessage(JSON.stringify(message), "*"),
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
        referrerPolicy="no-referrer"
        onError={onError}
        aria-hidden
        tabIndex={-1}
        style={{ width: 1, height: 1, position: "absolute", opacity: 0, border: 0 }}
      />
    );
  }
);
