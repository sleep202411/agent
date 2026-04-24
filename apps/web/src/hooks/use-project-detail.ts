"use client";

import { useEffect, useRef } from "react";
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

  const loadedProjectIdRef = useRef<string | null>(null);
  const loadedWorldIdRef = useRef<string | null>(null);
  const loadedEpisodesKeyRef = useRef<string | null>(null);

  const detail = useAppSelector((s) => selectCurrentInstance(s).detail);
  const isLoading = useAppSelector((s) => selectCurrentInstance(s).isLoading);
  const error = useAppSelector((s) => selectCurrentInstance(s).error);
  const episodes = useAppSelector((s) => selectCurrentInstance(s).episodes);
  const activeEpisodeId = useAppSelector((s) => selectCurrentInstance(s).activeEpisodeId);
  const isEpisodesLoading = useAppSelector((s) => selectCurrentInstance(s).isEpisodesLoading);
  const worldId = useAppSelector((s) => selectCurrentInstance(s).worldId);
  const episodesVersion = useAppSelector((s) => selectCurrentInstance(s).episodesVersion);
  const worldVersion = useAppSelector((s) => selectCurrentInstance(s).worldVersion);

  useEffect(() => {
    if (!id || loadedProjectIdRef.current === id) return;
    loadedProjectIdRef.current = id;

    store.dispatch(reset());
    store.dispatch(setProjectId(id));
    store.dispatch(setRouteEpisodeId(urlEpisodeId));
    if (urlWorldId) store.dispatch(setWorldId(urlWorldId));
    store.dispatch(setLoading(true));

    backendApi
      .post<ProjectDetail>(`/api/user/project/detail/${id}`)
      .then((data) => {
        store.dispatch(setDetail(data));
        const detailWorldId = data?.worldId as string | undefined;
        if (detailWorldId) store.dispatch(setWorldId(String(detailWorldId)));
      })
      .catch((err) => {
        store.dispatch(setError(err.message ?? "Load failed"));
      });
  }, [id, urlWorldId, urlEpisodeId]);

  useEffect(() => {
    store.dispatch(setRouteEpisodeId(urlEpisodeId));
    if (!urlEpisodeId) return;
    if (episodes.some((ep) => String(ep.id) === String(urlEpisodeId))) {
      store.dispatch(setActiveEpisodeId(String(urlEpisodeId)));
    }
  }, [urlEpisodeId, episodes]);

  useEffect(() => {
    if (!id) return;

    const key = `${id}:${episodesVersion}`;
    if (loadedEpisodesKeyRef.current === key) return;
    loadedEpisodesKeyRef.current = key;

    store.dispatch(setEpisodesLoading(true));

    backendApi
      .post<Paginated<Episode>>("/api/user/world/list/episode", {
        data: { productId: id, page: 1, pageSize: 100 },
      })
      .then((data) => {
        store.dispatch(setEpisodes(data?.list ?? []));
      })
      .catch((err) => {
        store.dispatch(setError(err.message ?? "Failed to load episodes"));
        store.dispatch(setEpisodesLoading(false));
      });
  }, [id, episodesVersion]);

  useEffect(() => {
    const resolvedWorldId =
      urlWorldId ?? (detail?.worldId ? String(detail.worldId) : null) ?? worldId;
    if (!resolvedWorldId) return;

    const key = `${resolvedWorldId}:${worldVersion}`;
    if (loadedWorldIdRef.current === key) return;
    loadedWorldIdRef.current = key;

    store.dispatch(setWorldId(resolvedWorldId));
    store.dispatch(setWorldLoading(true));

    backendApi
      .post<Record<string, unknown>>(`/api/user/world/query/world?id=${resolvedWorldId}`)
      .then((data) => {
        if (data) store.dispatch(setWorldDetail(data));
      })
      .catch((err) => {
        console.error("[useProjectDetail] 加载世界详情失败:", err);
        store.dispatch(setWorldLoading(false));
      });
  }, [detail?.worldId, urlWorldId, worldId, worldVersion]);

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
