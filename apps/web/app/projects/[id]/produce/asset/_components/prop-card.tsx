"use client";

import { IconPhoto, IconRefresh, IconSparkles } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ossUrl } from "@/src/lib/asset-paths";
import type { ProduceJavaAsset } from "@/src/lib/produce/java-produce-data";
import type { ProduceAssetImageStatus } from "../../_hooks/use-produce-asset-image";

interface PropCardProps {
  card: ProduceJavaAsset;
  status: ProduceAssetImageStatus;
  onGenerate: () => void;
  onRetryPersist: () => void;
}

/**
 * Square prop card — Step 2 / 道具 tab. Sibling of SceneCard;
 * same compact gallery silhouette but the thumbnail is **square**
 * (1:1) since props are objects without inherent orientation, and
 * square tiles pack the densest in a grid.
 *
 * Variant counter labels assets as "共 N 个样品图" (vs "共 N 个
 * 场景图" for scenes / "形象 N/M" for characters).
 *
 * State machine mirrors `useProduceAssetImage` — see CharacterCard
 * docstring for the same notes.
 */
export function PropCard({ card, status, onGenerate, onRetryPersist }: PropCardProps) {
  const imagePath =
    "generatedPath" in status && status.generatedPath
      ? status.generatedPath
      : (card.imagePaths[0] ?? "");
  const hasImage = Boolean(imagePath);
  const busy = status.state === "generating" || status.state === "persisting";
  const persistFailed = status.state === "persist_error";
  const variantTotal = card.imagePaths.length || (hasImage ? 1 : 0);

  return (
    <Card className="gap-0 overflow-hidden p-0">
      {/* Top — square thumbnail. 1:1 since props are objects with
          no canonical orientation, and square tiles read cleanest
          in a dense grid. */}
      <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden bg-muted">
        {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ossUrl(imagePath)} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground/45">
            <IconPhoto className="size-5" />
            <span className="text-[10px]">未生成</span>
          </div>
        )}
        {busy ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
            <IconRefresh className="size-4 animate-spin" />
          </div>
        ) : null}
      </div>

      {/* Bottom — title row + variant counter / status text. */}
      <div className="flex items-start justify-between gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-xs font-semibold">{card.name}</h4>
          <p
            className={`mt-0.5 line-clamp-1 text-[11px] ${
              status.state === "generate_error" || persistFailed
                ? "text-destructive"
                : "text-muted-foreground"
            }`}
          >
            {persistFailed
              ? `写回失败：${status.error}`
              : status.state === "generate_error"
                ? `生图失败：${status.error}`
                : `共 ${Math.max(variantTotal, 1)} 个样品图`}
          </p>
        </div>
        <Button
          variant={status.state === "done" || hasImage ? "soft" : "solid"}
          color={
            status.state === "generate_error" || persistFailed
              ? "destructive"
              : status.state === "done"
                ? "muted"
                : "primary"
          }
          size="icon-xs"
          onClick={persistFailed ? onRetryPersist : onGenerate}
          disabled={busy}
          aria-label={hasImage ? "重新生成" : "生成图片"}
        >
          {busy ? (
            <IconRefresh className="animate-spin" />
          ) : status.state === "generate_error" || persistFailed ? (
            <IconRefresh />
          ) : (
            <IconSparkles />
          )}
        </Button>
      </div>
    </Card>
  );
}
