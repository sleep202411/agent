import { AssetCandidatePicker } from "./story-asset-candidate-picker";
import { useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { uuid } from "expo-modules-core";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { assetPatchInput, type AssetCommand } from "../api/story-asset-mutations";
import type { StoryAssetSpec } from "../api/story-production-api";
export function StoryAssetEditFields({
  asset,
  locked,
  submit,
}: {
  asset: StoryAssetSpec;
  locked: boolean;
  submit: (command: AssetCommand) => void;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const [name, setName] = useState(asset.name),
    [prompt, setPrompt] = useState(asset.imagePrompt ?? ""),
    [description, setDescription] = useState(asset.description ?? ""),
    [error, setError] = useState<string>();
  const [purpose, setPurpose] = useState<"primary" | "turnaround">();
  const patch = (selectedMediaVersionId?: string | null, sourceMediaAssetId?: string) => {
    try {
      const input = assetPatchInput.parse({
        expectedVersion: asset.version,
        name,
        imagePrompt: prompt,
        description: description.trim() || null,
        ...(sourceMediaAssetId
          ? { sourceMediaAssetId, sourceMediaPurpose: purpose ?? "primary" }
          : {}),
        ...(selectedMediaVersionId !== undefined ? { selectedMediaVersionId } : {}),
      });
      setError(undefined);
      submit({ action: "patch", assetId: asset.id, clientKey: uuid.v4(), input });
    } catch (e) {
      setPurpose(undefined);
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const button = (label: string, action: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={locked || disabled}
      onPress={action}
      style={{ paddingVertical: 12, opacity: locked || disabled ? 0.5 : 1 }}
    >
      <ThemedText type="smallBold" style={{ color: theme.brand }}>
        {label}
      </ThemedText>
    </Pressable>
  );
  if (purpose)
    return (
      <AssetCandidatePicker
        projectId={asset.projectId}
        chapterId={asset.chapterId}
        locked={locked}
        onSelect={(id) => patch(undefined, id)}
        onClose={() => setPurpose(undefined)}
      />
    );
  return (
    <View style={{ gap: 12 }}>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {(
        [
          [t("assetEdit.name"), name, setName],
          [t("agent.assets.detail.description"), description, setDescription],
          [t("agent.assets.detail.imagePrompt"), prompt, setPrompt],
        ] as const
      ).map(([label, value, set]) => (
        <View key={label}>
          <ThemedText type="small">{label}</ThemedText>
          <TextInput
            accessibilityLabel={label}
            value={value}
            onChangeText={set}
            editable={!locked}
            multiline
            style={{
              color: theme.text,
              borderWidth: 1,
              borderColor: theme.border,
              padding: 10,
              borderRadius: 8,
            }}
          />
        </View>
      ))}
      {button(t("assetEdit.save"), () => patch(), !name.trim() || !prompt.trim())}
      {button(
        t("assetEdit.replaceImage"),
        () => setPurpose("primary"),
        !name.trim() || !prompt.trim()
      )}
      {asset.kind === "character" &&
        button(
          t("assetEdit.turnaround"),
          () => setPurpose("turnaround"),
          !name.trim() || !prompt.trim()
        )}
      <ThemedText type="smallBold">{t("assetEdit.versions")}</ThemedText>
      {asset.mediaVersions.map((version) => {
        const url = version.thumbnailUrl || version.previewUrl;
        return (
          <View key={version.id} style={{ gap: 4 }}>
            {version.mediaKind === "image" && url && /^https:\/\//i.test(url) && (
              <Image
                source={{ uri: url }}
                style={{ height: 140, width: "100%" }}
                contentFit="contain"
              />
            )}
            {button(
              `${asset.selectedMediaVersion?.id === version.id ? "✓ " : ""}${t("assetEdit.select")} ${version.versionNumber}`,
              () => patch(version.id),
              !name.trim() || !prompt.trim()
            )}
          </View>
        );
      })}
      {asset.selectedMediaVersion &&
        button(t("assetEdit.clearSelection"), () => patch(null), !name.trim() || !prompt.trim())}
      {button(t("assetEdit.archive"), () =>
        Alert.alert(t("assetEdit.archive"), t("assetEdit.archiveHelp"), [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("assetEdit.archive"),
            style: "destructive",
            onPress: () =>
              submit({
                action: "archive",
                assetId: asset.id,
                clientKey: uuid.v4(),
                input: { expectedVersion: asset.version },
              }),
          },
        ])
      )}
    </View>
  );
}
