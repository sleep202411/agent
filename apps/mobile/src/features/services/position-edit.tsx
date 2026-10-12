import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { getAuthGeneration } from "@/auth/auth-store";
import { PositionCreate } from "./position-create";
import { fetchEditablePosition, type EditablePosition } from "./position-edit-api";
export function PositionEdit(props: {
  active?: boolean;
  crewId: string;
  positionId: string;
  userId: string;
  generation: number;
  onClose: () => void;
}) {
  const [position, setPosition] = useState<EditablePosition>(),
    [error, setError] = useState<string>();
  const t = useTranslations(),
    theme = useTheme();
  useEffect(() => {
    const c = new AbortController();
    void fetchEditablePosition(
      props.crewId,
      props.positionId,
      props.userId,
      props.generation,
      c.signal
    ).then(
      (row) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) setPosition(row);
      },
      (cause) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => c.abort();
  }, [props.crewId, props.positionId, props.userId, props.generation]);
  if (position) return <PositionCreate {...props} editing={position} />;
  if (props.active === false) return null;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("positionEdit.title")}</ThemedText>
      {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : <ActivityIndicator />}
      <Pressable
        accessibilityRole="button"
        onPress={props.onClose}
        style={{ padding: 12, borderWidth: 1, borderColor: theme.border, borderRadius: 8 }}
      >
        <ThemedText>{t("nativeApplications.back")}</ThemedText>
      </Pressable>
    </ScrollView>
  );
}
