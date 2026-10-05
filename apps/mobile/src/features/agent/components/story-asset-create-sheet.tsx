import { useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { uuid } from "expo-modules-core";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { assetCreateInput, type AssetCommand } from "../api/story-asset-mutations";
import type { StoryAssetSpecKind } from "../api/story-production-api";
export function AssetCreateSheet({
  kind,
  locked,
  submit,
  onClose,
  recovery,
  visible = true,
}: {
  visible?: boolean;
  kind: StoryAssetSpecKind;
  locked: boolean;
  submit: (command: AssetCommand) => void;
  onClose: () => void;
  recovery: ReactNode;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const [name, setName] = useState(""),
    [error, setError] = useState<string>();
  const create = () => {
    try {
      const input = assetCreateInput.parse({ kind, name, imagePrompt: name });
      setError(undefined);
      submit({ action: "create", clientKey: uuid.v4(), input });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.55)" }}
      >
        <View
          style={{
            maxHeight: "78%",
            backgroundColor: theme.backgroundElement,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
          }}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              padding: 20,
              paddingBottom: Math.max(insets.bottom, 20),
              gap: 16,
            }}
          >
            <ThemedText type="smallBold">
              {t("assetEdit.create")} · {t(`agent.assets.tabs.${kind}`)}
            </ThemedText>
            <ThemedText type="small">{t("assetEdit.createHelp")}</ThemedText>
            {recovery}
            {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
            <TextInput
              accessibilityLabel={t("assetEdit.name")}
              value={name}
              onChangeText={setName}
              maxLength={240}
              editable={!locked}
              style={{
                color: theme.text,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 8,
                padding: 12,
              }}
            />
            <Pressable
              accessibilityRole="button"
              disabled={locked || !name.trim()}
              onPress={create}
              style={{ paddingVertical: 12, opacity: locked || !name.trim() ? 0.5 : 1 }}
            >
              <ThemedText type="smallBold" style={{ color: theme.brand }}>
                {t("assetEdit.create")}
              </ThemedText>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onClose} style={{ paddingVertical: 12 }}>
              <ThemedText>{t("common.cancel")}</ThemedText>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
