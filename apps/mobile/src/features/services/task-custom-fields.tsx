import { TaskCustomFieldEditing } from "./task-custom-field-editor";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTranslations } from "@/i18n";
import type { TaskDetail } from "./task-detail-api";
import { fetchTaskCustomFields, customFieldText } from "./task-custom-fields-api";
import { useUserDisplays } from "./user-displays";
export function TaskCustomFields({
  task,
  generation,
  userId,
  onRefresh,
}: {
  task: TaskDetail;
  generation: number;
  userId: string;
  onRefresh: () => void;
}) {
  const t = useTranslations();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchTaskCustomFields>>>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskCustomFields(task, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted && generation === getAuthGeneration()) setRows(data);
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => controller.abort();
  }, [task, generation, attempt]);
  const users = useUserDisplays(
    String(generation),
    rows?.flatMap((r) =>
      r.field.type === "user" && typeof r.value === "string" ? [r.value] : []
    ) ?? []
  );
  if (rows?.length === 0) return null;
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{t("taskCustomFields.title")}</ThemedText>
      {!rows && !error && <ActivityIndicator />}
      {error && (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setError(undefined);
              setAttempt((n) => n + 1);
            }}
          >
            <ThemedText>{t("inbox.retry")}</ThemedText>
          </Pressable>
        </>
      )}
      {rows && (
        <TaskCustomFieldEditing
          task={task}
          generation={generation}
          userId={userId}
          fields={rows.map((r) => r.field)}
          onRefresh={onRefresh}
        />
      )}
      {rows?.map(({ field, value }) => (
        <View key={field.id}>
          <ThemedText type="smallBold">{field.name}</ThemedText>
          <ThemedText>
            {customFieldText(
              field,
              value,
              {
                unset: t("thread.taskUnset"),
                yes: t("taskCustomFields.yes"),
                no: t("taskCustomFields.no"),
              },
              users
            )}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}
