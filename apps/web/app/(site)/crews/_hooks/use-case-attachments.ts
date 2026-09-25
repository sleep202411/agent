"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { crewApi } from "./api";
export type CaseAttachment = {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  ready: boolean;
  shared: boolean;
  createdAt: string;
};
export function useCaseAttachments(userId: string, caseId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["crew-cases", userId, "attachments", caseId],
    enabled,
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<{ items: CaseAttachment[]; nextBeforeId: string | null }>(
        `/crew-disputes/${encodeURIComponent(caseId)}/attachments`,
        { signal, cache: "no-store", query: { limit: 20, beforeId: pageParam } }
      ),
    getNextPageParam: (page) => page.nextBeforeId ?? undefined,
  });
}
export function attachmentFileError(file: File): boolean {
  return (
    !["application/pdf", "image/png", "image/jpeg"].includes(file.type) ||
    file.size < 1 ||
    file.size > 10 * 1024 * 1024 ||
    !file.name.trim() ||
    file.name.trim().length > 255 ||
    /["/\\]/.test(file.name) ||
    [...file.name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  );
}
export function validEvidenceUrl(url: string): boolean {
  try {
    const value = new URL(url);
    return value.protocol === "https:" && !value.username && !value.password;
  } catch {
    return false;
  }
}
