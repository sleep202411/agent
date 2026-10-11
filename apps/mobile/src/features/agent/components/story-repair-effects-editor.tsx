import { useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { z } from "zod";
import {
  StoryStateEffectsSchema,
  storyEffectTypeError,
  type StoryStateEffect,
} from "@repo/shared/story-stats";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { durableRecord } from "@/lib/durable-record";
import { repairVariables } from "../lib/story-repair-conditions";
import type { RepairContent } from "../lib/story-repair-fields";
const schema = z.object({
  base: z.string(),
  rows: z
    .array(
      z.object({
        key: z.string(),
        kind: z.enum(["set", "add", "subtract"]),
        value: z.union([z.string(), z.boolean()]),
      })
    )
    .max(6),
});
type Draft = z.infer<typeof schema>;
export function StoryRepairEffectsEditor({
  content,
  effects,
  userId,
  storageKey,
  canEdit,
  applyError,
  onApply,
  onClose,
}: {
  content: RepairContent;
  effects: unknown;
  userId: string;
  storageKey: string;
  canEdit: boolean;
  applyError?: string;
  onApply: (effects: StoryStateEffect[]) => boolean;
  onClose: () => void;
}) {
  const theme = useTheme(),
    t = useTranslations(),
    locale = useLocale(),
    insets = useSafeAreaInsets();
  const variables = repairVariables(content, locale);
  const base = JSON.stringify(effects);
  const record = useMemo(
    () => durableRecord("story-effects-edit", userId, storageKey),
    [userId, storageKey]
  );
  const initial = (): Draft => ({
    base,
    rows: StoryStateEffectsSchema.parse(effects).map((effect) => ({
      key: effect.key,
      kind: effect.kind === "set" ? "set" : effect.amount < 0 ? "subtract" : "add",
      value:
        effect.kind === "set"
          ? typeof effect.value === "boolean"
            ? effect.value
            : String(effect.value)
          : String(Math.abs(effect.amount)),
    })),
  });
  const [loaded] = useState(() => {
    try {
      const raw = record.read();
      return {
        draft: raw === null || raw === "null" ? initial() : schema.parse(JSON.parse(raw)),
        error: undefined,
      };
    } catch (e) {
      return { draft: null, error: e instanceof Error ? e.message : String(e) };
    }
  });
  const [draft, setDraft] = useState<Draft | null>(loaded.draft);
  const [error, setError] = useState<string | undefined>(loaded.error);
  const [rejected, setRejected] = useState(false);
  const conflict = !!draft && draft.base !== base;
  const disabled = !canEdit || conflict;
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
      const result = StoryStateEffectsSchema.parse(
        draft.rows.map((row) => {
          if (
            typeof row.value === "string" &&
            (!row.value.trim() || !Number.isFinite(Number(row.value)))
          )
            throw Error(t("storyCondition.invalidValue"));
          const value = typeof row.value === "boolean" ? row.value : Number(row.value);
          if (row.kind === "set") return { kind: "set", key: row.key, value };
          if (typeof value !== "number" || value < 0) throw Error(t("storyEffects.positive"));
          return { kind: "add", key: row.key, amount: row.kind === "subtract" ? -value : value };
        })
      );
      const lookup = new Map(variables.map((v) => [v.key, v]));
      for (const effect of result) {
        const detail = storyEffectTypeError(effect, lookup);
        if (detail) throw Error(detail);
      }
      if (onApply(result)) {
        record.write("null");
        onClose();
      } else setRejected(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
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
          <ThemedText type="smallBold">{t("storyEffects.title")}</ThemedText>
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
          {!variables.length ? <ThemedText>{t("storyCondition.noVariables")}</ThemedText> : null}
          {draft?.rows.map((row, index) => {
            const variable = variables.find((v) => v.key === row.key);
            const update = (next: Draft["rows"][number]) =>
              change(draft.rows.map((r, at) => (at === index ? next : r)));
            return (
              <View
                key={index}
                style={{
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 8,
                  padding: 12,
                  gap: 8,
                }}
              >
                <Select
                  label={`${t("storyCondition.variable")} ${index + 1}`}
                  value={row.key}
                  disabled={disabled}
                  options={variables.map((v) => ({ value: v.key, label: v.label }))}
                  onChange={(key) => {
                    const v = variables.find((item) => item.key === key)!;
                    update({
                      key,
                      kind: v.valueType === "boolean" ? "set" : row.kind,
                      value: v.valueType === "boolean" ? false : "0",
                    });
                  }}
                />
                <Select
                  label={`${t("storyEffects.operation")} ${index + 1}`}
                  value={row.kind}
                  disabled={disabled}
                  options={(variable?.valueType === "boolean"
                    ? (["set"] as const)
                    : (["set", "add", "subtract"] as const)
                  ).map((kind) => ({ value: kind, label: t(`storyEffects.${kind}`) }))}
                  onChange={(kind) => update({ ...row, kind: kind as typeof row.kind })}
                />
                {typeof row.value === "boolean" ? (
                  <Select
                    label={`${t("storyCondition.value")} ${index + 1}`}
                    value={String(row.value)}
                    disabled={disabled}
                    options={[true, false].map((v) => ({
                      value: String(v),
                      label: t(`storyCondition.${v}`),
                    }))}
                    onChange={(value) => update({ ...row, value: value === "true" })}
                  />
                ) : (
                  <TextInput
                    accessibilityLabel={`${t("storyCondition.value")} ${index + 1}`}
                    value={row.value}
                    editable={!disabled}
                    onChangeText={(value) => update({ ...row, value })}
                    style={{
                      color: theme.text,
                      borderColor: theme.border,
                      borderWidth: 1,
                      borderRadius: 8,
                      padding: 10,
                      minHeight: 44,
                    }}
                  />
                )}
                <Action
                  label={t("storyEffects.remove")}
                  disabled={disabled}
                  onPress={() => change(draft.rows.filter((_, at) => at !== index))}
                />
              </View>
            );
          })}
          {draft ? (
            <>
              <Action
                label={t("storyEffects.addEffect")}
                disabled={disabled || !variables.length || draft.rows.length >= 6}
                onPress={() =>
                  change([
                    ...draft.rows,
                    {
                      key: variables[0].key,
                      kind: "set",
                      value: variables[0].valueType === "boolean" ? false : "0",
                    },
                  ])
                }
              />
              <Action label={t("storyEffects.apply")} disabled={disabled} onPress={apply} />
            </>
          ) : null}
          {!draft ? (
            <Action
              label={t("storyEffects.clear")}
              disabled={!canEdit}
              onPress={() =>
                Alert.alert(t("storyEffects.clear"), t("storyEffects.clearHelp"), [
                  { text: t("common.cancel"), style: "cancel" },
                  {
                    text: t("storyEffects.clear"),
                    style: "destructive",
                    onPress: () => {
                      try {
                        const next: Draft = { base, rows: [] };
                        record.write(JSON.stringify(next));
                        setDraft(next);
                        setError(undefined);
                        setRejected(false);
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      }
                    },
                  },
                ])
              }
            />
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
function Select({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Action
        label={`${label}: ${options.find((o) => o.value === value)?.label ?? value}`}
        disabled={disabled}
        onPress={() => setOpen(!open)}
      />
      {open ? (
        <ScrollView style={{ maxHeight: 180 }}>
          {options.map((o) => (
            <Action
              key={o.value}
              label={`${o.value === value ? "● " : "○ "}${o.label}`}
              disabled={disabled}
              onPress={() => {
                onChange(o.value);
                setOpen(false);
              }}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}
