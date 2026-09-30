import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Pressable, ScrollView, TextInput } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { appEnv } from "@/config/app-env";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import {
  acceptStudioInvite,
  canAcceptStudioInvite,
  parseStudioInviteLink,
  previewStudioInvite,
  StudioInviteAcceptError,
  type StudioInvitePreview,
  type StudioInviteTarget,
} from "./api/studio-invite-accept-api";
type Props = {
  initialLink?: string;
  generation: number;
  onClose: () => void;
  onOpen: (target: StudioInviteTarget) => void | Promise<void>;
};
export function StudioInviteAccept(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Session key={`${props.generation}:${props.initialLink ?? ""}`} {...props} />
  ) : null;
}
function Session({ generation, onClose, onOpen, initialLink }: Props) {
  const t = useTranslations(),
    theme = useTheme(),
    active = useScreenActive();
  const [link, setLink] = useState(initialLink ?? "");
  const [review, setReview] = useState<{ token: string; value: StudioInvitePreview }>();
  const [result, setResult] = useState<StudioInviteTarget>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const operation = useRef(false),
    alive = useRef(true),
    pending = useRef<AbortController | null>(null);
  const current = () => alive.current && generation === getAuthGeneration();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (active) return;
    pending.current?.abort();
    void Promise.resolve().then(() => {
      if (alive.current) {
        setReview(undefined);
        setResult(undefined);
      }
    });
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!operation.current) onClose();
      return true;
    });
    return () => sub.remove();
  }, [active, onClose]);
  async function preview() {
    if (operation.current || !active || !current()) return;
    operation.current = true;
    setBusy(true);
    setError(undefined);
    setReview(undefined);
    setResult(undefined);
    const c = new AbortController();
    pending.current = c;
    try {
      const token = parseStudioInviteLink(link, appEnv.appRegion);
      const value = await previewStudioInvite(token, generation, c.signal);
      if (current() && !c.signal.aborted) {
        setReview({ token, value });
        setUncertain(false);
      }
    } catch (e) {
      if (current() && !c.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      operation.current = false;
      if (current()) setBusy(false);
    }
  }
  async function join() {
    if (!review || operation.current || !active || !current() || uncertain) return;
    operation.current = true;
    setBusy(true);
    setError(undefined);
    const c = new AbortController();
    pending.current = c;
    try {
      const target = await acceptStudioInvite(review.token, review.value, generation, c.signal);
      if (current() && !c.signal.aborted) setResult(target);
    } catch (e) {
      if (current()) {
        setError(e instanceof Error ? e.message : String(e));
        if (e instanceof StudioInviteAcceptError) setUncertain(true);
        else setReview(undefined);
      }
    } finally {
      operation.current = false;
      if (current()) setBusy(false);
    }
  }
  if (!active) return null;
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText type="smallBold">{t("studioJoin.title")}</ThemedText>
      <ThemedText type="small">{t("studioJoin.help")}</ThemedText>
      <TextInput
        accessibilityLabel={t("studioJoin.link")}
        placeholder={t("studioJoin.link")}
        placeholderTextColor={theme.textSecondary}
        value={link}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        onChangeText={(v) => {
          setLink(v);
          setReview(undefined);
          setResult(undefined);
          setError(undefined);
        }}
        style={{
          color: theme.text,
          padding: 12,
          borderWidth: 1,
          borderColor: theme.textSecondary,
          borderRadius: 8,
        }}
      />
      <Action
        label={t("studioJoin.preview")}
        disabled={busy || !link.trim()}
        onPress={() => void preview()}
      />
      {review && (
        <>
          <ThemedText type="smallBold">{review.value.targetName}</ThemedText>
          <ThemedText>
            {t(`studioJoin.${review.value.scope}`)} · {t(`studioInvites.${review.value.role}`)}
          </ThemedText>
          <ThemedText>
            {t(`studioInvites.${review.value.status}`)} ·{" "}
            {review.value.expiresAt === null
              ? t("studioInvites.never")
              : new Date(review.value.expiresAt).toLocaleString()}
          </ThemedText>
          {!result && (
            <Action
              label={t(review.value.existingAccess ? "studioJoin.existing" : "studioJoin.accept")}
              disabled={
                busy ||
                uncertain ||
                (!review.value.existingAccess && !canAcceptStudioInvite(review.value))
              }
              onPress={() => void join()}
            />
          )}
        </>
      )}
      {result && (
        <>
          <ThemedText>{t("studioJoin.ready")}</ThemedText>
          <Action
            label={t("studioJoin.open")}
            disabled={busy}
            onPress={() => {
              if (!current() || operation.current) return;
              operation.current = true;
              setBusy(true);
              void Promise.resolve()
                .then(() => onOpen(result))
                .catch((e) => {
                  if (current()) setError(e instanceof Error ? e.message : String(e));
                })
                .finally(() => {
                  operation.current = false;
                  if (current()) setBusy(false);
                });
            }}
          />
        </>
      )}
      {uncertain && <ThemedText>{t("studioJoin.uncertain")}</ThemedText>}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {busy && <ActivityIndicator />}
      <Action label={t("crewTasks.back")} disabled={busy} onPress={onClose} />
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
