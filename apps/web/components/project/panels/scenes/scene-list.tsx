"use client";

import { useTranslations } from "@/src/i18n/i18n";
import { IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { SceneCard } from "./scene-card";
import type { ScenePanelItem } from "./scene-utils";

export function SceneList({
  scenes,
  onEdit,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  scenes: ScenePanelItem[];
  onEdit: (scene: ScenePanelItem) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const t = useTranslations("scene");
  const tc = useTranslations("common");

  if (scenes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        {t("noScenes")}
      </div>
    );
  }

  return (
    <div className="@container space-y-3">
      <div className="grid grid-cols-1 gap-3 @[360px]:grid-cols-2 @[540px]:grid-cols-3 @[720px]:grid-cols-4">
        {scenes.map((scene) => (
          <SceneCard key={scene.__panelKey} scene={scene} onEdit={() => onEdit(scene)} />
        ))}
      </div>
      {hasMore && (
        <Button
          variant="ghost"
          color="muted"
          className="w-full"
          onClick={onLoadMore}
          disabled={loadingMore}
        >
          {loadingMore && <IconLoader2 className="size-3.5 animate-spin" />}
          {tc("loadMore")}
        </Button>
      )}
    </div>
  );
}
