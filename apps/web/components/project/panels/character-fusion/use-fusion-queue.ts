"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { backendApi, type Paginated } from "@/src/lib/api";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";
import { normalizeStoragePath } from "@/components/project/panels/characters/character-utils";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import { removeTask } from "@/src/store/slices/taskSlice";
import { submitFusionTask, retryFusionTask } from "@/src/lib/ai-fusion-queue";
import type { FusionGenerateInput, ResultItem } from "@/src/store/slices/projectSlice";
import type { AssetRecord } from "@/src/types/workspace";

export type FusionQueueItem = ResultItem & {
  taskId?: string;
  fromQueue?: boolean;
  fromHistory?: boolean;
};

interface UseFusionQueueOptions {
  characterId: string;
}

/** Map centralized task status to legacy ResultItem status */
function mapTaskStatus(status: string): ResultItem["status"] {
  switch (status) {
    case "pending":
      return "waiting";
    case "running":
      return "generating";
    case "completed":
      return "success";
    case "failed":
      return "failed";
    default:
      return undefined;
  }
}

export function useFusionQueue({ characterId }: UseFusionQueueOptions) {
  const t = useTranslations("character");
  const [history, setHistory] = useState<FusionQueueItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Read fusion tasks from centralized task store
  const tasks = useAppSelector((s) => s.task.tasks);

  const queueItems = useMemo(() => {
    return Object.values(tasks)
      .filter((task) => task.type === "fusion")
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(
        (task): FusionQueueItem => ({
          id: task.id,
          taskId: task.id,
          url: task.output?.url,
          storagePath: task.output?.storagePath,
          status: mapTaskStatus(task.status),
          error: task.error,
          fromQueue: true,
        })
      );
  }, [tasks]);

  const allResults = useMemo(() => [...queueItems, ...history], [queueItems, history]);

  const isGenerating = queueItems.some(
    (item) => item.status === "waiting" || item.status === "generating"
  );

  const loadHistory = useCallback(async () => {
    if (!characterId) {
      setHistory([]);
      return;
    }
    try {
      setHistoryLoading(true);
      const response = await backendApi.post<Paginated<AssetRecord>>("/api/ai/record/role/list", {
        data: { page: 1, pageSize: 50, roleId: characterId, type: "img", sort: 0 },
      });
      const items = (response?.list ?? []).map((item) => ({
        id: String(item.id ?? ""),
        url: buildOssUrl(item.path ?? item.storagePath ?? item.filePath ?? item.url) || "",
        storagePath: normalizeStoragePath(
          item.storagePath ?? item.path ?? item.filePath ?? item.url
        ),
        fromHistory: true,
      }));
      setHistory(items);
    } catch (error) {
      console.error("[useFusionQueue] 加载历史失败:", error);
      toast.error(t("fusionHistoryFailed"));
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [characterId, t]);

  const enqueue = useCallback((inputs: FusionGenerateInput[]) => {
    for (const input of inputs) {
      submitFusionTask(input);
    }
  }, []);

  const retry = useCallback((item: FusionQueueItem) => {
    if (item.taskId) {
      retryFusionTask(item.taskId);
    }
  }, []);

  const remove = useCallback(async (item: FusionQueueItem) => {
    if (item.fromHistory && item.id) {
      await backendApi.post(`/api/ai/record/delete/${item.id}`);
      setHistory((current) => current.filter((historyItem) => historyItem.id !== item.id));
    } else if (item.taskId) {
      store.dispatch(removeTask(item.taskId));
    }
  }, []);

  return {
    history,
    historyLoading,
    queueItems,
    allResults,
    isGenerating,
    loadHistory,
    enqueue,
    retry,
    remove,
  };
}
