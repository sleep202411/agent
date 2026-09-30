import { useState } from "react";
import { Pressable, Switch, TextInput, View } from "react-native";
import { useAuth } from "@/auth";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import type { CreatorServiceDetail } from "@/data/types";
import {
  questionsSchema,
  saveServiceQuestions,
  type EditableQuestion,
} from "./service-questions-api";
import { inquiryKey } from "./inquiry-api";
type Row = EditableQuestion & { key: string };
export function ServiceQuestionsEditor(props: {
  service: CreatorServiceDetail;
  refresh: () => void;
}) {
  const auth = useAuth();
  if (
    auth.status !== "authenticated" ||
    String(auth.user?.userId ?? auth.user?.id ?? "") !== props.service.creatorId ||
    props.service.status === "archived" ||
    props.service.version === undefined
  )
    return null;
  return (
    <Editor
      key={JSON.stringify([props.service.id, props.service.version, auth.generation])}
      {...props}
    />
  );
}
function Editor({ service, refresh }: { service: CreatorServiceDetail; refresh: () => void }) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(service.id, useScreenActive());
  const initial = (): Row[] =>
    service.requirementQuestions.map((q) => ({
      ...q,
      helpText: q.helpText ?? "",
      key: `persisted:${q.id}`,
    }));
  const [rows, setRows] = useState(initial),
    [open, setOpen] = useState(false),
    [error, setError] = useState<string>();
  const parsed = questionsSchema.safeParse({
    expectedVersion: service.version,
    requirementQuestions: rows,
  });
  const update = (key: string, change: Partial<EditableQuestion>) =>
    setRows((items) => items.map((item) => (item.key === key ? { ...item, ...change } : item)));
  const move = (index: number, delta: number) =>
    setRows((items) => {
      const copy = [...items];
      const other = index + delta;
      if (other < 0 || other >= copy.length) return items;
      [copy[index], copy[other]] = [copy[other], copy[index]];
      return copy;
    });
  const button = (label: string, onPress: () => void, disabled = false) => (
    <Pressable accessibilityRole="button" disabled={op.busy || disabled} onPress={onPress}>
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
  if (!open) return button(t("serviceQuestions.title"), () => setOpen(true));
  return (
    <View style={{ gap: 12 }}>
      <ThemedText type="smallBold">{t("serviceQuestions.title")}</ThemedText>
      <ThemedText>{t("serviceQuestions.hint")}</ThemedText>
      {rows.map((row, index) => (
        <View
          key={row.key}
          style={{ gap: 8, padding: 12, borderRadius: 8, backgroundColor: theme.backgroundElement }}
        >
          <ThemedText>
            {t("serviceQuestions.prompt")} {index + 1}
          </ThemedText>
          <TextInput
            accessibilityLabel={`${t("serviceQuestions.prompt")} ${index + 1}`}
            value={row.prompt}
            onChangeText={(prompt) => update(row.key, { prompt })}
            maxLength={240}
            multiline
            editable={!op.busy}
            style={{ color: theme.text }}
          />
          <ThemedText>{t("serviceQuestions.help")}</ThemedText>
          <TextInput
            accessibilityLabel={`${t("serviceQuestions.help")} ${index + 1}`}
            value={row.helpText}
            onChangeText={(helpText) => update(row.key, { helpText })}
            maxLength={240}
            multiline
            editable={!op.busy}
            style={{ color: theme.text }}
          />
          <ThemedText>{t("serviceQuestions.required")}</ThemedText>
          <Switch
            accessibilityLabel={`${t("serviceQuestions.required")} ${index + 1}`}
            value={row.required}
            onValueChange={(required) => update(row.key, { required })}
            disabled={op.busy}
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {button(t("serviceQuestions.up"), () => move(index, -1), index === 0)}
            {button(t("serviceQuestions.down"), () => move(index, 1), index === rows.length - 1)}
            {button(t("serviceQuestions.remove"), () =>
              setRows((items) => items.filter((item) => item.key !== row.key))
            )}
          </View>
        </View>
      ))}
      {button(
        t("serviceQuestions.add"),
        () => {
          const key = `new:${inquiryKey()}`;
          setRows((items) => [...items, { key, prompt: "", helpText: "", required: false }]);
        },
        rows.length >= 20
      )}
      {!parsed.success && <ThemedText>{t("serviceQuestions.invalid")}</ThemedText>}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {button(
        t("profileEdit.save"),
        () => {
          if (!parsed.success) return;
          void op.run(
            () => saveServiceQuestions(service.id, parsed.data),
            refresh,
            (cause) => setError(cause instanceof Error ? cause.message : String(cause))
          );
        },
        !parsed.success
      )}
      {button(t("myServices.cancel"), () => {
        setRows(initial());
        setError(undefined);
        setOpen(false);
      })}
      {error && button(t("serviceEdit.reload"), refresh)}
    </View>
  );
}
