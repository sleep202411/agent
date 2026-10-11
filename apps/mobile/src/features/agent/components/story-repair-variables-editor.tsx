import { useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { z } from "zod";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { durableRecord } from "@/lib/durable-record";
import {
  allocateRepairVariableKey,
  readRepairVariables,
  repairVariableListSchema,
  type RepairVariable,
} from "../lib/story-repair-variables";
import type { RepairContent } from "../lib/story-repair-fields";
const rawSchema = z.object({
  base: z.string(),
  rows: z
    .array(
      z.object({
        key: z.string(),
        name: z.record(z.string()),
        valueType: z.enum(["number", "boolean"]),
        initialValue: z.union([z.string(), z.boolean()]),
        note: z.string().optional(),
      })
    )
    .max(64),
});
type Draft = z.infer<typeof rawSchema>;
export function StoryRepairVariablesEditor({
  content,
  defaultLocale,
  userId,
  storageKey,
  canEdit,
  applyError,
  onApply,
  onClose,
}: {
  content: RepairContent;
  defaultLocale: string;
  userId: string;
  storageKey: string;
  canEdit: boolean;
  applyError?: string;
  onApply: (variables: RepairVariable[]) => boolean;
  onClose: () => void;
}) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const record = useMemo(
    () => durableRecord("story-variables-edit", userId, storageKey),
    [userId, storageKey]
  );
  // Preserve project language changes as conflicts, just like changed variable definitions.
  const base = JSON.stringify({
    defaultLocale,
    variables: (content.storyBible as Record<string, unknown>)?.stateVariables ?? [],
  });
  const initial = (): Draft => ({
    base,
    rows: readRepairVariables(content).map((v) => ({
      ...v,
      initialValue: typeof v.initialValue === "number" ? String(v.initialValue) : v.initialValue,
    })),
  });
  const [loaded] = useState(() => {
    try {
      const raw = record.read();
      return {
        draft: raw === null || raw === "null" ? initial() : rawSchema.parse(JSON.parse(raw)),
        error: undefined,
      };
    } catch (e) {
      return { draft: null, error: e instanceof Error ? e.message : String(e) };
    }
  });
  const [draft, setDraft] = useState<Draft | null>(loaded.draft),
    [error, setError] = useState<string | undefined>(loaded.error),
    [rejected, setRejected] = useState(false),
    [open, setOpen] = useState<string>();
  const conflict = !!draft && draft.base !== base,
    disabled = !canEdit || conflict;
  const change = (rows: Draft["rows"]) => {
    if (!draft || disabled) return;
    try {
      const next = { ...draft, rows };
      record.write(JSON.stringify(next));
      setDraft(next);
      setError(undefined);
      setRejected(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const apply = () => {
    if (!draft || disabled) return;
    try {
      const rows = repairVariableListSchema.parse(
        draft.rows.map((row) => {
          if (
            row.valueType === "number" &&
            (typeof row.initialValue !== "string" ||
              !row.initialValue.trim() ||
              !Number.isFinite(Number(row.initialValue)))
          )
            throw Error(t("storyCondition.invalidValue"));
          if (!row.name[defaultLocale]?.trim()) throw Error(t("storyVariables.nameRequired"));
          return {
            ...row,
            initialValue: row.valueType === "number" ? Number(row.initialValue) : row.initialValue,
          };
        })
      );
      if (onApply(rows)) {
        record.write("null");
        onClose();
      } else setRejected(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const fieldStyle = {
    color: theme.text,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    minHeight: 44,
  };
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
          <ThemedText type="smallBold">{t("storyVariables.title")}</ThemedText>
          <Action label={t("agent.close")} onPress={onClose} />
          <ThemedText type="small" themeColor="textSecondary">
            {t("storyCondition.help")}
          </ThemedText>
          {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
          {rejected ? (
            <ThemedText accessibilityRole="alert">
              {applyError || t("storyCondition.applyFailed")}
            </ThemedText>
          ) : null}
          {conflict ? (
            <ThemedText accessibilityRole="alert">{t("storyCondition.conflict")}</ThemedText>
          ) : null}
          <ThemedText type="small">{draft?.rows.length ?? 0}/64</ThemedText>
          {draft?.rows.map((row, index) => {
            const update = (next: typeof row) =>
              change(draft.rows.map((v, at) => (at === index ? next : v)));
            return (
              <View
                key={row.key}
                style={{
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 8,
                  padding: 12,
                  gap: 8,
                }}
              >
                <Action
                  label={row.name[locale] || row.name[defaultLocale] || row.key}
                  onPress={() => setOpen(open === row.key ? undefined : row.key)}
                />
                {open === row.key ? (
                  <>
                    <ThemedText type="small" themeColor="textSecondary">
                      {row.key}
                    </ThemedText>
                    {[...new Set([defaultLocale, locale])].map((lang) => (
                      <View key={lang}>
                        <ThemedText type="small">
                          {t("storyVariables.name")} ({lang})
                        </ThemedText>
                        <TextInput
                          accessibilityLabel={`${t("storyVariables.name")} (${lang})`}
                          style={fieldStyle}
                          value={row.name[lang] ?? ""}
                          maxLength={80}
                          editable={!disabled}
                          onChangeText={(name) =>
                            update({ ...row, name: { ...row.name, [lang]: name } })
                          }
                        />
                      </View>
                    ))}
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
                      {(["number", "boolean"] as const).map((type) => (
                        <Action
                          key={type}
                          label={`${row.valueType === type ? "● " : "○ "}${t(`storyVariables.${type}`)}`}
                          disabled={disabled}
                          onPress={() => {
                            if (type !== row.valueType)
                              update({
                                ...row,
                                valueType: type,
                                initialValue: type === "number" ? "0" : false,
                              });
                          }}
                        />
                      ))}
                    </View>
                    <ThemedText type="small">{t("storyVariables.initial")}</ThemedText>
                    {row.valueType === "boolean" ? (
                      <Action
                        label={t(
                          row.initialValue === true ? "storyCondition.true" : "storyCondition.false"
                        )}
                        disabled={disabled}
                        onPress={() => update({ ...row, initialValue: row.initialValue !== true })}
                      />
                    ) : (
                      <TextInput
                        accessibilityLabel={t("storyVariables.initial")}
                        style={fieldStyle}
                        editable={!disabled}
                        value={String(row.initialValue)}
                        onChangeText={(initialValue) => update({ ...row, initialValue })}
                      />
                    )}
                    <ThemedText type="small">{t("storyVariables.note")}</ThemedText>
                    <TextInput
                      accessibilityLabel={t("storyVariables.note")}
                      style={fieldStyle}
                      multiline
                      maxLength={2000}
                      editable={!disabled}
                      value={row.note ?? ""}
                      onChangeText={(note) => update({ ...row, note })}
                    />
                    <Action
                      label={t("storyVariables.remove")}
                      disabled={disabled}
                      onPress={() =>
                        Alert.alert(t("storyVariables.remove"), t("storyVariables.removeHelp"), [
                          { text: t("common.cancel"), style: "cancel" },
                          {
                            text: t("storyVariables.remove"),
                            style: "destructive",
                            onPress: () => change(draft.rows.filter((v) => v.key !== row.key)),
                          },
                        ])
                      }
                    />
                  </>
                ) : null}
              </View>
            );
          })}
          {draft ? (
            <>
              <Action
                label={t("storyVariables.add")}
                disabled={disabled || draft.rows.length >= 64}
                onPress={() => {
                  const key = allocateRepairVariableKey(draft.rows);
                  change([
                    ...draft.rows,
                    {
                      key,
                      name: { [defaultLocale]: "", [locale]: "" },
                      valueType: "number",
                      initialValue: "0",
                    },
                  ]);
                  setOpen(key);
                }}
              />
              <Action label={t("storyVariables.apply")} disabled={disabled} onPress={apply} />
            </>
          ) : null}
          {conflict || !draft ? (
            <Action
              label={t("storyCondition.reload")}
              disabled={!canEdit}
              onPress={() => {
                try {
                  const next = initial();
                  record.write("null");
                  setDraft(next);
                  setError(undefined);
                  setRejected(false);
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            />
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}
function Action({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      accessibilityState={{ disabled }}
      onPress={onPress}
      style={{ minHeight: 44, justifyContent: "center", opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}
