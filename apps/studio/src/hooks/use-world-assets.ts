import { useEffect, useRef } from "react";
import { backendApi, type Paginated } from "@/src/lib/api";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import {
  setCharacters,
  setCharactersLoading,
  setScenes,
  setScenesLoading,
  setProps,
  setPropsLoading,
  setProjectList,
  setProjectListLoading,
  selectCurrentInstance,
  type Asset,
} from "@/src/store/slices/projectSlice";
import type { ProjectOptionItem } from "@/src/types/workspace";

export function useWorldAssets() {
  const worldId = useAppSelector((s) => selectCurrentInstance(s).worldId);
  const charactersVersion = useAppSelector((s) => selectCurrentInstance(s).charactersVersion);
  const scenesVersion = useAppSelector((s) => selectCurrentInstance(s).scenesVersion);
  const propsVersion = useAppSelector((s) => selectCurrentInstance(s).propsVersion);
  const projectListVersion = useAppSelector((s) => selectCurrentInstance(s).projectListVersion);

  const loadedCharactersRef = useRef<string | null>(null);
  const loadedScenesRef = useRef<string | null>(null);
  const loadedPropsRef = useRef<string | null>(null);
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

  useEffect(() => {
    if (!worldId) return;
    const key = `${worldId}:${propsVersion}`;
    if (loadedPropsRef.current === key) return;
    loadedPropsRef.current = key;

    store.dispatch(setPropsLoading(true));
    backendApi
      .post<Paginated<Asset>>("/api/user/world/list/worldprop", {
        data: { worldId, page: 1, pageSize: 100 },
      })
      .then((data) => store.dispatch(setProps(data?.list ?? [])))
      .catch((error) => {
        console.error("[useWorldAssets] 加载道具失败:", error);
        store.dispatch(setPropsLoading(false));
      });
  }, [propsVersion, worldId]);

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
