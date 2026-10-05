import { recordCanvasSubmission } from "./submission-edit";
import { applyCanvasGeneration } from "./generation-edit";
import { editCanvasPositions } from "./position-edit";
import { editCanvasGroup } from "./group-edit";
import { editCanvasShotMedia, reconcileCanvasShotMedia } from "./shot-media";
import { z } from "zod";
import { canvasHostMessage, type CanvasRuntimeMessage } from "./protocol";
import { materializeCanvas } from "./state";
import { createCanvasNode } from "./node-create";
import { editCanvasNode } from "./node-edit";

const { sessionId } = z
  .object({ sessionId: z.string().uuid() })
  .parse(JSON.parse(document.querySelector("[data-initial]")!.textContent!));
const host = window as typeof window & {
  ReactNativeWebView?: { postMessage(raw: string): void };
  __fizzCanvasReceive?: (raw: string) => void;
};
const send = (message: CanvasRuntimeMessage) => {
  const raw = JSON.stringify(message);
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
  try {
    if (message.type === "submission") {
      send({
        type: "edited",
        ...identity,
        ...recordCanvasSubmission(message.snapshot, message.documentId, message.submission),
      });
    } else if (message.type === "generation") {
      send({
        type: "edited",
        ...identity,
        ...applyCanvasGeneration(message.snapshot, message.documentId, message.job),
      });
    } else if (message.type === "moveNodes") {
      send({ type: "edited", ...identity, ...editCanvasPositions(message.snapshot, message.move) });
    } else if (message.type === "group") {
      send({ type: "edited", ...identity, ...editCanvasGroup(message.snapshot, message.group) });
    } else if (message.type === "reconcileShotMedia") {
      send({ type: "edited", ...identity, ...reconcileCanvasShotMedia(message.snapshot) });
    } else if (message.type === "shotMedia") {
      send({
        type: "edited",
        ...identity,
        ...editCanvasShotMedia(message.snapshot, message.media),
      });
    } else if (message.type === "create") {
      send({ type: "edited", ...identity, ...createCanvasNode(message.snapshot, message.create) });
    } else if (message.type === "edit") {
      send({ type: "edited", ...identity, ...editCanvasNode(message.snapshot, message.edit) });
    } else {
      send({
        type: "loaded",
        ...identity,
        ...materializeCanvas(message.snapshot, message.updates),
      });
    }
  } catch (error) {
    send({
      type: "error",
      ...identity,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
host.__fizzCanvasReceive = receive;
window.addEventListener("message", (event) => {
  if (event.source === parent) receive(event.data);
});
send({ type: "ready", sessionId });
