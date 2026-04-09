import { IconMask } from "@tabler/icons-react";
import { ImageCollage } from "@/components/ui/image-collage";
import { buildOssImageUrl } from "@/src/lib/uploads/workspace-upload";
import { ossUrl, type PropPanelItem } from "./prop-utils";

export function PropCard({ prop, onEdit }: { prop: PropPanelItem; onEdit: () => void }) {
  const images = (prop.propImgPath ?? [])
    .map((path) => buildOssImageUrl(ossUrl(path), { width: 300, height: 300, mode: "fill" }))
    .filter(Boolean) as string[];

  return (
    <div data-panel-key={prop.__panelKey} className="cursor-pointer" onClick={onEdit}>
      {/* Name */}
      <div className="mb-1 truncate text-xs font-medium">{prop.name ?? ""}</div>

      {/* Image (square) */}
      <div className="aspect-square overflow-hidden rounded-lg">
        {images.length > 0 ? (
          <ImageCollage images={images} className="h-full w-full rounded-none" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted">
            <IconMask className="size-5 text-muted-foreground/30" />
          </div>
        )}
      </div>
    </div>
  );
}
