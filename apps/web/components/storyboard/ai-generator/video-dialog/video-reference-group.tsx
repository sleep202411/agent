"use client";

import { useTranslations } from "@/src/i18n/i18n";
import { IconRepeat } from "@tabler/icons-react";
import { ReferenceGroup } from "../reference-group";
import type {
  EditMode,
  MultiRefType,
  PickerTarget,
  ReferenceAsset,
  SimpleMode,
} from "./video-types";
import { getVideoThumbnail, ossUrl } from "./video-types";
import { classifyAsset } from "@/components/ui/schema-field/schema";

export { ReferenceGroup };

/** Shared resolve props for video reference groups */
const videoResolveProps = {
  resolveUrl: ossUrl,
  resolveVideoThumbnail: getVideoThumbnail,
};

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
  /** Model reference limits */
  maxImages?: number;
  maxVideos?: number;
  maxAudios?: number;
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
  maxImages = 3,
  maxVideos = 0,
  maxAudios = 0,
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
          {...videoResolveProps}
          maxCount={1}
          onAdd={() => onOpenPicker("repaintVideo")}
          onRemove={() => onSetRepaintRefVideos([])}
        />
        <ReferenceGroup
          label={t("referenceImage")}
          items={repaintRefImage}
          {...videoResolveProps}
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
          {...videoResolveProps}
          maxCount={1}
          onAdd={() => onOpenPicker("localEditVideo")}
          onRemove={() => onSetLocalEditRefVideo([])}
        />
        <ReferenceGroup
          label={t("maskImage")}
          items={localEditMaskImage}
          {...videoResolveProps}
          maxCount={1}
          onAdd={() => onOpenPicker("localEditMask")}
          onRemove={() => onSetLocalEditMaskImage([])}
        />
        <ReferenceGroup
          label={t("referenceImage")}
          items={localEditRefImage}
          {...videoResolveProps}
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
          {...videoResolveProps}
          maxCount={1}
          onAdd={() => onOpenPicker("extendFirstClip")}
          onRemove={() => onSetExtendFirstClip([])}
        />
        <ReferenceGroup
          label={t("lastClipLabel")}
          items={extendLastClip}
          {...videoResolveProps}
          maxCount={1}
          onAdd={() => onOpenPicker("extendLastClip")}
          onRemove={() => onSetExtendLastClip([])}
        />
        <ReferenceGroup
          label={t("firstFrameImage")}
          items={extendFirstFrame}
          {...videoResolveProps}
          maxCount={1}
          onAdd={() => onOpenPicker("extendFirstFrame")}
          onRemove={() => onSetExtendFirstFrame([])}
        />
        <ReferenceGroup
          label={t("lastFrameImage")}
          items={extendLastFrame}
          {...videoResolveProps}
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
          {...videoResolveProps}
          maxCount={1}
          onAdd={() => onOpenPicker("firstFrames")}
          onRemove={() => onSetFirstFrames([])}
        />
        <ReferenceGroup
          label={t("lastFrame")}
          items={lastFrames}
          {...videoResolveProps}
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
          {...videoResolveProps}
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
          {...videoResolveProps}
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

  if (uploadMode === "multimodal") {
    const mmImages = referenceImages.filter((item) => classifyAsset(item) === "image");
    const mmVideos = referenceImages.filter((item) => classifyAsset(item) === "video");
    const mmAudios = referenceImages.filter((item) => classifyAsset(item) === "audio");
    const removeByPath = (path: string) => {
      onSetReferenceImages(referenceImages.filter((item) => item.path !== path));
    };
    return (
      <div className="flex flex-wrap items-center gap-2">
        {maxImages > 0 && (
          <ReferenceGroup
            label={t("referenceImage")}
            items={mmImages}
            {...videoResolveProps}
            maxCount={maxImages}
            onAdd={() => onOpenPicker("multimodalImages")}
            onRemove={(index) => {
              const target = mmImages[index];
              if (target) removeByPath(target.path);
            }}
          />
        )}
        {maxVideos > 0 && (
          <ReferenceGroup
            label={t("video")}
            items={mmVideos}
            {...videoResolveProps}
            maxCount={maxVideos}
            onAdd={() => onOpenPicker("multimodalVideos")}
            onRemove={(index) => {
              const target = mmVideos[index];
              if (target) removeByPath(target.path);
            }}
          />
        )}
        {maxAudios > 0 && (
          <ReferenceGroup
            label={t("audio")}
            items={mmAudios}
            {...videoResolveProps}
            maxCount={maxAudios}
            onAdd={() => onOpenPicker("multimodalAudios")}
            onRemove={(index) => {
              const target = mmAudios[index];
              if (target) removeByPath(target.path);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <ReferenceGroup
      label={t("referenceImage")}
      items={referenceImages}
      {...videoResolveProps}
      maxCount={maxImages}
      onAdd={() => onOpenPicker("referenceImages")}
      onRemove={(index) => onSetReferenceImages(referenceImages.filter((_, i) => i !== index))}
    />
  );
}
