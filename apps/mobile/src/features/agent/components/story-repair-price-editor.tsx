import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { z } from "zod";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { durableRecord } from "@/lib/durable-record";
import { parseRepairPointPrice, readRepairPointPrice } from "../lib/story-repair-price";
import type { RepairContent } from "../lib/story-repair-fields";
const schema = z.object({ base: z.number().int().nonnegative(), value: z.string() });
export function StoryRepairPriceEditor({
  content,
  nodeId,
  userId,
  storageKey,
  canEdit,
  applyError,
  onApply,
  onClose,
}: {
  content: RepairContent;
  nodeId: string;
  userId: string;
  storageKey: string;
  canEdit: boolean;
  applyError?: string;
  onApply: (expected: number, price: number) => boolean;
  onClose: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const record = useMemo(
    () => durableRecord("story-price-edit", userId, storageKey),
    [userId, storageKey]
  );
  const initial = () => {
    const base = readRepairPointPrice(content, nodeId);
    return { base, value: String(base) };
  };
  const [loaded] = useState(() => {
    try {
      const raw = record.read();
      return {
        draft: raw === null || raw === "null" ? initial() : schema.parse(JSON.parse(raw)),
        error: undefined,
      };
    } catch (e) {
      return { draft: null, error: String(e) };
    }
  });
  const [draft, setDraft] = useState(loaded.draft),
    [error, setError] = useState<string | undefined>(loaded.error),
    [rejected, setRejected] = useState(false);
  let current: number | undefined;
  try {
    current = readRepairPointPrice(content, nodeId);
  } catch {
    /* Missing or malformed scenes require reload. */
  }
  const conflict = !!draft && current !== draft.base,
    disabled = !canEdit || conflict || current === undefined;
  const action = (label: string, onPress: () => void, blocked = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={blocked}
      accessibilityState={{ disabled: blocked }}
      onPress={onPress}
      style={{ minHeight: 44, justifyContent: "center", opacity: blocked ? 0.5 : 1 }}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, gap: 12 }}
        >
          <ThemedText type="smallBold">{t("storyPrice.title")}</ThemedText>
          {action(t("agent.close"), onClose)}
          <ThemedText type="small">{t("storyPrice.help")}</ThemedText>
          {error || rejected ? (
            <ThemedText accessibilityRole="alert">
              {error || applyError || t("storyCondition.applyFailed")}
            </ThemedText>
          ) : null}
          {conflict ? (
            <ThemedText accessibilityRole="alert">{t("storyCondition.conflict")}</ThemedText>
          ) : null}
          {draft ? (
            <TextInput
              accessibilityLabel={t("storyPrice.title")}
              value={draft.value}
              editable={!disabled}
              inputMode="numeric"
              onChangeText={(value) => {
                if (disabled) return;
                try {
                  const next = { ...draft, value };
                  record.write(JSON.stringify(next));
                  setDraft(next);
                  setError(undefined);
                  setRejected(false);
                } catch (e) {
                  setError(String(e));
                }
              }}
              style={{
                minHeight: 44,
                padding: 10,
                borderWidth: 1,
                borderRadius: 8,
                borderColor: theme.border,
                color: theme.text,
              }}
            />
          ) : null}
          {action(
            t("storyPrice.apply"),
            () => {
              if (!draft || disabled) return;
              const price = parseRepairPointPrice(draft.value);
              if (price === null) {
                setError(t("storyPrice.invalid"));
                return;
              }
              setError(undefined);
              try {
                if (onApply(draft.base, price)) {
                  record.write("null");
                  onClose();
                } else setRejected(true);
              } catch (e) {
                setError(String(e));
              }
            },
            disabled || !draft
          )}
          {conflict || !draft
            ? action(
                t("storyCondition.reload"),
                () => {
                  try {
                    const next = initial();
                    record.write(JSON.stringify(next));
                    setDraft(next);
                    setError(undefined);
                    setRejected(false);
                  } catch (e) {
                    setError(String(e));
                  }
                },
                !canEdit
              )
            : null}
        </ScrollView>
      </View>
    </Modal>
  );
}
