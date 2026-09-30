import { findMyWork, type MyWork } from "@/data/mine-api";
import { Stack, useIsFocused, useRouter, useLocalSearchParams } from "expo-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { useAuth, useLoginGateOnFocus } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import {
  createWork,
  updateWork,
  getWorkTags,
  pickWorkFile,
  uploadWorkFile,
  type WorkTag,
} from "@/features/profile/publish-work-api";
import { refreshPersonalWorks } from "@/features/profile/work-refresh";
export default function PublishWorkScreen() {
  const auth = useAuth(),
    theme = useTheme(),
    t = useTranslations();
  useLoginGateOnFocus();
  const { workId } = useLocalSearchParams<{ workId?: string }>();
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("publishWork.title"),
          headerTintColor: theme.text,
          headerStyle: { backgroundColor: theme.background },
        }}
      />
      {auth.status === "authenticated" ? (
        <OwnedWorkForm
          key={JSON.stringify([auth.generation, workId])}
          workId={typeof workId === "string" ? workId : undefined}
        />
      ) : (
        <ActivityIndicator />
      )}
    </View>
  );
}
function OwnedWorkForm({ workId }: { workId?: string }) {
  const t = useTranslations();
  const [work, setWork] = useState<MyWork>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!workId) return;
    const controller = new AbortController();
    void findMyWork(workId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setWork(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [workId, attempt]);
  if (!workId) return <PublishForm />;
  if (work) return <PublishForm initial={work} />;
  if (failed)
    return (
      <View style={{ padding: 16 }}>
        <ThemedText accessibilityRole="alert">{t("publishWork.loadFailed")}</ThemedText>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setFailed(false);
            setAttempt((n) => n + 1);
          }}
        >
          <ThemedText>{t("profileEdit.retry")}</ThemedText>
        </Pressable>
      </View>
    );
  return <ActivityIndicator />;
}
function PublishForm({ initial }: { initial?: MyWork }) {
  const auth = useAuth(),
    theme = useTheme(),
    t = useTranslations(),
    router = useRouter(),
    focused = useIsFocused();
  const op = useAuthFormOperation("publish-work", focused);
  const [title, setTitle] = useState(initial?.title ?? ""),
    [description, setDescription] = useState(initial?.introduction ?? ""),
    [selected, setSelected] = useState<number[]>([]);
  const [tags, setTags] = useState<WorkTag[]>(),
    [tagError, setTagError] = useState(false),
    [attempt, setAttempt] = useState(0);
  const [id, setId] = useState<string | undefined>(initial?.id),
    [video, setVideo] = useState(initial?.hasVideo ?? false),
    [cover, setCover] = useState(!!initial?.coverUrl),
    [error, setError] = useState<string>();
  const [basic, setBasic] = useState(true);
  const scope = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    const controller = new AbortController();
    scope.current = focused ? controller : null;
    return () => {
      controller.abort();
      scope.current = null;
    };
  }, [focused]);
  useEffect(() => {
    if (initial) return;
    const controller = new AbortController();
    void getWorkTags(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setTags(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setTagError(true);
      });
    return () => controller.abort();
  }, [attempt, initial]);
  const next = () => {
    const request = scope.current;
    if (!request) return;
    void op.run(
      async () => {
        setError(undefined);
        if (initial) {
          await updateWork(initial.id, title, description, request.signal);
          return initial.id;
        }
        return createWork({ title, description, tagIds: selected }, request.signal);
      },
      (value) => {
        setId(value);
        setBasic(false);
        refreshPersonalWorks();
      },
      (cause) => setError(cause instanceof Error ? cause.message : t("profileEdit.failed"))
    );
  };
  const upload = (kind: "cover" | "video") => {
    const request = scope.current;
    if (!request || !id) return;
    const generation = getAuthGeneration();
    const current = () => !request.signal.aborted && generation === getAuthGeneration();
    void op.run(
      async () => {
        setError(undefined);
        const file = await pickWorkFile(kind);
        if (!file || !current()) return false;
        await uploadWorkFile(id, kind, file, auth.session?.token?.tokenValue ?? "", request.signal);
        return true;
      },
      (uploaded) => {
        if (uploaded) {
          if (kind === "video") setVideo(true);
          else setCover(true);
          refreshPersonalWorks();
        }
      },
      (cause) => setError(cause instanceof Error ? cause.message : t("profileEdit.failed"))
    );
  };
  const fieldStyle = {
    color: theme.text,
    backgroundColor: theme.backgroundElement,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    minHeight: 48,
  };
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 16 }}
    >
      {basic ? (
        <>
          <ThemedText>{t("publishWork.name")}</ThemedText>
          <TextInput
            accessibilityLabel={t("publishWork.name")}
            value={title}
            onChangeText={setTitle}
            editable={!op.busy}
            maxLength={80}
            style={fieldStyle}
          />
          <ThemedText>{t("publishWork.description")}</ThemedText>
          <TextInput
            accessibilityLabel={t("publishWork.description")}
            value={description}
            onChangeText={setDescription}
            editable={!op.busy}
            multiline
            maxLength={500}
            style={fieldStyle}
          />
          {!initial && (
            <>
              <ThemedText>{t("publishWork.tags")}</ThemedText>
              {tagError ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setTagError(false);
                    setAttempt((n) => n + 1);
                  }}
                >
                  <ThemedText>{t("profileEdit.retry")}</ThemedText>
                </Pressable>
              ) : !tags ? (
                <ActivityIndicator />
              ) : (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {tags.map((tag) => (
                    <Pressable
                      key={tag.id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected.includes(tag.id) }}
                      disabled={op.busy || (!selected.includes(tag.id) && selected.length >= 5)}
                      onPress={() =>
                        setSelected((current) =>
                          current.includes(tag.id)
                            ? current.filter((id) => id !== tag.id)
                            : [...current, tag.id]
                        )
                      }
                      style={{
                        padding: 10,
                        borderRadius: 8,
                        backgroundColor: selected.includes(tag.id)
                          ? theme.brand
                          : theme.backgroundElement,
                      }}
                    >
                      <ThemedText>{tag.name}</ThemedText>
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={
              op.busy || !title.trim() || !description.trim() || (!initial && !selected.length)
            }
            onPress={next}
          >
            <ThemedText>{t("publishWork.next")}</ThemedText>
          </Pressable>
        </>
      ) : (
        <>
          <ThemedText>{title}</ThemedText>
          <ThemedText>{t("publishWork.saved")}</ThemedText>
          <Pressable accessibilityRole="button" disabled={op.busy} onPress={() => upload("cover")}>
            <ThemedText>
              {t("publishWork.cover")}
              {cover ? " ✓" : ""}
            </ThemedText>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={op.busy} onPress={() => upload("video")}>
            <ThemedText>
              {t("publishWork.video")}
              {video ? " ✓" : ""}
            </ThemedText>
          </Pressable>
          <ThemedText>{t("publishWork.limits")}</ThemedText>
          <Pressable
            accessibilityRole="button"
            disabled={op.busy || !video}
            onPress={() => router.back()}
          >
            <ThemedText>{t("publishWork.done")}</ThemedText>
          </Pressable>
        </>
      )}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {op.busy && <ActivityIndicator />}
    </ScrollView>
  );
}
