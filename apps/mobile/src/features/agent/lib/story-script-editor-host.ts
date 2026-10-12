import { durableRecord } from "@/lib/durable-record";
import { getAuthGeneration } from "@/auth/auth-store";
import {
  scriptUpdatePending,
  type ScriptScope,
  type reloadScriptCollaboration,
} from "../api/story-script-collaboration";
import { scriptCheckpointSchema, type ScriptHostMessage } from "../../../../script-editor/protocol";
import { parseScriptEditorMessage } from "./story-script-editor-bridge";

type HostPayload<T = ScriptHostMessage> = T extends ScriptHostMessage
  ? Omit<T, "sessionId">
  : never;
type Snapshot = Awaited<ReturnType<typeof reloadScriptCollaboration>>;
/** One editor visit owns its messages; durable edits belong to the account/chapter/document. */
export function createScriptEditorHost(options: {
  scope: ScriptScope;
  userId: string;
  sessionId: string;
  editable: boolean;
  snapshot: Snapshot;
  send: (message: ScriptHostMessage) => void;
  onError: (message?: string) => void;
  onFatal?: (message: string) => void;
}) {
  const { scope, userId, sessionId } = options;
  const storage = durableRecord(
    "story-script-checkpoint",
    userId,
    `${scope.projectId}:${scope.chapterId}:${scope.documentId}`
  );
  const writes = scriptUpdatePending(scope, userId);
  const saved = storage.read();
  let checkpoint = saved === null ? undefined : scriptCheckpointSchema.parse(JSON.parse(saved));
  const unfinished = writes.read();
  if (
    unfinished &&
    !checkpoint?.pending.some(
      (p) =>
        p.clientKey === unfinished.clientKey && p.yjsUpdateBase64 === unfinished.yjsUpdateBase64
    )
  )
    throw Error("Script recovery does not match the saved edit journal.");
  let snapshot = options.snapshot;
  let disposed = false,
    editable = options.editable,
    revision = 0,
    sending = false,
    waitingAck: string | undefined,
    networkError = false,
    storageError = false;
  const current = () => !disposed && scope.generation === getAuthGeneration();
  const send = (message: HostPayload) => {
    if (current()) options.send({ ...message, sessionId } as ScriptHostMessage);
  };
  const pump = () => {
    if (
      !current() ||
      !editable ||
      sending ||
      waitingAck ||
      networkError ||
      storageError ||
      !checkpoint?.pending.length
    )
      return;
    const edit = checkpoint.pending[0];
    sending = true;
    void writes
      .submit(edit)
      .then(() => {
        if (!current()) return;
        waitingAck = edit.clientKey;
        send({ type: "ack", edit });
      })
      .catch((error) => {
        if (current()) {
          networkError = true;
          options.onError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        sending = false;
        pump();
      });
  };
  const persist = () => {
    if (!current() || !checkpoint) return;
    try {
      storage.write(JSON.stringify(checkpoint));
      storageError = false;
      send({ type: "persisted", revision });
      if (waitingAck && !checkpoint.pending.some((p) => p.clientKey === waitingAck))
        waitingAck = undefined;
      pump();
    } catch (error) {
      storageError = true;
      const message = error instanceof Error ? error.message : String(error);
      options.onError(message);
      send({ type: "hostError", message });
    }
  };
  return {
    receive(raw: unknown) {
      if (!current()) return;
      const message = parseScriptEditorMessage(raw, sessionId);
      if (!message) return;
      if (message.type === "ready") {
        revision = 0;
        waitingAck = undefined;
        send({
          type: "init",
          editable,
          checkpoint,
          snapshot: snapshot.document.crdtStateBase64,
          updates: snapshot.operations.flatMap((op) =>
            op.yjsUpdateBase64 ? [op.yjsUpdateBase64] : []
          ),
        });
      }
      if (message.type === "error") {
        networkError = true;
        options.onError(message.message);
        options.onFatal?.(message.message);
      }
      if (message.type === "checkpoint" && message.revision > revision) {
        revision = message.revision;
        checkpoint = message.checkpoint;
        persist();
      }
    },
    retry() {
      if (!current()) return;
      networkError = false;
      options.onError(undefined);
      persist();
      pump();
    },
    remote(value: Snapshot) {
      if (!current()) return;
      if (
        value.document.id !== scope.documentId ||
        value.document.storyProjectId !== scope.projectId ||
        value.document.storyChapterId !== scope.chapterId
      )
        throw Error("Script sync scope mismatch.");
      snapshot = value;
      send({
        type: "remote",
        snapshot: value.document.crdtStateBase64,
        updates: value.operations.flatMap((op) => (op.yjsUpdateBase64 ? [op.yjsUpdateBase64] : [])),
      });
    },
    setEditable(value: boolean) {
      editable = value;
      send({ type: "editable", value });
      pump();
    },
    dispose() {
      disposed = true;
    },
  };
}
