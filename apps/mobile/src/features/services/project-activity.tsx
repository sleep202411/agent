import { activityDetails, fetchActivityAuthors } from "./project-activity-display";
import { useEffect, useRef, useState } from "react";
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
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { webBaseUrl } from "@/config";
import {
  fetchProjectActivityAccess,
  fetchProjectActivityPage,
  postProjectActivity,
  projectHealth,
  ProjectActivityPostError,
  type ProjectActivity as Activity,
} from "./project-activity-api";
import {
  CrewProductionActivityContentSchema,
  productionDocumentPlainText,
  type CrewProductionDocument,
} from "./production-document-schema";
import { DocumentEditorFrame } from "./production-document-editor-frame";
import { documentEditorHtml, editorMessage } from "./production-document-editor-bridge";
import { editorLabelKeys } from "./project-document-editor";
import { ProductionDocumentView } from "./production-document-view";
import { renderProductionDocument } from "./production-document-html";
import { resolveDocumentLink } from "./production-document-links";
type Props = { crewId: string; userId: string; generation: number; onClose: () => void };
export function ProjectActivity(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Session key={`${props.crewId}:${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations(),
    theme = useTheme(),
    active = useScreenActive();
  const [rows, setRows] = useState<Activity[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [access, setAccess] = useState<{ view: boolean; manage: boolean }>();
  const [loading, setLoading] = useState(false),
    [error, setError] = useState<string>();
  const [mode, setMode] = useState<"comment" | "update">("comment"),
    [health, setHealth] = useState<(typeof projectHealth)[number]>("on_track");
  const [progress, setProgress] = useState(""),
    [document, setDocument] = useState<CrewProductionDocument>({ type: "doc", content: [] });
  const [editing, setEditing] = useState(false),
    [selected, setSelected] = useState<Activity>();
  const [posting, setPosting] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [discard, setDiscard] = useState(false);
  const alive = useRef(false),
    write = useRef(false),
    read = useRef<AbortController | undefined>(undefined);
  const writeController = useRef<AbortController | undefined>(undefined);
  const [authors, setAuthors] = useState<Record<string, string>>({});
  const seen = useRef(new Set<string>());
  const current = () => alive.current && props.generation === getAuthGeneration();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      read.current?.abort();
      writeController.current?.abort();
    };
  }, []);
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => write.current);
    return () => subscription.remove();
  }, []);
  async function load(next: string | null = null) {
    if (!active || !current() || read.current) return;
    const controller = new AbortController();
    read.current = controller;
    setLoading(true);
    setError(undefined);
    if (!next) {
      setRows([]);
      setAuthors({});
      setAccess(undefined);
      setCursor(null);
      seen.current.clear();
    }
    try {
      const permission = await fetchProjectActivityAccess(
        props.crewId,
        props.userId,
        props.generation,
        controller.signal
      );
      if (!permission.view) throw new Error(t("projectActivity.denied"));
      const page = await fetchProjectActivityPage(
        props.crewId,
        props.generation,
        next,
        controller.signal
      );
      if (!current() || controller.signal.aborted) return;
      if (
        next &&
        (page.items.some((item) => rows.some((old) => old.id === item.id)) ||
          (page.nextCursor && seen.current.has(page.nextCursor)))
      )
        throw new Error(t("projectActivity.changed"));
      if (page.nextCursor) seen.current.add(page.nextCursor);
      setRows(next ? [...rows, ...page.items] : page.items);
      setCursor(page.nextCursor);
      setAccess(permission);
      try {
        const names = await fetchActivityAuthors(
          page.items.map((row) => row.createdByUserId),
          props.generation,
          controller.signal
        );
        if (current() && !controller.signal.aborted)
          setAuthors((previous) => ({ ...previous, ...names }));
      } catch {
        // Identity lookup is supplementary; keep the authoritative user ID when unavailable.
      }
    } catch (cause) {
      if (current() && !controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (read.current === controller) read.current = undefined;
      if (current() && !controller.signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    if (active)
      void Promise.resolve().then(() => {
        if (!cancelled) return load();
      });
    else {
      writeController.current?.abort();
      read.current?.abort();
      read.current = undefined;
      void Promise.resolve().then(() => {
        if (!cancelled) {
          setRows([]);
          setAccess(undefined);
          setSelected(undefined);
        }
      });
    }
    return () => {
      cancelled = true;
      read.current?.abort();
      read.current = undefined;
    };
    // The identity is fixed by the keyed Session; foregrounding rechecks access.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  async function submit() {
    if (write.current || uncertain || !active || !current() || !access?.view) return;
    const kind = access.manage ? mode : "comment";
    if (kind === "update" && progress && (!/^\d{1,3}$/.test(progress) || Number(progress) > 100)) {
      setError(t("projectActivity.invalidProgress"));
      return;
    }
    const content = CrewProductionActivityContentSchema.safeParse(document);
    if (!content.success) {
      setError(t("projectActivity.invalidContent"));
      return;
    }
    writeController.current = new AbortController();
    write.current = true;
    setPosting(true);
    setError(undefined);
    try {
      const result = await postProjectActivity(
        props.crewId,
        props.userId,
        props.generation,
        kind === "comment"
          ? { kind, content: content.data }
          : { kind, health, content: content.data, progress: progress ? Number(progress) : null },
        writeController.current.signal
      );
      if (current()) {
        setRows((items) => [result, ...items.filter((item) => item.id !== result.id)]);
        setDocument({ type: "doc", content: [] });
        setDiscard(false);
      }
    } catch (cause) {
      if (current()) {
        setError(cause instanceof Error ? cause.message : String(cause));
        if (cause instanceof ProjectActivityPostError && cause.uncertain) setUncertain(true);
      }
    } finally {
      write.current = false;
      if (current()) setPosting(false);
    }
  }
  if (editing)
    return (
      <View style={{ flex: 1, display: active ? "flex" : "none" }}>
        <ActivityEditor
          active={active}
          initial={document}
          generation={props.generation}
          onClose={() => setEditing(false)}
          onSave={(value) => {
            setDocument(value);
            setEditing(false);
          }}
        />
      </View>
    );
  if (!active) return null;
  if (selected?.content)
    return (
      <ActivityReader
        activity={selected}
        generation={props.generation}
        onClose={() => setSelected(undefined)}
      />
    );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{t("projectActivity.title")}</ThemedText>
      {
        <Action
          label={t("thread.refresh")}
          onPress={() => void load()}
          disabled={loading || posting}
        />
      }
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {access?.view && (
        <View
          style={{
            gap: 8,
            padding: 12,
            borderColor: theme.border,
            borderWidth: 1,
            borderRadius: 8,
          }}
        >
          <ThemedText>{t(`projectActivity.${access.manage ? mode : "comment"}`)}</ThemedText>
          {access.manage && (
            <Action
              label={t(`projectActivity.${mode === "comment" ? "update" : "comment"}`)}
              onPress={() => setMode(mode === "comment" ? "update" : "comment")}
              disabled={posting || uncertain}
            />
          )}
          {access.manage && mode === "update" && (
            <>
              {projectHealth.map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{
                    selected: health === value,
                    disabled: posting || uncertain,
                  }}
                  disabled={posting || uncertain}
                  onPress={() => setHealth(value)}
                  style={{
                    padding: 8,
                    borderWidth: health === value ? 1 : 0,
                    borderColor: theme.brand,
                  }}
                >
                  <ThemedText>{t(`projectActivity.${value}`)}</ThemedText>
                </Pressable>
              ))}
              <TextInput
                accessibilityLabel={t("projectActivity.progress")}
                placeholder={t("projectActivity.progress")}
                placeholderTextColor={theme.textSecondary}
                value={progress}
                onChangeText={setProgress}
                editable={!posting && !uncertain}
                keyboardType="number-pad"
                maxLength={3}
                style={{ color: theme.text, padding: 12 }}
              />
            </>
          )}
          <ThemedText>{productionDocumentPlainText(document)}</ThemedText>
          {
            <Action
              label={t("projectActivity.edit")}
              onPress={() => setEditing(true)}
              disabled={posting || uncertain}
            />
          }
          {
            <Action
              label={t("projectActivity.post")}
              onPress={() => void submit()}
              disabled={posting || uncertain || !productionDocumentPlainText(document).trim()}
            />
          }
          {uncertain && (
            <>
              <ThemedText accessibilityRole="alert">{t("projectActivity.uncertain")}</ThemedText>
              {
                <Action
                  label={t(discard ? "projectActivity.confirmDiscard" : "projectActivity.checked")}
                  onPress={() => {
                    if (!discard) setDiscard(true);
                    else {
                      setDocument({ type: "doc", content: [] });
                      setUncertain(false);
                      setDiscard(false);
                      setError(undefined);
                    }
                  }}
                />
              }
            </>
          )}
        </View>
      )}
      {(loading || posting) && <ActivityIndicator />}
      {!loading && access && !rows.length && <ThemedText>{t("projectActivity.empty")}</ThemedText>}
      {rows.map((row) => (
        <View
          key={row.id}
          style={{
            gap: 8,
            padding: 12,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 8,
          }}
        >
          <ThemedText type="smallBold">{t(`projectActivity.${row.kind}`)}</ThemedText>
          <ThemedText>
            {authors[row.createdByUserId] ?? row.createdByUserId} ·{" "}
            {new Date(row.createdAt).toLocaleString()}
          </ThemedText>
          {row.health && (
            <ThemedText>
              {t(`projectActivity.${row.health}`)}
              {row.progress !== null ? ` · ${row.progress}%` : ""}
            </ThemedText>
          )}
          <ThemedText>{row.plainText}</ThemedText>
          {activityDetails(row, t).map((detail, index) => (
            <ThemedText key={index}>
              {t(`projectActivity.${detail.key}`)}: {detail.value}
            </ThemedText>
          ))}
          {row.content && (
            <Action
              label={t("projectActivity.read")}
              onPress={() => setSelected(row)}
              disabled={posting}
            />
          )}
        </View>
      ))}
      {cursor && (
        <Action
          label={t("projectActivity.more")}
          onPress={() => void load(cursor)}
          disabled={loading || posting}
        />
      )}
      {<Action label={t("crewTasks.back")} onPress={props.onClose} disabled={posting} />}
    </ScrollView>
  );
}
function ActivityEditor({
  active,
  initial,
  generation,
  onSave,
  onClose,
}: {
  active: boolean;
  initial: CrewProductionDocument;
  generation: number;
  onSave: (document: CrewProductionDocument) => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const [html, setHtml] = useState(() =>
    documentEditorHtml(
      initial,
      Object.fromEntries(
        editorLabelKeys.map((key) => [
          key,
          key === "save" ? t("projectActivity.useDraft") : t(`documentEditor.${key}`),
        ])
      )
    )
  );
  const [error, setError] = useState<string>(),
    [confirm, setConfirm] = useState(false);
  const [revision, setRevision] = useState(0);
  const dirty = useRef(false),
    failed = useRef(false);
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!active) return false;
      if (dirty.current && !confirm) setConfirm(true);
      else onClose();
      return true;
    });
    return () => subscription.remove();
  }, [active, confirm, onClose]);
  return (
    <View style={{ flex: 1, gap: 12, padding: 16 }}>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          if (dirty.current && !confirm) setConfirm(true);
          else onClose();
        }}
      >
        <ThemedText>{t(confirm ? "projectActivity.confirmDiscard" : "crewTasks.back")}</ThemedText>
      </Pressable>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <DocumentEditorFrame
        key={revision}
        html={html}
        title={t("projectActivity.edit")}
        onError={() => {
          failed.current = true;
          setError(t("projectDocument.loadError"));
        }}
        onMessage={(raw) => {
          if (!active || generation !== getAuthGeneration() || failed.current) return;
          const message = editorMessage(raw);
          if (message?.type === "dirty") dirty.current = true;
          if (message?.type === "error") {
            failed.current = true;
            setError(t("projectDocument.loadError"));
          }
          if (message?.type === "save") {
            const parsed = CrewProductionActivityContentSchema.safeParse(message.document);
            if (parsed.success) onSave(parsed.data);
            else {
              setError(t("projectActivity.invalidContent"));
              // The shared editor locks after Save. Reopen the exact rejected
              // document so the author can fix length/content without losing it.
              setHtml(
                documentEditorHtml(
                  message.document,
                  Object.fromEntries(
                    editorLabelKeys.map((key) => [
                      key,
                      key === "save" ? t("projectActivity.useDraft") : t(`documentEditor.${key}`),
                    ])
                  )
                )
              );
              setRevision((value) => value + 1);
            }
          }
        }}
      />
    </View>
  );
}
function ActivityReader({
  activity,
  generation,
  onClose,
}: {
  activity: Activity;
  generation: number;
  onClose: () => void;
}) {
  const t = useTranslations(),
    [rendered] = useState(() => renderProductionDocument(activity.content));
  const [error, setError] = useState<string>();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return (
    <View style={{ flex: 1, gap: 12, padding: 16 }}>
      <Pressable accessibilityRole="button" onPress={onClose}>
        <ThemedText>{t("crewTasks.back")}</ThemedText>
      </Pressable>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <ProductionDocumentView
        html={rendered.html}
        title={t("projectActivity.read")}
        onError={() => setError(t("projectDocument.loadError"))}
        onLink={(index) => {
          if (!alive.current || generation !== getAuthGeneration()) return;
          const href = rendered.links[index];
          if (href === undefined) return;
          const url = resolveDocumentLink(href, webBaseUrl);
          if (!url) {
            setError(t("projectDocument.linkUnavailable"));
            return;
          }
          void Linking.openURL(url).catch(() => {
            if (alive.current && generation === getAuthGeneration())
              setError(t("projectDocument.linkUnavailable"));
          });
        }}
      />
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
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 12,
        backgroundColor: theme.backgroundElement,
        borderRadius: 8,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
