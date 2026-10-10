import { getAuthGeneration } from "@/auth/auth-store";
import type { CandidateScope } from "../api/story-candidates-api";
import type { StoryCanvasDocumentState } from "../api/story-canvas-document";
import type {
  PlatformCanvasDocumentState,
  PlatformCanvasScope,
} from "../api/platform-canvas-document";
import type { CanvasHostMessage, CanvasRuntimeMessage } from "../../../../canvas-editor/protocol";
import { parseCanvasMessage } from "./story-canvas-bridge";

type Loaded = Extract<CanvasRuntimeMessage, { type: "loaded" }>;
type CanvasDocumentState = StoryCanvasDocumentState | PlatformCanvasDocumentState;
/** Transport stays in the app; the isolated runtime receives only document bytes.
 * Each host belongs to one authenticated project/document visit. */
export function createCanvasHost(options: {
  scope: CandidateScope | PlatformCanvasScope;
  sessionId: string;
  snapshot: CanvasDocumentState;
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
  const validate = (value: CanvasDocumentState) => {
    const scope = options.scope;
    const document = value.document;
    const owned =
      "kind" in scope && scope.kind === "platform"
        ? document.owner.kind === "platform_project" &&
          document.platformProjectId === scope.projectId &&
          document.storyProjectId === null &&
          "workspaceId" in document &&
          document.workspaceId === scope.workspaceId &&
          "sectionId" in document &&
          document.sectionId === scope.sectionId &&
          document.id === scope.documentId
        : document.owner.kind === "story_project" &&
          document.storyProjectId === scope.projectId &&
          document.platformProjectId === null;
    if (
      !owned ||
      value.document.id !== documentId ||
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
      if (message.type === "edited" || message.type === "tidied") return;
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
    remote(value: CanvasDocumentState) {
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
