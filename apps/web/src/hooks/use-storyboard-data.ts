"use client";

import { useEffect, useRef } from "react";
import { backendApi, type Paginated } from "@/src/lib/api";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import {
  setColumns,
  setRows,
  setStoryboardLoading,
  selectCurrentInstance,
  type ShotColumn,
  type ShotRow,
} from "@/src/store/slices/projectSlice";

/**
 * 监听 activeEpisodeId 变化，自动加载分镜表列定义 + 镜头行数据。
 *
 * 在项目详情页顶层调用一次即可。
 */
export function useStoryboardData() {
  const activeEpisodeId = useAppSelector((s) => selectCurrentInstance(s).activeEpisodeId);
  const columns = useAppSelector((s) => selectCurrentInstance(s).columns);
  const rows = useAppSelector((s) => selectCurrentInstance(s).rows);
  const isStoryboardLoading = useAppSelector((s) => selectCurrentInstance(s).isStoryboardLoading);
  const storyboardVersion = useAppSelector((s) => selectCurrentInstance(s).storyboardVersion);

  const loadingKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeEpisodeId) return;

    const requestKey = `${activeEpisodeId}:${storyboardVersion}`;
    if (requestKey === loadingKeyRef.current) return;
    loadingKeyRef.current = requestKey;

    store.dispatch(setStoryboardLoading(true));

    const storyBoardId = activeEpisodeId;

    // 并行获取列定义和镜头数据
    Promise.all([
      backendApi.post<ShotColumn[]>("/api/user/shotColumn/list", { data: { storyBoardId } }),
      backendApi.post<Paginated<ShotRow>>("/api/user/shot/queryPage", {
        data: {
          storyBoardId,
          page: 1,
          pageSize: 200,
          shotIds: [],
          presetColumnKeys: [],
        },
      }),
    ])
      .then(([columnsData, shotsData]) => {
        // 防止切换后旧请求覆盖新数据
        if (loadingKeyRef.current !== requestKey) return;

        store.dispatch(setColumns(Array.isArray(columnsData) ? columnsData : []));
        store.dispatch(setRows(shotsData?.list ?? []));
      })
      .catch((err) => {
        console.error("[useStoryboardData] 加载分镜表失败:", err);
        if (loadingKeyRef.current !== requestKey) return;
        store.dispatch(setStoryboardLoading(false));
      });
  }, [activeEpisodeId, storyboardVersion]);

  return { columns, rows, isStoryboardLoading };
}
