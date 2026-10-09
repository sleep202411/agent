import { toHref } from "@/lib/navigation";
import { Stack, useIsFocused, useRouter } from "expo-router";
import { useEffect, useEffectEvent, useState, useLayoutEffect, useRef } from "react";
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
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { profileDraft, updateProfile, type ProfileDraft } from "@/features/profile/api";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations, type MessageKey } from "@/i18n";

import {
  AvatarValidationError,
  pickAndUploadProfileImage,
  type ProfileImageKind,
} from "@/features/profile/avatar-upload";

import { EducationEditor } from "@/features/profile/education-editor";

const fields: { key: keyof ProfileDraft; label: MessageKey; multiline?: boolean }[] = [
  { key: "nickName", label: "profileEdit.nickname" },
  { key: "contact", label: "profileEdit.contact" },
  { key: "description", label: "profileEdit.bio", multiline: true },
  { key: "other", label: "profileEdit.other", multiline: true },
];
export default function ProfileEditScreen() {
  const auth = useAuth();
  const t = useTranslations();
  const theme = useTheme();
  useLoginGateOnFocus();
  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("profileEdit.title"),
          headerBackButtonDisplayMode: "minimal",
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
          headerShadowVisible: false,
        }}
      />
      {auth.status === "authenticated" ? (
        <ProfileForm key={JSON.stringify([auth.generation, auth.user?.id ?? auth.user?.userId])} />
      ) : (
        <ActivityIndicator />
      )}
    </View>
  );
}
function ProfileForm() {
  const auth = useAuth();
  const focused = useIsFocused();
  const router = useRouter();
  const t = useTranslations();
  const theme = useTheme();
  const operation = useAuthFormOperation("profile-edit", focused);
  const [draft, setDraft] = useState<ProfileDraft>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [originalStudy, setOriginalStudy] = useState("");
  const [editedStudy, setEditedStudy] = useState<string>();
  const refresh = auth.refreshCurrentUser;
  const uploadScope = useRef<AbortController | null>(null);
  const [updatedImage, setUpdatedImage] = useState<ProfileImageKind>();
  useLayoutEffect(() => {
    const scope = new AbortController();
    uploadScope.current = focused ? scope : null;
    return () => {
      scope.abort();
      uploadScope.current = null;
    };
  }, [focused]);
  const changeProfileImage = async (kind: ProfileImageKind = "avatar") => {
    const scope = uploadScope.current;
    if (!scope) return;
    const generation = getAuthGeneration();
    const current = () => !scope.signal.aborted && getAuthGeneration() === generation;
    await operation.run(
      async () => {
        setError(undefined);
        setUpdatedImage(undefined);
        const uploaded = await pickAndUploadProfileImage(current, scope.signal, kind);
        if (uploaded && current()) await refresh();
        return uploaded;
      },
      (uploaded) => setUpdatedImage(uploaded ? kind : undefined),
      (cause) => {
        setError(
          cause instanceof AvatarValidationError
            ? t(kind === "banner" ? "profileEdit.bannerInvalid" : "profileEdit.avatarInvalid")
            : cause instanceof Error
              ? cause.message
              : t("profileEdit.failed")
        );
      }
    );
  };
  const loadFailed = useEffectEvent((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : t("profileEdit.failed"));
  });
  useEffect(() => {
    let active = true;
    void refresh()
      .then((user) => {
        if (!active) return;
        if (!user) {
          loadFailed(undefined);
          return;
        }
        setDraft(profileDraft(user));
        setOriginalStudy("study" in user && typeof user.study === "string" ? user.study : "");
      })
      .catch((cause: unknown) => {
        if (active) loadFailed(cause);
      });
    return () => {
      active = false;
    };
  }, [refresh, attempt]);
  const save = async () => {
    if (!draft?.nickName.trim()) return;
    const generation = getAuthGeneration();
    await operation.run(
      async () => {
        setError(undefined);
        await updateProfile(draft, editedStudy);
        if (getAuthGeneration() === generation) await refresh();
      },
      () => router.back(),
      (cause) => setError(cause instanceof Error ? cause.message : t("profileEdit.failed"))
    );
  };
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.root}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {!draft && !error && <ActivityIndicator />}
        {draft && (
          <View style={styles.field}>
            <Pressable
              accessibilityRole="button"
              disabled={operation.busy}
              onPress={() => void changeProfileImage()}
            >
              <ThemedText type="smallBold">{t("profileEdit.avatarChange")}</ThemedText>
            </Pressable>
            <ThemedText>{t("profileEdit.avatarHint")}</ThemedText>
            <Pressable
              accessibilityRole="button"
              disabled={operation.busy}
              onPress={() => void changeProfileImage("banner")}
            >
              <ThemedText type="smallBold">{t("profileEdit.bannerChange")}</ThemedText>
            </Pressable>
            <ThemedText>{t("profileEdit.bannerHint")}</ThemedText>
            {updatedImage && (
              <ThemedText>
                {t(
                  updatedImage === "banner"
                    ? "profileEdit.bannerUpdated"
                    : "profileEdit.avatarUpdated"
                )}
              </ThemedText>
            )}
          </View>
        )}
        {draft &&
          fields.map((field) => (
            <View key={field.key} style={styles.field}>
              <ThemedText type="smallBold">{t(field.label)}</ThemedText>
              <TextInput
                accessibilityLabel={t(field.label)}
                value={draft[field.key]}
                editable={!operation.busy}
                multiline={field.multiline}
                onChangeText={(value) =>
                  setDraft((current) => current && { ...current, [field.key]: value })
                }
                style={[
                  styles.input,
                  field.multiline && styles.multiline,
                  {
                    color: theme.text,
                    borderColor: theme.border,
                    backgroundColor: theme.backgroundElement,
                  },
                ]}
              />
            </View>
          ))}
        {draft && (
          <EducationEditor
            study={originalStudy}
            disabled={operation.busy}
            onChange={setEditedStudy}
          />
        )}
        {draft && (
          <Pressable
            accessibilityRole="button"
            disabled={operation.busy}
            onPress={() => router.push(toHref("/profile-experience"))}
          >
            <ThemedText type="smallBold">{t("experienceEdit.manage")}</ThemedText>
          </Pressable>
        )}
        {!!error && (
          <ThemedText accessibilityRole="alert" style={{ color: theme.brand }}>
            {error}
          </ThemedText>
        )}
        {!draft && error ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setError(undefined);
              setAttempt((n) => n + 1);
            }}
          >
            <ThemedText>{t("profileEdit.retry")}</ThemedText>
          </Pressable>
        ) : null}
        {draft && (
          <Pressable
            accessibilityRole="button"
            disabled={operation.busy || !draft.nickName.trim()}
            onPress={() => void save()}
            style={[
              styles.button,
              {
                backgroundColor:
                  operation.busy || !draft.nickName.trim() ? theme.backgroundSelected : theme.brand,
              },
            ]}
          >
            {operation.busy && <ActivityIndicator color="#FFFFFF" />}
            <ThemedText type="smallBold" style={styles.buttonText}>
              {t("profileEdit.save")}
            </ThemedText>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.four },
  field: { gap: Spacing.two },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    minHeight: 48,
    fontSize: 16,
  },
  multiline: { minHeight: 100, textAlignVertical: "top" },
  button: {
    minHeight: 48,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
  },
  buttonText: { color: "#FFFFFF" },
});
