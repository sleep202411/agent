"use client";

import { useEffect, useMemo, useRef } from "react";
import { backendApi } from "@/src/lib/api";
import { store } from "@/src/store";
import { selectCurrentInstance, setEpisodes } from "@/src/store/slices/projectSlice";

/** Keep a delayed episode edit attached to the episode that admitted it. */
export function useEpisodePromptAutosave() {
  const stateRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    pending: (() => void) | null;
    owns: (() => boolean) | null;
    active: boolean;
  }>({ timer: null, pending: null, owns: null, active: false });
  const autosave = useMemo(() => {
    const cancel = () => {
      if (stateRef.current.timer !== null) clearTimeout(stateRef.current.timer);
      stateRef.current.timer = null;
      stateRef.current.pending = null;
      stateRef.current.owns = null;
    };
    const flush = () => {
      const save = stateRef.current.owns?.() ? stateRef.current.pending : null;
      cancel();
      save?.();
    };
    return {
      start() {
        stateRef.current.active = true;
      },
      stop() {
        flush();
        stateRef.current.active = false;
      },
      check() {
        if (stateRef.current.owns && !stateRef.current.owns()) cancel();
      },
      isPending: () => stateRef.current.timer !== null,
      schedule(front: string, behind: string) {
        if (!stateRef.current.active) return;
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
        stateRef.current.owns = () => {
          const current = store.getState();
          const next = selectCurrentInstance(current);
          return (
            current.project.currentProjectId === projectId &&
            next.detail?.id === detailId &&
            String(next.activeEpisodeId) === String(episode.id) &&
            next.episodes.some((item) => String(item.id) === String(episode.id))
          );
        };
        stateRef.current.pending = () => {
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
        stateRef.current.timer = setTimeout(flush, 500);
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
