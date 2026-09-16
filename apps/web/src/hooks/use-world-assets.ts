"use client";

import { useEffect } from "react";
import { useCurrentUser } from "./use-user";
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
  const { user } = useCurrentUser();
  const viewer = user?.id ?? null;
  const projectId = useAppSelector((s) => s.project.currentProjectId);
  const worldId = useAppSelector((s) => selectCurrentInstance(s).worldId);
  const charactersVersion = useAppSelector((s) => selectCurrentInstance(s).charactersVersion);
  const scenesVersion = useAppSelector((s) => selectCurrentInstance(s).scenesVersion);
  const projectListVersion = useAppSelector((s) => selectCurrentInstance(s).projectListVersion);

  useEffect(() => {
    if (!worldId || !projectId || !viewer) return;
    const controller = new AbortController();
    const owns = () =>
      !controller.signal.aborted &&
      store.getState().project.currentProjectId === projectId &&
      selectCurrentInstance(store.getState()).worldId === worldId;

    store.dispatch(setCharactersLoading(true));
    backendApi
      .post<Paginated<Asset>>("/api/user/world/list/worldrole", {
        signal: controller.signal,
        data: { worldId, page: 1, pageSize: 100 },
      })
      .then((data) => {
        if (owns()) store.dispatch(setCharacters(data?.list ?? []));
      })
      .catch((error) => {
        if (!owns()) return;
        console.error("[useWorldAssets] 加载角色失败:", error);
        store.dispatch(setCharactersLoading(false));
      });
    return () => controller.abort();
  }, [charactersVersion, worldId, projectId, viewer]);

  useEffect(() => {
    if (!worldId || !projectId || !viewer) return;
    const controller = new AbortController();
    const owns = () =>
      !controller.signal.aborted &&
      store.getState().project.currentProjectId === projectId &&
      selectCurrentInstance(store.getState()).worldId === worldId;

    store.dispatch(setScenesLoading(true));
    backendApi
      .post<Paginated<Asset>>("/api/user/world/list/worldscene", {
        signal: controller.signal,
        data: { worldId, page: 1, pageSize: 100 },
      })
      .then((data) => {
        if (owns()) store.dispatch(setScenes(data?.list ?? []));
      })
      .catch((error) => {
        if (!owns()) return;
        console.error("[useWorldAssets] 加载场景失败:", error);
        store.dispatch(setScenesLoading(false));
      });
    return () => controller.abort();
  }, [scenesVersion, worldId, projectId, viewer]);

  // 项目列表
  useEffect(() => {
    if (!worldId || !projectId || !viewer) return;
    const controller = new AbortController();
    const owns = () =>
      !controller.signal.aborted &&
      store.getState().project.currentProjectId === projectId &&
      selectCurrentInstance(store.getState()).worldId === worldId;

    store.dispatch(setProjectListLoading(true));
    backendApi
      .post<Paginated<ProjectOptionItem>>("/api/user/world/list/worldproduct", {
        signal: controller.signal,
        data: { worldId, page: 1, pageSize: 100 },
      })
      .then((data) => {
        if (owns()) store.dispatch(setProjectList(data?.list ?? []));
      })
      .catch((error) => {
        if (!owns()) return;
        console.error("[useWorldAssets] 加载项目列表失败:", error);
        store.dispatch(setProjectListLoading(false));
      });
    return () => controller.abort();
  }, [projectListVersion, worldId, projectId, viewer]);
}
