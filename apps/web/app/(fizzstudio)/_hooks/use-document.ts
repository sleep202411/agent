"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  archiveDocument,
  createDocument,
  ensurePrimaryStoryboard,
  getDocument,
  listDocuments,
  updateDocument,
  type DocumentType,
  type FizzDocument,
} from "../_lib/api";

// ─── Cache keys ──────────────────────────────────────────────────────────────

export const documentKeys = {
  all: ["fizzstudio", "documents"] as const,
  list: (projectId: string) => [...documentKeys.all, "list", projectId] as const,
  detail: (documentId: string) => [...documentKeys.all, "detail", documentId] as const,
};

// ─── Queries ─────────────────────────────────────────────────────────────────

export function useDocuments(projectId: string, type?: DocumentType) {
  return useQuery({
    queryKey: [...documentKeys.list(projectId), type ?? "all"],
    queryFn: () => listDocuments(projectId, type),
    enabled: !!projectId,
    staleTime: 15_000,
  });
}

export function useDocument(documentId: string) {
  return useQuery({
    queryKey: documentKeys.detail(documentId),
    queryFn: () => getDocument(documentId),
    enabled: !!documentId,
    staleTime: 30_000,
  });
}

/**
 * Resolve a project's primary storyboard document, creating it on first
 * open. Idempotent — the editor calls this on mount; the user never sees
 * the underlying "document".
 */
export function usePrimaryStoryboard(projectId: string) {
  return useQuery({
    queryKey: [...documentKeys.all, "primary-storyboard", projectId],
    queryFn: () => ensurePrimaryStoryboard(projectId),
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useCreateDocument(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { type: DocumentType; title: string }) => createDocument(projectId, input),
    onSuccess: (doc) => {
      qc.setQueryData(documentKeys.detail(doc.id), doc);
      qc.invalidateQueries({ queryKey: documentKeys.list(projectId) });
    },
  });
}

export function useUpdateDocument(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof updateDocument>[1]) => updateDocument(documentId, input),
    onSuccess: (doc) => {
      qc.setQueryData(documentKeys.detail(documentId), doc);
      qc.invalidateQueries({ queryKey: documentKeys.list(doc.projectId) });
    },
  });
}

export function useArchiveDocument(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      documentId,
      expectedVersion,
    }: {
      documentId: string;
      expectedVersion?: number;
    }) => archiveDocument(documentId, expectedVersion),
    onSuccess: (doc) => {
      qc.setQueryData<FizzDocument[]>([...documentKeys.list(projectId), "all"], (prev = []) =>
        prev.filter((d) => d.id !== doc.id)
      );
      qc.invalidateQueries({ queryKey: documentKeys.list(projectId) });
    },
  });
}
