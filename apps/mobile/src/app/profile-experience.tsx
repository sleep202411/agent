import { Stack, useIsFocused } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useAuth, useLoginGateOnFocus } from "@/auth";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations, type MessageKey } from "@/i18n";
import {
  getMyExperience,
  saveExperience,
  deleteExperience,
  type ExperienceEntry,
} from "@/features/profile/experience-api";
const empty: ExperienceEntry = {
  title: "",
  organization: "",
  location: "",
  startTime: "",
  endTime: "",
  description: "",
};
const fields: { key: Exclude<keyof ExperienceEntry, "id">; label: MessageKey; limit: number }[] = [
  { key: "title", label: "experienceEdit.role", limit: 120 },
  { key: "organization", label: "experienceEdit.organization", limit: 120 },
  { key: "location", label: "experienceEdit.location", limit: 120 },
  { key: "startTime", label: "profileEdit.startDate", limit: 10 },
  { key: "endTime", label: "profileEdit.endDate", limit: 10 },
  { key: "description", label: "experienceEdit.description", limit: 2000 },
];
export default function ProfileExperienceScreen() {
  const auth = useAuth(),
    theme = useTheme(),
    t = useTranslations();
  useLoginGateOnFocus();
  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("creatorDetail.experienceTitle"),
          headerBackButtonDisplayMode: "minimal",
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
          headerShadowVisible: false,
        }}
      />
      {auth.status === "authenticated" ? (
        <ExperienceEditor
          key={JSON.stringify([auth.generation, auth.user?.id ?? auth.user?.userId])}
        />
      ) : (
        <ActivityIndicator />
      )}
    </View>
  );
}
function ExperienceEditor() {
  const theme = useTheme(),
    t = useTranslations();
  const operation = useAuthFormOperation("profile-experience", useIsFocused());
  const [rows, setRows] = useState<ExperienceEntry[]>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<ExperienceEntry>();
  const [removal, setRemoval] = useState<ExperienceEntry>();
  useEffect(() => {
    const controller = new AbortController();
    void getMyExperience(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setRows(result);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [attempt]);
  const reload = () => {
    setRows(undefined);
    setError(undefined);
    setAttempt((value) => value + 1);
  };
  const mutate = (request: () => Promise<void>) =>
    operation.run(
      async () => {
        setError(undefined);
        await request();
      },
      () => {
        setDraft(undefined);
        setRemoval(undefined);
        reload();
      },
      (cause) => setError(cause instanceof Error ? cause.message : String(cause))
    );
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ThemedText>{t("experienceEdit.hint")}</ThemedText>
        {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
        {!rows ? (
          error ? (
            <Pressable accessibilityRole="button" onPress={reload}>
              <ThemedText>{t("profileEdit.retry")}</ThemedText>
            </Pressable>
          ) : (
            <ActivityIndicator />
          )
        ) : draft ? (
          <>
            {fields.map((field) => (
              <View key={field.key} style={styles.field}>
                <ThemedText>{t(field.label)}</ThemedText>
                <TextInput
                  accessibilityLabel={t(field.label)}
                  value={draft[field.key]}
                  editable={!operation.busy}
                  maxLength={field.limit}
                  multiline={field.key === "description"}
                  placeholder={field.key.endsWith("Time") ? "YYYY-MM-DD" : undefined}
                  placeholderTextColor={theme.textSecondary}
                  onChangeText={(value) =>
                    setDraft((current) => current && { ...current, [field.key]: value })
                  }
                  style={[
                    styles.input,
                    {
                      color: theme.text,
                      borderColor: theme.border,
                      backgroundColor: theme.backgroundElement,
                    },
                  ]}
                />
              </View>
            ))}
            <Pressable
              accessibilityRole="button"
              disabled={operation.busy || !draft.title.trim()}
              onPress={() => void mutate(() => saveExperience(draft))}
            >
              <ThemedText>{t("profileEdit.save")}</ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={operation.busy}
              onPress={() => {
                setDraft(undefined);
                setError(undefined);
              }}
            >
              <ThemedText>{t("experienceEdit.cancel")}</ThemedText>
            </Pressable>
          </>
        ) : (
          <>
            {!rows.length && <ThemedText>{t("experienceEdit.empty")}</ThemedText>}
            {rows.map((row, index) => (
              <View key={`${row.id ?? "row"}-${index}`} style={styles.field}>
                <ThemedText type="smallBold">{row.title || row.organization}</ThemedText>
                {!!row.organization && <ThemedText>{row.organization}</ThemedText>}
                {row.id !== undefined && (
                  <View style={styles.actions}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={operation.busy || !!removal}
                      onPress={() => {
                        setDraft({ ...row });
                        setError(undefined);
                      }}
                    >
                      <ThemedText>{t("experienceEdit.edit")}</ThemedText>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={operation.busy || !!removal}
                      onPress={() => {
                        setRemoval(row);
                        setError(undefined);
                      }}
                    >
                      <ThemedText>{t("experienceEdit.delete")}</ThemedText>
                    </Pressable>
                  </View>
                )}
              </View>
            ))}
            {removal ? (
              <View style={styles.field}>
                <ThemedText>
                  {t("experienceEdit.deleteConfirm")} {removal.title}
                </ThemedText>
                <Pressable
                  accessibilityRole="button"
                  disabled={operation.busy}
                  onPress={() => void mutate(() => deleteExperience(removal.id!))}
                >
                  <ThemedText>{t("experienceEdit.confirmDelete")}</ThemedText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={operation.busy}
                  onPress={() => setRemoval(undefined)}
                >
                  <ThemedText>{t("experienceEdit.cancel")}</ThemedText>
                </Pressable>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                disabled={operation.busy}
                onPress={() => {
                  setDraft({ ...empty });
                  setError(undefined);
                }}
              >
                <ThemedText type="smallBold">{t("experienceEdit.add")}</ThemedText>
              </Pressable>
            )}
          </>
        )}
        {operation.busy && <ActivityIndicator />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.four },
  field: { gap: Spacing.two },
  actions: { flexDirection: "row", gap: Spacing.four },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 8, padding: Spacing.three, fontSize: 16 },
});
