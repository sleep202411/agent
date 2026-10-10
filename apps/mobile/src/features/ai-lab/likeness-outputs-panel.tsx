import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Image } from "expo-image";
import { uuid } from "expo-modules-core";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { ConversationVideo } from "@/features/services/conversation-video";
import { useTranslations } from "@/i18n";
import {
  loadLikenessOutputs,
  likenessTakedownBox,
  prepareLikenessTakedown,
  submitLikenessTakedown,
  previewLikenessOutput,
  type LikenessOutputJob,
  type LikenessTakedown,
  type TakedownScope,
} from "./likeness-outputs-api";
type Props = { characterId: string; characterName: string; userId: string; generation: number };
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
export function LikenessOutputsPanel(props: Props) {
  const t = useTranslations();
  const [open, setOpen] = useState(false),
    [epoch, setEpoch] = useState(0);
  return (
    <View style={{ gap: 8 }}>
      <Button
        label={t(open ? "likenessOutputs.hide" : "likenessOutputs.title")}
        onPress={() => setOpen((v) => !v)}
      />
      {open ? <Outputs key={epoch} {...props} refresh={() => setEpoch((v) => v + 1)} /> : null}
    </View>
  );
}
function Outputs({
  characterId,
  characterName,
  userId,
  generation,
  refresh,
}: Props & { refresh: () => void }) {
  const t = useTranslations(),
    op = useAuthFormOperation(`outputs:${characterId}`, true);
  const [box] = useState(() => likenessTakedownBox(userId, generation, characterId));
  const [initial] = useState(() => {
    try {
      return { pending: box.read(), error: "" };
    } catch (e) {
      return { pending: null, error: String(e) };
    }
  });
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState(initial.pending),
    [error, setError] = useState(initial.error),
    [rows, setRows] = useState<LikenessOutputJob[]>(),
    [confirmation, setConfirmation] = useState<LikenessTakedown>(),
    [receipt, setReceipt] = useState<number>(),
    [clear, setClear] = useState(false),
    [preview, setPreview] = useState<{ url: string; mimeType: string | null }>();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void loadLikenessOutputs(characterId, generation, c.signal).then(
      (r) => {
        if (!c.signal.aborted) setRows(r);
      },
      (e) => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      }
    );
    return () => c.abort();
  }, [characterId, generation, reload]);
  const fail = (e: unknown) => {
    if (controller.current?.signal.aborted || generation !== getAuthGeneration()) return;
    setError(e instanceof Error ? e.message : String(e));
    setRows(undefined);
    setPreview(undefined);
    setConfirmation(undefined);
    try {
      setPending(box.read());
    } catch {
      /* Keep invalid record intact. */
    }
  };
  const select = (scope: TakedownScope) => {
    if (!rows || pending) return;
    try {
      setPreview(undefined);
      setReceipt(undefined);
      setConfirmation(prepareLikenessTakedown(characterId, characterName, rows, scope, uuid.v4()));
    } catch (e) {
      fail(e);
    }
  };
  const submit = () => {
    if (!confirmation || pending) return;
    void op.run(
      () => submitLikenessTakedown(confirmation, userId, generation, controller.current!.signal),
      (r) => {
        setReceipt(r.blocked);
        setConfirmation(undefined);
        setPreview(undefined);
        setRows(undefined);
        setError("");
        setReload((value) => value + 1);
      },
      fail
    );
  };
  const scopeLabel = (scope: TakedownScope) =>
    scope.kind === "all"
      ? t("likenessOutputs.all")
      : scope.kind === "project"
        ? `${t("likenessOutputs.project")} ${scope.projectId.slice(0, 8)}`
        : `${t("likenessOutputs.job")} ${scope.jobId.slice(0, 8)}`;
  return (
    <View style={{ gap: 10 }}>
      <ThemedText type="small">{t("likenessOutputs.hint")}</ThemedText>
      <Button label={t("likenessGrants.refresh")} onPress={refresh} disabled={op.busy} />
      {error ? (
        <ThemedText accessibilityRole="alert">{error}</ThemedText>
      ) : !rows ? (
        <ActivityIndicator />
      ) : null}
      {pending ? (
        <View style={{ gap: 8 }}>
          <ThemedText>{t("likenessOutputs.pending")}</ThemedText>
          <ThemedText type="small">{scopeLabel(pending.scope)}</ThemedText>
          <Button label={t("casting.clear")} onPress={() => setClear(true)} disabled={op.busy} />
          {clear ? (
            <>
              <ThemedText>{t("likenessOutputs.clearHint")}</ThemedText>
              <Button
                label={t("casting.confirm")}
                disabled={op.busy}
                onPress={() => {
                  try {
                    box.clear(pending.clientKey);
                    setPending(null);
                    setClear(false);
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
      {receipt !== undefined ? (
        <>
          <ThemedText>
            {t("likenessOutputs.receipt").replace("{count}", String(receipt))}
          </ThemedText>
          <ThemedText type="small">{t("likenessOutputs.receiptHint")}</ThemedText>
        </>
      ) : null}
      {!error && rows?.length === 0 ? <ThemedText>{t("likenessOutputs.empty")}</ThemedText> : null}
      {!error && rows && rows.some((r) => r.outputs.some((o) => o.assetId)) ? (
        <Button
          label={t("likenessOutputs.takeAll")}
          disabled={!!pending || op.busy}
          onPress={() => select({ kind: "all" })}
        />
      ) : null}
      {!error
        ? rows?.map((job) => (
            <View key={job.jobId} style={{ gap: 8, paddingVertical: 8 }}>
              <ThemedText type="smallBold">
                {job.projectId
                  ? `${t("likenessOutputs.project")} ${job.projectId.slice(0, 8)}`
                  : t("likenessOutputs.noProject")}
              </ThemedText>
              <ThemedText type="small">
                {t("likenessOutputs.job")} {job.jobId.slice(0, 8)} ·{" "}
                {new Date(job.createdAt).toLocaleDateString()}
              </ThemedText>
              {job.outputs.map((asset, index) => (
                <View key={`${asset.assetId}:${index}`}>
                  <ThemedText type="small">
                    {asset.mimeType ?? t("likenessOutputs.unknownType")} ·{" "}
                    {t(
                      asset.moderationStatus === "blocked"
                        ? "likenessOutputs.blocked"
                        : "likenessOutputs.unknown"
                    )}
                  </ThemedText>
                  {asset.assetId && asset.moderationStatus !== "blocked" ? (
                    <Button
                      label={t("likenessOutputs.preview")}
                      disabled={op.busy}
                      onPress={() =>
                        void op.run(
                          () =>
                            previewLikenessOutput(
                              characterId,
                              job.jobId,
                              asset.assetId!,
                              generation,
                              controller.current!.signal
                            ),
                          setPreview,
                          fail
                        )
                      }
                    />
                  ) : null}
                </View>
              ))}
              {job.outputs.some((o) => o.assetId) ? (
                <Button
                  label={t("likenessOutputs.takeJob")}
                  disabled={!!pending || op.busy}
                  onPress={() => select({ kind: "job", jobId: job.jobId })}
                />
              ) : null}
              {job.projectId &&
              rows.find((r) => r.projectId === job.projectId)?.jobId === job.jobId &&
              rows.some(
                (r) => r.projectId === job.projectId && r.outputs.some((o) => o.assetId)
              ) ? (
                <Button
                  label={t("likenessOutputs.takeProject")}
                  disabled={!!pending || op.busy}
                  onPress={() => select({ kind: "project", projectId: job.projectId! })}
                />
              ) : null}
            </View>
          ))
        : null}
      {preview ? (
        <View style={{ gap: 8 }}>
          {preview.mimeType?.startsWith("video/") ? (
            <View style={{ height: 220 }}>
              <ConversationVideo url={preview.url} onRetry={() => setPreview(undefined)} />
            </View>
          ) : preview.mimeType?.startsWith("image/") ? (
            <Image
              source={{ uri: preview.url }}
              cachePolicy="none"
              contentFit="contain"
              style={{ height: 220, width: "100%" }}
              onError={() => {
                setPreview(undefined);
                setError(t("likenessOutputs.previewFailed"));
              }}
            />
          ) : (
            <ThemedText>{t("likenessOutputs.unsupported")}</ThemedText>
          )}
          <Button label={t("thread.closePreview")} onPress={() => setPreview(undefined)} />
        </View>
      ) : null}
      {confirmation ? (
        <View style={{ gap: 8 }}>
          <ThemedText type="smallBold">{scopeLabel(confirmation.scope)}</ThemedText>
          <ThemedText>{t("likenessOutputs.confirmHint")}</ThemedText>
          <Button
            label={t("likenessOutputs.confirm")}
            disabled={op.busy || !!pending}
            onPress={submit}
          />
          <Button
            label={t("report.cancel")}
            disabled={op.busy}
            onPress={() => setConfirmation(undefined)}
          />
        </View>
      ) : null}
    </View>
  );
}
