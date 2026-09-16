import { IconHome } from "@tabler/icons-react";
import { Stack } from "@/components/ui/stack";
import { buildOssImageUrl } from "@/src/lib/uploads/workspace-upload";
import { ossUrl, type ScenePanelItem } from "./scene-utils";

export function SceneCard({ scene, onEdit }: { scene: ScenePanelItem; onEdit: () => void }) {
  const images = (scene.sceneImgPath ?? []).slice(0, 4);
  const hasImages = images.length > 0;

  return (
    <div data-panel-key={scene.__panelKey} className="flex flex-col p-0">
      <button
        type="button"
        className="mb-1 w-full truncate text-left text-sm font-medium hover:text-primary"
        onClick={onEdit}
      >
        {scene.name ?? ""}
      </button>
      <div className="relative aspect-video w-full" onClick={(e) => e.stopPropagation()}>
        {hasImages ? (
          <Stack
            cards={images.map((path) => {
              const src = buildOssImageUrl(ossUrl(path), { width: 300, height: 200, mode: "fill" });
              return src ? (
                <img key={path} src={src} alt="" className="card-image" />
              ) : (
                <div key={path} className="flex h-full w-full items-center justify-center bg-muted">
                  <IconHome className="size-4 text-muted-foreground/30" />
                </div>
              );
            })}
            sendToBackOnClick
            sensitivity={120}
            animationConfig={{ stiffness: 300, damping: 22 }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-lg bg-muted">
            <IconHome className="size-4 text-muted-foreground/30" />
          </div>
        )}
      </div>
    </div>
  );
}
