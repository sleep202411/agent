import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import { uuid } from "expo-modules-core";
import { appEnv } from "@/config";
import { useAuth } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useIsFocused } from "expo-router";
import { useLocale, useTranslations } from "@/i18n";
import {
  parseStoryPlotImport,
  StoryPlotImportError,
  type StoryPlotImport,
} from "../lib/story-plot-import";
import { readPlotImportFile } from "../lib/plot-import-file";
import {
  loadPlotImportDraft,
  plotImportPending,
  type PlotImportCommand,
  type PlotImportDraft,
  type PlotImportScope,
} from "../api/story-plot-import-api";

type Props = { projectId: string; chapterId: string; canEdit: boolean; onImported: () => void };
export function StoryPlotImportAction(props: Props) {
  const [open, setOpen] = useState(false);
  const auth = useAuth(),
    t = useTranslations(),
    active = useIsFocused();
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  if (!props.canEdit || auth.status !== "authenticated" || !active || !userId) return null;
  return (
    <>
      <Pressable accessibilityRole="button" style={{ padding: 12 }} onPress={() => setOpen(true)}>
        <ThemedText>{t("plotImport.title")}</ThemedText>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        {open && (
          <ImportSession
            key={`${props.projectId}:${props.chapterId}:${auth.generation}`}
            {...props}
            generation={auth.generation}
            userId={userId}
            onClose={() => setOpen(false)}
          />
        )}
      </Modal>
    </>
  );
}
function ImportSession({
  projectId,
  chapterId,
  generation,
  userId,
  onImported,
  onClose,
}: Props & { generation: number; userId: string; onClose: () => void }) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const scope = useMemo<PlotImportScope>(
    () => ({ projectId, chapterId, generation }),
    [projectId, chapterId, generation]
  );
  const outbox = useMemo(() => plotImportPending(scope, userId), [scope, userId]);
  const life = useRef<AbortController | null>(null),
    lock = useRef(false);
  const [revision, setRevision] = useState(0),
    [loaded, setLoaded] = useState<{
      revision: number;
      draft?: PlotImportDraft;
      pending: PlotImportCommand | null;
      error?: string;
    }>();
  const [selection, setSelection] = useState<{ name: string; plot: StoryPlotImport }>();
  const [mode, setMode] = useState<"append" | "replace">("append");
  const [confirmed, setConfirmed] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const current = useCallback(
    () => !!life.current && !life.current.signal.aborted && generation === getAuthGeneration(),
    [generation]
  );
  const message = (e: unknown) =>
    e instanceof StoryPlotImportError
      ? t("plotImport.invalid").replace("{code}", e.code).replace("{path}", e.path)
      : e instanceof Error
        ? e.message
        : String(e);
  useEffect(() => {
    const c = new AbortController();
    life.current = c;
    return () => c.abort();
  }, []);
  useEffect(() => {
    const c = new AbortController();
    void (async () => {
      let pending: PlotImportCommand | null = null;
      try {
        pending = outbox.read() ?? null;
        const draft = await loadPlotImportDraft(scope, c.signal);
        if (!c.signal.aborted && current()) setLoaded({ revision, draft, pending });
      } catch (e) {
        if (!c.signal.aborted && current())
          setLoaded({ revision, pending, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => c.abort();
  }, [scope, outbox, revision, current]);
  const visible = loaded?.revision === revision ? loaded : undefined;
  const refresh = () => {
    setConfirmed(false);
    setReviewed(false);
    setError(undefined);
    setRevision((v) => v + 1);
  };
  async function choose() {
    if (lock.current || visible?.pending || !visible?.draft || !current()) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    setConfirmed(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/json", "text/plain"],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (!current() || result.canceled) return;
      const asset = result.assets[0];
      if (!asset) throw Error(t("plotImport.noFile"));
      const plot = parseStoryPlotImport(await readPlotImportFile(asset, life.current!.signal));
      if (current()) setSelection({ name: asset.name, plot });
    } catch (e) {
      if (current()) {
        setSelection(undefined);
        setError(message(e));
      }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }
  async function submit() {
    if (
      lock.current ||
      !confirmed ||
      !selection ||
      !visible?.draft ||
      visible.pending ||
      !current()
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    const sessionId = uuid.v4();
    try {
      await outbox.submit(
        {
          clientKey: sessionId,
          name: selection.name,
          input: {
            schemaVersion: "interactive-story-draft-v1",
            expectedRevision: visible.draft.revision,
            content: visible.draft.content,
            sessionId,
            locale,
            mode,
            plot: selection.plot,
          },
        },
        life.current!.signal
      );
      if (current()) {
        onClose();
        onImported();
      }
    } catch (e) {
      if (current()) {
        setError(message(e));
        setConfirmed(false);
        setRevision((v) => v + 1);
      }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{
        padding: 16,
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 16,
        gap: 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <ThemedText type="smallBold" style={{ flex: 1 }}>
          {t("plotImport.title")}
        </ThemedText>
        <ImportButton label={t("ipDetail.close")} onPress={onClose} quiet />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {t("plotImport.help")}
      </ThemedText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <ImportButton
          quiet
          label={t("plotImport.template")}
          onPress={() => {
            const origin =
              appEnv.siteRegion === "cn"
                ? "https://studio.fizzspace.cn"
                : "https://studio.fizzdragon.com";
            void Linking.openURL(`${origin}/templates/story-plot/${locale}.md`).catch((e) => {
              if (current()) setError(message(e));
            });
          }}
        />
        <ImportButton quiet label={t("plotImport.refresh")} onPress={refresh} disabled={busy} />
      </View>
      {!visible && <ActivityIndicator />}
      {visible?.error && <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {visible?.draft && (
        <>
          <ThemedText>
            {t("plotImport.current")
              .replace("{revision}", String(visible.draft.revision))
              .replace("{nodes}", String(visible.draft.content.graph.nodes.length))}
          </ThemedText>
          {visible.pending ? (
            <>
              <ThemedText accessibilityRole="alert">{t("plotImport.uncertain")}</ThemedText>
              <ThemedText>
                {visible.pending.name} · {t(`plotImport.${visible.pending.input.mode}`)} ·{" "}
                {t("plotImport.previousRevision")} {visible.pending.input.expectedRevision}
              </ThemedText>
              <ImportButton
                label={t("plotImport.inspect")}
                onPress={() => setShowCurrent((v) => !v)}
              />
              {showCurrent && (
                <View style={{ gap: 8 }}>
                  {visible.draft.content.graph.nodes.length === 0 && (
                    <ThemedText type="small" themeColor="textSecondary">
                      {t("plotImport.empty")}
                    </ThemedText>
                  )}
                  {visible.draft.content.graph.nodes.map((node) => (
                    <View
                      key={node.nodeId}
                      style={{
                        padding: 12,
                        gap: 4,
                        borderRadius: 8,
                        backgroundColor: theme.backgroundElement,
                      }}
                    >
                      <ThemedText type="smallBold" selectable>
                        {typeof node.name === "string" && node.name.trim()
                          ? node.name
                          : node.nodeId}
                      </ThemedText>
                      {typeof node.description === "string" && !!node.description && (
                        <ThemedText type="small" themeColor="textSecondary" selectable>
                          {node.description}
                        </ThemedText>
                      )}
                    </View>
                  ))}
                  <ImportButton
                    quiet
                    label={t(showDetails ? "plotImport.hideDetails" : "plotImport.details")}
                    onPress={() => setShowDetails((v) => !v)}
                  />
                  {showDetails && (
                    <ThemedText type="code" themeColor="textSecondary" selectable>
                      {JSON.stringify(visible.draft.content.graph, null, 2)}
                    </ThemedText>
                  )}
                </View>
              )}
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: reviewed }}
                aria-checked={reviewed}
                style={{ padding: 12 }}
                onPress={() => setReviewed((v) => !v)}
              >
                <ThemedText>
                  {reviewed ? "☑ " : "☐ "}
                  {t("plotImport.reviewed")}
                </ThemedText>
              </Pressable>
              <ImportButton
                label={t("plotImport.clear")}
                onPress={() => {
                  try {
                    outbox.clear(visible.pending!.clientKey);
                    refresh();
                  } catch (e) {
                    setError(message(e));
                  }
                }}
                disabled={busy || !reviewed}
              />
            </>
          ) : (
            <>
              <ImportButton
                label={t("plotImport.choose")}
                onPress={() => void choose()}
                disabled={busy}
              />
              {selection && (
                <>
                  <ThemedText type="smallBold">{selection.name}</ThemedText>
                  <ThemedText>
                    {t("plotImport.summary")
                      .replace("{nodes}", String(selection.plot.nodes.length))
                      .replace("{assets}", String(selection.plot.assets.length))}
                  </ThemedText>
                  {selection.plot.nodes.map((node) => (
                    <ThemedText key={node.id}>
                      {node.type === "scene" ? node.title : node.prompt}
                    </ThemedText>
                  ))}
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {(["append", "replace"] as const).map((value) => (
                      <Pressable
                        key={value}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: mode === value, disabled: busy }}
                        aria-checked={mode === value}
                        disabled={busy}
                        style={{
                          padding: 12,
                          backgroundColor:
                            mode === value ? theme.backgroundSelected : theme.backgroundElement,
                        }}
                        onPress={() => {
                          setMode(value);
                          setConfirmed(false);
                        }}
                      >
                        <ThemedText>{t(`plotImport.${value}`)}</ThemedText>
                      </Pressable>
                    ))}
                  </View>
                  <ThemedText>
                    {t(
                      mode === "replace" ? "plotImport.replaceWarning" : "plotImport.appendWarning"
                    )}
                  </ThemedText>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: confirmed, disabled: busy }}
                    aria-checked={confirmed}
                    disabled={busy}
                    style={{ padding: 12 }}
                    onPress={() => setConfirmed((v) => !v)}
                  >
                    <ThemedText>
                      {confirmed ? "☑ " : "☐ "}
                      {t("plotImport.confirm")}
                    </ThemedText>
                  </Pressable>
                  <ImportButton
                    primary
                    label={t("plotImport.submit")}
                    onPress={() => void submit()}
                    disabled={busy || !confirmed}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
      {busy && <ActivityIndicator />}
    </ScrollView>
  );
}

function ImportButton({
  label,
  onPress,
  disabled = false,
  quiet = false,
  primary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  quiet?: boolean;
  primary?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      accessibilityState={{ disabled }}
      style={{
        padding: 12,
        minHeight: 44,
        borderRadius: 8,
        backgroundColor: primary ? theme.brand : quiet ? "transparent" : theme.backgroundElement,
        opacity: disabled ? 0.45 : 1,
      }}
      onPress={onPress}
    >
      <ThemedText type="smallBold" themeColor={quiet ? "textSecondary" : "text"}>
        {label}
      </ThemedText>
    </Pressable>
  );
}
