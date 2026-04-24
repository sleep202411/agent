"use client";

import { IconPhoto, IconSparkles, IconVideo } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/src/i18n/i18n";
import {
  useAiImageTrigger,
  useAiVideoTrigger,
  useImageAssetPicker,
  useVideoAssetPicker,
} from "./storyboard-card-hooks";

/**
 * Per-media action groups for a storyboard card. Each media slot owns
 * its own two-button strip so the buttons sit directly below the thing
 * they act on (image buttons under the image, video buttons under the
 * video) instead of a single card-wide footer that mixes both.
 *
 * Disabled state: if the underlying column doesn't exist for this project
 * (no image_path / video_path column in the schema) the caller just
 * shouldn't render the corresponding group.
 */

export function StoryboardCardImageActions({
  shotId,
  shotColumnId,
}: {
  shotId: string;
  shotColumnId: string;
}) {
  const t = useTranslations("storyboard");
  const picker = useImageAssetPicker({ shotId, shotColumnId });
  const aiTrigger = useAiImageTrigger({ shotId, shotColumnId });
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
      <Button size="sm" variant="outline" color="muted" onClick={picker.open}>
        <IconPhoto className="size-3.5" />
        {t("selectImage")}
      </Button>
      <Button size="sm" variant="outline" color="muted" onClick={aiTrigger}>
        <IconSparkles className="size-3.5" />
        {t("aiGenerateImage")}
      </Button>
      {picker.element}
    </div>
  );
}

export function StoryboardCardVideoActions({
  shotId,
  shotColumnId,
}: {
  shotId: string;
  shotColumnId: string;
}) {
  const t = useTranslations("storyboard");
  const picker = useVideoAssetPicker({ shotId, shotColumnId });
  const aiTrigger = useAiVideoTrigger({ shotId, shotColumnId });
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
      <Button size="sm" variant="outline" color="muted" onClick={picker.open}>
        <IconVideo className="size-3.5" />
        {t("selectVideo")}
      </Button>
      <Button size="sm" variant="outline" color="muted" onClick={aiTrigger}>
        <IconSparkles className="size-3.5" />
        {t("aiGenerateVideo")}
      </Button>
      {picker.element}
    </div>
  );
}
