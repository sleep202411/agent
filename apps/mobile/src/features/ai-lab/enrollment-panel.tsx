import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { appEnv } from "@/config/app-env";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import type { LibraryDetail } from "./character-library-api";
import {
  completeEnrollment,
  enrollmentErrorCode,
  loadEnrollmentStatus,
  startEnrollment,
  type EnrollmentScope,
  type EnrollmentSession,
  type EnrollmentStatus,
} from "./enrollment-api";
import { EnrollmentFrame } from "./enrollment-frame";
export function EnrollmentPanel({
  scope,
  onDetail,
  onClose,
}: {
  scope: EnrollmentScope;
  onDetail: (detail: LibraryDetail) => void;
  onClose: () => void;
}) {
  const t = useTranslations(),
    active = useScreenActive();
  const [session, setSession] = useState<EnrollmentSession>(),
    [status, setStatus] = useState<EnrollmentStatus>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [waiting, setWaiting] = useState(false),
    [attempted, setAttempted] = useState(false),
    [confirmRestart, setConfirmRestart] = useState(false),
    [now, setNow] = useState(() => Date.now());
  const owner = useRef<AbortController | null>(null),
    locked = useRef(false);
  const current = (c: AbortController) =>
    owner.current === c && !c.signal.aborted && scope.generation === getAuthGeneration();
  const finish = async (c: AbortController) => {
    const detail = await completeEnrollment(scope, c.signal);
    if (!current(c)) return;
    if (detail.status === "active") {
      setSession(undefined);
      setWaiting(false);
      onDetail(detail);
    } else {
      setWaiting(false);
      setStatus({ sessionStatus: "none", characterStatus: detail.status });
      setError(t("enrollment.notVerified"));
    }
  };
  const run = async (action: "status" | "start" | "complete", automatic = false) => {
    const c = owner.current;
    if (!c || !active || !current(c) || locked.current) return;
    locked.current = true;
    setBusy(true);
    if (!automatic) {
      setError("");
      setConfirmRestart(false);
    }
    try {
      if (action === "start") {
        setAttempted(true);
        setSession(undefined);
        setWaiting(false);
        setStatus(undefined);
        const next = await startEnrollment(scope, c.signal);
        if (current(c)) {
          setSession(next);
          setNow(Date.now());
          setStatus({
            sessionStatus: "pending",
            characterStatus: "pending_verification",
            expiresAt: next.expiresAt,
          });
        }
      } else if (action === "complete") await finish(c);
      else {
        const next = await loadEnrollmentStatus(scope, c.signal);
        if (!current(c)) return;
        setStatus(next);
        if (next.sessionStatus === "completed" || next.characterStatus === "active")
          await finish(c);
        else if (["failed", "expired"].includes(next.sessionStatus)) {
          setSession(undefined);
          setWaiting(false);
        }
      }
    } catch (e) {
      if (!current(c)) return;
      const code = enrollmentErrorCode(e);
      if (action === "complete" && code === "ENROLLMENT_NOT_COMPLETED") setWaiting(true);
      else {
        setWaiting(false);
        setError(e instanceof Error ? e.message : String(e));
        if (code === "ENROLLMENT_SESSION_EXPIRED") {
          setSession(undefined);
          setStatus({ sessionStatus: "expired", characterStatus: "pending_verification" });
        }
      }
    } finally {
      if (current(c)) {
        locked.current = false;
        setBusy(false);
      }
    }
  };
  const poll = useEffectEvent((action: "status" | "complete") => void run(action, true));
  useEffect(() => {
    const c = new AbortController();
    owner.current = c;
    return () => {
      c.abort();
      owner.current = null;
      locked.current = false;
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    const initial = setTimeout(() => poll("status"), 0);
    const timer = setInterval(() => {
      poll(waiting ? "complete" : "status");
    }, 5000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [active, waiting]);
  useEffect(() => {
    if (!active || !session) return;
    const tick = () => {
      setNow(Date.now());
      if (Date.parse(session.expiresAt) <= Date.now()) {
        setSession(undefined);
        setWaiting(false);
        setStatus({ sessionStatus: "expired", characterStatus: "pending_verification" });
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [active, session]);
  const restart = attempted || (!!status && status.sessionStatus !== "none");
  return (
    <View style={{ gap: 10 }}>
      <ThemedText type="smallBold">{t("enrollment.title")}</ThemedText>
      <ThemedText type="small">{t("enrollment.sameSession")}</ThemedText>
      {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
      {busy ? <ActivityIndicator /> : null}
      {status ? <ThemedText>{t(`enrollment.status.${status.sessionStatus}`)}</ThemedText> : null}
      {!session && (attempted || status?.sessionStatus === "pending") ? (
        <ThemedText type="small">{t("enrollment.lost")}</ThemedText>
      ) : null}
      {session ? (
        <>
          <ThemedText type="small">
            {t("enrollment.remaining").replace(
              "{seconds}",
              String(Math.max(0, Math.ceil((Date.parse(session.expiresAt) - now) / 1000)))
            )}
          </ThemedText>
          <EnrollmentFrame
            key={session.sessionId}
            uri={session.h5Link}
            characterId={scope.characterId}
            callbackOrigin={`https://${appEnv.appRegion === "cn" ? "studio.fizzspace.cn" : "studio.fizzdragon.com"}`}
            title={t("enrollment.title")}
            onComplete={() => {
              setWaiting(true);
              void run("complete");
            }}
            onError={() => {
              setError(t("enrollment.frameError"));
            }}
          />
        </>
      ) : null}
      {waiting ? <ThemedText type="small">{t("enrollment.waiting")}</ThemedText> : null}
      <Action
        label={t("enrollment.check")}
        disabled={busy || !active}
        onPress={() => void run("status")}
      />
      <Action
        label={t("enrollment.complete")}
        disabled={
          busy ||
          !active ||
          (!session && status?.sessionStatus !== "pending" && status?.sessionStatus !== "completed")
        }
        onPress={() => void run("complete")}
      />
      <Action
        label={t(restart ? "enrollment.restart" : "enrollment.start")}
        disabled={busy || !active || (!status && !attempted)}
        onPress={() => (restart ? setConfirmRestart(true) : void run("start"))}
      />
      {confirmRestart ? (
        <View style={{ gap: 8 }}>
          <ThemedText>{t("enrollment.restartWarning")}</ThemedText>
          <Action
            label={t("casting.confirm")}
            disabled={busy || !active}
            onPress={() => void run("start")}
          />
          <Action
            label={t("report.cancel")}
            disabled={busy || !active}
            onPress={() => setConfirmRestart(false)}
          />
        </View>
      ) : null}
      <Action label={t("enrollment.close")} disabled={busy || !active} onPress={onClose} />
    </View>
  );
}
function Action({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
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
