import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { TaskMentionPicker } from "./task-mention-picker";
import { createAgreement, newAgreement, type NewAgreement } from "./agreement-create-api";
export function AgreementCreate(props: {
  crewId: string;
  userId: string;
  generation: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(props.crewId, true);
  const [draft, setDraft] = useState<NewAgreement>({
    memberUserId: "",
    signerName: "",
    signerEmail: "",
    title: "",
  });
  const [picker, setPicker] = useState(false),
    [review, setReview] = useState<NewAgreement>(),
    [error, setError] = useState<string>(),
    [attempted, setAttempted] = useState(false);
  const sent = useRef(false);
  const locked = attempted || op.busy;
  if (picker)
    return (
      <TaskMentionPicker
        crewId={props.crewId}
        userId={props.userId}
        generation={props.generation}
        includeSelf
        excludedIds={[]}
        onClose={() => setPicker(false)}
        onSelect={(member) => {
          if (props.generation !== getAuthGeneration()) return;
          setDraft((old) => ({
            ...old,
            memberUserId: member.userId,
            signerName: member.label,
            signerEmail: old.memberUserId === member.userId ? old.signerEmail : "",
          }));
          setPicker(false);
        }}
      />
    );
  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText>{t("agreementCreate.title")}</ThemedText>
      <ThemedText>{t("agreementCreate.help")}</ThemedText>
      {!review ? (
        <>
          <Pressable
            accessibilityRole="button"
            style={{ padding: 12 }}
            onPress={() => setPicker(true)}
          >
            <ThemedText>
              {t("agreementCreate.member")} * · {draft.memberUserId}
            </ThemedText>
          </Pressable>
          {(["signerName", "signerEmail", "title"] as const).map((field) => (
            <View key={field} style={{ gap: 6 }}>
              <ThemedText>
                {t(`agreementCreate.${field === "title" ? "agreementTitle" : field}`)} *
              </ThemedText>
              <TextInput
                accessibilityLabel={t(
                  `agreementCreate.${field === "title" ? "agreementTitle" : field}`
                )}
                value={draft[field]}
                editable={!locked}
                autoCapitalize={field === "signerEmail" ? "none" : "sentences"}
                keyboardType={field === "signerEmail" ? "email-address" : "default"}
                maxLength={field === "signerName" ? 128 : field === "title" ? 180 : 320}
                style={{
                  color: theme.text,
                  borderColor: theme.text,
                  borderWidth: 1,
                  borderRadius: 8,
                  padding: 12,
                }}
                onChangeText={(value) => setDraft((old) => ({ ...old, [field]: value }))}
              />
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            style={{ padding: 12 }}
            onPress={() => {
              const parsed = newAgreement.safeParse(draft);
              if (!parsed.success) {
                setError(t("agreementCreate.invalid"));
                return;
              }
              setError(undefined);
              setReview(parsed.data);
            }}
          >
            <ThemedText>{t("agreementCreate.review")}</ThemedText>
          </Pressable>
        </>
      ) : (
        <>
          <ThemedText>{review.title}</ThemedText>
          <ThemedText>
            {review.memberUserId} · {review.signerName} · {review.signerEmail}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            style={{ padding: 12 }}
            disabled={locked}
            onPress={() => {
              if (sent.current || props.generation !== getAuthGeneration()) return;
              void op.run(
                () => {
                  sent.current = true;
                  setAttempted(true);
                  return createAgreement(props.crewId, review, props.generation);
                },
                props.onSaved,
                (cause) => setError(cause instanceof Error ? cause.message : String(cause))
              );
            }}
          >
            <ThemedText>{t("agreementCreate.confirm")}</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={{ padding: 12 }}
            disabled={locked}
            onPress={() => setReview(undefined)}
          >
            <ThemedText>{t("agreementCreate.edit")}</ThemedText>
          </Pressable>
        </>
      )}
      {op.busy && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {attempted && <ThemedText>{t("agreementCreate.checkList")}</ThemedText>}
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        disabled={op.busy}
        onPress={props.onClose}
      >
        <ThemedText>{t("crewAgreements.backToList")}</ThemedText>
      </Pressable>
    </ScrollView>
  );
}
