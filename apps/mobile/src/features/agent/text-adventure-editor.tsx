import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, TextInput, View } from "react-native";
import {
  isTextGameEditableByCreator,
  isTextGameCreatorActionAllowed,
  type TextGameDetail,
  type TextGameUpdateInput,
  type TextGameCreatorAction,
} from "@repo/shared/text-game";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTranslations, type MessageKey } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import {
  getTextAdventure,
  updateTextAdventure,
  transitionTextAdventure,
  type TextAdventureSession,
} from "./api/text-adventure-api";
import { TextAdventureMusic } from "./text-adventure-media";
import { textAdventureDraft } from "./text-adventure-draft";
import {
  pickAndUploadTextAdventureMedia,
  type TextAdventureUploadTarget,
} from "./text-adventure-upload";
type Props = {
  gameId: string;
  session: TextAdventureSession;
  onBack: () => void;
  onPlay?: () => void;
};
export function TextAdventureEditor(props: Props) {
  const [revision, setRevision] = useState(0);
  return (
    <Loader
      key={`${props.gameId}:${props.session.userId}:${props.session.generation}:${revision}`}
      {...props}
      reload={() => setRevision((n) => n + 1)}
    />
  );
}
function Loader(props: Props & { reload: () => void }) {
  const [game, setGame] = useState<TextGameDetail>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    const c = new AbortController();
    void getTextAdventure(props.gameId, props.session, c.signal).then(
      (g) => {
        if (!c.signal.aborted) setGame(g);
      },
      (e) => {
        if (!c.signal.aborted && props.session.generation === getAuthGeneration())
          setError(String(e.message ?? e));
      }
    );
    return () => c.abort();
  }, [props.gameId, props.session]);
  if (game)
    return <Editor key={`${game.draftVersionId}:${game.updatedAt}`} {...props} game={game} />;
  return (
    <View style={{ padding: 16, gap: 12 }}>
      {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : <ActivityIndicator />}
      <Action label="thread.refresh" onPress={props.reload} />
      <Action label="textAdventures.actions.backToLibrary" onPress={props.onBack} />
    </View>
  );
}
function Editor(props: Props & { reload: () => void; game: TextGameDetail }) {
  const t = useTranslations(),
    theme = useTheme();
  const [store] = useState(() => textAdventureDraft(props.session.userId, props.game));
  const [restored] = useState(() => {
    try {
      return { saved: store.read(), error: undefined };
    } catch (e) {
      return { saved: null, error: String(e instanceof Error ? e.message : e) };
    }
  });
  const [patch, setPatch] = useState<TextGameUpdateInput>(restored.saved?.patch ?? {}),
    [error, setError] = useState<string | undefined>(restored.error),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(!!restored.error || !!restored.saved?.conflict),
    [confirm, setConfirm] = useState<TextGameCreatorAction>();
  const lock = useRef(false),
    abort = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    abort.current = c;
    return () => c.abort();
  }, []);
  const current = () =>
    props.session.generation === getAuthGeneration() && !abort.current?.signal.aborted;
  const editable = isTextGameEditableByCreator(props.game.status) && !blocked && !busy && !confirm;
  const form = { ...props.game.content, ...patch };
  const dirty = Object.keys(patch).length > 0;
  const change = (next: TextGameUpdateInput) => {
    if (!current()) return;
    try {
      const merged = { ...patch, ...next };
      store.write(merged);
      setPatch(merged);
      setError(undefined);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setBlocked(true);
    }
  };
  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (lock.current || !current() || !abort.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await work(abort.current.signal);
    } catch (e) {
      if (current()) {
        setError(String(e instanceof Error ? e.message : e));
        setBlocked(true);
      }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  };
  const save = () =>
    run(async (signal) => {
      await updateTextAdventure(props.game.gameId, patch, props.session, signal, props.game);
      if (current()) {
        store.clear();
        props.reload();
      }
    });
  const upload = (target: TextAdventureUploadTarget) =>
    run(async (signal) => {
      const r = await pickAndUploadTextAdventureMedia(target, props.session.generation, signal);
      if (!r || !current()) return;
      change(
        target === "document"
          ? { worldviewDocxUrl: r.url }
          : target === "poster"
            ? { posterUrl: r.url }
            : target === "music"
              ? { bgmUrl: r.url }
              : { stillUrls: [...(form.stillUrls ?? []), r.url] }
      );
    });
  const transition = () => {
    const action = confirm;
    if (!action || dirty || blocked || busy || !current()) return;
    setConfirm(undefined);
    void run(async (signal) => {
      await transitionTextAdventure(props.game.gameId, action, props.session, signal);
      if (current()) props.reload();
    });
  };
  const ready =
    !!form.name?.trim() && !!form.synopsis?.trim() && !!form.posterUrl && !!form.worldviewDocxUrl;
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText>{t(`textAdventures.status.${props.game.status}`)}</ThemedText>
      {props.onPlay &&
        (props.game.publishedVersionId !== null ? (
          <Action
            label="textAdventures.playtest.title"
            disabled={busy || !!confirm}
            onPress={props.onPlay}
          />
        ) : (
          <ThemedText>{t("textAdventures.playtest.unavailableBody")}</ThemedText>
        ))}
      {props.game.rejectReason && (
        <ThemedText>
          {t("textAdventures.publish.rejected")} · {props.game.rejectReason}
        </ThemedText>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {restored.saved?.conflict && <ThemedText>{t("textAdventures.mobile.conflict")}</ThemedText>}
      {dirty && <ThemedText>{t("textAdventures.editor.unsaved")}</ThemedText>}
      {(["name", "synopsis"] as const).map((field) => (
        <View key={field}>
          <ThemedText>{t(`textAdventures.editor.${field}`)}</ThemedText>
          <TextInput
            accessibilityLabel={t(`textAdventures.editor.${field}`)}
            value={form[field] ?? ""}
            editable={editable}
            multiline={field === "synopsis"}
            onChangeText={(value) => change({ [field]: value })}
            style={{
              color: theme.text,
              borderColor: theme.border,
              borderWidth: 1,
              borderRadius: 8,
              padding: 12,
            }}
          />
        </View>
      ))}
      {form.posterUrl?.startsWith("https://") && (
        <Image
          source={{ uri: form.posterUrl }}
          style={{ width: 120, height: 180, borderRadius: 8 }}
        />
      )}
      <Action
        label="textAdventures.editor.uploadPoster"
        disabled={!editable}
        onPress={() => void upload("poster")}
      />
      <ThemedText>
        {t(
          form.worldviewDocxUrl
            ? "textAdventures.editor.worldviewAttached"
            : "textAdventures.editor.notAdded"
        )}
      </ThemedText>
      <ThemedText>{t("textAdventures.editor.replaceDocumentHint")}</ThemedText>
      <Action
        label="textAdventures.editor.replaceDocument"
        disabled={!editable}
        onPress={() => void upload("document")}
      />
      <ThemedText>{t("textAdventures.editor.charactersReadOnly")}</ThemedText>
      {props.game.content.characters.map((c) => (
        <ThemedText key={c.id}>
          {c.name} · {c.intro}
        </ThemedText>
      ))}
      {(form.stillUrls ?? []).map((url, i) => (
        <View key={`${url}:${i}`} style={{ gap: 8 }}>
          {url.startsWith("https://") && (
            <Image source={{ uri: url }} style={{ height: 150, width: "100%", borderRadius: 8 }} />
          )}
          <Action
            label="textAdventures.mobile.removeImage"
            disabled={!editable}
            onPress={() => change({ stillUrls: form.stillUrls.filter((_, n) => n !== i) })}
          />
        </View>
      ))}
      <Action
        label="textAdventures.editor.addStills"
        disabled={!editable}
        onPress={() => void upload("still")}
      />
      <ThemedText>
        {t(form.bgmUrl ? "textAdventures.editor.attached" : "textAdventures.editor.noMusic")}
      </ThemedText>
      <Action
        label="textAdventures.editor.uploadMusic"
        disabled={!editable}
        onPress={() => void upload("music")}
      />
      {form.bgmUrl && <TextAdventureMusic url={form.bgmUrl} />}
      {form.bgmUrl && (
        <Action
          label="textAdventures.editor.removeMusic"
          disabled={!editable}
          onPress={() => change({ bgmUrl: "" })}
        />
      )}
      <Action
        label="textAdventures.actions.save"
        disabled={!editable || !dirty}
        onPress={() => void save()}
      />
      {!ready && (
        <ThemedText>
          {t("textAdventures.publish.validationTitle")} ·{" "}
          {[
            !form.name?.trim() ? t("textAdventures.publish.requirements.name") : null,
            !form.synopsis?.trim() ? t("textAdventures.publish.requirements.synopsis") : null,
            !form.posterUrl ? t("textAdventures.publish.requirements.poster") : null,
            !form.worldviewDocxUrl ? t("textAdventures.publish.requirements.document") : null,
          ]
            .filter(Boolean)
            .join(", ")}
        </ThemedText>
      )}
      {(["submit", "offline"] as const)
        .filter((a) => isTextGameCreatorActionAllowed(props.game.status, a))
        .map((a) => (
          <Action
            key={a}
            label={
              a === "submit"
                ? "textAdventures.publish.submit"
                : "textAdventures.publish.takeOffline"
            }
            disabled={busy || blocked || dirty || (a === "submit" && !ready)}
            onPress={() => setConfirm(a)}
          />
        ))}
      {confirm && (
        <View style={{ gap: 12 }}>
          <ThemedText>
            {t(
              `textAdventures.publish.${confirm === "submit" ? "submitConfirmBody" : "offlineConfirmBody"}`
            )}
          </ThemedText>
          <Action
            label={
              confirm === "submit"
                ? "textAdventures.publish.submitConfirm"
                : "textAdventures.publish.offlineConfirm"
            }
            disabled={busy}
            onPress={transition}
          />
          <Action
            label="textAdventures.actions.cancel"
            disabled={busy}
            onPress={() => setConfirm(undefined)}
          />
        </View>
      )}
      {busy && <ActivityIndicator />}
      {blocked && <Action label="thread.refresh" disabled={busy} onPress={props.reload} />}
      <Action
        label="textAdventures.mobile.discard"
        disabled={busy || (!dirty && !blocked)}
        onPress={() => {
          try {
            store.clear();
            props.reload();
          } catch (e) {
            setError(String(e));
          }
        }}
      />
      <Action label="textAdventures.actions.backToLibrary" disabled={busy} onPress={props.onBack} />
    </ScrollView>
  );
}
export function Action({
  label,
  disabled = false,
  onPress,
}: {
  label: MessageKey;
  disabled?: boolean;
  onPress: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      accessibilityState={{ disabled }}
      onPress={onPress}
      style={{
        padding: 12,
        borderRadius: 8,
        borderColor: theme.border,
        borderWidth: 1,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText>{t(label)}</ThemedText>
    </Pressable>
  );
}
