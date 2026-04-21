"use client";

import { useEffect, useRef } from "react";
import { backendApi, type Paginated } from "@/src/lib/api";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import {
  setCharacters,
  setCharactersLoading,
  setScenes,
  setScenesLoading,
  setProjectList,
  setProjectListLoading,
  selectCurrentInstance,
  type Asset,
} from "@/src/store/slices/projectSlice";
import type { ProjectOptionItem } from "@/src/types/workspace";

/**
 * Eagerly preload world-scoped lists that the storyboard consumes on
 * mount. Specifically:
 *  - `characters` — CharacterCell when a character column is present,
 *    plus the characters panel.
 *  - `scenes` — SceneReferenceCell (scene column is part of the default
 *    storyboard schema), plus the scenes panel.
 *  - `projectList` (worldproduct) — the cross-project switcher.
 *
 * `props` is NOT preloaded here: there's no PropCell in the storyboard
 * (check `app/projects/_components/storyboard/cells/` — no prop-cell),
 * and the @mention popup hits `/api/user/world/list/worldprop` on
 * demand. `PropsPanel` loads its own list when opened.
 */
export function useWorldAssets() {
  const worldId = useAppSelector((s) => selectCurrentInstance(s).worldId);
  const charactersVersion = useAppSelector((s) => selectCurrentInstance(s).charactersVersion);
  const scenesVersion = useAppSelector((s) => selectCurrentInstance(s).scenesVersion);
  const projectListVersion = useAppSelector((s) => selectCurrentInstance(s).projectListVersion);

  const loadedCharactersRef = useRef<string | null>(null);
  const loadedScenesRef = useRef<string | null>(null);
  const loadedProjectListRef = useRef<string | null>(null);

  useEffect(() => {
    if (!worldId) return;
    const key = `${worldId}:${charactersVersion}`;
    if (loadedCharactersRef.current === key) return;
    loadedCharactersRef.current = key;

    store.dispatch(setCharactersLoading(true));
    backendApi
      .post<Paginated<Asset>>("/api/user/world/list/worldrole", {
        data: { worldId, page: 1, pageSize: 100 },
      })
      .then((data) => store.dispatch(setCharacters(data?.list ?? [])))
      .catch((error) => {
        console.error("[useWorldAssets] 加载角色失败:", error);
        store.dispatch(setCharactersLoading(false));
      });
  }, [charactersVersion, worldId]);

  useEffect(() => {
    if (!worldId) return;
    const key = `${worldId}:${scenesVersion}`;
    if (loadedScenesRef.current === key) return;
    loadedScenesRef.current = key;

    store.dispatch(setScenesLoading(true));
    backendApi
      .post<Paginated<Asset>>("/api/user/world/list/worldscene", {
        data: { worldId, page: 1, pageSize: 100 },
      })
      .then((data) => store.dispatch(setScenes(data?.list ?? [])))
      .catch((error) => {
        console.error("[useWorldAssets] 加载场景失败:", error);
        store.dispatch(setScenesLoading(false));
      });
  }, [scenesVersion, worldId]);

  // 项目列表
  useEffect(() => {
    if (!worldId) return;
    const key = `${worldId}:${projectListVersion}`;
    if (loadedProjectListRef.current === key) return;
    loadedProjectListRef.current = key;

    store.dispatch(setProjectListLoading(true));
    backendApi
      .post<Paginated<ProjectOptionItem>>("/api/user/world/list/worldproduct", {
        data: { worldId, page: 1, pageSize: 100 },
      })
      .then((data) => store.dispatch(setProjectList(data?.list ?? [])))
      .catch((error) => {
        console.error("[useWorldAssets] 加载项目列表失败:", error);
        store.dispatch(setProjectListLoading(false));
      });
  }, [projectListVersion, worldId]);
}
