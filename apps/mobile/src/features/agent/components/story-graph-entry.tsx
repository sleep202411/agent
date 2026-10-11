import { useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable } from "react-native";
import { useAuth } from "@/auth";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { useStoryChapterContext } from "../context/story-chapter-context";
import { StoryRepairSheet } from "./story-repair-sheet";

export function StoryGraphEntry() {
  const context = useStoryChapterContext(),
    auth = useAuth(),
    active = useScreenActive(),
    t = useTranslations();
  const { graph } = useLocalSearchParams<{ graph?: string | string[] }>();
  const router = useRouter();
  const identity = `${context.projectId}:${context.chapterId}:${auth.generation}`;
  const [openedIdentity, setOpenedIdentity] = useState<string>();
  const open = graph === "1" || openedIdentity === identity;
  const readable = auth.status === "authenticated" && context.capabilities.includes("story.read");
  const scope = useMemo(
    () => ({
      projectId: context.projectId,
      chapterId: context.chapterId,
      generation: auth.generation,
    }),
    [context.projectId, context.chapterId, auth.generation]
  );
  if (!readable) return null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        disabled={context.loading || !!context.error || !context.chapterId}
        onPress={() => setOpenedIdentity(identity)}
        style={{ padding: 10 }}
      >
        <ThemedText type="small">{t("storyGraph.title")}</ThemedText>
      </Pressable>
      {open && active && !context.loading && !context.error && !!context.chapterId && (
        <StoryRepairSheet
          key={identity}
          scope={scope}
          userId={String(auth.user?.userId ?? auth.user?.id ?? "")}
          authoring
          issues={[]}
          onSaved={context.refresh}
          onClose={() => {
            setOpenedIdentity(undefined);
            // Consume the route intent on close so returning to Assets stays closed.
            if (graph === "1") router.setParams({ graph: undefined });
          }}
        />
      )}
    </>
  );
}
