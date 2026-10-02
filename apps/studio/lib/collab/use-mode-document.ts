"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiRequestError } from "@/lib/api";
import { useAuth } from "@/app/_components/auth-provider";
import { ensureModeDocument, type ModeDocumentRef } from "./projects-api";

export type ModeDocumentStatus = "loading" | "ready" | "error";

export interface ModeDocumentState {
  document: ModeDocumentRef | null;
  documentId: string | null;
  status: ModeDocumentStatus;
  error: string | null;
  retry: () => void;
  retrying: boolean;
}

/** Resolves the project's non-section document, with an account-scoped retry. */
export function useModeDocument(
  projectId: string | null | undefined,
  type: string
): ModeDocumentState {
  const { user, loading } = useAuth();
  const enabled = Boolean(projectId && user) && !loading;
  const query = useQuery({
    queryKey: ["project-mode-document", user?.id ?? null, projectId ?? null, type],
    queryFn: ({ signal }) => ensureModeDocument(projectId!, type, signal),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
  const unavailable =
    query.error instanceof ApiRequestError && [401, 403, 404, 410].includes(query.error.status);
  const document = enabled && !unavailable ? (query.data ?? null) : null;
  return {
    document,
    documentId: document?.id ?? null,
    status: !enabled || query.isPending ? "loading" : document ? "ready" : "error",
    error:
      enabled && query.isError
        ? query.error instanceof Error
          ? query.error.message
          : "Failed to open document"
        : null,
    retry: () => {
      if (enabled && !query.isFetching) void query.refetch();
    },
    retrying: query.isFetching,
  };
}
