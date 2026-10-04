import { getAuthGeneration } from "@/auth/auth-store";
import type { CandidateScope } from "../api/story-candidates-api";
import type { StoryCanvasDocumentState } from "../api/story-canvas-document";
import type { CanvasHostMessage, CanvasRuntimeMessage } from "../../../../canvas-editor/protocol";
import { parseCanvasMessage } from "./story-canvas-bridge";

type Loaded = Extract<CanvasRuntimeMessage, { type: "loaded" }>;
/** Transport stays in the app; the isolated runtime receives only document bytes.
 * Each host belongs to one authenticated project/document visit. */
export function createCanvasHost(options: {
  scope: CandidateScope;
  sessionId: string;
  snapshot: StoryCanvasDocumentState;
  send(message: CanvasHostMessage): void;
  onResult(result: Loaded): void;
  onError(message: string): void;
}) {
  let snapshot = options.snapshot,
    requestId = 0,
    ready = false,
    disposed = false,
    settled = false;
  const documentId = snapshot.document.id;
  const current = () => !disposed && getAuthGeneration() === options.scope.generation;
  const validate = (value: StoryCanvasDocumentState) => {
    if (
      value.document.id !== documentId ||
      value.document.storyProjectId !== options.scope.projectId ||
      value.document.owner.projectId !== options.scope.projectId ||
      value.sequence !== value.document.currentSequence ||
      value.sequence < snapshot.sequence
    )
      throw Error("Canvas sync scope or sequence mismatch.");
  };
  validate(snapshot);
  const send = () => {
    if (!current() || !ready) return;
    settled = false;
    options.send({
      type: "load",
      sessionId: options.sessionId,
      documentId,
      sequence: snapshot.sequence,
      requestId: ++requestId,
      snapshot: snapshot.document.crdtStateBase64,
      updates: snapshot.operations.flatMap((operation) =>
        operation.yjsUpdateBase64 ? [operation.yjsUpdateBase64] : []
      ),
    });
  };
  return {
    receive(raw: unknown) {
      if (!current()) return;
      const message = parseCanvasMessage(raw, options.sessionId);
      if (!message) return;
      if (message.type === "ready") {
        ready = true;
        send();
        return;
      }
      if (
        !ready ||
        settled ||
        message.documentId !== documentId ||
        message.sequence !== snapshot.sequence ||
        message.requestId !== requestId
      )
        return;
      settled = true;
      if (message.type === "loaded") options.onResult(message);
      else options.onError(message.message);
    },
    remote(value: StoryCanvasDocumentState) {
      if (!current()) return;
      validate(value);
      snapshot = value;
      send();
    },
    dispose() {
      disposed = true;
    },
  };
}
