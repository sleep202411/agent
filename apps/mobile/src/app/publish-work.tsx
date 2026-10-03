import { workDraft, type WorkDraft } from "@/features/profile/work-draft";
import { inquiryKey } from "@/features/services/inquiry-api";
import { findMyWork, type MyWork } from "@/data/mine-api";
import { Stack, useIsFocused, useRouter, useLocalSearchParams } from "expo-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { useAuth, useAuthGate, useLoginGateOnFocus } from "@/auth";
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
import { WorkCreationRecovery } from "@/features/profile/work-creation-recovery";
export default function PublishWorkScreen() {
  const auth = useAuth(),
    gate = useAuthGate(),
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
      ) : auth.status === "hydrating" ? (
        <ActivityIndicator />
      ) : (
        <Pressable
          accessibilityRole="button"
          style={{ padding: 16 }}
          onPress={() => gate.requireAuth()}
        >
          <ThemedText>{t("login.signIn")}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}
function OwnedWorkForm({ workId }: { workId?: string }) {
  const t = useTranslations(),
    auth = useAuth();
  const [store] = useState(() =>
    workDraft(String(auth.user?.userId ?? auth.user?.id ?? ""), auth.generation, workId)
  );
  const [recovery, setRecovery] = useState(() => {
    try {
      return { draft: store.read(), error: undefined };
    } catch (cause) {
      return { draft: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  });
  const resolvedId = workId ?? recovery.draft?.workId;
  const [work, setWork] = useState<MyWork>();
  const [failed, setFailed] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!resolvedId || recovery.error) return;
    const controller = new AbortController();
    void findMyWork(resolvedId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setWork(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setFailed(
            cause instanceof Error && cause.message ? cause.message : t("publishWork.loadFailed")
          );
      });
    return () => controller.abort();
  }, [resolvedId, recovery.error, attempt, t]);
  if (recovery.error) return <ThemedText accessibilityRole="alert">{recovery.error}</ThemedText>;
  const onRecovered = (draft: WorkDraft, owned: MyWork) => {
    setWork(owned);
    setRecovery({ draft, error: undefined });
  };
  if (!resolvedId)
    return <PublishForm store={store} recovered={recovery.draft} onRecovered={onRecovered} />;
  if (work?.id === resolvedId)
    return (
      <PublishForm
        key={work.id}
        initial={work}
        store={store}
        recovered={recovery.draft}
        onRecovered={onRecovered}
      />
    );
  if (failed)
    return (
      <View style={{ padding: 16 }}>
        <ThemedText accessibilityRole="alert">{failed}</ThemedText>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setFailed(undefined);
            setAttempt((n) => n + 1);
          }}
        >
          <ThemedText>{t("profileEdit.retry")}</ThemedText>
        </Pressable>
      </View>
    );
  return <ActivityIndicator />;
}
function PublishForm({
  initial,
  store,
  recovered,
  onRecovered,
}: {
  initial?: MyWork;
  store: ReturnType<typeof workDraft>;
  recovered: WorkDraft | null;
  onRecovered: (draft: WorkDraft, work: MyWork) => void;
}) {
  const auth = useAuth(),
    theme = useTheme(),
    t = useTranslations(),
    router = useRouter(),
    focused = useIsFocused();
  const op = useAuthFormOperation("publish-work", focused);
  const [title, setTitle] = useState(recovered?.title ?? initial?.title ?? ""),
    [description, setDescription] = useState(recovered?.description ?? initial?.introduction ?? ""),
    [selected, setSelected] = useState<number[]>(recovered?.tagIds ?? []);
  const [tags, setTags] = useState<WorkTag[]>(),
    [tagError, setTagError] = useState<string>(),
    [attempt, setAttempt] = useState(0);
  const [id, setId] = useState<string | undefined>(initial?.id),
    [video, setVideo] = useState(initial?.hasVideo ?? false),
    [cover, setCover] = useState(!!initial?.coverUrl),
    [error, setError] = useState<string>();
  const [basic, setBasic] = useState(recovered?.phase !== "uploading");
  const [pending, setPending] = useState<WorkDraft | null>(recovered);
  const pendingRef = useRef<WorkDraft | null>(recovered);
  const creationUnknown = pending?.phase === "creating";
  const frozen = !!pending || op.busy;
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
      .catch((cause) => {
        if (!controller.signal.aborted)
          setTagError(
            cause instanceof Error && cause.message ? cause.message : t("profileEdit.failed")
          );
      });
    return () => controller.abort();
  }, [attempt, initial, t]);
  const next = () => {
    const request = scope.current;
    if (!request) return;
    void op.run(
      async () => {
        setError(undefined);
        if (pendingRef.current?.phase === "creating")
          throw new Error(t("publishWork.creationUnknown"));
        const draft =
          pendingRef.current ??
          store.start({
            key: inquiryKey(),
            phase: initial ? "updating" : "creating",
            ...(initial ? { workId: initial.id } : {}),
            title,
            description,
            tagIds: selected,
          });
        pendingRef.current = draft;
        setPending(draft);
        let workId: string;
        if (draft.workId) {
          await updateWork(draft.workId, draft.title, draft.description, request.signal);
          workId = draft.workId;
        } else {
          workId = await createWork(
            { title: draft.title, description: draft.description, tagIds: draft.tagIds },
            request.signal
          );
        }
        const saved = store.confirm(draft.key, workId);
        pendingRef.current = saved;
        setPending(saved);
        return workId;
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
            editable={!frozen}
            maxLength={80}
            style={fieldStyle}
          />
          <ThemedText>{t("publishWork.description")}</ThemedText>
          <TextInput
            accessibilityLabel={t("publishWork.description")}
            value={description}
            onChangeText={setDescription}
            editable={!frozen}
            multiline
            maxLength={500}
            style={fieldStyle}
          />
          {!initial && (
            <>
              <ThemedText>{t("publishWork.tags")}</ThemedText>
              {tagError ? (
                <View style={{ gap: 8 }}>
                  <ThemedText accessibilityRole="alert">{tagError}</ThemedText>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setTagError(undefined);
                      setAttempt((n) => n + 1);
                    }}
                  >
                    <ThemedText>{t("profileEdit.retry")}</ThemedText>
                  </Pressable>
                </View>
              ) : !tags ? (
                <ActivityIndicator />
              ) : (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {tags.map((tag) => (
                    <Pressable
                      key={tag.id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected.includes(tag.id) }}
                      disabled={frozen || (!selected.includes(tag.id) && selected.length >= 5)}
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
              op.busy ||
              creationUnknown ||
              !title.trim() ||
              !description.trim() ||
              (!initial && !selected.length)
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
            onPress={() => {
              try {
                if (pendingRef.current) store.clear(pendingRef.current.key);
                router.back();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
              }
            }}
          >
            <ThemedText>{t("publishWork.done")}</ThemedText>
          </Pressable>
        </>
      )}
      {creationUnknown && !op.busy && (
        <>
          <ThemedText accessibilityRole="alert">{t("publishWork.creationUnknown")}</ThemedText>
          <WorkCreationRecovery
            owner={JSON.stringify([auth.generation, auth.user?.userId ?? auth.user?.id])}
            onSelect={(workId) => {
              const request = scope.current;
              const draft = pendingRef.current;
              if (!request || draft?.phase !== "creating") return;
              void op.run(
                () => findMyWork(workId, request.signal),
                (owned) => {
                  const saved = store.confirm(draft.key, owned.id);
                  onRecovered(saved, owned);
                },
                (cause) => setError(cause instanceof Error ? cause.message : String(cause))
              );
            }}
          />
        </>
      )}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {op.busy && <ActivityIndicator />}
    </ScrollView>
  );
}
