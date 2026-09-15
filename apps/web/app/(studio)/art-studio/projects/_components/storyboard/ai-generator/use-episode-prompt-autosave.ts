"use client";

import { useEffect, useMemo } from "react";
import { backendApi } from "@/src/lib/api";
import { store } from "@/src/store";
import { selectCurrentInstance, setEpisodes } from "@/src/store/slices/projectSlice";

/** Keep a delayed episode edit attached to the episode that admitted it. */
export function useEpisodePromptAutosave() {
  const autosave = useMemo(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: (() => void) | null = null;
    let owns: (() => boolean) | null = null;
    let active = false;
    const cancel = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
      owns = null;
    };
    const flush = () => {
      const save = owns?.() ? pending : null;
      cancel();
      save?.();
    };
    return {
      start() {
        active = true;
      },
      stop() {
        flush();
        active = false;
      },
      check() {
        if (owns && !owns()) cancel();
      },
      isPending: () => timer !== null,
      schedule(front: string, behind: string) {
        if (!active) return;
        cancel();
        const state = store.getState();
        const projectId = state.project.currentProjectId;
        const instance = selectCurrentInstance(state);
        const episode = instance.episodes.find(
          (item) => String(item.id) === String(instance.activeEpisodeId)
        );
        if (
          !projectId ||
          !instance.detail?.id ||
          String(instance.detail.id) !== projectId ||
          !episode?.id
        )
          return;
        const detailId = instance.detail.id;
        owns = () => {
          const current = store.getState();
          const next = selectCurrentInstance(current);
          return (
            current.project.currentProjectId === projectId &&
            next.detail?.id === detailId &&
            String(next.activeEpisodeId) === String(episode.id) &&
            next.episodes.some((item) => String(item.id) === String(episode.id))
          );
        };
        pending = () => {
          const prompts = { frontPrompt: front.trim(), behindPrompt: behind.trim() };
          store.dispatch(
            setEpisodes(
              selectCurrentInstance(store.getState()).episodes.map((item) =>
                String(item.id) === String(episode.id) ? { ...item, ...prompts } : item
              )
            )
          );
          void backendApi
            .post("/api/user/world/update/episode", {
              data: { id: episode.id, projectId: detailId, ...prompts },
            })
            .catch((error) => console.warn("[EpisodePromptAutosave] save prompts failed:", error));
        };
        timer = setTimeout(flush, 500);
      },
    };
  }, []);
  useEffect(() => {
    autosave.start();
    const unsubscribe = store.subscribe(autosave.check);
    return () => {
      unsubscribe();
      autosave.stop();
    };
  }, [autosave]);
  return autosave;
}
