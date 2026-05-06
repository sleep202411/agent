"use client";

/**
 * Read-only fallback for the script step when no seed exists in
 * sessionStorage. Pulls the project's existing episodes from Java
 * and parallel-fills each episode's shot count, so a returning
 * user (already ran the pipeline + committed, or built episodes
 * via chat) sees their work instead of the empty onboarding card.
 *
 * Distinct from `useProduceCommittedResult` (which only knows
 * about results that went through the produce pipeline's commit
 * step). This hook reflects whatever Java currently holds for
 * the project, regardless of how the data got there.
 */

import { useCallback, useEffect, useState } from "react";
import {
  loadEpisodeShotCount,
  loadProduceJavaEpisodes,
  type ProduceJavaEpisode,
} from "@/src/lib/produce/java-produce-data";

export interface ProjectScriptEpisode extends ProduceJavaEpisode {
  shotCount: number;
}

export interface UseProjectScriptsResult {
  loading: boolean;
  episodes: ProjectScriptEpisode[];
  error: string | null;
  refresh: () => Promise<void>;
}

export function useProjectScripts(projectId: string): UseProjectScriptsResult {
  const [loading, setLoading] = useState(true);
  const [episodes, setEpisodes] = useState<ProjectScriptEpisode[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setEpisodes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await loadProduceJavaEpisodes(projectId);
      // Parallel-fetch shot counts so the UI can show progress at
      // a glance. A failed count is non-fatal — we just default
      // that one to 0 and keep going.
      const counts = await Promise.all(
        list.map((episode) =>
          episode.id ? loadEpisodeShotCount(episode.id).catch(() => 0) : Promise.resolve(0)
        )
      );
      setEpisodes(
        list.map((episode, index) => ({
          ...episode,
          shotCount: counts[index] ?? 0,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载剧集失败");
      setEpisodes([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { loading, episodes, error, refresh };
}
