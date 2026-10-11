import { Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useLocale, useTranslations } from "@/i18n";
import { useSavedOpening } from "./use-saved-opening";
export function SaveOpening({ positionId }: { positionId: string }) {
  const auth = useAuth(),
    gate = useAuthGate(),
    active = useScreenActive(),
    locale = useLocale(),
    t = useTranslations();
  const userId =
    auth.status === "authenticated" ? String(auth.user?.userId ?? auth.user?.id ?? "") : null;
  const state = useSavedOpening(
    auth.generation,
    userId,
    locale,
    positionId,
    active && auth.status !== "hydrating"
  );
  const disabled = !active || auth.status === "hydrating" || Boolean(userId && state.busy);
  const label =
    userId && !state.known && !state.busy
      ? t("common.retry")
      : t(state.saved ? "savedOpenings.remove" : "savedOpenings.save");
  return (
    <View style={{ gap: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled, selected: state.saved }}
        disabled={disabled}
        onPress={() => {
          if (!userId) gate.requireAuth();
          else if (!state.known) state.retry();
          else void state.toggle();
        }}
        style={{ minHeight: 44, paddingVertical: 12, opacity: disabled ? 0.5 : 1 }}
      >
        <ThemedText>{label}</ThemedText>
      </Pressable>
      {state.error && <ThemedText accessibilityRole="alert">{state.error}</ThemedText>}
    </View>
  );
}
