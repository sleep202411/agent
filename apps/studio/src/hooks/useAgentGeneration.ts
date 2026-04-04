"use client";

import { useCallback, useState } from "react";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import { useAppSelector, useAppDispatch } from "@/src/store";
import { store } from "@/src/store";
import {
  setOutline,
  setStepStatus,
  setCharacters,
  setScenes,
  setProps,
  setStoryboards,
} from "@/src/store/slices/agentSlice";
import { api } from "@/src/lib/api";
import {
  storyOutlineSchema,
  charactersAndScenesSchema,
  storyboardSchema,
} from "@/src/lib/agent/schemas";
import type {
  StoryOutlineResult,
  CharactersAndScenesResult,
  StoryboardResult,
} from "@/src/lib/agent/schemas";
import { MOCK_OUTLINE, MOCK_CHARACTERS, MOCK_STORYBOARD } from "@/src/lib/agent/mock-data";

// ─── Mock Mode ───────────────────────────────────────

const MOCK = process.env.NEXT_PUBLIC_MOCK_AGENT === "true";
const MOCK_DELAY = 2000; // ms

// ─── Persistence Helper ──────────────────────────────

function persistStep(step: number, stepLabel: string, result: Record<string, unknown>) {
  const taskId = store.getState().agent.taskId;
  if (!taskId) return;

  api
    .put(`/api/tasks/${taskId}/steps/${step}`, {
      data: { stepLabel, result },
    })
    .catch((err) => {
      console.warn(`[persistStep] Failed to save step ${step}:`, err);
    });
}

// ─── Step① Outline Generation ─────────────────────────

export function useOutlineGeneration() {
  const dispatch = useAppDispatch();
  const [mockLoading, setMockLoading] = useState(false);

  const realHook = useObject({
    api: `${MOCK ? "/dev-null" : ""}/api/agent/outline`,
    schema: storyOutlineSchema,
    fetch: (url, init) => fetch(url, { ...init, credentials: "include" }),
    onFinish: ({ object }) => {
      if (object) {
        dispatch(
          setOutline({
            ...object,
            episodes: object.episodes.map((ep) => ({
              ...ep,
              id: crypto.randomUUID(),
            })),
          })
        );
        dispatch(setStepStatus({ step: 1, status: "done" }));
        persistStep(1, "生成大纲", object as Record<string, unknown>);
      }
    },
    onError: () => {
      dispatch(setStepStatus({ step: 1, status: "pending" }));
    },
  });

  const generate = useCallback(
    (input: { prompt?: string; text?: string }) => {
      dispatch(setStepStatus({ step: 1, status: "generating" }));

      if (MOCK) {
        setMockLoading(true);
        setTimeout(() => {
          dispatch(
            setOutline({
              ...MOCK_OUTLINE,
              episodes: MOCK_OUTLINE.episodes.map((ep) => ({
                ...ep,
                id: crypto.randomUUID(),
              })),
            })
          );
          dispatch(setStepStatus({ step: 1, status: "done" }));
          setMockLoading(false);
        }, MOCK_DELAY);
        return;
      }

      realHook.submit(input);
    },
    [MOCK, realHook.submit, dispatch, setMockLoading]
  );

  return {
    outline: MOCK
      ? (MOCK_OUTLINE as Partial<StoryOutlineResult>)
      : (realHook.object as Partial<StoryOutlineResult> | undefined),
    generate,
    isLoading: MOCK ? mockLoading : realHook.isLoading,
    error: MOCK ? null : realHook.error,
  };
}

// ─── Step② Characters & Scenes ────────────────────────

export function useCharactersGeneration() {
  const dispatch = useAppDispatch();
  const [mockLoading, setMockLoading] = useState(false);

  const realHook = useObject({
    api: `${MOCK ? "/dev-null" : ""}/api/agent/characters`,
    schema: charactersAndScenesSchema,
    fetch: (url, init) => fetch(url, { ...init, credentials: "include" }),
    onFinish: ({ object }) => {
      if (object) {
        dispatch(
          setCharacters(
            object.characters.map((c) => ({
              ...c,
              id: crypto.randomUUID(),
              imageStatus: "pending" as const,
            }))
          )
        );
        dispatch(
          setScenes(
            object.scenes.map((s) => ({
              ...s,
              id: crypto.randomUUID(),
              imageStatus: "pending" as const,
            }))
          )
        );
        dispatch(
          setProps(
            object.props.map((p) => ({
              ...p,
              id: crypto.randomUUID(),
            }))
          )
        );
        dispatch(setStepStatus({ step: 2, status: "done" }));
        persistStep(2, "提取角色与场景", object as Record<string, unknown>);
      }
    },
    onError: () => {
      dispatch(setStepStatus({ step: 2, status: "pending" }));
    },
  });

  const generate = useCallback(
    (outline: {
      title: string;
      background: string;
      conflict: string;
      episodes: { title: string; script: string }[];
    }) => {
      dispatch(setStepStatus({ step: 2, status: "generating" }));

      if (MOCK) {
        setMockLoading(true);
        setTimeout(() => {
          const m = MOCK_CHARACTERS;
          dispatch(
            setCharacters(
              m.characters.map((c) => ({
                ...c,
                id: crypto.randomUUID(),
                imageStatus: "pending" as const,
              }))
            )
          );
          dispatch(
            setScenes(
              m.scenes.map((s) => ({
                ...s,
                id: crypto.randomUUID(),
                imageStatus: "pending" as const,
              }))
            )
          );
          dispatch(setProps(m.props.map((p) => ({ ...p, id: crypto.randomUUID() }))));
          dispatch(setStepStatus({ step: 2, status: "done" }));
          setMockLoading(false);
        }, MOCK_DELAY);
        return;
      }

      realHook.submit({ outline });
    },
    [MOCK, realHook.submit, dispatch, setMockLoading]
  );

  return {
    result: MOCK
      ? (MOCK_CHARACTERS as Partial<CharactersAndScenesResult>)
      : (realHook.object as Partial<CharactersAndScenesResult> | undefined),
    generate,
    isLoading: MOCK ? mockLoading : realHook.isLoading,
    error: MOCK ? null : realHook.error,
  };
}

// ─── Step③ Storyboard ─────────────────────────────────

export function useStoryboardGeneration() {
  const dispatch = useAppDispatch();
  const outline = useAppSelector((s) => s.agent.outline);
  const [mockLoading, setMockLoading] = useState(false);

  const realHook = useObject({
    api: `${MOCK ? "/dev-null" : ""}/api/agent/storyboard`,
    schema: storyboardSchema,
    fetch: (url, init) => fetch(url, { ...init, credentials: "include" }),
    onFinish: ({ object }) => {
      if (object && outline) {
        dispatch(
          setStoryboards(
            object.storyboards.map((sb, i) => ({
              episodeId: outline.episodes[i]?.id || crypto.randomUUID(),
              title: sb.episodeTitle,
              shots: sb.shots.map((shot) => ({
                ...shot,
                id: crypto.randomUUID(),
                imageStatus: "pending" as const,
              })),
            }))
          )
        );
        dispatch(setStepStatus({ step: 3, status: "done" }));
        persistStep(3, "生成分镜表", object as Record<string, unknown>);
      }
    },
    onError: () => {
      dispatch(setStepStatus({ step: 3, status: "pending" }));
    },
  });

  const generate = useCallback(
    (input: {
      outline: {
        title: string;
        videoStyle: string;
        aspectRatio: string;
        episodes: { title: string; script: string }[];
      };
      characters: { name: string; appearance: string }[];
      scenes: { name: string; description: string }[];
    }) => {
      dispatch(setStepStatus({ step: 3, status: "generating" }));

      if (MOCK) {
        setMockLoading(true);
        setTimeout(() => {
          const storeOutline = store.getState().agent.outline;
          dispatch(
            setStoryboards(
              MOCK_STORYBOARD.storyboards.map((sb, i) => ({
                episodeId: storeOutline?.episodes[i]?.id || crypto.randomUUID(),
                title: sb.episodeTitle,
                shots: sb.shots.map((shot) => ({
                  ...shot,
                  id: crypto.randomUUID(),
                  imageStatus: "pending" as const,
                })),
              }))
            )
          );
          dispatch(setStepStatus({ step: 3, status: "done" }));
          setMockLoading(false);
        }, MOCK_DELAY);
        return;
      }

      realHook.submit(input);
    },
    [MOCK, realHook.submit, dispatch, setMockLoading]
  );

  return {
    result: MOCK
      ? (MOCK_STORYBOARD as Partial<StoryboardResult>)
      : (realHook.object as Partial<StoryboardResult> | undefined),
    generate,
    isLoading: MOCK ? mockLoading : realHook.isLoading,
    error: MOCK ? null : realHook.error,
  };
}
