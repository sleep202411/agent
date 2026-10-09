import { z } from "zod";
import { canvasHostMessage, canvasRuntimeMessage, type CanvasRuntimeMessage } from "../protocol";
import { layoutCanvasTidyGraph } from "./engine";
const { sessionId } = z
  .object({ sessionId: z.string().uuid() })
  .parse(JSON.parse(document.querySelector("[data-initial]")!.textContent!));
const host = window as typeof window & {
  ReactNativeWebView?: { postMessage(raw: string): void };
  __fizzCanvasReceive?: (raw: string) => void;
};
const send = (message: CanvasRuntimeMessage) => {
  const raw = JSON.stringify(canvasRuntimeMessage.parse(message));
  if (host.ReactNativeWebView) host.ReactNativeWebView.postMessage(raw);
  else parent.postMessage(raw, "*");
};
let lastRequest = 0;
function receive(raw: unknown) {
  if (typeof raw !== "string") return;
  let parsed;
  try {
    parsed = canvasHostMessage.safeParse(JSON.parse(raw));
  } catch {
    return;
  }
  if (
    !parsed.success ||
    parsed.data.type !== "tidy" ||
    parsed.data.sessionId !== sessionId ||
    parsed.data.requestId <= lastRequest
  )
    return;
  const message = parsed.data;
  lastRequest = message.requestId;
  const identity = {
    sessionId,
    requestId: message.requestId,
    documentId: message.documentId,
    sequence: message.sequence,
  };
  void layoutCanvasTidyGraph(message.layout)
    .then((positions) => {
      if (lastRequest !== message.requestId) return;
      send({
        type: "tidied",
        ...identity,
        move: {
          action: "moveNodes",
          positions: positions.map((row) => ({ nodeId: row.id, ...row.position })),
        },
      });
    })
    .catch((error) => {
      if (lastRequest === message.requestId)
        send({
          type: "error",
          ...identity,
          message: error instanceof Error ? error.message : String(error),
        });
    });
}
host.__fizzCanvasReceive = receive;
window.addEventListener("message", (event) => {
  if (event.source === parent) receive(event.data);
});
send({ type: "ready", sessionId });
