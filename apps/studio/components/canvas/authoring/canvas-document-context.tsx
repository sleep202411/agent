"use client";

import { createContext, useContext } from "react";

/**
 * The Studio document this canvas persists into, when the host knows it.
 * Media rendered on the canvas appends it to protected asset URLs so the
 * server can apply the canvas-context grant: whoever can read the document
 * may view every asset referenced on it (media ACL `documentId`).
 */
const CanvasDocumentContext = createContext<string | null>(null);

export const CanvasDocumentProvider = CanvasDocumentContext.Provider;

export function useCanvasDocumentId(): string | null {
  return useContext(CanvasDocumentContext);
}

export function withCanvasDocumentContext(src: string, documentId: string | null): string {
  if (!documentId || !src.startsWith("/aurora/media/assets/")) return src;
  return `${src}${src.includes("?") ? "&" : "?"}documentId=${encodeURIComponent(documentId)}`;
}
