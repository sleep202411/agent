"use client";

import {
  useModeDocument,
  type ModeDocumentState,
  type ModeDocumentStatus,
} from "./use-mode-document";

export type CanvasDocumentStatus = ModeDocumentStatus;
export type CanvasDocumentState = ModeDocumentState;

/** {@link useModeDocument} bound to the canvas mode. */
export function useCanvasDocument(projectId: string | null | undefined): CanvasDocumentState {
  return useModeDocument(projectId, "canvas");
}
