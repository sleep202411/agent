import { useTranslations } from "@/src/i18n/i18n";
import {
  IconPlayerPlay,
  IconPlus,
  IconRepeat,
  IconSparkles,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import type {
  EditMode,
  MultiRefType,
  PickerAssetType,
  PickerTarget,
  ReferenceAsset,
  SimpleMode,
} from "./video-types";
import { getVideoThumbnail, ossUrl } from "./video-types";

export function ReferenceGroup({
  label,
  items,
  mediaType,
  maxCount,
  onAdd,
  onRemove,
}: {
  label: string;
  items: ReferenceAsset[];
  mediaType: PickerAssetType;
  maxCount: number;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {items.map((item, index) => {
        const src =
          mediaType === "video"
            ? getVideoThumbnail(item.url || item.path)
            : ossUrl(item.url || item.path);
        return (
          <div
            key={`${label}-${item.path}-${index}`}
            className="group relative size-16 overflow-hidden rounded-lg bg-muted"
          >
            {src ? (
              <img src={src} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
                {mediaType === "video" ? (
                  <IconVideo className="size-5" />
                ) : (
                  <IconSparkles className="size-5" />
                )}
              </div>
            )}
            {mediaType === "video" ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                <div className="flex size-7 items-center justify-center rounded-full bg-black/55 text-white">
                  <IconPlayerPlay className="ml-0.5 size-3.5" />
                </div>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => onRemove(index)}
              className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
            >
              <IconX className="size-2.5" />
            </button>
          </div>
        );
      })}
      {items.length < maxCount ? (
        <button
          type="button"
          onClick={onAdd}
          className="flex size-16 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <IconPlus className="size-4" />
          <span className="text-[10px]">{label}</span>
        </button>
      ) : null}
    </div>
  );
}

export interface VideoReferencePanelProps {
  uploadMode: SimpleMode;
  editMode: EditMode | null;
  // All reference arrays
  referenceImages: ReferenceAsset[];
  firstFrames: ReferenceAsset[];
  lastFrames: ReferenceAsset[];
  multiRefImages: (ReferenceAsset & { typeTag: MultiRefType })[];
  repaintRefVideos: ReferenceAsset[];
  repaintRefImage: ReferenceAsset[];
  localEditRefVideo: ReferenceAsset[];
  localEditMaskImage: ReferenceAsset[];
  localEditRefImage: ReferenceAsset[];
  extendFirstClip: ReferenceAsset[];
  extendLastClip: ReferenceAsset[];
  extendFirstFrame: ReferenceAsset[];
  extendLastFrame: ReferenceAsset[];
  outpaintingRefVideo: ReferenceAsset[];
  // Callbacks
  onOpenPicker: (target: PickerTarget) => void;
  onSetReferenceImages: (items: ReferenceAsset[]) => void;
  onSetFirstFrames: (items: ReferenceAsset[]) => void;
  onSetLastFrames: (items: ReferenceAsset[]) => void;
  onSetMultiRefImages: (items: (ReferenceAsset & { typeTag: MultiRefType })[]) => void;
  onSetRepaintRefVideos: (items: ReferenceAsset[]) => void;
  onSetRepaintRefImage: (items: ReferenceAsset[]) => void;
  onSetLocalEditRefVideo: (items: ReferenceAsset[]) => void;
  onSetLocalEditMaskImage: (items: ReferenceAsset[]) => void;
  onSetLocalEditRefImage: (items: ReferenceAsset[]) => void;
  onSetExtendFirstClip: (items: ReferenceAsset[]) => void;
  onSetExtendLastClip: (items: ReferenceAsset[]) => void;
  onSetExtendFirstFrame: (items: ReferenceAsset[]) => void;
  onSetExtendLastFrame: (items: ReferenceAsset[]) => void;
  onSetOutpaintingRefVideo: (items: ReferenceAsset[]) => void;
}

export function VideoReferencePanel({
  uploadMode,
  editMode,
  referenceImages,
  firstFrames,
  lastFrames,
  multiRefImages,
  repaintRefVideos,
  repaintRefImage,
  localEditRefVideo,
  localEditMaskImage,
  localEditRefImage,
  extendFirstClip,
  extendLastClip,
  extendFirstFrame,
  extendLastFrame,
  outpaintingRefVideo,
  onOpenPicker,
  onSetReferenceImages,
  onSetFirstFrames,
  onSetLastFrames,
  onSetMultiRefImages,
  onSetRepaintRefVideos,
  onSetRepaintRefImage,
  onSetLocalEditRefVideo,
  onSetLocalEditMaskImage,
  onSetLocalEditRefImage,
  onSetExtendFirstClip,
  onSetExtendLastClip,
  onSetExtendFirstFrame,
  onSetExtendLastFrame,
  onSetOutpaintingRefVideo,
}: VideoReferencePanelProps) {
  const t = useTranslations("storyboard");
  const multiRefSubjectImages = multiRefImages.filter((item) => item.typeTag !== "bg");
  const multiRefBgImages = multiRefImages.filter((item) => item.typeTag === "bg");

  const swapMultiRefTypes = () => {
    onSetMultiRefImages(
      multiRefImages.map((item) => ({
        ...item,
        typeTag: item.typeTag === "bg" ? ("obj" as MultiRefType) : ("bg" as MultiRefType),
      }))
    );
  };

  if (editMode === "repaint") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <ReferenceGroup
          label={t("video")}
          items={repaintRefVideos}
          mediaType="video"
          maxCount={1}
          onAdd={() => onOpenPicker("repaintVideo")}
          onRemove={() => onSetRepaintRefVideos([])}
        />
        <ReferenceGroup
          label={t("referenceImage")}
          items={repaintRefImage}
          mediaType="img"
          maxCount={1}
          onAdd={() => onOpenPicker("repaintImage")}
          onRemove={() => onSetRepaintRefImage([])}
        />
      </div>
    );
  }

  if (editMode === "localEdit") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <ReferenceGroup
          label={t("video")}
          items={localEditRefVideo}
          mediaType="video"
          maxCount={1}
          onAdd={() => onOpenPicker("localEditVideo")}
          onRemove={() => onSetLocalEditRefVideo([])}
        />
        <ReferenceGroup
          label={t("maskImage")}
          items={localEditMaskImage}
          mediaType="img"
          maxCount={1}
          onAdd={() => onOpenPicker("localEditMask")}
          onRemove={() => onSetLocalEditMaskImage([])}
        />
        <ReferenceGroup
          label={t("referenceImage")}
          items={localEditRefImage}
          mediaType="img"
          maxCount={1}
          onAdd={() => onOpenPicker("localEditRefImage")}
          onRemove={() => onSetLocalEditRefImage([])}
        />
      </div>
    );
  }

  if (editMode === "extend") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <ReferenceGroup
          label={t("firstClipLabel")}
          items={extendFirstClip}
          mediaType="video"
          maxCount={1}
          onAdd={() => onOpenPicker("extendFirstClip")}
          onRemove={() => onSetExtendFirstClip([])}
        />
        <ReferenceGroup
          label={t("lastClipLabel")}
          items={extendLastClip}
          mediaType="video"
          maxCount={1}
          onAdd={() => onOpenPicker("extendLastClip")}
          onRemove={() => onSetExtendLastClip([])}
        />
        <ReferenceGroup
          label={t("firstFrameImage")}
          items={extendFirstFrame}
          mediaType="img"
          maxCount={1}
          onAdd={() => onOpenPicker("extendFirstFrame")}
          onRemove={() => onSetExtendFirstFrame([])}
        />
        <ReferenceGroup
          label={t("lastFrameImage")}
          items={extendLastFrame}
          mediaType="img"
          maxCount={1}
          onAdd={() => onOpenPicker("extendLastFrame")}
          onRemove={() => onSetExtendLastFrame([])}
        />
      </div>
    );
  }

  if (editMode === "outpainting") {
    return (
      <ReferenceGroup
        label={t("video")}
        items={outpaintingRefVideo}
        mediaType="video"
        maxCount={1}
        onAdd={() => onOpenPicker("outpaintingVideo")}
        onRemove={() => onSetOutpaintingRefVideo([])}
      />
    );
  }

  if (uploadMode === "frames") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <ReferenceGroup
          label={t("firstFrame")}
          items={firstFrames}
          mediaType="img"
          maxCount={1}
          onAdd={() => onOpenPicker("firstFrames")}
          onRemove={() => onSetFirstFrames([])}
        />
        <ReferenceGroup
          label={t("lastFrame")}
          items={lastFrames}
          mediaType="img"
          maxCount={1}
          onAdd={() => onOpenPicker("lastFrames")}
          onRemove={() => onSetLastFrames([])}
        />
      </div>
    );
  }

  if (uploadMode === "multiReference") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <ReferenceGroup
          label={t("subjectLabel")}
          items={multiRefSubjectImages}
          mediaType="img"
          maxCount={1}
          onAdd={() => onOpenPicker("multiRefSubject")}
          onRemove={() =>
            onSetMultiRefImages(multiRefImages.filter((item) => item.typeTag === "bg"))
          }
        />
        <button
          type="button"
          onClick={swapMultiRefTypes}
          className="flex size-8 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          title={t("swapSubjectBackground")}
        >
          <IconRepeat className="size-4" />
        </button>
        <ReferenceGroup
          label={t("backgroundLabel")}
          items={multiRefBgImages}
          mediaType="img"
          maxCount={2}
          onAdd={() => onOpenPicker("multiRefBg")}
          onRemove={(index) => {
            const bg = multiRefBgImages[index];
            if (!bg) return;
            onSetMultiRefImages(multiRefImages.filter((item) => item.path !== bg.path));
          }}
        />
      </div>
    );
  }

  return (
    <ReferenceGroup
      label={t("referenceImage")}
      items={referenceImages}
      mediaType="img"
      maxCount={1}
      onAdd={() => onOpenPicker("referenceImages")}
      onRemove={() => onSetReferenceImages([])}
    />
  );
}
