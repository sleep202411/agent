import { useMemo, useState } from "react";
import { Pressable } from "react-native";
import { useAuth } from "@/auth";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { useStoryChapterContext } from "../context/story-chapter-context";
import { StoryCanvasPanel } from "./story-canvas-panel";

export function StoryCanvasEntry() {
  const context = useStoryChapterContext(),
    auth = useAuth(),
    active = useScreenActive(),
    t = useTranslations();
  const identity = `${context.projectId}:${auth.generation}`;
  const [openedIdentity, setOpenedIdentity] = useState<string>();
  const open = openedIdentity === identity;
  const readable = auth.status === "authenticated" && context.capabilities.includes("story.read");
  const scope = useMemo(
    () => ({ projectId: context.projectId, generation: auth.generation }),
    [context.projectId, auth.generation]
  );
  if (!readable) return null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        disabled={context.loading || !!context.error}
        onPress={() => setOpenedIdentity(identity)}
        style={{ padding: 10 }}
      >
        <ThemedText type="small">{t("storyCanvas.title")}</ThemedText>
      </Pressable>
      {open && active && !context.loading && !context.error && (
        <StoryCanvasPanel
          key={`${scope.projectId}:${scope.generation}`}
          scope={scope}
          userId={String(auth.user?.userId ?? auth.user?.id ?? "")}
          canEdit={context.capabilities.includes("story.edit")}
          canGenerate={context.capabilities.includes("story.generate")}
          canComment={context.capabilities.includes("story.review")}
          close={() => {
            setOpenedIdentity(undefined);
          }}
        />
      )}
    </>
  );
}
