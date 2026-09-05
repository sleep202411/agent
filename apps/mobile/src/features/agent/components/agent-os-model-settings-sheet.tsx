import IconCheck from "@tabler/icons-react-native/icons/IconCheck";
import IconChevronDown from "@tabler/icons-react-native/icons/IconChevronDown";
import IconX from "@tabler/icons-react-native/icons/IconX";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Colors, Spacing } from "@/constants/theme";
import { useTranslations } from "@/i18n";

import {
  getCachedGenerationCatalog,
  loadGenerationCatalog,
  type AiCatalogOption,
} from "../api/ai-catalog-api";
import {
  agentOsApi,
  type AgentOsModelPreferences,
  type AgentOsModelProfile,
} from "../api/agent-os-api";

const theme = Colors.dark;
const BRAND_RED = theme.brand;
const AUTOMATIC = "__automatic__";

type FieldKey = "chat" | "image" | "video";

type AgentOsModelSettingsSheetProps = {
  projectId: string;
  chatModels: readonly AgentOsModelProfile[];
  initialPreferences?: AgentOsModelPreferences | null;
  visible: boolean;
  disabled?: boolean;
  onClose: () => void;
  onSaved?: (preferences: AgentOsModelPreferences) => void;
};

function applyPreferenceValues(next: AgentOsModelPreferences) {
  return {
    chat: next.chatModelProfileId ?? AUTOMATIC,
    image: next.imageModelId ?? AUTOMATIC,
    video: next.videoModelId ?? AUTOMATIC,
  };
}

/** H5 `AgentOsModelSettingsDialog` — project defaults for chat / image / video. */
export function AgentOsModelSettingsSheet({
  projectId,
  chatModels,
  initialPreferences = null,
  visible,
  disabled = false,
  onClose,
  onSaved,
}: AgentOsModelSettingsSheetProps) {
  const t = useTranslations();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<AgentOsModelPreferences | null>(
    initialPreferences
  );
  const [imageModels, setImageModels] = useState<AiCatalogOption[]>(
    () => getCachedGenerationCatalog()?.image ?? []
  );
  const [videoModels, setVideoModels] = useState<AiCatalogOption[]>(
    () => getCachedGenerationCatalog()?.video ?? []
  );
  const [chatValue, setChatValue] = useState(
    () => initialPreferences?.chatModelProfileId ?? AUTOMATIC
  );
  const [imageValue, setImageValue] = useState(() => initialPreferences?.imageModelId ?? AUTOMATIC);
  const [videoValue, setVideoValue] = useState(() => initialPreferences?.videoModelId ?? AUTOMATIC);
  const [picking, setPicking] = useState<FieldKey | null>(null);
  const initialPreferencesRef = useRef(initialPreferences);
  const fieldsHydratedRef = useRef(false);
  initialPreferencesRef.current = initialPreferences;

  const hydrateFields = (next: AgentOsModelPreferences) => {
    const values = applyPreferenceValues(next);
    setChatValue(values.chat);
    setImageValue(values.image);
    setVideoValue(values.video);
    fieldsHydratedRef.current = true;
  };

  useEffect(() => {
    if (!visible) {
      fieldsHydratedRef.current = false;
      setPicking(null);
      setError(null);
      setSaving(false);
      return;
    }

    const seeded = initialPreferencesRef.current;
    if (seeded) {
      setPreferences(seeded);
      hydrateFields(seeded);
    }

    const cached = getCachedGenerationCatalog();
    if (cached) {
      setImageModels(cached.image);
      setVideoModels(cached.video);
    }

    let cancelled = false;

    if (!seeded) {
      void agentOsApi
        .getModelPreferences(projectId)
        .then((next) => {
          if (cancelled) return;
          setPreferences((prev) => prev ?? next);
          if (!fieldsHydratedRef.current) hydrateFields(next);
        })
        .catch((err) => {
          if (cancelled) return;
          setPreferences(null);
          setError(err instanceof Error ? err.message : t("agent.modelSettings.loadFailed"));
        });
    }

    if (!cached) {
      void loadGenerationCatalog()
        .then((catalog) => {
          if (cancelled) return;
          setImageModels(catalog.image);
          setVideoModels(catalog.video);
        })
        .catch(() => {
          if (cancelled) return;
          setImageModels([]);
          setVideoModels([]);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [projectId, t, visible]);

  useEffect(() => {
    if (!visible || !initialPreferences) return;
    setPreferences((prev) => prev ?? initialPreferences);
    if (!fieldsHydratedRef.current) hydrateFields(initialPreferences);
  }, [initialPreferences, visible]);

  const fields = useMemo(
    () => ({
      chat: {
        label: t("agent.modelSettings.conversationModel"),
        hint: t("agent.modelSettings.conversationModelHint"),
        value: chatValue,
        options: chatModels.map((model) => ({ id: model.id, name: model.label })),
      },
      image: {
        label: t("agent.modelSettings.imageModel"),
        hint: t("agent.modelSettings.imageModelHint"),
        value: imageValue,
        options: imageModels,
      },
      video: {
        label: t("agent.modelSettings.videoModel"),
        hint: t("agent.modelSettings.videoModelHint"),
        value: videoValue,
        options: videoModels,
      },
    }),
    [chatModels, chatValue, imageModels, imageValue, t, videoModels, videoValue]
  );

  const setFieldValue = (field: FieldKey, value: string) => {
    if (field === "chat") setChatValue(value);
    if (field === "image") setImageValue(value);
    if (field === "video") setVideoValue(value);
    setPicking(null);
  };

  const save = async () => {
    if (!preferences || disabled || saving) return;
    setSaving(true);
    setError(null);
    try {
      const next = await agentOsApi.updateModelPreferences(projectId, {
        expectedVersion: preferences.version,
        chatModelProfileId: nullableSelection(chatValue),
        imageModelId: nullableSelection(imageValue),
        videoModelId: nullableSelection(videoValue),
      });
      onSaved?.(next);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("agent.modelSettings.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const fieldsLocked = disabled || saving;
  const saveLocked = fieldsLocked || !preferences;
  const pickingField = picking ? fields[picking] : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => (picking ? setPicking(null) : onClose())}
    >
      <View style={styles.modalRoot}>
        <View style={styles.backdrop}>
          <View
            style={[
              styles.dialog,
              {
                marginTop: Math.max(insets.top, Spacing.four),
                marginBottom: Math.max(insets.bottom, Spacing.four),
              },
            ]}
          >
            <View style={styles.header}>
              <View style={styles.headerCopy}>
                <ThemedText style={styles.title}>{t("agent.modelSettings.title")}</ThemedText>
                <ThemedText style={styles.description}>
                  {t("agent.modelSettings.description")}
                </ThemedText>
              </View>
              <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
                <View style={styles.close}>
                  <IconX size={16} color="rgba(255,255,255,0.72)" strokeWidth={2} />
                </View>
              </Pressable>
            </View>

            <View style={styles.body}>
              <View style={styles.fields}>
                {(Object.keys(fields) as FieldKey[]).map((key) => (
                  <ModelField
                    key={key}
                    label={fields[key].label}
                    hint={fields[key].hint}
                    valueLabel={optionLabel(
                      fields[key].value,
                      fields[key].options,
                      t("agent.modelSettings.automatic")
                    )}
                    disabled={fieldsLocked}
                    onPress={() => setPicking(key)}
                  />
                ))}
                <ThemedText style={styles.automaticHint}>
                  {t("agent.modelSettings.automaticHint")}
                </ThemedText>
              </View>

              {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

              <Pressable
                accessibilityRole="button"
                disabled={saveLocked}
                onPress={() => void save()}
              >
                <View style={[styles.saveChrome, saveLocked && styles.disabled]}>
                  {saving ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <ThemedText style={styles.saveText}>{t("agent.modelSettings.save")}</ThemedText>
                  )}
                </View>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={saving} onPress={onClose}>
                <View style={styles.cancelChrome}>
                  <ThemedText style={styles.cancelText}>{t("common.cancel")}</ThemedText>
                </View>
              </Pressable>
            </View>
          </View>
        </View>

        {picking && pickingField ? (
          <View style={styles.pickerRoot} pointerEvents="box-none">
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setPicking(null)}>
              <View style={styles.pickerDim} />
            </Pressable>
            <View
              style={[
                styles.pickerSheet,
                {
                  maxHeight: windowHeight * 0.5,
                  paddingBottom: Math.max(insets.bottom, Spacing.four),
                  paddingLeft: Math.max(insets.left, Spacing.four),
                  paddingRight: Math.max(insets.right, Spacing.four),
                },
              ]}
            >
              <ThemedText style={styles.pickerTitle}>{pickingField.label}</ThemedText>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                style={[styles.pickerList, { maxHeight: windowHeight * 0.5 - 72 }]}
                contentContainerStyle={styles.pickerListContent}
              >
                <OptionRow
                  label={t("agent.modelSettings.automatic")}
                  selected={pickingField.value === AUTOMATIC}
                  onPress={() => setFieldValue(picking, AUTOMATIC)}
                />
                {pickingField.value !== AUTOMATIC &&
                !pickingField.options.some((option) => option.id === pickingField.value) ? (
                  <OptionRow
                    label={pickingField.value}
                    selected
                    onPress={() => setFieldValue(picking, pickingField.value)}
                  />
                ) : null}
                {pickingField.options.map((option) => (
                  <OptionRow
                    key={option.id}
                    label={option.name}
                    selected={option.id === pickingField.value}
                    onPress={() => setFieldValue(picking, option.id)}
                  />
                ))}
              </ScrollView>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function ModelField({
  label,
  hint,
  valueLabel,
  disabled,
  onPress,
}: {
  label: string;
  hint: string;
  valueLabel: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        <ThemedText style={styles.fieldLabel}>{label}</ThemedText>
        <ThemedText style={styles.fieldHint}>{hint}</ThemedText>
      </View>
      <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}>
        <View style={[styles.select, disabled && styles.disabled]}>
          <ThemedText numberOfLines={1} style={styles.selectValue}>
            {valueLabel}
          </ThemedText>
          <IconChevronDown size={16} color="rgba(255,255,255,0.55)" strokeWidth={2} />
        </View>
      </Pressable>
    </View>
  );
}

function OptionRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress}>
      <View style={[styles.optionRow, selected && styles.optionActive]}>
        <ThemedText style={styles.optionLabel}>{label}</ThemedText>
        {selected ? <IconCheck size={18} color={BRAND_RED} strokeWidth={2.5} /> : null}
      </View>
    </Pressable>
  );
}

function optionLabel(
  value: string,
  options: Array<{ id: string; name: string }>,
  automatic: string
) {
  if (value === AUTOMATIC) return automatic;
  return options.find((option) => option.id === value)?.name ?? value;
}

function nullableSelection(value: string): string | null {
  return value === AUTOMATIC ? null : value;
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.62)",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  dialog: {
    alignSelf: "stretch",
    backgroundColor: "rgba(28,28,28,0.98)",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.four,
    maxWidth: 520,
    padding: 20,
    width: "100%",
  },
  header: {
    flexDirection: "row",
    gap: Spacing.three,
  },
  headerCopy: {
    flex: 1,
    gap: 6,
    minWidth: 0,
    paddingRight: 8,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  description: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    lineHeight: 18,
  },
  close: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 16,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  body: {
    gap: Spacing.four,
  },
  fields: {
    gap: Spacing.four,
  },
  field: {
    gap: 8,
  },
  fieldLabelRow: {
    alignItems: "baseline",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  fieldLabel: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 13,
    fontWeight: "600",
  },
  fieldHint: {
    color: "rgba(255,255,255,0.48)",
    fontSize: 12,
  },
  select: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.055)",
    borderRadius: 14,
    flexDirection: "row",
    minHeight: 44,
    paddingHorizontal: 14,
  },
  selectValue: {
    color: "rgba(255,255,255,0.92)",
    flex: 1,
    fontSize: 14,
    minWidth: 0,
    paddingRight: 8,
  },
  automaticHint: {
    color: "rgba(255,255,255,0.42)",
    fontSize: 11,
    lineHeight: 16,
  },
  pickerRoot: {
    bottom: 0,
    justifyContent: "flex-end",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  pickerDim: {
    backgroundColor: "rgba(0,0,0,0.45)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  pickerSheet: {
    alignSelf: "stretch",
    backgroundColor: theme.backgroundElement,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    gap: Spacing.two,
    paddingTop: Spacing.three,
    width: "100%",
  },
  pickerTitle: {
    color: "rgba(255,255,255,0.48)",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.4,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  pickerList: {
    flexGrow: 0,
    flexShrink: 1,
  },
  pickerListContent: {
    gap: Spacing.one,
    paddingBottom: Spacing.two,
    width: "100%",
  },
  optionRow: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 52,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    width: "100%",
  },
  optionActive: {
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  optionLabel: {
    color: "rgba(255,255,255,0.92)",
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
    minWidth: 0,
    paddingRight: Spacing.three,
  },
  error: {
    color: "rgba(254, 202, 202, 0.88)",
    fontSize: 12,
    lineHeight: 18,
  },
  saveChrome: {
    alignItems: "center",
    backgroundColor: BRAND_RED,
    borderRadius: 16,
    height: 48,
    justifyContent: "center",
  },
  saveText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  cancelChrome: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    height: 48,
    justifyContent: "center",
  },
  cancelText: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 15,
    fontWeight: "500",
  },
  disabled: {
    opacity: 0.45,
  },
});
