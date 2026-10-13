import { useRouter } from "expo-router";
import { toHref } from "@/lib/navigation";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Pressable, ScrollView, TextInput } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { appEnv } from "@/config/app-env";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import {
  acceptCrewInvite,
  canAcceptCrewInvite,
  parseCrewInviteLink,
  previewCrewInvite,
  CrewInviteAcceptError,
  type CrewInvitePreview,
  type CrewInviteTarget,
} from "./crew-invite-accept-api";
type Props = {
  initialLink?: string;
  generation: number;
  onClose: () => void;
  onOpen: (target: CrewInviteTarget) => void | Promise<void>;
};
export function CrewInviteAccept(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Session key={`${props.generation}:${props.initialLink ?? ""}`} {...props} />
  ) : null;
}
function Session({ generation, onClose, onOpen, initialLink }: Props) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations(),
    theme = useTheme(),
    active = useScreenActive();
  const [link, setLink] = useState(initialLink ?? "");
  const [review, setReview] = useState<{ token: string; value: CrewInvitePreview }>();
  const [result, setResult] = useState<CrewInviteTarget>();
  const [error, setError] = useState<string>();
  const [qualificationRequired, setQualificationRequired] = useState(false);
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
    setQualificationRequired(false);
    setReview(undefined);
    setResult(undefined);
    const c = new AbortController();
    pending.current = c;
    try {
      const token = parseCrewInviteLink(link, appEnv.appRegion);
      const value = await previewCrewInvite(token, generation, c.signal);
      if (current() && !c.signal.aborted) {
        setReview({ token, value });
      }
    } catch (e) {
      if (current() && !c.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      operation.current = false;
      if (current()) setBusy(false);
    }
  }
  async function join() {
    if (!review || operation.current || !active || !current()) return;
    operation.current = true;
    setBusy(true);
    setError(undefined);
    setQualificationRequired(false);
    const c = new AbortController();
    pending.current = c;
    try {
      const target = await acceptCrewInvite(
        review.token,
        review.value,
        generation,
        c.signal,
        uncertain || !canAcceptCrewInvite(review.value)
      );
      if (current() && !c.signal.aborted) {
        setResult(target);
        setUncertain(false);
      }
    } catch (e) {
      if (current()) {
        setError(e instanceof Error ? e.message : String(e));
        if (e instanceof CrewInviteAcceptError) {
          setQualificationRequired(e.qualificationRequired);
          setUncertain(!e.qualificationRequired);
        } else setReview(undefined);
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
      <ThemedText type="smallBold">{t("crewJoin.title")}</ThemedText>
      <ThemedText type="small">{t("crewJoin.help")}</ThemedText>
      <TextInput
        accessibilityLabel={t("crewJoin.link")}
        placeholder={t("crewJoin.link")}
        placeholderTextColor={theme.textSecondary}
        value={link}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        onChangeText={(v) => {
          setLink(v);
          setUncertain(false);
          setReview(undefined);
          setResult(undefined);
          setError(undefined);
          setQualificationRequired(false);
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
        label={t("crewJoin.preview")}
        disabled={busy || !link.trim()}
        onPress={() => void preview()}
      />
      {review && (
        <>
          <ThemedText type="smallBold">{review.value.targetName}</ThemedText>
          <ThemedText type="small">{t(`crewJoin.${review.value.scope}`)}</ThemedText>
          {review.value.tagline && <ThemedText type="small">{review.value.tagline}</ThemedText>}
          <ThemedText type="small">
            {t("crewJoin.members")} · {review.value.memberCount}
          </ThemedText>
          <ThemedText type="small">
            {t(`crewJoin.${review.value.status}`)} ·{" "}
            {review.value.expiresAt === null
              ? t("crewJoin.never")
              : new Date(review.value.expiresAt).toLocaleString()}
          </ThemedText>
          {review.value.task && (
            <>
              <ThemedText type="smallBold">{review.value.task.title}</ThemedText>
              {!!review.value.task.description && (
                <ThemedText>{review.value.task.description}</ThemedText>
              )}
              <ThemedText>
                {t("crewInvite.taskReward")}:{" "}
                {review.value.task.rewardUsdMinor === null
                  ? t("crewInvite.taskUnspecified")
                  : new Intl.NumberFormat(locale, {
                      style: "currency",
                      currency: review.value.task.rewardCurrency ?? "USD",
                    }).format(review.value.task.rewardUsdMinor / 100)}
              </ThemedText>
              {review.value.task.paymentTerms && (
                <ThemedText>{t(`taskPaymentTerms.${review.value.task.paymentTerms}`)}</ThemedText>
              )}
              {review.value.task.profitShareBps !== null && (
                <ThemedText>
                  {t("crewInvite.taskShare")}: {review.value.task.profitShareBps / 100}%
                </ThemedText>
              )}
              <ThemedText>
                {t("crewInvite.taskDeadline")}:{" "}
                {review.value.task.dueAt
                  ? new Date(review.value.task.dueAt).toLocaleString(locale)
                  : t("crewInvite.taskUnspecified")}
              </ThemedText>
              {!!review.value.task.requiredSkills.length && (
                <ThemedText>
                  {t("crewInvite.taskSkills")}: {review.value.task.requiredSkills.join(" · ")}
                </ThemedText>
              )}
              <ThemedText>{t("crewInvite.taskAcceptExplanation")}</ThemedText>
            </>
          )}
          {!result && (
            <Action
              label={t(
                uncertain || !canAcceptCrewInvite(review.value)
                  ? "crewJoin.recover"
                  : "crewJoin.accept"
              )}
              disabled={busy}
              onPress={() => void join()}
            />
          )}
        </>
      )}
      {result && (
        <>
          <ThemedText>{t("crewJoin.ready")}</ThemedText>
          <Action
            label={t("crewJoin.open")}
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
      {uncertain && <ThemedText>{t("crewJoin.uncertain")}</ThemedText>}
      {review?.value.task && qualificationRequired && !result && (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(toHref("/certification-application"))}
          style={{ padding: 16 }}
        >
          <ThemedText>{t("crewInvite.goVerification")}</ThemedText>
        </Pressable>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {busy && <ActivityIndicator />}
      <Action label={t("common.back")} disabled={busy} onPress={onClose} />
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
