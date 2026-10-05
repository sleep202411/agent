import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/build/react-navigation/core/usePreventRemove";
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { appEnv } from "@/config/app-env";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { studioInviteTargetUrl } from "./api/studio-invite-accept-api";
import { PlatformCanvasPanel } from "./components/platform-canvas-panel";
import {
  changePlatformSection,
  fetchPlatformSections,
  sectionTitle,
  SectionWriteError,
  type PlatformSections,
  type SectionChange,
} from "./api/platform-sections-api";
type Props = {
  projectId: string;
  workspaceId: string;
  name: string;
  generation: number;
  onClose: () => void;
};
type Review = { snapshot: PlatformSections; change: SectionChange };
export function PlatformProjectSections(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Session key={`${props.projectId}:${props.workspaceId}:${props.generation}`} {...props} />
  ) : null;
}
function Session({ projectId, workspaceId, name, generation, onClose }: Props) {
  const t = useTranslations(),
    theme = useTheme(),
    active = useScreenActive();
  const [revision, setRevision] = useState(0);
  const scope = useMemo(() => ({ revision, active }), [revision, active]);
  const [loaded, setLoaded] = useState<{
    scope: typeof scope;
    data?: PlatformSections;
    error?: string;
  }>();
  const [review, setReview] = useState<Review>();
  const [canvas, setCanvas] = useState<{ id: string; documentId: string; title: string }>();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [uncertainAt, setUncertainAt] = useState<number>();
  const lock = useRef(false),
    alive = useRef(true),
    pending = useRef<AbortController | null>(null);
  const current = () => alive.current && generation === getAuthGeneration();
  const navigation = useNavigation();
  const [leave, setLeave] = useState<{ run: () => void }>();
  const hasEdits =
    !!review &&
    (("title" in review.change && title !== review.change.title) || uncertainAt !== undefined);
  const requestLeave = (run: () => void) => {
    if (!active || !current() || lock.current) return;
    if (hasEdits) setLeave({ run });
    else run();
  };
  usePreventRemove(hasEdits || busy, ({ data }) => {
    if (generation !== getAuthGeneration()) {
      navigation.dispatch(data.action);
      return;
    }
    requestLeave(() => navigation.dispatch(data.action));
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!active) pending.current?.abort();
  }, [active]);
  useEffect(() => {
    if (!active || busy) return;
    const c = new AbortController();
    void fetchPlatformSections(projectId, workspaceId, generation, c.signal).then(
      (data) => {
        if (!c.signal.aborted && !lock.current) setLoaded({ scope, data });
      },
      (e) => {
        if (!c.signal.aborted && !lock.current)
          setLoaded({ scope, error: e instanceof Error ? e.message : String(e) });
      }
    );
    return () => c.abort();
  }, [projectId, workspaceId, generation, scope, active, busy]);
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!lock.current) {
        if (canvas) setCanvas(undefined);
        else requestLeave(review ? () => setReview(undefined) : onClose);
      }
      return true;
    });
    return () => sub.remove();
  });
  const visible = loaded?.scope === scope ? loaded : undefined;
  const data = visible?.data;
  const changed = !!(
    review &&
    data &&
    (review.snapshot.projectVersion !== data.projectVersion ||
      JSON.stringify(review.snapshot.sections) !== JSON.stringify(data.sections))
  );
  const targetExists =
    !review ||
    !("id" in review.change) ||
    !!data?.sections.some((s) => s.id === (review.change as { id: string }).id);
  const locked = busy || uncertainAt !== undefined;
  const canConfirm =
    !!data?.canEdit &&
    !changed &&
    targetExists &&
    !(review?.change.kind === "archive" && data.sections.length === 1);
  async function submit(command: Review) {
    if (locked || lock.current || !current() || !active || !canConfirm) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    const c = new AbortController();
    pending.current = c;
    try {
      const result = await changePlatformSection(
        command.snapshot,
        command.change,
        generation,
        c.signal
      );
      if (current()) {
        setLoaded({ scope, data: result });
        setReview(undefined);
      }
    } catch (e) {
      if (current()) {
        setError(e instanceof Error ? e.message : String(e));
        if (e instanceof SectionWriteError) setUncertainAt(revision);
      }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }
  function start(change: SectionChange) {
    if (!data?.canEdit || locked || !current() || !active) return;
    setTitle("title" in change ? change.title : "");
    setError(undefined);
    setReview({ snapshot: data, change });
  }
  function move(index: number, offset: number) {
    if (
      !data ||
      locked ||
      !data.canEdit ||
      index + offset < 0 ||
      index + offset >= data.sections.length
    )
      return;
    const ids = data.sections.map((s) => s.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    void submit({ snapshot: data, change: { kind: "reorder", ids } });
  }
  if (!active) return null;
  if (canvas)
    return (
      <PlatformCanvasPanel
        scope={{
          kind: "platform",
          projectId,
          workspaceId,
          generation,
          sectionId: canvas.id,
          documentId: canvas.documentId,
        }}
        title={`${name} · ${canvas.title}`}
        close={() => setCanvas(undefined)}
      />
    );
  if (leave)
    return (
      <View style={{ padding: 16, gap: 12 }}>
        <ThemedText>{t("documentEditor.discardQuestion")}</ThemedText>
        <Action
          label={t("documentEditor.keepEditing")}
          disabled={busy}
          onPress={() => {
            if (active && current() && !lock.current) setLeave(undefined);
          }}
        />
        <Action
          label={t("documentEditor.discard")}
          disabled={busy}
          onPress={() => {
            if (!active || !current() || lock.current) return;
            const run = leave.run;
            setLeave(undefined);
            setReview(undefined);
            run();
          }}
        />
      </View>
    );
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText type="smallBold">
        {t("studioChapters.title")} · {name}
      </ThemedText>
      {!visible && <ActivityIndicator />}
      {(error || visible?.error) && (
        <ThemedText accessibilityRole="alert">{error ?? visible?.error}</ThemedText>
      )}
      {(uncertainAt !== undefined || changed) && (
        <>
          <ThemedText>{t("studioChapters.reviewChanges")}</ThemedText>
          {data && (
            <View style={{ gap: 4 }}>
              {data.sections.map((section) => (
                <ThemedText key={section.id} type="small">
                  {section.title}
                </ThemedText>
              ))}
            </View>
          )}
          {data?.canEdit &&
            targetExists &&
            (uncertainAt === undefined || revision > uncertainAt) && (
              <Action
                label={t("studioProjects.reviewed")}
                onPress={() => {
                  if (review) setReview({ ...review, snapshot: data });
                  setUncertainAt(undefined);
                  setError(undefined);
                }}
              />
            )}
        </>
      )}
      {data && !data.canEdit && <ThemedText>{t("studioChapters.readOnly")}</ThemedText>}
      {review && data && !targetExists && <ThemedText>{t("studioChapters.missing")}</ThemedText>}
      {review ? (
        <>
          {review.change.kind === "archive" ? (
            <>
              <ThemedText>{t("studioChapters.archiveHelp")}</ThemedText>
              <ThemedText>
                {
                  review.snapshot.sections.find(
                    (s) => s.id === (review.change as { id: string }).id
                  )?.title
                }
              </ThemedText>
            </>
          ) : (
            <TextInput
              accessibilityLabel={t("studioChapters.name")}
              value={title}
              onChangeText={setTitle}
              editable={!locked}
              maxLength={160}
              style={{
                color: theme.text,
                padding: 12,
                borderRadius: 8,
                backgroundColor: theme.backgroundElement,
              }}
            />
          )}
          <Action
            label={t("studioChapters.confirm")}
            disabled={
              !canConfirm ||
              locked ||
              (review.change.kind !== "archive" && !sectionTitle.safeParse(title).success)
            }
            onPress={() =>
              void submit({
                snapshot: review.snapshot,
                change: "title" in review.change ? { ...review.change, title } : review.change,
              })
            }
          />
          <Action
            label={t("studioProjects.discard")}
            disabled={busy}
            onPress={() => requestLeave(() => setReview(undefined))}
          />
        </>
      ) : (
        <>
          {data?.canEdit && (
            <Action
              label={t("studioChapters.create")}
              disabled={locked}
              onPress={() => start({ kind: "create", title: "" })}
            />
          )}
          {data?.sections.map((section, index) => (
            <View
              key={section.id}
              style={{
                gap: 8,
                padding: 12,
                borderRadius: 8,
                backgroundColor: theme.backgroundElement,
              }}
            >
              <ThemedText type="smallBold">
                {index + 1}. {section.title}
              </ThemedText>
              {data.canEdit && (
                <>
                  <Action
                    label={t("studioChapters.rename")}
                    disabled={locked}
                    onPress={() => start({ kind: "rename", id: section.id, title: section.title })}
                  />
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Action
                      label={t("studioChapters.up")}
                      disabled={locked || index === 0}
                      onPress={() => move(index, -1)}
                    />
                    <Action
                      label={t("studioChapters.down")}
                      disabled={locked || index === data.sections.length - 1}
                      onPress={() => move(index, 1)}
                    />
                  </View>
                  <Action
                    label={t("studioChapters.archive")}
                    disabled={locked || data.sections.length === 1}
                    onPress={() => start({ kind: "archive", id: section.id })}
                  />
                </>
              )}
              <Action
                label={t("studioChapters.open")}
                disabled={busy}
                onPress={() => {
                  if (!current() || lock.current) return;
                  setCanvas({
                    id: section.id,
                    documentId: section.canvasDocumentId,
                    title: section.title,
                  });
                }}
              />
              <Action
                label={t("platformCanvas.openWeb")}
                disabled={busy}
                onPress={() => {
                  if (!current() || lock.current) return;
                  lock.current = true;
                  setBusy(true);
                  const url = new URL(
                    studioInviteTargetUrl(
                      { scope: "project", projectId, workspaceId, targetName: name },
                      appEnv.appRegion
                    )
                  );
                  url.pathname += "/canvas";
                  url.searchParams.set("section", section.id);
                  void Linking.openURL(url.toString())
                    .catch((e) => {
                      if (current()) setError(e instanceof Error ? e.message : String(e));
                    })
                    .finally(() => {
                      lock.current = false;
                      if (current()) setBusy(false);
                    });
                }}
              />
            </View>
          ))}
          {data?.sections.length === 1 && <ThemedText>{t("studioChapters.keepOne")}</ThemedText>}
        </>
      )}
      <Action
        label={t("studioChapters.refresh")}
        disabled={busy}
        onPress={() => {
          setError(undefined);
          setRevision((v) => v + 1);
        }}
      />
      {busy && <ActivityIndicator />}
      <Action
        label={t("common.back")}
        disabled={busy}
        onPress={() => requestLeave(review ? () => setReview(undefined) : onClose)}
      />
    </ScrollView>
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
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 12,
        borderRadius: 8,
        backgroundColor: theme.backgroundElement,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}
