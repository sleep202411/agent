import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { PRESET_POSITIONS } from "@repo/shared/crew";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { crewPositionLabel } from "@/lib/crew-position-label";
import type { CrewMember } from "./crew-members-api";
import { memberPositionsInput, updateCrewMemberPositions } from "./crew-member-positions-api";
type Props = {
  crewId: string;
  userId: string;
  generation: number;
  member: CrewMember;
  name: string;
  onClose: () => void;
  initialPosition?: (typeof PRESET_POSITIONS)[number]["value"];
};
export function CrewMemberPositions(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Form key={`${props.crewId}:${props.member.id}:${props.generation}`} {...props} />
  ) : null;
}
function Form(props: Props) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(`${props.crewId}:${props.member.id}`, true);
  const original = [...props.member.positions]
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
    .map((p) => ({ categoryKey: p.categoryKey, title: p.title ?? "" }));
  const [rows, setRows] = useState(() =>
      props.initialPosition &&
      original.length < 12 &&
      !original.some((p) => p.categoryKey === props.initialPosition)
        ? [...original, { categoryKey: props.initialPosition, title: "" }]
        : original
    ),
    [editing, setEditing] = useState<number>(),
    [armed, setArmed] = useState(false),
    [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>();
  const locked = op.busy || attempted;
  const parsed = memberPositionsInput.safeParse(
    rows.map((r) => ({ ...r, title: r.title.trim() || null }))
  );
  const changed = JSON.stringify(rows) !== JSON.stringify(original);
  const save = () => {
    if (locked || !parsed.success || !changed || props.generation !== getAuthGeneration()) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    void op.run(
      async () => {
        setAttempted(true);
        return updateCrewMemberPositions(
          props.crewId,
          props.userId,
          props.generation,
          props.member,
          parsed.data
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
      <ThemedText type="smallBold">{t("memberPositions.title")}</ThemedText>
      <ThemedText>
        {props.name} · {props.member.userId}
      </ThemedText>
      <ThemedText>{t("memberPositions.help")}</ThemedText>
      {rows.map((row, index) => (
        <View key={index} style={{ gap: 6, padding: 12, backgroundColor: theme.backgroundElement }}>
          <ThemedText>
            {index === 0 ? t("crewMembers.primary") : String(index + 1)} ·{" "}
            {row.categoryKey ? crewPositionLabel(row.categoryKey, t) : t("memberPositions.custom")}
          </ThemedText>
          <Button
            label={t("memberPositions.choose")}
            disabled={locked}
            onPress={() => setEditing(editing === index ? undefined : index)}
          />
          {editing === index && (
            <>
              {[
                { value: null, label: t("memberPositions.custom") },
                ...PRESET_POSITIONS.map((p) => ({
                  value: p.value,
                  label: crewPositionLabel(p.value, t),
                })),
              ].map((p) => (
                <Button
                  key={p.value ?? "custom"}
                  label={p.label}
                  disabled={locked}
                  onPress={() => {
                    setRows((old) =>
                      old.map((v, i) => (i === index ? { ...v, categoryKey: p.value } : v))
                    );
                    setEditing(undefined);
                    setArmed(false);
                  }}
                />
              ))}
            </>
          )}
          <TextInput
            accessibilityLabel={t("memberPositions.customTitle")}
            placeholder={t("memberPositions.customTitle")}
            value={row.title}
            maxLength={128}
            editable={!locked}
            onChangeText={(title) => {
              setRows((old) => old.map((v, i) => (i === index ? { ...v, title } : v)));
              setArmed(false);
            }}
            style={{ color: theme.text, padding: 12 }}
          />
          {index > 0 && (
            <Button
              label={t("memberPositions.makePrimary")}
              disabled={locked}
              onPress={() => {
                setRows((old) => [old[index]!, ...old.filter((_, i) => i !== index)]);
                setEditing(undefined);
                setArmed(false);
              }}
            />
          )}
          <Button
            label={t("memberPositions.remove")}
            disabled={locked}
            onPress={() => {
              setRows((old) => old.filter((_, i) => i !== index));
              setEditing(undefined);
              setArmed(false);
            }}
          />
        </View>
      ))}
      <Button
        label={t("memberPositions.add")}
        disabled={locked || rows.length >= 12}
        onPress={() => {
          setRows((old) => [...old, { categoryKey: null, title: "" }]);
          setArmed(false);
        }}
      />
      {!parsed.success && <ThemedText>{t("memberPositions.invalid")}</ThemedText>}
      {armed && <ThemedText>{t("memberPositions.confirmHelp")}</ThemedText>}
      <Button
        label={t(armed ? "assetOrganization.confirm" : "assetOrganization.save")}
        disabled={locked || !changed || !parsed.success}
        onPress={save}
      />
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
