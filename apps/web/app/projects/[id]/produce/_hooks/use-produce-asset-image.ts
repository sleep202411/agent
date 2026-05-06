"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  generateProduceAssetImagePath,
  persistProduceAssetImagePath,
  type ProduceJavaAsset,
} from "@/src/lib/produce/java-produce-data";

export type ProduceAssetImageStatus =
  | { state: "idle" }
  | { state: "generating" }
  | { state: "persisting"; generatedPath: string }
  | { state: "done"; generatedPath: string }
  | { state: "generate_error"; error: string }
  | { state: "persist_error"; error: string; generatedPath: string };

type UseProduceAssetImageOptions = {
  worldId: string;
  onAssetUpdated: (asset: ProduceJavaAsset) => void;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err || "请求失败");
}

export function useProduceAssetImage({ worldId, onAssetUpdated }: UseProduceAssetImageOptions) {
  const [statusById, setStatusById] = useState<Record<string, ProduceAssetImageStatus>>({});

  const setStatus = useCallback((assetId: string, status: ProduceAssetImageStatus) => {
    setStatusById((current) => ({ ...current, [assetId]: status }));
  }, []);

  const persistGeneratedImage = useCallback(
    async (asset: ProduceJavaAsset, generatedPath: string) => {
      if (!worldId) {
        const message = "未找到项目世界，请先完成剧本步骤。";
        setStatus(asset.id, { state: "persist_error", error: message, generatedPath });
        toast.error(message);
        return null;
      }

      setStatus(asset.id, { state: "persisting", generatedPath });
      try {
        const updated = await persistProduceAssetImagePath(worldId, asset, generatedPath);
        onAssetUpdated(updated);
        setStatus(asset.id, { state: "done", generatedPath });
        toast.success("图片已生成并写入资产。");
        return updated;
      } catch (err) {
        const message = errorMessage(err);
        setStatus(asset.id, { state: "persist_error", error: message, generatedPath });
        toast.error(`图片已生成，但写回资产失败：${message}`);
        return null;
      }
    },
    [onAssetUpdated, setStatus, worldId]
  );

  const generateImage = useCallback(
    async (asset: ProduceJavaAsset) => {
      setStatus(asset.id, { state: "generating" });
      let generatedPath = "";
      try {
        generatedPath = await generateProduceAssetImagePath(asset);
      } catch (err) {
        const message = errorMessage(err);
        setStatus(asset.id, { state: "generate_error", error: message });
        toast.error(`生图失败：${message}`);
        return null;
      }

      return persistGeneratedImage(asset, generatedPath);
    },
    [persistGeneratedImage, setStatus]
  );

  const retryPersist = useCallback(
    async (asset: ProduceJavaAsset) => {
      const status = statusById[asset.id];
      if (status?.state !== "persist_error") return null;
      return persistGeneratedImage(asset, status.generatedPath);
    },
    [persistGeneratedImage, statusById]
  );

  return {
    statusById,
    generateImage,
    retryPersist,
  };
}
