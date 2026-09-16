"use client";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/app/_components/auth-provider";
import { ensureStoryCanvasDocument, ensureStoryScriptDocument } from "@/lib/collab/projects-api";

export function useStoryCanvasDocument(projectId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["story-studio", "creative-document", projectId, user?.id ?? null],
    queryFn: ({ signal }) => ensureStoryCanvasDocument(projectId, signal),
    enabled: Boolean(projectId && user),
    staleTime: Infinity,
  });
}

export function useStoryScriptDocument(projectId: string, chapterId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["story-studio", "script-document", projectId, chapterId, user?.id ?? null],
    queryFn: ({ signal }) => ensureStoryScriptDocument(projectId, chapterId!, signal),
    enabled: Boolean(projectId && chapterId && user),
    retry: false,
  });
}
