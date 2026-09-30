import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, Switch } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import type { CrewMember } from "./crew-members-api";
import { transferCrewOwnership } from "./crew-ownership-transfer-api";
type Props = {
  crewId: string;
  userId: string;
  generation: number;
  member: CrewMember;
  name: string;
  onClose: () => void;
  onSuccess: () => void;
};
export function CrewOwnershipTransfer(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Form key={`${props.crewId}:${props.member.id}:${props.generation}`} {...props} />
  ) : null;
}
function Form(props: Props) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(`${props.crewId}:${props.member.id}`, true);
  const [confirmation, setConfirmation] = useState(""),
    [leave, setLeave] = useState(false),
    [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>();
  const transfer = () => {
    if (
      op.busy ||
      attempted ||
      props.member.isOwner ||
      props.member.userId === props.userId ||
      confirmation !== props.member.userId ||
      props.generation !== getAuthGeneration()
    )
      return;
    void op.run(
      async () => {
        setAttempted(true);
        await transferCrewOwnership(
          props.crewId,
          props.userId,
          props.generation,
          props.member,
          leave
        );
      },
      props.onSuccess,
      (e) => setError(e instanceof Error ? e.message : String(e))
    );
  };
  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      <ThemedText type="smallBold">{t("crewTransfer.title")}</ThemedText>
      <ThemedText>
        {props.name} · {props.member.userId}
      </ThemedText>
      <ThemedText>{t("crewTransfer.help")}</ThemedText>
      {props.member.isOwner || props.member.userId === props.userId ? (
        <ThemedText>{t("crewTransfer.protected")}</ThemedText>
      ) : (
        <>
          <ThemedText>{t("crewTransfer.leave")}</ThemedText>
          <Switch
            accessibilityLabel={t("crewTransfer.leave")}
            value={leave}
            onValueChange={setLeave}
            disabled={op.busy || attempted}
          />
          {leave && <ThemedText>{t("crewTransfer.leaveHelp")}</ThemedText>}
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
            label={t("crewTransfer.confirm")}
            disabled={op.busy || attempted || confirmation !== props.member.userId}
            onPress={transfer}
          />
        </>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {attempted && error && <ThemedText>{t("crewTransfer.recheck")}</ThemedText>}
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
