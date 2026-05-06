"use client";

import { IconPhoto, IconRefresh, IconSparkles } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ossUrl } from "@/src/lib/asset-paths";
import type { ProduceJavaAsset } from "@/src/lib/produce/java-produce-data";
import type { ProduceAssetImageStatus } from "../../_hooks/use-produce-asset-image";

interface CharacterCardProps {
  card: ProduceJavaAsset;
  status: ProduceAssetImageStatus;
  onGenerate: () => void;
  onRetryPersist: () => void;
}

/**
 * Horizontal character card — Step 2 / 角色 tab. Portrait-aspect
 * thumbnail (5:7) on the left, name + variant counter + description
 * + generate-image action on the right. Sibling cards
 * (`SceneCard`, `PropCard`) keep the same right-column shape but
 * tweak the thumbnail aspect for their domain (scenes are landscape
 * environments, props are square objects), so we don't fold them
 * into one generic component.
 *
 * State machine on the action button mirrors `useProduceAssetImage`:
 *   idle / done    → "生成图片" / "重新生成" (primary or muted soft)
 *   generating     → "生成中" + spinner
 *   persisting     → "写入资产中" + spinner
 *   generate_error → "重试生图" (destructive)
 *   persist_error  → "重试写回" (destructive, fires onRetryPersist
 *                    instead of onGenerate so we don't burn a fresh
 *                    image gen for a write-back failure).
 */
export function CharacterCard({ card, status, onGenerate, onRetryPersist }: CharacterCardProps) {
  const imagePath =
    "generatedPath" in status && status.generatedPath
      ? status.generatedPath
      : (card.imagePaths[0] ?? "");
  const hasImage = Boolean(imagePath);
  const busy = status.state === "generating" || status.state === "persisting";
  const persistFailed = status.state === "persist_error";
  const variantTotal = card.imagePaths.length || (hasImage ? 1 : 0);
  const variantCurrent = variantTotal === 0 ? 0 : 1;

  return (
    <Card className="flex-row gap-0 overflow-hidden p-0">
      {/* Left — portrait-aspect thumbnail. 5:7 mirrors the reference
          mockup; loading / busy state overlays the thumb so the
          right column stays readable. */}
      <div className="relative flex aspect-5/7 w-27.5 shrink-0 items-center justify-center overflow-hidden bg-muted">
        {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ossUrl(imagePath)} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground/45">
            <IconPhoto className="size-6" />
            <span className="text-[11px]">未生成</span>
          </div>
        )}
        {busy ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
            <IconRefresh className="size-4 animate-spin" />
          </div>
        ) : null}
      </div>

      {/* Right — name + variant counter + description + action. */}
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-3 p-4">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold">{card.name}</h4>
          <p className="mt-1 text-[11px] text-muted-foreground/70">
            形象 {variantCurrent}/{Math.max(variantTotal, 1)}
          </p>
          <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
            {persistFailed
              ? `图片已生成，但写回资产失败：${status.error}`
              : status.state === "generate_error"
                ? `生图失败：${status.error}`
                : card.description || card.prompt || "暂无描述"}
          </p>
        </div>
        <Button
          variant={status.state === "done" || hasImage ? "soft" : "solid"}
          color={
            status.state === "generate_error" || status.state === "persist_error"
              ? "destructive"
              : status.state === "done"
                ? "muted"
                : "primary"
          }
          size="sm"
          className="self-start"
          onClick={persistFailed ? onRetryPersist : onGenerate}
          disabled={busy}
        >
          {status.state === "generating" ? (
            <>
              <IconRefresh className="animate-spin" /> 生成中
            </>
          ) : status.state === "persisting" ? (
            <>
              <IconRefresh className="animate-spin" /> 写入资产中
            </>
          ) : status.state === "done" ? (
            <>
              <IconSparkles /> 已写入资产
            </>
          ) : status.state === "persist_error" ? (
            <>
              <IconRefresh /> 重试写回
            </>
          ) : status.state === "generate_error" ? (
            <>
              <IconRefresh /> 重试生图
            </>
          ) : hasImage ? (
            <>
              <IconSparkles /> 重新生成
            </>
          ) : (
            <>
              <IconSparkles /> 生成图片
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}
