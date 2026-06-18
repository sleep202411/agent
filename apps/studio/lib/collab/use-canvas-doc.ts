"use client";

import { CANVAS_ROOT_SCHEMA } from "./protocol";
import { useCollabDoc, type CollabDocHandle, type CollabUser } from "./use-collab-doc";

/** Canvas is one collaborative mode; its identity/handle types alias the generic ones. */
export type CanvasUser = CollabUser;
export type CanvasDocHandle = CollabDocHandle;

/** {@link useCollabDoc} bound to the canvas root schema. */
export function useCanvasDoc(
  documentId: string | null | undefined,
  user: CanvasUser | null
): CanvasDocHandle {
  return useCollabDoc(documentId, user, CANVAS_ROOT_SCHEMA);
}
