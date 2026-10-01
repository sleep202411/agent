/* eslint-disable react-hooks/refs -- Refs are read only in effects and press callbacks; button() only builds JSX. */
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, TextInput, View } from "react-native";
import {
  isTextGameEditableByCreator,
  isTextGameCreatorActionAllowed,
  type TextGameDetail,
  type TextGameSummary,
  type TextGamePlaySession,
} from "@repo/shared/text-game";
import { useAuth } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations, type MessageKey } from "@/i18n";
import {
  createTextAdventure,
  getTextAdventure,
  listTextAdventures,
  updateTextAdventure,
  transitionTextAdventure,
} from "./api/text-adventure-api";
import {
  loadTextAdventurePreview,
  sendTextAdventurePreview,
} from "./api/text-adventure-preview-api";
import {
  pickAndUploadTextAdventureMedia,
  type TextAdventureUploadTarget,
} from "./text-adventure-upload";
const empty = {
  name: "",
  synopsis: "",
  worldviewDocxUrl: "",
  posterUrl: "",
  bgmUrl: "",
  stillUrls: [] as string[],
};
export function TextAdventures({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  return (
    <AdventureSession
      key={auth.generation}
      generation={auth.generation}
      userId={String(auth.user?.id ?? auth.user?.userId ?? "")}
      onClose={onClose}
    />
  );
}
function AdventureSession({
  generation,
  userId,
  onClose,
}: {
  generation: number;
  userId: string;
  onClose: () => void;
}) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme();
  const label = (key: string) => t(`textAdventure.${key}` as MessageKey);
  const [rows, setRows] = useState<TextGameSummary[]>([]),
    [selected, setSelected] = useState<TextGameDetail>();
  const [form, setForm] = useState(empty),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false),
    [preview, setPreview] = useState<TextGamePlaySession>(),
    [message, setMessage] = useState("");
  const controller = useRef(new AbortController()),
    working = useRef(false);
  const session = { userId, generation };
  const current = () => !controller.current.signal.aborted && generation === getAuthGeneration();
  async function run(action: () => Promise<void>, write = false) {
    if (working.current || !current()) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      if (current()) {
        setError(e instanceof Error ? e.message : String(e));
        if (write) setUncertain(true);
      }
    } finally {
      working.current = false;
      if (current()) setBusy(false);
    }
  }
  function adopt(detail: TextGameDetail) {
    if (!current()) return;
    setSelected(detail);
    setEditing(true);
    setPreview(undefined);
    setForm({
      name: detail.content.name ?? "",
      synopsis: detail.content.synopsis ?? "",
      worldviewDocxUrl: detail.content.worldviewDocxUrl ?? "",
      posterUrl: detail.content.posterUrl ?? "",
      bgmUrl: detail.content.bgmUrl ?? "",
      stillUrls: detail.content.stillUrls,
    });
  }
  async function refresh() {
    const data = await listTextAdventures(session, controller.current.signal);
    if (current()) {
      setRows(data);
      setSelected(undefined);
      setEditing(false);
      setPreview(undefined);
      setUncertain(false);
    }
  }
  useEffect(() => {
    controller.current = new AbortController();
    const request = controller.current;
    working.current = true;
    void listTextAdventures(session, request.signal)
      .then(
        (data) => {
          if (!request.signal.aborted && current()) setRows(data);
        },
        (e) => {
          if (!request.signal.aborted && current())
            setError(e instanceof Error ? e.message : String(e));
        }
      )
      .finally(() => {
        if (!request.signal.aborted && current()) {
          working.current = false;
          setBusy(false);
        }
      });
    return () => request.abort();
    // Auth changes remount the entire session and abort its requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const editable = !selected || isTextGameEditableByCreator(selected.status);
  const dirty =
    !!selected &&
    (form.name !== (selected.content.name ?? "") ||
      form.synopsis !== (selected.content.synopsis ?? "") ||
      form.worldviewDocxUrl !== (selected.content.worldviewDocxUrl ?? "") ||
      form.posterUrl !== (selected.content.posterUrl ?? "") ||
      form.bgmUrl !== (selected.content.bgmUrl ?? "") ||
      JSON.stringify(form.stillUrls) !== JSON.stringify(selected.content.stillUrls));
  const button = (title: string, action: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: busy || disabled }}
      disabled={busy || disabled}
      onPress={action}
      style={{
        padding: 12,
        borderWidth: 1,
        borderColor: theme.textSecondary,
        borderRadius: 8,
        opacity: busy || disabled ? 0.45 : 1,
      }}
    >
      <ThemedText>{title}</ThemedText>
    </Pressable>
  );
  async function upload(target: TextAdventureUploadTarget) {
    const result = await pickAndUploadTextAdventureMedia(
      target,
      generation,
      controller.current.signal
    );
    if (!result || !current()) return;
    setForm((value) =>
      target === "still"
        ? { ...value, stillUrls: [...value.stillUrls, result.url] }
        : {
            ...value,
            [target === "document"
              ? "worldviewDocxUrl"
              : target === "poster"
                ? "posterUrl"
                : "bgmUrl"]: result.url,
          }
    );
  }
  async function save() {
    const input = {
      name: form.name,
      synopsis: form.synopsis,
      ...(form.posterUrl ? { posterUrl: form.posterUrl } : {}),
      ...(form.worldviewDocxUrl ? { worldviewDocxUrl: form.worldviewDocxUrl } : {}),
      bgmUrl: form.bgmUrl,
      stillUrls: form.stillUrls,
    };
    const result = selected
      ? await updateTextAdventure(selected.gameId, input, session, controller.current.signal)
      : await createTextAdventure(
          { ...input, worldviewDocxUrl: form.worldviewDocxUrl, bgmUrl: form.bgmUrl || undefined },
          session,
          controller.current.signal
        );
    adopt(result);
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
    >
      <ThemedText type="title">{label("title")}</ThemedText>
      {button(label("back"), onClose)}
      {button(label("refresh"), () => void run(refresh))}
      {busy && <ActivityIndicator />}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {dirty && <ThemedText>{label("saveFirst")}</ThemedText>}
      {uncertain && <ThemedText>{label("uncertain")}</ThemedText>}
      {!editing ? (
        <>
          {button(
            label("create"),
            () => {
              setForm(empty);
              setSelected(undefined);
              setEditing(true);
            },
            uncertain || dirty
          )}
          {!busy && rows.length === 0 && <ThemedText>{label("empty")}</ThemedText>}
          {rows.map((row) => (
            <View key={row.gameId} style={{ gap: 6 }}>
              {button(
                row.name || row.gameId,
                () =>
                  void run(async () =>
                    adopt(await getTextAdventure(row.gameId, session, controller.current.signal))
                  )
              )}
              <ThemedText>
                {label(row.status === "offline" ? "offlineStatus" : row.status)}
              </ThemedText>
            </View>
          ))}
        </>
      ) : (
        <>
          {selected && (
            <ThemedText>
              {label(selected.status === "offline" ? "offlineStatus" : selected.status)}
            </ThemedText>
          )}
          {!!selected?.rejectReason && <ThemedText>{selected.rejectReason}</ThemedText>}
          {(["name", "synopsis"] as const).map((field) => (
            <View key={field}>
              <ThemedText>{label(field)}</ThemedText>
              <TextInput
                accessibilityLabel={label(field)}
                editable={editable && !busy && !uncertain}
                value={form[field]}
                multiline={field === "synopsis"}
                onChangeText={(value) => setForm((f) => ({ ...f, [field]: value }))}
                style={{
                  padding: 12,
                  color: theme.text,
                  borderWidth: 1,
                  borderColor: theme.textSecondary,
                  borderRadius: 8,
                }}
              />
            </View>
          ))}
          {(["document", "poster", "music", "still"] as const).map((target) => (
            <View key={target} style={{ gap: 4 }}>
              {button(label(target), () => void run(() => upload(target)), !editable || uncertain)}
              {target !== "still" &&
                !!form[
                  target === "document"
                    ? "worldviewDocxUrl"
                    : target === "poster"
                      ? "posterUrl"
                      : "bgmUrl"
                ] && <ThemedText>{label("attached")}</ThemedText>}
            </View>
          ))}
          {!!form.posterUrl && (
            <Image
              source={{ uri: form.posterUrl }}
              style={{ width: "100%", height: 160 }}
              resizeMode="cover"
            />
          )}
          {!!form.bgmUrl &&
            button(
              label("removeMusic"),
              () => setForm((f) => ({ ...f, bgmUrl: "" })),
              !editable || uncertain
            )}
          {form.stillUrls.map((url, index) => (
            <View key={`${index}:${url}`}>
              <Image
                source={{ uri: url }}
                style={{ width: "100%", height: 120 }}
                resizeMode="cover"
              />
              {button(
                `${label("removeStill")} ${index + 1}`,
                () =>
                  setForm((f) => ({ ...f, stillUrls: f.stillUrls.filter((_, i) => i !== index) })),
                !editable || uncertain
              )}
            </View>
          ))}
          {button(
            label("save"),
            () => void run(save, true),
            !editable || uncertain || (!selected && !form.worldviewDocxUrl)
          )}
          {selected &&
            (["submit", "offline"] as const)
              .filter((action) => isTextGameCreatorActionAllowed(selected.status, action))
              .map((action) => (
                <View key={action}>
                  {button(
                    label(action),
                    () =>
                      void run(
                        async () =>
                          adopt(
                            await transitionTextAdventure(
                              selected.gameId,
                              action,
                              session,
                              controller.current.signal
                            )
                          ),
                        true
                      ),
                    uncertain || dirty
                  )}
                </View>
              ))}
          {selected &&
            button(
              label("preview"),
              () =>
                void run(async () => {
                  const value = await loadTextAdventurePreview(
                    selected.gameId,
                    locale,
                    session,
                    controller.current.signal
                  );
                  if (current()) setPreview(value);
                }, true),
              uncertain || dirty
            )}
          {preview && (
            <View style={{ gap: 12 }}>
              {preview.messages
                .filter((item) => item.role !== "system")
                .map((item) => (
                  <ThemedText key={item.id}>{item.content}</ThemedText>
                ))}
              <TextInput
                accessibilityLabel={label("message")}
                value={message}
                onChangeText={setMessage}
                editable={!busy && !uncertain}
                multiline
                style={{
                  color: theme.text,
                  padding: 12,
                  borderWidth: 1,
                  borderColor: theme.textSecondary,
                }}
              />
              {button(
                label("send"),
                () =>
                  void run(async () => {
                    const next = await sendTextAdventurePreview(
                      preview,
                      message,
                      locale,
                      session,
                      controller.current.signal
                    );
                    if (current()) {
                      setPreview(next);
                      setMessage("");
                    }
                  }, true),
                !message.trim() || uncertain
              )}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}
