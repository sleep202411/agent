import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, TextInput, View } from "react-native";
import { uuid } from "expo-modules-core";
import { z } from "zod";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord } from "@/lib/durable-record";
import { ThemedText } from "@/components/themed-text";
import {
  storyLibraryActions,
  canMoveToWorkspace,
  type StoryLibraryScope,
  type StoryLibraryProject,
  type StoryLibraryCommand,
} from "../api/story-library-actions";
const formSchema = z.object({
  base: z.number().int().nonnegative(),
  title: z.string(),
  summary: z.string(),
});
type Form = z.infer<typeof formSchema>;
const fromProject = (p: StoryLibraryProject): Form => ({
  base: p.projectVersion,
  title: p.title,
  summary: p.summary ?? "",
});
const fields = (f: Form) => ({ title: f.title.trim(), summary: f.summary.trim() || null });
export function StoryLibraryEditor({
  scope,
  userId,
  onClose,
  onSaved,
  workspaces = [],
}: {
  scope: StoryLibraryScope;
  userId: string;
  onClose: () => void;
  onSaved: (archived: boolean, workspaceId?: string) => void;
  workspaces?: { id: string; name: string; role?: string; accessScope?: string; status?: string }[];
}) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const client = useMemo(() => storyLibraryActions(scope, userId), [scope, userId]),
    record = useMemo(
      () => durableRecord("story-library-form", userId, scope.projectId),
      [scope.projectId, userId]
    );
  const [moving, setMoving] = useState(false),
    [destination, setDestination] = useState("");
  const [project, setProject] = useState<StoryLibraryProject>(),
    [form, setForm] = useState<Form>(),
    [pending, setPending] = useState<StoryLibraryCommand | null>(null),
    [error, setError] = useState<string>(),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const life = useRef<AbortController | null>(null),
    lock = useRef(false),
    notifySaved = useEffectEvent(onSaved);
  const current = () =>
    !!life.current && !life.current.signal.aborted && scope.generation === getAuthGeneration();
  useEffect(() => {
    const c = new AbortController();
    life.current = c;
    const alive = () => !c.signal.aborted && scope.generation === getAuthGeneration();
    void (async () => {
      try {
        const result = await client.load(c.signal);
        if (!alive()) return;
        setProject(result.project);
        setPending(result.pending ?? null);
        const raw = record.read();
        let draft =
          raw && raw !== "null" ? formSchema.parse(JSON.parse(raw)) : fromProject(result.project);
        if (
          result.applied &&
          draft.base < result.project.projectVersion &&
          JSON.stringify(fields(draft)) ===
            JSON.stringify({ title: result.project.title, summary: result.project.summary })
        ) {
          record.write("null");
          draft = fromProject(result.project);
        }
        setForm(draft);
        setError(undefined);
        if (result.applied)
          notifySaved(result.project.status === "archived", result.movedWorkspaceId);
      } catch (e) {
        if (alive()) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive()) setLoading(false);
      }
    })();
    return () => c.abort();
  }, [client, record, scope, revision]);
  const reload = () => {
    setLoading(true);
    setProject(undefined);
    setForm(undefined);
    setRevision((v) => v + 1);
  };
  const conflict = !!form && !!project && form.base !== project.projectVersion;
  const editable =
    project?.status === "active" &&
    project.capabilities.includes("story.edit") &&
    !loading &&
    !busy &&
    !pending &&
    !conflict;
  const dirty =
    !!form &&
    !!project &&
    (form.title !== project.title || form.summary !== (project.summary ?? ""));
  const change = (key: "title" | "summary", value: string) => {
    if (!form || !editable || !current()) return;
    try {
      const next = { ...form, [key]: value };
      record.write(JSON.stringify(next));
      setForm(next);
      setError(undefined);
    } catch (e) {
      setError(String(e));
    }
  };
  const save = async (command: StoryLibraryCommand) => {
    if (!current() || lock.current || loading) return;
    lock.current = true;
    setBusy(true);
    try {
      const result = await client.save(command, life.current!.signal);
      if (!current()) return;
      record.write("null");
      setProject(result);
      setForm(fromProject(result));
      setPending(null);
      setError(undefined);
      onSaved(
        result.status === "archived",
        command.kind === "move" ? result.workspaceId : undefined
      );
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (current()) {
        try {
          setPending(client.read() ?? null);
        } catch (e) {
          setError(String(e));
        }
        setBusy(false);
      }
      lock.current = false;
    }
  };
  const reset = () =>
    Alert.alert(t("storyLibrary.discard"), t("storyLibrary.discardHelp"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("storyLibrary.discard"),
        style: "destructive",
        onPress: () => {
          if (!current() || lock.current) return;
          try {
            if (pending) client.discard(pending.clientKey);
            record.write("null");
            setPending(null);
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
        <ThemedText type="smallBold">{t("storyLibrary.title")}</ThemedText>
        <Action label={t("agent.close")} onPress={onClose} />
        {loading || busy ? <ActivityIndicator /> : null}
        {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
        <Action label={t("common.retry")} onPress={reload} disabled={loading || busy} />
        {project && form ? (
          <>
            {(["title", "summary"] as const).map((key) => (
              <View key={key} style={{ gap: 6 }}>
                <ThemedText type="smallBold">{t(`storyLibrary.${key}Field`)}</ThemedText>
                <TextInput
                  accessibilityLabel={t(`storyLibrary.${key}Field`)}
                  value={form[key]}
                  editable={!!editable}
                  maxLength={key === "title" ? 160 : 2000}
                  multiline={key === "summary"}
                  onChangeText={(text) => change(key, text)}
                  style={{
                    color: theme.text,
                    borderColor: theme.border,
                    borderWidth: 1,
                    borderRadius: 8,
                    padding: 10,
                    minHeight: key === "summary" ? 120 : 44,
                    textAlignVertical: "top",
                  }}
                />
              </View>
            ))}
            {conflict ? (
              <ThemedText accessibilityRole="alert">{t("storyLibrary.conflict")}</ThemedText>
            ) : null}
            {pending ? (
              <>
                <ThemedText accessibilityRole="alert">{t("storyLibrary.pending")}</ThemedText>
                <Action
                  label={t("storyLibrary.retrySave")}
                  onPress={() => void save(pending)}
                  disabled={busy || loading || conflict}
                />
              </>
            ) : null}
            {!project.capabilities.includes("story.edit") ? (
              <ThemedText>{t("storyRepair.readOnly")}</ThemedText>
            ) : null}
            <Action
              label={t("documentEditor.save")}
              disabled={!editable || !dirty || !form.title.trim()}
              onPress={() =>
                void save({
                  kind: "edit",
                  clientKey: uuid.v4(),
                  expectedProjectVersion: form.base,
                  fields: fields(form),
                })
              }
            />
            {project.canMove && project.workspaceId ? (
              <View style={{ gap: 8 }}>
                <Action
                  label={t("storyMove.title")}
                  onPress={() => setMoving(!moving)}
                  disabled={
                    busy || loading || !!pending || dirty || conflict || project.status !== "active"
                  }
                />
                {moving ? (
                  <>
                    <ThemedText type="small">{t("storyMove.help")}</ThemedText>
                    {workspaces
                      .filter((w) => canMoveToWorkspace(w, project.workspaceId))
                      .map((w) => (
                        <Pressable
                          key={w.id}
                          accessibilityRole="radio"
                          accessibilityLabel={w.name}
                          accessibilityState={{
                            checked: destination === w.id,
                            disabled: busy || !!pending || dirty || conflict,
                          }}
                          disabled={busy || !!pending || dirty || conflict}
                          onPress={() => setDestination(w.id)}
                          style={{
                            minHeight: 44,
                            padding: 10,
                            borderWidth: 1,
                            borderRadius: 8,
                            borderColor: destination === w.id ? theme.brand : theme.border,
                          }}
                        >
                          <ThemedText type="small">{w.name}</ThemedText>
                        </Pressable>
                      ))}
                    {!workspaces.some((w) => canMoveToWorkspace(w, project.workspaceId)) ? (
                      <ThemedText type="small">{t("storyMove.empty")}</ThemedText>
                    ) : null}
                    <Action
                      label={t("storyMove.confirm")}
                      disabled={
                        busy ||
                        loading ||
                        !!pending ||
                        dirty ||
                        conflict ||
                        !workspaces.some(
                          (w) => w.id === destination && canMoveToWorkspace(w, project.workspaceId)
                        )
                      }
                      onPress={() =>
                        Alert.alert(
                          t("storyMove.title"),
                          t("storyMove.confirmHelp").replace(
                            "{workspace}",
                            workspaces.find((w) => w.id === destination)?.name ?? ""
                          ),
                          [
                            { text: t("common.cancel"), style: "cancel" },
                            {
                              text: t("storyMove.confirm"),
                              onPress: () =>
                                void save({
                                  kind: "move",
                                  clientKey: uuid.v4(),
                                  expectedWorkspaceId: project.workspaceId!,
                                  targetWorkspaceId: destination,
                                  expectedProjectVersion: project.projectVersion,
                                }),
                            },
                          ]
                        )
                      }
                    />
                  </>
                ) : null}
              </View>
            ) : null}
            {project.capabilities.includes("story.admin") ? (
              <>
                <ThemedText type="small">{t("storyLibrary.archiveHelp")}</ThemedText>
                <Action
                  label={t("storyLibrary.archive")}
                  disabled={
                    busy || loading || !!pending || dirty || conflict || project.status !== "active"
                  }
                  onPress={() =>
                    Alert.alert(
                      t("storyLibrary.archive"),
                      t("storyLibrary.confirmArchive").replace("{title}", project.title),
                      [
                        { text: t("common.cancel"), style: "cancel" },
                        {
                          text: t("storyLibrary.archive"),
                          style: "destructive",
                          onPress: () =>
                            void save({
                              kind: "archive",
                              clientKey: uuid.v4(),
                              expectedProjectVersion: project.projectVersion,
                            }),
                        },
                      ]
                    )
                  }
                />
              </>
            ) : null}
          </>
        ) : null}
        {dirty || pending || conflict || (!form && !loading) ? (
          <Action label={t("storyLibrary.discard")} onPress={reset} disabled={busy || loading} />
        ) : null}
      </ScrollView>
    </View>
  );
}
function Action({
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
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}
