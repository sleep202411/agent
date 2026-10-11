import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { ScriptHostMessage } from "../../../../script-editor/protocol";
export type ScriptFrameHandle = { send(message: ScriptHostMessage): void };
export type ScriptFrameProps = {
  html: string;
  title: string;
  onMessage(raw: unknown): void;
  onError(): void;
};
export const ScriptEditorFrame = forwardRef<ScriptFrameHandle, ScriptFrameProps>(
  function ScriptEditorFrame({ html, title, onMessage, onError }, ref) {
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
        style={{ width: "100%", flex: 1, minHeight: 320, border: 0 }}
      />
    );
  }
);
