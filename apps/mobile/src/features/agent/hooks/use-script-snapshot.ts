import { useEffect, useState } from "react";
import { useAuth } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { loadStoryScriptSnapshot } from "../api/story-production-api";
import { scriptDocumentToMarkdown } from "../lib/parse-script-snapshot";

/** Every refresh belongs to one account, chapter and foreground visit. */
export function useScriptSnapshot(projectId: string, chapterId: string, ready: boolean) {
  const auth = useAuth();
  const active = useScreenActive();
  const [revision, setRevision] = useState(0);
  const key = `${auth.generation}:${projectId}:${chapterId}:${revision}`;
  const enabled = ready && active && auth.status === "authenticated" && !!chapterId;
  const [result, setResult] = useState<{ key: string; markdown: string; error?: string }>();
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && getAuthGeneration() === auth.generation;
    void loadStoryScriptSnapshot(projectId, chapterId, controller.signal)
      .then((document) => {
        if (current())
          setResult({
            key,
            markdown: scriptDocumentToMarkdown({ contentSnapshot: document.contentSnapshot }),
          });
      })
      .catch((error: unknown) => {
        if (current())
          setResult({
            key,
            markdown: "",
            error: error instanceof Error ? error.message : String(error),
          });
      });
    return () => controller.abort();
  }, [enabled, projectId, chapterId, auth.generation, key]);
  const visible = enabled && result?.key === key ? result : undefined;
  return {
    markdown: visible?.markdown ?? "",
    error: visible?.error,
    loading: enabled && !visible,
    refresh: () => setRevision((n) => n + 1),
  };
}
