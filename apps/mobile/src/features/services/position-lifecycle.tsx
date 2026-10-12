import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { crewPositionLabel } from "@/lib/crew-position-label";
import type { ManagedPosition } from "./invitation-management-api";
import {
  fetchLifecyclePosition,
  changePositionLifecycle,
  type PositionAction,
} from "./position-lifecycle-api";
export function PositionLifecycle(props: {
  position: ManagedPosition;
  userId: string;
  generation: number;
  onClose: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(props.position.id, true);
  const [position, setPosition] = useState<ManagedPosition>(),
    [error, setError] = useState<string>(),
    [action, setAction] = useState<PositionAction>(),
    [attempted, setAttempted] = useState(false),
    [done, setDone] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    void fetchLifecyclePosition(props.position, props.userId, props.generation, c.signal).then(
      (value) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) setPosition(value);
      },
      (cause) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => c.abort();
  }, [props.position, props.userId, props.generation]);
  const button = (label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: op.busy }}
      disabled={op.busy}
      onPress={onPress}
      style={{
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.backgroundElement,
      }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
  const confirm = () => {
    if (!position || !action || attempted || props.generation !== getAuthGeneration()) return;
    void op.run(
      () => {
        setAttempted(true);
        setError(undefined);
        return changePositionLifecycle(position, props.userId, props.generation, action);
      },
      () => setDone(true),
      (cause) => setError(cause instanceof Error ? cause.message : String(cause))
    );
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("positionLifecycle.title")}</ThemedText>
      {!position && !error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {position && !attempted && (
        <>
          <ThemedText>
            {crewPositionLabel(position.positionType, t)} · {position.recruitedCount}/
            {position.targetCount}
          </ThemedText>
          <ThemedText>{t(`positionLifecycle.${position.status}`)}</ThemedText>
        </>
      )}
      {position &&
        !attempted &&
        (!action ? (
          <>
            {button(
              t(
                position.status === "frozen"
                  ? "positionLifecycle.reopen"
                  : "positionLifecycle.freeze"
              ),
              () => setAction(position.status === "frozen" ? "reopen" : "freeze")
            )}
            {button(t("positionLifecycle.remove"), () => setAction("remove"))}
          </>
        ) : (
          <>
            <ThemedText>
              {t(
                `positionLifecycle.confirm${action === "remove" ? "Remove" : action === "freeze" ? "Freeze" : "Reopen"}`
              )}
            </ThemedText>
            {button(t("positionLifecycle.confirm"), confirm)}
            {button(t("positionLifecycle.cancel"), () => setAction(undefined))}
          </>
        ))}
      {op.busy && <ActivityIndicator />}
      {attempted && !op.busy && (
        <ThemedText>{t(done ? "positionLifecycle.saved" : "positionLifecycle.recheck")}</ThemedText>
      )}
      {button(t("nativeApplications.back"), props.onClose)}
    </ScrollView>
  );
}
