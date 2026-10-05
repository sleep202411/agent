import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { uuid } from "expo-modules-core";
import { useAuth } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { ThemedText } from "@/components/themed-text";
import { useLocale, useTranslations } from "@/i18n";
import {
  openScriptCollaboration,
  reloadScriptCollaboration,
} from "../api/story-script-collaboration";
import type { TimelineScope } from "../api/story-timeline-api";
import { createScriptEditorHost } from "../lib/story-script-editor-host";
import { scriptEditorHtml } from "../lib/story-script-editor-bridge";
import { ScriptEditorFrame, type ScriptFrameHandle } from "./story-script-editor-frame";

export function StoryScriptEditor({
  projectId,
  chapterId,
  canEdit,
}: {
  projectId: string;
  chapterId: string;
  canEdit: boolean;
}) {
  const locale = useLocale();
  const auth = useAuth(),
    active = useScreenActive();
  if (auth.status !== "authenticated" || !active) return null;
  return (
    <ScriptSession
      key={`${auth.generation}:${projectId}:${chapterId}:${locale}`}
      scope={{ projectId, chapterId, generation: auth.generation }}
      userId={String(auth.user?.userId ?? auth.user?.id ?? "")}
      canEdit={canEdit}
    />
  );
}
function ScriptSession({
  scope: input,
  userId,
  canEdit,
}: {
  scope: TimelineScope;
  userId: string;
  canEdit: boolean;
}) {
  const t = useTranslations();
  const { projectId, chapterId, generation } = input;
  const scope = useMemo(
    () => ({ projectId, chapterId, generation }),
    [projectId, chapterId, generation]
  );
  const [sessionId] = useState(() => uuid.v4());
  const frame = useRef<ScriptFrameHandle>(null),
    host = useRef<ReturnType<typeof createScriptEditorHost> | null>(null);
  const refreshRemote = useRef<(() => void) | null>(null);
  const allowed = useRef(canEdit);
  useEffect(() => {
    allowed.current = canEdit;
  }, [canEdit]);
  const [ready, setReady] = useState(false),
    [error, setError] = useState<string>(),
    [syncError, setSyncError] = useState<string>(),
    [attempt, setAttempt] = useState(0);
  const html = useMemo(
    () =>
      scriptEditorHtml(sessionId, {
        editor: t("scriptEditor.editor"),
        saving: t("scriptEditor.saving"),
        pending: t("scriptEditor.pending"),
        synced: t("scriptEditor.synced"),
        bold: t("scriptEditor.bold"),
        italic: t("scriptEditor.italic"),
        heading: t("scriptEditor.heading"),
        bulletList: t("scriptEditor.bullets"),
        orderedList: t("scriptEditor.numbered"),
        quote: t("scriptEditor.quote"),
        undo: t("scriptEditor.undo"),
        redo: t("scriptEditor.redo"),
      }),
    [sessionId, t]
  );
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const current = () => !controller.signal.aborted && getAuthGeneration() === scope.generation;
    void openScriptCollaboration(scope, controller.signal)
      .then((snapshot) => {
        if (!current()) return;
        const target = { ...scope, documentId: snapshot.document.id };
        const instance = createScriptEditorHost({
          scope: target,
          userId,
          sessionId,
          editable: allowed.current,
          snapshot,
          send: (message) => frame.current?.send(message),
          onFatal: (message) => {
            if (!current()) return;
            setReady(false);
            host.current?.dispose();
            host.current = null;
            setError(message);
          },
          onError: (message) => {
            if (current()) setError(message);
          },
        });
        host.current = instance;
        setReady(true);
        setError(undefined);
        setSyncError(undefined);
        let polling = false;
        const canPoll = () => current() && host.current === instance;
        const poll = async () => {
          if (!canPoll() || polling) return;
          clearTimeout(timer);
          polling = true;
          try {
            const value = await reloadScriptCollaboration(target, controller.signal);
            if (canPoll()) {
              instance.remote(value);
              setSyncError(undefined);
            }
          } catch (e) {
            if (canPoll()) setSyncError(e instanceof Error ? e.message : String(e));
          } finally {
            polling = false;
            if (canPoll()) timer = setTimeout(() => void poll(), 3000);
          }
        };
        refreshRemote.current = () => void poll();
        timer = setTimeout(() => void poll(), 3000);
      })
      .catch((e) => {
        if (current()) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      controller.abort();
      clearTimeout(timer);
      refreshRemote.current = null;
      host.current?.dispose();
      host.current = null;
    };
  }, [scope, userId, sessionId, attempt]);
  useEffect(() => {
    host.current?.setEditable(canEdit);
  }, [canEdit]);
  const receive = useCallback((raw: unknown) => host.current?.receive(raw), []);
  const retry = () => {
    if (host.current) {
      host.current.retry();
      refreshRemote.current?.();
    } else {
      setError(undefined);
      setAttempt((n) => n + 1);
    }
  };
  const visibleError = error ?? syncError;
  return (
    <View style={{ flex: 1 }}>
      {!ready && !visibleError && <ActivityIndicator />}
      {visibleError && (
        <View style={{ padding: 12, gap: 8 }}>
          <ThemedText accessibilityRole="alert">{visibleError}</ThemedText>
          <Pressable accessibilityRole="button" onPress={retry}>
            <ThemedText>{t("common.retry")}</ThemedText>
          </Pressable>
        </View>
      )}
      {ready && (
        <ScriptEditorFrame
          ref={frame}
          html={html}
          title={t("scriptEditor.editor")}
          onMessage={receive}
          onError={() => {
            setReady(false);
            host.current?.dispose();
            host.current = null;
            setError(t("scriptEditor.frameError"));
          }}
        />
      )}
    </View>
  );
}
