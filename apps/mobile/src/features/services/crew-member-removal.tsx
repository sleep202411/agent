import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { removeCrewMember, type CrewMember } from "./crew-members-api";
type Props = {
  crewId: string;
  userId: string;
  generation: number;
  member: CrewMember;
  name: string;
  onClose: () => void;
};
export function CrewMemberRemoval(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Form key={`${props.crewId}:${props.member.id}:${props.generation}`} {...props} />
  ) : null;
}
function Form(props: Props) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(`${props.crewId}:${props.member.id}`, true);
  const [confirmation, setConfirmation] = useState(""),
    [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>();
  const remove = () => {
    if (
      op.busy ||
      attempted ||
      props.member.isOwner ||
      confirmation !== props.member.userId ||
      props.generation !== getAuthGeneration()
    )
      return;
    void op.run(
      async () => {
        setAttempted(true);
        await removeCrewMember(props.crewId, props.userId, props.generation, props.member);
      },
      props.onClose,
      (e) => setError(e instanceof Error ? e.message : String(e))
    );
  };
  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      <ThemedText type="smallBold">{t("crewMembers.remove")}</ThemedText>
      <ThemedText>
        {props.name} · {props.member.userId}
      </ThemedText>
      <ThemedText>{t("crewMembers.removeHelp")}</ThemedText>
      {props.member.isOwner ? (
        <ThemedText>{t("crewMembers.ownerProtected")}</ThemedText>
      ) : (
        <>
          <ThemedText>{t("crewMembers.confirmId")}</ThemedText>
          <TextInput
            accessibilityLabel={t("crewMembers.confirmId")}
            value={confirmation}
            onChangeText={setConfirmation}
            editable={!op.busy && !attempted}
            autoCapitalize="none"
            autoCorrect={false}
            style={{ color: theme.text, padding: 12, backgroundColor: theme.backgroundElement }}
          />
          <Button
            label={t("crewMembers.confirmRemove")}
            disabled={op.busy || attempted || confirmation !== props.member.userId}
            onPress={remove}
          />
        </>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {attempted && error && <ThemedText>{t("crewMembers.removeRecheck")}</ThemedText>}
      {op.busy && <ActivityIndicator />}
      <Button label={t("crewTasks.back")} disabled={op.busy} onPress={props.onClose} />
    </ScrollView>
  );
}
function Button({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
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
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
