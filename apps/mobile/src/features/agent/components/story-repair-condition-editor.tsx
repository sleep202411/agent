import { useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { z } from "zod";
import {
  StoryCompareOperatorSchema,
  StoryConditionSchema,
  type StoryCondition,
  type StoryCompareOperator,
} from "@repo/shared/story-stats";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { durableRecord } from "@/lib/durable-record";
import {
  buildRepairCondition,
  flattenRepairCondition,
  repairVariables,
} from "../lib/story-repair-conditions";
import type { RepairContent } from "../lib/story-repair-fields";
const draftSchema = z.object({
  base: z.string(),
  combinator: z.enum(["all", "any"]),
  negated: z.boolean(),
  compares: z
    .array(
      z.object({
        variableKey: z.string(),
        operator: z.custom<StoryCompareOperator>(
          (value) => StoryCompareOperatorSchema.safeParse(value).success
        ),
        value: z.union([z.string(), z.boolean()]),
      })
    )
    .max(12),
});
type Draft = z.infer<typeof draftSchema>;
type Props = {
  content: RepairContent;
  condition: unknown;
  userId: string;
  storageKey: string;
  canEdit: boolean;
  onApply: (value: StoryCondition | undefined) => boolean;
  onClose: () => void;
};
export function StoryRepairConditionEditor({
  content,
  condition,
  userId,
  storageKey,
  canEdit,
  onApply,
  onClose,
}: Props) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const record = useMemo(
    () => durableRecord("story-condition-edit", userId, storageKey),
    [userId, storageKey]
  );
  const flat = flattenRepairCondition(condition);
  const base = JSON.stringify(condition ?? null);
  const initial: Draft | null = flat
    ? {
        ...flat,
        base,
        compares: flat.compares.map((row) => ({
          variableKey: row.variableKey,
          operator: row.operator,
          value: typeof row.value === "boolean" ? row.value : String(row.value),
        })),
      }
    : null;
  const [loaded] = useState(() => {
    try {
      const raw = record.read();
      if (raw === null || raw === "null") return { draft: initial, error: undefined };
      return { draft: draftSchema.parse(JSON.parse(raw)), error: undefined };
    } catch (e) {
      return { draft: null, error: e instanceof Error ? e.message : String(e) };
    }
  });
  const [draft, setDraft] = useState(loaded.draft);
  const [error, setError] = useState<string | undefined>(loaded.error);
  const variables = repairVariables(content, locale);
  const conflict = !!draft && draft.base !== base;
  const change = (next: Draft) => {
    if (!canEdit || conflict) return;
    try {
      record.write(JSON.stringify(next));
      setDraft(next);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const apply = () => {
    if (!draft || !canEdit || conflict) return;
    try {
      const compares = draft.compares.map((row) => {
        const variable = variables.find((v) => v.key === row.variableKey);
        let value: number | boolean;
        if (variable?.valueType === "boolean") {
          if (typeof row.value !== "boolean") throw Error(t("storyCondition.invalidValue"));
          value = row.value;
        } else {
          if (
            typeof row.value !== "string" ||
            !row.value.trim() ||
            !Number.isFinite(Number(row.value))
          )
            throw Error(t("storyCondition.invalidValue"));
          value = Number(row.value);
        }
        return {
          kind: "compare" as const,
          variableKey: row.variableKey,
          operator: row.operator,
          value,
        };
      });
      const value = buildRepairCondition(content, { ...draft, compares });
      if (onApply(value)) {
        record.write("null");
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const describe = (value: StoryCondition): string => {
    if (value.kind === "compare")
      return `${variables.find((v) => v.key === value.variableKey)?.label ?? value.variableKey} ${t(`storyCondition.operator.${value.operator}`)} ${typeof value.value === "boolean" ? t(value.value ? "storyCondition.true" : "storyCondition.false") : value.value}`;
    if (value.kind === "not") return `${t("storyCondition.not")} (${describe(value.condition)})`;
    return `${t(value.kind === "all" ? "storyCondition.all" : "storyCondition.any")}: ${value.conditions.map((child) => `(${describe(child)})`).join("; ")}`;
  };
  const parsedCondition = StoryConditionSchema.safeParse(condition);
  const fieldStyle = {
    color: theme.text,
    borderWidth: 1,
    borderColor: theme.border,
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
          <ThemedText type="smallBold">{t("storyCondition.title")}</ThemedText>
          <Action label={t("agent.close")} onPress={onClose} />
          <ThemedText type="small" themeColor="textSecondary">
            {t("storyCondition.help")}
          </ThemedText>
          {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
          {conflict ? <ThemedText>{t("storyCondition.conflict")}</ThemedText> : null}
          {!draft && !loaded.error ? (
            <>
              <ThemedText>{t("storyCondition.complex")}</ThemedText>
              <ThemedText type="small">
                {parsedCondition.success
                  ? describe(parsedCondition.data)
                  : t("storyCondition.invalidValue")}
              </ThemedText>
            </>
          ) : null}
          {condition != null ? (
            <Action
              label={t("storyCondition.remove")}
              disabled={!canEdit || conflict}
              onPress={() =>
                Alert.alert(t("storyCondition.remove"), t("storyCondition.removeHelp"), [
                  { text: t("common.cancel"), style: "cancel" },
                  {
                    text: t("storyCondition.remove"),
                    style: "destructive",
                    onPress: () => {
                      try {
                        if (onApply(undefined)) {
                          record.write("null");
                          onClose();
                        }
                      } catch (e) {
                        setError(String(e));
                      }
                    },
                  },
                ])
              }
            />
          ) : null}
          {draft ? (
            <>
              <Select
                label={t("storyCondition.combine")}
                value={draft.combinator}
                options={[
                  { value: "all", label: t("storyCondition.all") },
                  { value: "any", label: t("storyCondition.any") },
                ]}
                disabled={!canEdit || conflict}
                onChange={(value) => change({ ...draft, combinator: value as "all" | "any" })}
              />
              <Action
                label={`${draft.negated ? "☑" : "☐"} ${t("storyCondition.not")}`}
                disabled={!canEdit || conflict}
                onPress={() => change({ ...draft, negated: !draft.negated })}
              />
              {draft.compares.map((row, index) => (
                <View
                  key={index}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 8,
                    padding: 10,
                    gap: 8,
                  }}
                >
                  <Select
                    label={`${t("storyCondition.variable")} ${index + 1}`}
                    value={row.variableKey}
                    options={variables.map((v) => ({ value: v.key, label: v.label }))}
                    disabled={!canEdit || conflict}
                    onChange={(key) => {
                      const variable = variables.find((v) => v.key === key)!;
                      change({
                        ...draft,
                        compares: draft.compares.map((r, i) =>
                          i === index
                            ? {
                                variableKey: key,
                                operator: variable.valueType === "boolean" ? "equals" : "at-least",
                                value: variable.valueType === "boolean" ? true : "0",
                              }
                            : r
                        ),
                      });
                    }}
                  />
                  <Select
                    label={`${t("storyCondition.operator")} ${index + 1}`}
                    value={row.operator}
                    options={StoryCompareOperatorSchema.options
                      .filter(
                        (op) =>
                          variables.find((v) => v.key === row.variableKey)?.valueType !==
                            "boolean" ||
                          op === "equals" ||
                          op === "not-equals"
                      )
                      .map((op) => ({ value: op, label: t(`storyCondition.operator.${op}`) }))}
                    disabled={!canEdit || conflict}
                    onChange={(operator) =>
                      change({
                        ...draft,
                        compares: draft.compares.map((r, i) =>
                          i === index
                            ? { ...r, operator: StoryCompareOperatorSchema.parse(operator) }
                            : r
                        ),
                      })
                    }
                  />
                  {variables.find((v) => v.key === row.variableKey)?.valueType === "boolean" ? (
                    <Select
                      label={`${t("storyCondition.value")} ${index + 1}`}
                      value={String(row.value)}
                      options={[
                        { value: "true", label: t("storyCondition.true") },
                        { value: "false", label: t("storyCondition.false") },
                      ]}
                      disabled={!canEdit || conflict}
                      onChange={(value) =>
                        change({
                          ...draft,
                          compares: draft.compares.map((r, i) =>
                            i === index ? { ...r, value: value === "true" } : r
                          ),
                        })
                      }
                    />
                  ) : (
                    <TextInput
                      accessibilityLabel={`${t("storyCondition.value")} ${index + 1}`}
                      value={String(row.value)}
                      editable={canEdit && !conflict}
                      keyboardType="numbers-and-punctuation"
                      onChangeText={(value) =>
                        change({
                          ...draft,
                          compares: draft.compares.map((r, i) =>
                            i === index ? { ...r, value } : r
                          ),
                        })
                      }
                      style={fieldStyle}
                    />
                  )}
                  <Action
                    label={t("storyCondition.removeComparison")}
                    disabled={!canEdit || conflict}
                    onPress={() =>
                      change({ ...draft, compares: draft.compares.filter((_, i) => i !== index) })
                    }
                  />
                </View>
              ))}
              {variables.length ? (
                <Action
                  label={t("storyCondition.addComparison")}
                  disabled={!canEdit || conflict || draft.compares.length >= 12}
                  onPress={() =>
                    change({
                      ...draft,
                      compares: [
                        ...draft.compares,
                        {
                          variableKey: variables[0].key,
                          operator: variables[0].valueType === "boolean" ? "equals" : "at-least",
                          value: variables[0].valueType === "boolean" ? true : "0",
                        },
                      ],
                    })
                  }
                />
              ) : (
                <ThemedText>{t("storyCondition.noVariables")}</ThemedText>
              )}
              <Action
                label={t("storyCondition.apply")}
                disabled={!canEdit || conflict}
                onPress={apply}
              />
            </>
          ) : null}
          {(conflict || loaded.error) && initial ? (
            <Action
              label={t("storyCondition.reload")}
              disabled={!canEdit}
              onPress={() => {
                try {
                  record.write("null");
                  setDraft(initial);
                  setError(undefined);
                } catch (e) {
                  setError(String(e));
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
          {options.map((option) => (
            <Action
              key={option.value}
              label={`${option.value === value ? "● " : "○ "}${option.label}`}
              disabled={disabled}
              onPress={() => {
                onChange(option.value);
                setOpen(false);
              }}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}
