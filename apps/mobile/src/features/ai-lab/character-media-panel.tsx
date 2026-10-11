import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Image } from "expo-image";
import { uuid } from "expo-modules-core";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { ConversationAudio } from "@/features/services/conversation-audio";
import { ConversationVideo } from "@/features/services/conversation-video";
import { useTranslations } from "@/i18n";
import { loadLibraryCharacter, type LibraryDetail } from "./character-library-api";
import {
  characterMediaBox,
  characterUploadStore,
  prepareCharacterMedia,
  submitCharacterMedia,
  reconcileCharacterMedia,
  uploadCharacterMedia,
  finishCharacterUpload,
  previewCharacterMedia,
  CHARACTER_MEDIA_CAPS,
  type CharacterMediaAction,
  type CharacterMediaKind,
  type CharacterMediaCommand,
} from "./character-media-api";
type Props = {
  workspaceId: string;
  characterId: string;
  userId: string;
  generation: number;
  canEdit: boolean;
  onBusy: (busy: boolean) => void;
  onDetail: (d: LibraryDetail) => void;
};
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
      onPress={onPress}
      disabled={disabled}
      style={{ padding: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}
export function CharacterMediaPanel(props: Props) {
  const t = useTranslations(),
    [open, setOpen] = useState(false),
    [epoch, setEpoch] = useState(0);
  return (
    <View>
      <Button
        label={t(open ? "characterMedia.hide" : "characterMedia.title")}
        onPress={() => setOpen((v) => !v)}
      />
      {open ? <Board key={epoch} {...props} refresh={() => setEpoch((v) => v + 1)} /> : null}
    </View>
  );
}
function Board({
  workspaceId,
  characterId,
  userId,
  generation,
  canEdit,
  onBusy,
  onDetail,
  refresh,
}: Props & { refresh: () => void }) {
  const t = useTranslations(),
    op = useAuthFormOperation(`character-media:${characterId}`, true);
  useEffect(() => {
    onBusy(op.busy);
    return () => onBusy(false);
  }, [op.busy, onBusy]);
  const [box] = useState(() => characterMediaBox(userId, generation, characterId)),
    [store] = useState(() => characterUploadStore(userId, generation, characterId));
  const [initial] = useState(() => {
    try {
      return { pending: box.read(), upload: store.read(), error: "" };
    } catch (e) {
      return { pending: null, upload: null, error: String(e) };
    }
  });
  const [pending, setPending] = useState(initial.pending),
    [upload, setUpload] = useState(initial.upload),
    [error, setError] = useState(initial.error),
    [detail, setDetail] = useState<LibraryDetail>(),
    [confirmation, setConfirmation] = useState<CharacterMediaCommand>(),
    [preview, setPreview] = useState<{ url: string; kind: CharacterMediaKind }>(),
    [clear, setClear] = useState(false),
    [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void loadLibraryCharacter(workspaceId, characterId, generation, c.signal).then(
      (d) => {
        if (!c.signal.aborted) setDetail(d);
      },
      (e) => {
        if (!c.signal.aborted) setError(String(e));
      }
    );
    return () => c.abort();
  }, [workspaceId, characterId, generation]);
  const waitingForProvider =
    detail?.media.some(
      (m) => m.mirror?.status === "pending" || m.mirror?.status === "processing"
    ) === true;
  useEffect(() => {
    if (!waitingForProvider || op.busy) return;
    const c = new AbortController();
    let loading = false;
    const timer = setInterval(() => {
      if (loading) return;
      loading = true;
      void loadLibraryCharacter(workspaceId, characterId, generation, c.signal)
        .then(
          (d) => {
            if (!c.signal.aborted) setDetail(d);
          },
          (e) => {
            if (!c.signal.aborted) {
              setPreview(undefined);
              setError(e instanceof Error ? e.message : String(e));
            }
          }
        )
        .finally(() => {
          loading = false;
        });
    }, 5000);
    return () => {
      clearInterval(timer);
      c.abort();
    };
  }, [waitingForProvider, op.busy, workspaceId, characterId, generation]);
  const records = () => {
    setPending(box.read());
    setUpload(store.read());
  };
  const fail = (e: unknown) => {
    if (controller.current?.signal.aborted || generation !== getAuthGeneration()) return;
    setError(e instanceof Error ? e.message : String(e));
    setConfirmation(undefined);
    setPreview(undefined);
    try {
      records();
    } catch {
      /* Preserve invalid checkpoint. */
    }
  };
  const apply = (d: LibraryDetail | null) => {
    if (d) {
      setDetail(d);
      onDetail(d);
    }
    setConfirmation(undefined);
    setError("");
    setMessage(t("characterMedia.current"));
    records();
  };
  const run = (task: () => Promise<LibraryDetail | null>) => void op.run(task, apply, fail);
  const choose = (action: CharacterMediaAction) => {
    if (!detail) return;
    try {
      setConfirmation(prepareCharacterMedia(detail, action, uuid.v4()));
      setPreview(undefined);
      setError("");
    } catch (e) {
      fail(e);
    }
  };
  const pick = (kind: CharacterMediaKind) =>
    run(async () => {
      const uploaded = await uploadCharacterMedia(
        workspaceId,
        characterId,
        kind,
        userId,
        generation,
        uuid.v4(),
        controller.current!.signal
      );
      if (!uploaded) return null;
      return finishCharacterUpload(userId, generation, characterId, controller.current!.signal);
    });
  const disabled =
    op.busy ||
    !!pending ||
    !!upload ||
    !!initial.error ||
    !canEdit ||
    !detail ||
    ["disabled", "revoked"].includes(detail.status);
  const ordered =
    detail?.media.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)) ??
    [];
  const move = (mediaId: string, direction: -1 | 1) => {
    const i = ordered.findIndex((m) => m.id === mediaId);
    let j = i + direction;
    while (j >= 0 && j < ordered.length && ordered[j].mediaKind !== ordered[i].mediaKind)
      j += direction;
    if (j < 0 || j >= ordered.length) return;
    const next = ordered.map((m) => m.id);
    [next[i], next[j]] = [next[j], next[i]];
    choose({ kind: "order", order: next });
  };
  return (
    <View style={{ gap: 8 }}>
      <Button label={t("likenessGrants.refresh")} onPress={refresh} disabled={op.busy} />
      {error ? (
        <ThemedText accessibilityRole="alert">{error}</ThemedText>
      ) : !detail ? (
        <ActivityIndicator />
      ) : null}
      {op.busy ? <ActivityIndicator accessibilityLabel={t("characterMedia.working")} /> : null}
      {message ? <ThemedText>{message}</ThemedText> : null}
      {pending || upload ? (
        <View style={{ gap: 8 }}>
          <ThemedText>
            {t(upload ? "characterMedia.uploadPending" : "characterMedia.pending")}
          </ThemedText>
          {upload ? <ThemedText>{upload.fileName}</ThemedText> : null}
          <Button
            label={t("characterMedia.resume")}
            disabled={op.busy}
            onPress={() =>
              run(() =>
                upload
                  ? finishCharacterUpload(
                      userId,
                      generation,
                      characterId,
                      controller.current!.signal
                    )
                  : reconcileCharacterMedia(
                      userId,
                      generation,
                      characterId,
                      controller.current!.signal
                    )
              )
            }
          />
          <Button label={t("casting.clear")} disabled={op.busy} onPress={() => setClear(true)} />
          {clear ? (
            <>
              <ThemedText>{t("characterMedia.clearHint")}</ThemedText>
              <Button
                label={t("casting.confirm")}
                onPress={() => {
                  try {
                    if (pending) box.clear(pending.clientKey);
                    if (upload) store.clear(upload.clientKey);
                    refresh();
                  } catch (e) {
                    fail(e);
                  }
                }}
              />
              <Button label={t("report.cancel")} onPress={() => setClear(false)} />
            </>
          ) : null}
        </View>
      ) : null}
      {(["image", "video", "audio"] as const).map((kind) => {
        const group = ordered.filter((m) => m.mediaKind === kind);
        return (
          <View key={kind} style={{ gap: 6 }}>
            <ThemedText type="smallBold">
              {t(`characterMedia.kind.${kind}`)} ({group.length}/{CHARACTER_MEDIA_CAPS[kind]})
            </ThemedText>
            {group.map((m, i) => (
              <View key={m.id} style={{ gap: 4 }}>
                <ThemedText>
                  {t(`characterMedia.kind.${kind}`)} {i + 1}
                  {detail?.coverAssetId === m.mediaAssetId ? ` · ${t("characterMedia.cover")}` : ""}
                </ThemedText>
                {m.mirror ? (
                  <ThemedText type="small">
                    {t(`characterMedia.mirror.${m.mirror.status}`)}
                    {m.mirror.statusReason ? ` · ${m.mirror.statusReason}` : ""}
                  </ThemedText>
                ) : null}
                <Button
                  label={t("characterMedia.preview")}
                  disabled={op.busy}
                  onPress={() => {
                    setPreview(undefined);
                    void op.run(
                      () =>
                        previewCharacterMedia(
                          workspaceId,
                          characterId,
                          m.id,
                          generation,
                          controller.current!.signal
                        ),
                      setPreview,
                      fail
                    );
                  }}
                />
                {canEdit ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                    <Button
                      label={t("characterMedia.up")}
                      disabled={disabled || i === 0}
                      onPress={() => move(m.id, -1)}
                    />
                    <Button
                      label={t("characterMedia.down")}
                      disabled={disabled || i === group.length - 1}
                      onPress={() => move(m.id, 1)}
                    />
                    {kind === "image" && detail?.coverAssetId !== m.mediaAssetId ? (
                      <Button
                        label={t("characterMedia.setCover")}
                        disabled={disabled}
                        onPress={() => choose({ kind: "cover", assetId: m.mediaAssetId })}
                      />
                    ) : null}
                    <Button
                      label={t("characterMedia.remove")}
                      disabled={disabled}
                      onPress={() => choose({ kind: "remove", mediaId: m.id })}
                    />
                  </View>
                ) : null}
              </View>
            ))}
            {canEdit ? (
              <Button
                label={t(`characterMedia.add.${kind}`)}
                disabled={
                  disabled ||
                  group.length >= CHARACTER_MEDIA_CAPS[kind] ||
                  (detail?.kind === "real_person" && detail.status !== "active")
                }
                onPress={() => pick(kind)}
              />
            ) : null}
          </View>
        );
      })}
      {canEdit && detail?.coverAssetId ? (
        <Button
          label={t("characterMedia.clearCover")}
          disabled={disabled}
          onPress={() => choose({ kind: "cover", assetId: null })}
        />
      ) : null}
      {confirmation ? (
        <View>
          <ThemedText>
            {t(
              confirmation.action.kind === "remove"
                ? "characterMedia.removeHint"
                : "characterMedia.confirmHint"
            )}
          </ThemedText>
          <Button
            label={t("casting.confirm")}
            disabled={disabled}
            onPress={() =>
              run(() =>
                submitCharacterMedia(confirmation, userId, generation, controller.current!.signal)
              )
            }
          />
          <Button
            label={t("report.cancel")}
            disabled={op.busy}
            onPress={() => setConfirmation(undefined)}
          />
        </View>
      ) : null}
      {preview ? (
        <View style={{ gap: 8 }}>
          <View style={{ height: 240 }}>
            {preview.kind === "image" ? (
              <Image
                source={{ uri: preview.url }}
                cachePolicy="none"
                contentFit="contain"
                style={{ width: "100%", height: 240 }}
                accessibilityLabel={t("characterMedia.preview")}
                onError={() => {
                  setPreview(undefined);
                  setError(t("thread.previewFailed"));
                }}
              />
            ) : preview.kind === "video" ? (
              <ConversationVideo url={preview.url} onRetry={() => setPreview(undefined)} />
            ) : (
              <ConversationAudio url={preview.url} />
            )}
          </View>
          <Button label={t("thread.closePreview")} onPress={() => setPreview(undefined)} />
        </View>
      ) : null}
    </View>
  );
}
