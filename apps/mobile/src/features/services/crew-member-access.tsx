import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import type { CrewMember } from "./crew-members-api";
import { updateCrewMemberAccess, type MemberPolicyKey } from "./crew-member-access-api";
type Props = {
  crewId: string;
  userId: string;
  generation: number;
  member: CrewMember;
  name: string;
  onClose: () => void;
};
export function CrewMemberAccess(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Form key={`${props.crewId}:${props.member.id}:${props.generation}`} {...props} />
  ) : null;
}
function Form(props: Props) {
  const t = useTranslations(),
    op = useAuthFormOperation(`${props.crewId}:${props.member.id}`, true);
  const [policyKeys, setPolicyKeys] = useState<MemberPolicyKey[]>(props.member.policyKeys),
    [confirming, setConfirming] = useState(false),
    [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>();
  const save = () => {
    if (
      op.busy ||
      attempted ||
      props.member.isOwner ||
      !confirming ||
      props.generation !== getAuthGeneration()
    )
      return;
    void op.run(
      async () => {
        setAttempted(true);
        await updateCrewMemberAccess(
          props.crewId,
          props.userId,
          props.generation,
          props.member,
          policyKeys
        );
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
      <ThemedText type="smallBold">{t("memberAccess.title")}</ThemedText>
      <ThemedText>
        {props.name} · {props.member.userId}
      </ThemedText>
      <ThemedText>{t("memberAccess.help")}</ThemedText>
      {props.member.isOwner ? (
        <ThemedText>{t("memberAccess.ownerProtected")}</ThemedText>
      ) : (
        <>
          {([[], ["admin"], ["finance"], ["admin", "finance"]] as MemberPolicyKey[][]).map(
            (keys, i) => (
              <Button
                key={i}
                label={`${JSON.stringify([...policyKeys].sort()) === JSON.stringify([...keys].sort()) ? "✓ " : ""}${t((["memberAccess.standard", "crewMembers.admin", "crewMembers.finance", "memberAccess.both"] as const)[i]!)}`}
                selected={
                  JSON.stringify([...policyKeys].sort()) === JSON.stringify([...keys].sort())
                }
                disabled={op.busy || attempted || confirming}
                onPress={() => setPolicyKeys(keys)}
              />
            )
          )}
          {confirming && <ThemedText>{t("memberAccess.confirmHelp")}</ThemedText>}
          <Button
            label={t(confirming ? "memberAccess.confirm" : "memberAccess.review")}
            disabled={
              op.busy ||
              attempted ||
              JSON.stringify([...policyKeys].sort()) ===
                JSON.stringify([...props.member.policyKeys].sort())
            }
            onPress={() => (confirming ? save() : setConfirming(true))}
          />
          {confirming && (
            <Button
              label={t("memberAccess.edit")}
              disabled={op.busy || attempted}
              onPress={() => setConfirming(false)}
            />
          )}
        </>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {attempted && error && <ThemedText>{t("memberAccess.recheck")}</ThemedText>}
      {op.busy && <ActivityIndicator />}
      <Button label={t("crewTasks.back")} disabled={op.busy} onPress={props.onClose} />
    </ScrollView>
  );
}
function Button({
  label,
  onPress,
  disabled,
  selected,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, selected }}
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
