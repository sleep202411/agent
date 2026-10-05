import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuth } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import {
  openPlatformCanvasDocument,
  type PlatformCanvasScope,
} from "../api/platform-canvas-document";
import { canvasOverview } from "../lib/story-canvas-overview";
import { StoryCanvasReader } from "./story-canvas-reader";
import { StoryCanvasMap } from "./story-canvas-map";
import { PlatformActorsPanel } from "./platform-actors-panel";

export function PlatformCanvasPanel({
  scope,
  title,
  close,
}: {
  scope: PlatformCanvasScope;
  title: string;
  close(): void;
}) {
  const active = useScreenActive();
  return active && scope.generation === getAuthGeneration() ? (
    <Session
      key={`${scope.projectId}:${scope.sectionId}:${scope.documentId}:${scope.generation}`}
      scope={scope}
      title={title}
      close={close}
    />
  ) : null;
}
function Session({
  scope,
  title,
  close,
}: {
  scope: PlatformCanvasScope;
  title: string;
  close(): void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const [revision, setRevision] = useState(0);
  const auth = useAuth();
  const [actors, setActors] = useState(false);
  if (auth.status !== "authenticated" || auth.generation !== scope.generation) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <View style={{ padding: 16, gap: 8 }}>
          <ThemedText type="smallBold">{title}</ThemedText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            <Pressable accessibilityRole="button" onPress={close} style={{ padding: 8 }}>
              <ThemedText type="small">{t("agent.close")}</ThemedText>
            </Pressable>
            {!actors && (
              <Pressable
                accessibilityRole="button"
                onPress={() => setRevision((n) => n + 1)}
                style={{ padding: 8 }}
              >
                <ThemedText type="small">{t("storyCanvas.refresh")}</ThemedText>
              </Pressable>
            )}
          </View>
        </View>
        {actors && auth.status === "authenticated" ? (
          <PlatformActorsPanel
            scope={scope}
            userId={String(auth.user?.userId ?? auth.user?.id ?? "")}
            close={() => setActors(false)}
            saved={() => {
              setActors(false);
              setRevision((n) => n + 1);
            }}
          />
        ) : (
          <Document
            key={revision}
            scope={scope}
            openActors={auth.status === "authenticated" ? () => setActors(true) : undefined}
          />
        )}
      </View>
    </Modal>
  );
}
function Document({ scope, openActors }: { scope: PlatformCanvasScope; openActors?: () => void }) {
  const t = useTranslations(),
    theme = useTheme();
  const [loaded, setLoaded] = useState<CanvasLoaded>();
  const [overview, setOverview] = useState<ReturnType<typeof canvasOverview>>();
  const [error, setError] = useState<string>();
  const [mapping, setMapping] = useState(false);
  const [selected, setSelected] = useState<string>();
  return (
    <>
      {!loaded && !error && (
        <>
          <ActivityIndicator />
          <StoryCanvasReader
            scope={scope}
            platform={{ scope, load: openPlatformCanvasDocument }}
            title={t("storyCanvas.title")}
            runtimeError={t("storyCanvas.loadError")}
            onResult={(result) => {
              try {
                setOverview(canvasOverview(result.snapshot));
                setLoaded(result);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
              }
            }}
            onError={setError}
          />
        </>
      )}
      {error && (
        <ThemedText accessibilityRole="alert" style={{ padding: 16 }}>
          {error}
        </ThemedText>
      )}
      {loaded && overview && (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          {openActors && (
            <Pressable accessibilityRole="button" onPress={openActors} style={{ padding: 10 }}>
              <ThemedText type="small">{t("platformActors.title")}</ThemedText>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => setMapping(true)}
            style={{ padding: 10 }}
          >
            <ThemedText type="small">{t("storyCanvas.map.title")}</ThemedText>
          </Pressable>
          {!overview.nodes.length && <ThemedText type="small">{t("storyCanvas.empty")}</ThemedText>}
          {(selected ? overview.nodes.filter((node) => node.id === selected) : overview.nodes).map(
            (node) => (
              <View
                key={node.id}
                style={{
                  backgroundColor: theme.backgroundElement,
                  padding: 12,
                  borderRadius: 8,
                  gap: 8,
                }}
              >
                <ThemedText type="smallBold">{node.title}</ThemedText>
                {!!node.text && (
                  <ThemedText type="small" selectable>
                    {node.text}
                  </ThemedText>
                )}
              </View>
            )
          )}
          {selected && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setSelected(undefined)}
              style={{ padding: 10 }}
            >
              <ThemedText type="small">{t("platformCanvas.allCards")}</ThemedText>
            </Pressable>
          )}
        </ScrollView>
      )}
      {loaded && mapping && (
        <StoryCanvasMap
          loaded={loaded}
          close={() => setMapping(false)}
          inspect={(nodeId) => {
            setSelected(nodeId);
            setMapping(false);
          }}
        />
      )}
    </>
  );
}
