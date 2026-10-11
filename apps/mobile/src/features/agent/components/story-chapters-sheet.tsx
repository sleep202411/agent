import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { uuid } from "expo-modules-core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { z } from "zod";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { durableRecord } from "@/lib/durable-record";
import { getAuthGeneration } from "@/auth/auth-store";
import { storyChapters, type ChapterScope, type ChapterCommand } from "../api/story-chapters-api";
const formSchema = z.object({
  title: z.string(),
  chapterId: z.string().uuid().optional(),
  base: z.number().int().nonnegative(),
});
type Form = z.infer<typeof formSchema>;
type Client = ReturnType<typeof storyChapters>;
type State = Awaited<ReturnType<Client["load"]>>;
export function StoryChaptersSheet(props: {
  scope: ChapterScope;
  userId: string;
  activeChapterId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <Modal visible animationType="slide" onRequestClose={props.onClose}>
      <Session key={JSON.stringify(props.scope)} {...props} />
    </Modal>
  );
}
function Session({
  scope,
  userId,
  activeChapterId,
  onClose,
  onChanged,
}: {
  scope: ChapterScope;
  userId: string;
  activeChapterId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets(),
    router = useRouter();
  const client = useMemo(() => storyChapters(scope, userId), [scope, userId]);
  const record = useMemo(
    () => durableRecord("story-chapter-form", userId, scope.projectId),
    [scope.projectId, userId]
  );
  const [state, setState] = useState<State>(),
    [form, setForm] = useState<Form>(),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(true),
    [revision, setRevision] = useState(0);
  const life = useRef<AbortController | null>(null);
  const current = () =>
    !!life.current && !life.current.signal.aborted && scope.generation === getAuthGeneration();
  const loaded = useEffectEvent((next: State) => {
    if (!next.chapters.some((chapter) => chapter.id === activeChapterId)) {
      router.setParams({ chapterId: next.chapters[0]!.id });
      onChanged();
    } else if (next.reconciled) onChanged();
  });
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    let cancelled = false;
    let previous: ChapterCommand | null = null;
    void Promise.resolve()
      .then(() => {
        previous = client.pending() ?? null;
        return client.load(controller.signal);
      })
      .then((next) => {
        if (cancelled || controller.signal.aborted || scope.generation !== getAuthGeneration())
          return;
        const raw = record.read();
        let draft = raw && raw !== "null" ? formSchema.parse(JSON.parse(raw)) : undefined;
        if (
          next.reconciled &&
          previous?.kind === "rename" &&
          draft?.chapterId === previous.chapterId &&
          draft.title.trim() === previous.title
        ) {
          record.write("null");
          draft = undefined;
        }
        setState(next);
        setForm(draft);
        setError(undefined);
        loaded(next);
      })
      .catch((e) => {
        if (!cancelled && !controller.signal.aborted)
          setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled && !controller.signal.aborted) setBusy(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, record, revision, scope.generation]);
  const reload = () => {
    setBusy(true);
    setState(undefined);
    setRevision((v) => v + 1);
  };
  const editable = !!state?.project.capabilities.includes("story.edit") && !busy && !state.pending;
  const updateForm = (next: Form | undefined) => {
    try {
      record.write(next ? JSON.stringify(next) : "null");
      setForm(next);
      setError(undefined);
    } catch (e) {
      setError(String(e));
    }
  };
  const select = (chapterId: string) => {
    if (!current() || busy) return;
    router.setParams({ chapterId });
    onChanged();
    onClose();
  };
  const run = async (command: ChapterCommand) => {
    if (busy || !current()) return;
    setBusy(true);
    try {
      const result = await client.save(command, life.current!.signal);
      if (!current()) return;
      const next = { ...result.state, pending: null, reconciled: false };
      setState(next);
      setError(undefined);
      if (command.kind === "create" || command.kind === "rename") updateForm(undefined);
      onChanged();
      if (result.chapterId) {
        router.setParams({ chapterId: result.chapterId });
        onClose();
      } else if (command.kind === "archive" && command.chapterId === activeChapterId) {
        router.setParams({ chapterId: result.state.chapters[0]!.id });
        onClose();
      }
    } catch (e) {
      if (current()) {
        setError(e instanceof Error ? e.message : String(e));
        setState((s) => (s ? { ...s, pending: client.pending() } : s));
      }
    } finally {
      if (current()) setBusy(false);
    }
  };
  const discard = () =>
    Alert.alert(t("storyChapters.discard"), t("storyChapters.discardHelp"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("storyChapters.discard"),
        style: "destructive",
        onPress: () => {
          if (busy || !current()) return;
          try {
            const p = client.pending();
            if (p) client.discard(p.clientKey);
            updateForm(undefined);
            reload();
          } catch (e) {
            setError(String(e));
          }
        },
      },
    ]);
  return (
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
        <ThemedText type="smallBold">{t("storyChapters.title")}</ThemedText>
        <Button
          label={t("agent.close")}
          onPress={() => {
            onChanged();
            onClose();
          }}
        />
        {busy ? <ActivityIndicator /> : null}
        {error ? (
          <>
            <ThemedText accessibilityRole="alert">{error}</ThemedText>
            {!state ? (
              <Button label={t("storyChapters.discard")} disabled={busy} onPress={discard} />
            ) : null}
          </>
        ) : null}
        <Button label={t("common.retry")} disabled={busy} onPress={reload} />
        {state?.pending ? (
          <>
            <ThemedText accessibilityRole="alert">
              {t(
                state.pending.kind === "create"
                  ? "storyChapters.unknownCreate"
                  : "storyChapters.pending"
              )}
            </ThemedText>
            {state.pending.kind !== "create" ? (
              <Button
                label={t("storyLibrary.retrySave")}
                disabled={busy}
                onPress={() => void run(state.pending!)}
              />
            ) : null}
            <Button label={t("storyChapters.discard")} disabled={busy} onPress={discard} />
          </>
        ) : null}
        {state?.chapters.map((chapter, index) => (
          <View
            key={chapter.id}
            style={{
              gap: 6,
              padding: 10,
              borderWidth: 1,
              borderRadius: 8,
              borderColor: chapter.id === activeChapterId ? theme.brand : theme.border,
            }}
          >
            <Button
              label={`${index + 1}. ${chapter.title}`}
              disabled={busy}
              onPress={() => select(chapter.id)}
            />
            {state.pending?.kind === "create" &&
            chapter.title === state.pending.title &&
            !state.pending.previousIds.includes(chapter.id) ? (
              <Button
                label={t("storyChapters.useExisting")}
                disabled={busy}
                onPress={() => {
                  setBusy(true);
                  void client
                    .selectCreated(chapter.id, life.current!.signal)
                    .then(() => {
                      if (current()) {
                        updateForm(undefined);
                        router.setParams({ chapterId: chapter.id });
                        onChanged();
                        onClose();
                      }
                    })
                    .catch((e) => {
                      if (current()) setError(String(e));
                    })
                    .finally(() => {
                      if (current()) setBusy(false);
                    });
                }}
              />
            ) : null}
            {state.project.capabilities.includes("story.edit") ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16 }}>
                <Button
                  label={t("storyChapters.rename")}
                  disabled={!editable || !!form}
                  onPress={() =>
                    updateForm({
                      title: chapter.title,
                      chapterId: chapter.id,
                      base: state.project.projectVersion,
                    })
                  }
                />
                <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
                  {([-1, 1] as const).map((direction) => (
                    <Button
                      key={direction}
                      label={t(direction < 0 ? "storyChapters.up" : "storyChapters.down")}
                      disabled={
                        !editable ||
                        !!form ||
                        index + direction < 0 ||
                        index + direction >= state.chapters.length
                      }
                      onPress={() => {
                        const chapterIds = state.chapters.map((c) => c.id);
                        [chapterIds[index], chapterIds[index + direction]] = [
                          chapterIds[index + direction]!,
                          chapterIds[index]!,
                        ];
                        void run({
                          kind: "order",
                          clientKey: uuid.v4(),
                          expectedProjectVersion: state.project.projectVersion,
                          chapterIds,
                        });
                      }}
                    />
                  ))}
                </View>
                <Button
                  label={t("storyChapters.archive")}
                  disabled={
                    !editable || !!form || chapter.nodeCount > 0 || state.chapters.length === 1
                  }
                  onPress={() =>
                    Alert.alert(t("storyChapters.archive"), t("storyChapters.archiveHelp"), [
                      { text: t("common.cancel"), style: "cancel" },
                      {
                        text: t("storyChapters.archive"),
                        style: "destructive",
                        onPress: () =>
                          void run({
                            kind: "archive",
                            clientKey: uuid.v4(),
                            chapterId: chapter.id,
                            expectedProjectVersion: state.project.projectVersion,
                          }),
                      },
                    ])
                  }
                />
              </View>
            ) : null}
          </View>
        ))}
        {state?.project.capabilities.includes("story.edit") ? (
          <>
            <Button
              label={t("storyChapters.create")}
              disabled={!editable || !!form || state.chapters.length >= 200}
              onPress={() => updateForm({ title: "", base: state.project.projectVersion })}
            />
            {form ? (
              <>
                <TextInput
                  accessibilityLabel={t("storyChapters.name")}
                  value={form.title}
                  maxLength={160}
                  editable={editable}
                  onChangeText={(title) => updateForm({ ...form, title })}
                  style={{
                    color: theme.text,
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 8,
                    padding: 10,
                    minHeight: 44,
                  }}
                />
                {form.base !== state.project.projectVersion ? (
                  <ThemedText accessibilityRole="alert">{t("storyLibrary.conflict")}</ThemedText>
                ) : null}
                <Button
                  label={t("documentEditor.save")}
                  disabled={
                    !editable || !form.title.trim() || form.base !== state.project.projectVersion
                  }
                  onPress={() =>
                    void run(
                      form.chapterId
                        ? {
                            kind: "rename",
                            clientKey: uuid.v4(),
                            chapterId: form.chapterId,
                            title: form.title,
                            expectedProjectVersion: form.base,
                          }
                        : {
                            kind: "create",
                            clientKey: uuid.v4(),
                            title: form.title,
                            expectedProjectVersion: form.base,
                            previousIds: state.chapters.map((c) => c.id),
                          }
                    )
                  }
                />
                <Button label={t("storyChapters.discard")} disabled={busy} onPress={discard} />
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
function Button({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: 44, justifyContent: "center", opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}
