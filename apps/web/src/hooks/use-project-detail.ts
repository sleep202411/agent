"use client";

import { useEffect, useLayoutEffect } from "react";
import { useCurrentUser } from "./use-user";
import { useParams, useSearchParams } from "next/navigation";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import { backendApi, type Paginated } from "@/src/lib/api";
import {
  setProjectId,
  setWorldId,
  setRouteEpisodeId,
  setDetail,
  setLoading,
  setError,
  setEpisodes,
  setEpisodesLoading,
  setActiveEpisodeId,
  setWorldDetail,
  setWorldLoading,
  reset,
  selectCurrentInstance,
  type Episode,
  type ProjectDetail,
} from "@/src/store/slices/projectSlice";

/**
 * 项目详情 + 剧集列表数据加载 hook。
 *
 * 职责：
 * 1. 从 URL params 读取 projectId（仅此一处从 URL 取值）
 * 2. 写入 projectId 到 store（单一数据源）
 * 3. 调用 V1 接口获取项目详情 → 写入 store
 * 4. 级联加载剧集列表 → 写入 store，默认选中第一集
 *
 * 应在项目详情页顶层调用一次，其他组件通过 useProjectStore 消费数据。
 */
export function useProjectDetail() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = params?.id ?? "";
  const urlWorldId = searchParams?.get("worldId") ?? null;
  const urlEpisodeId = searchParams?.get("episodeId") ?? null;

  const { user } = useCurrentUser();
  const viewer = user?.id ?? null;

  const detail = useAppSelector((s) => selectCurrentInstance(s).detail);
  const isLoading = useAppSelector((s) => selectCurrentInstance(s).isLoading);
  const error = useAppSelector((s) => selectCurrentInstance(s).error);
  const episodes = useAppSelector((s) => selectCurrentInstance(s).episodes);
  const activeEpisodeId = useAppSelector((s) => selectCurrentInstance(s).activeEpisodeId);
  const isEpisodesLoading = useAppSelector((s) => selectCurrentInstance(s).isEpisodesLoading);
  const worldId = useAppSelector((s) => selectCurrentInstance(s).worldId);
  const episodesVersion = useAppSelector((s) => selectCurrentInstance(s).episodesVersion);
  const worldVersion = useAppSelector((s) => selectCurrentInstance(s).worldVersion);

  useLayoutEffect(() => {
    if (!id) return;
    store.dispatch(setProjectId(id));
    store.dispatch(reset());
    if (!viewer) return;
    const controller = new AbortController();
    const owns = () =>
      !controller.signal.aborted && store.getState().project.currentProjectId === id;
    store.dispatch(setLoading(true));

    backendApi
      .post<ProjectDetail>(`/api/user/project/detail/${id}`, { signal: controller.signal })
      .then((data) => {
        if (!owns()) return;
        store.dispatch(setDetail(data));
        const detailWorldId = data?.worldId as string | undefined;
        if (detailWorldId) store.dispatch(setWorldId(String(detailWorldId)));
      })
      .catch((err) => {
        if (!owns()) return;
        store.dispatch(setError(err.message ?? "Load failed"));
      });
    return () => controller.abort();
  }, [id, viewer]);

  useEffect(() => {
    if (!viewer || store.getState().project.currentProjectId !== id) return;
    store.dispatch(setRouteEpisodeId(urlEpisodeId));
    if (!urlEpisodeId) return;
    if (episodes.some((ep) => String(ep.id) === String(urlEpisodeId))) {
      store.dispatch(setActiveEpisodeId(String(urlEpisodeId)));
    }
  }, [id, viewer, urlEpisodeId, episodes]);

  useEffect(() => {
    if (!id || !viewer) return;
    const controller = new AbortController();
    const owns = () =>
      !controller.signal.aborted && store.getState().project.currentProjectId === id;

    store.dispatch(setEpisodesLoading(true));

    backendApi
      .post<Paginated<Episode>>("/api/user/world/list/episode", {
        signal: controller.signal,
        data: { productId: id, page: 1, pageSize: 100 },
      })
      .then((data) => {
        if (!owns()) return;
        store.dispatch(setEpisodes(data?.list ?? []));
      })
      .catch((err) => {
        if (!owns()) return;
        store.dispatch(setError(err.message ?? "Failed to load episodes"));
        store.dispatch(setEpisodesLoading(false));
      });
    return () => controller.abort();
  }, [id, viewer, episodesVersion]);

  useEffect(() => {
    if (!id || !viewer || store.getState().project.currentProjectId !== id) return;
    const current = selectCurrentInstance(store.getState());
    const resolvedWorldId =
      urlWorldId ??
      (current.detail?.worldId ? String(current.detail.worldId) : null) ??
      current.worldId;
    if (!resolvedWorldId) return;

    const controller = new AbortController();
    const owns = () =>
      !controller.signal.aborted && store.getState().project.currentProjectId === id;

    store.dispatch(setWorldId(resolvedWorldId));
    store.dispatch(setWorldLoading(true));

    backendApi
      .post<Record<string, unknown>>(
        `/api/user/world/query/world?id=${encodeURIComponent(resolvedWorldId)}`,
        { signal: controller.signal }
      )
      .then((data) => {
        if (!owns()) return;
        if (data) store.dispatch(setWorldDetail(data));
        else store.dispatch(setWorldLoading(false));
      })
      .catch((err) => {
        if (!owns()) return;
        console.error("[useProjectDetail] 加载世界详情失败:", err);
        store.dispatch(setWorldLoading(false));
      });
    return () => controller.abort();
  }, [id, viewer, detail?.worldId, urlWorldId, worldId, worldVersion]);

  return {
    projectId: store.getState().project.currentProjectId ?? id,
    detail,
    episodes,
    activeEpisodeId,
    isLoading,
    isEpisodesLoading,
    error,
  };
}
