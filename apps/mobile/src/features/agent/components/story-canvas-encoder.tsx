import type { CanvasReferenceEdit } from "../../../../canvas-editor/reference-schema";
import type { CanvasSubmissionRecord } from "../../../../canvas-editor/submission-schema";
import type { CanvasGenerationJob } from "../../../../canvas-editor/generation-schema";
import type { CanvasPositionEdit } from "../../../../canvas-editor/position-schema";
import type { CanvasGroupEdit } from "../../../../canvas-editor/group-schema";
import type { CanvasShotMedia } from "../../../../canvas-editor/shot-media-schema";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { uuid } from "expo-modules-core";
import { getAuthGeneration } from "@/auth/auth-store";
import type { CanvasNodeEdit, CanvasNodeCreate } from "../../../../canvas-editor/schema";
import type { CanvasTidyLayoutRequest } from "../../../../canvas-editor/tidy/schema";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import { canvasRuntimeHtml, parseCanvasMessage } from "../lib/story-canvas-bridge";
import { CanvasRuntimeFrame, type CanvasFrameHandle } from "./story-canvas-runtime-frame";

export function StoryCanvasEncoder({
  loaded,
  edit,
  generation,
  title,
  runtimeError,
  onResult,
  onError,
  tidy,
}: {
  loaded: CanvasLoaded;
  edit?:
    | CanvasNodeEdit
    | CanvasNodeCreate
    | CanvasShotMedia
    | CanvasGroupEdit
    | CanvasPositionEdit
    | { action: "references"; references: CanvasReferenceEdit }
    | { action: "reconcileShotMedia" }
    | { action: "generation"; job: CanvasGenerationJob }
    | { action: "submission"; submission: CanvasSubmissionRecord };
  generation: number;
  title: string;
  runtimeError: string;
  tidy?: {
    layout: CanvasTidyLayoutRequest;
    html(sessionId: string): string;
    onResult(move: CanvasPositionEdit): void;
  };
  onResult(update: string | null): void;
  onError(message: string): void;
}) {
  const [sessionId] = useState(() => uuid.v4());
  const html = useMemo(
    () => (tidy ? tidy.html(sessionId) : canvasRuntimeHtml(sessionId)),
    [sessionId, tidy]
  );
  const frame = useRef<CanvasFrameHandle>(null),
    life = useRef<{ active: boolean; settled: boolean; sent: boolean } | null>(null);
  const callbacks = useRef({ onResult, onError, runtimeError });
  useLayoutEffect(() => {
    callbacks.current = { onResult, onError, runtimeError };
  }, [onResult, onError, runtimeError]);
  useLayoutEffect(() => {
    const token = { active: true, settled: false, sent: false };
    life.current = token;
    const timer = setTimeout(() => {
      if (token.active && !token.settled && getAuthGeneration() === generation) {
        token.settled = true;
        callbacks.current.onError(callbacks.current.runtimeError);
      }
    }, 30000);
    return () => {
      token.active = false;
      clearTimeout(timer);
    };
  }, [generation]);
  const current = () =>
    life.current?.active && !life.current.settled && getAuthGeneration() === generation;
  const fail = (message: string) => {
    if (current()) {
      life.current!.settled = true;
      callbacks.current.onError(message);
    }
  };
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: 1 }}
    >
      <CanvasRuntimeFrame
        ref={frame}
        html={html}
        title={title}
        onError={() => fail(runtimeError)}
        onMessage={(raw) => {
          if (!current()) return;
          const message = parseCanvasMessage(raw, sessionId);
          if (!message) return;
          if (message.type === "ready") {
            if (life.current!.sent) return;
            life.current!.sent = true;
            if (tidy) {
              frame.current?.send({
                type: "tidy",
                sessionId,
                requestId: 1,
                documentId: loaded.documentId,
                sequence: loaded.sequence,
                layout: tidy.layout,
              });
              return;
            }
            if (!edit) {
              fail(runtimeError);
              return;
            }
            frame.current?.send({
              sessionId,
              requestId: 1,
              documentId: loaded.documentId,
              sequence: loaded.sequence,
              snapshot: loaded.state,
              ...("operation" in edit
                ? { type: "group" as const, group: edit }
                : "action" in edit
                  ? edit.action === "moveNodes"
                    ? { type: "moveNodes" as const, move: edit }
                    : edit.action === "submission"
                      ? { type: "submission" as const, submission: edit.submission }
                      : edit.action === "generation"
                        ? { type: "generation" as const, job: edit.job }
                        : edit.action === "references"
                          ? { type: "references" as const, references: edit.references }
                          : edit.action === "reconcileShotMedia"
                            ? { type: "reconcileShotMedia" as const }
                            : { type: "shotMedia" as const, media: edit }
                  : "kind" in edit
                    ? { type: "edit" as const, edit }
                    : { type: "create" as const, create: edit }),
            });
            return;
          }
          if (
            !life.current!.sent ||
            message.documentId !== loaded.documentId ||
            message.sequence !== loaded.sequence ||
            message.requestId !== 1
          )
            return;
          if (message.type === "error") fail(message.message);
          if (message.type === "tidied" && tidy) {
            life.current!.settled = true;
            tidy.onResult(message.move);
          }
          if (message.type === "edited") {
            life.current!.settled = true;
            callbacks.current.onResult(message.yjsUpdateBase64);
          }
        }}
      />
    </View>
  );
}
