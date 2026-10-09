import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput } from "react-native";
import { appEnv } from "@/config/app-env";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import {
  canvasProjectId,
  canvasScenes,
  fetchCanvasTaskPreview,
  type CanvasTaskPreview,
} from "./canvas-task-import-api";
export function CanvasTaskImport({
  crewId,
  generation,
  onClose,
  onStage,
}: {
  crewId: string;
  generation: number;
  onClose: () => void;
  onStage: (preview: CanvasTaskPreview) => void;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const [link, setLink] = useState("");
  const [preview, setPreview] = useState<CanvasTaskPreview>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => request.current?.abort(), []);
  async function load() {
    if (request.current || generation !== getAuthGeneration()) return;
    setPreview(undefined);
    setError(undefined);
    const projectId = canvasProjectId(link, appEnv.appRegion);
    if (!projectId) {
      setError(t("canvasImport.invalidLink"));
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const value = await fetchCanvasTaskPreview(crewId, projectId, generation, controller.signal);
      if (!controller.signal.aborted && generation === getAuthGeneration()) setPreview(value);
    } catch (cause) {
      if (!controller.signal.aborted && generation === getAuthGeneration())
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request.current === controller) request.current = undefined;
      if (!controller.signal.aborted && generation === getAuthGeneration()) setBusy(false);
    }
  }
  if (generation !== getAuthGeneration()) return null;
  const scenes = preview ? canvasScenes(preview) : [];
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{t("canvasImport.title")}</ThemedText>
      <ThemedText>{t("canvasImport.help")}</ThemedText>
      <TextInput
        accessibilityLabel={t("canvasImport.link")}
        placeholder={t("canvasImport.link")}
        placeholderTextColor={theme.textSecondary}
        value={link}
        editable={!busy}
        maxLength={2048}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          padding: 12,
          color: theme.text,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 8,
        }}
        onChangeText={(value) => {
          setLink(value);
          setPreview(undefined);
          setError(undefined);
        }}
      />
      <Pressable
        accessibilityRole="button"
        disabled={busy || !link.trim()}
        onPress={() => void load()}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("canvasImport.preview")}</ThemedText>
      </Pressable>
      {busy && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {preview && (
        <>
          <ThemedText type="smallBold">{preview.title}</ThemedText>
          {scenes.map((scene) => (
            <ThemedText key={scene.id}>{scene.content.title || scene.id}</ThemedText>
          ))}
          {(!scenes.length || scenes.length > 200) && (
            <ThemedText accessibilityRole="alert">{t("canvasImport.limit")}</ThemedText>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={busy || !scenes.length || scenes.length > 200}
            style={{ padding: 12, borderRadius: 8, backgroundColor: theme.brand }}
            onPress={() => {
              if (generation !== getAuthGeneration()) return;
              try {
                onStage(preview);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
              }
            }}
          >
            <ThemedText>{t("canvasImport.stage")}</ThemedText>
          </Pressable>
        </>
      )}
      <Pressable accessibilityRole="button" onPress={onClose} style={{ padding: 12 }}>
        <ThemedText>{t("crewTasks.back")}</ThemedText>
      </Pressable>
    </ScrollView>
  );
}
