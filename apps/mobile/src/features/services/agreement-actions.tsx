import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import {
  agreementActionChoices,
  runAgreementAction,
  type ActionAgreement,
  type AgreementAction,
} from "./agreement-actions-api";
export function AgreementActions({
  record,
  generation,
  onSaved,
}: {
  record: ActionAgreement;
  generation: number;
  onSaved: () => void;
}) {
  const t = useTranslations(),
    op = useAuthFormOperation(record.id, true);
  const [choice, setChoice] = useState<AgreementAction>(),
    [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>();
  const sent = useRef(false),
    locked = attempted || op.busy;
  return (
    <View style={{ gap: 12 }}>
      {!choice &&
        agreementActionChoices(record).map((action) => (
          <Pressable
            key={action}
            accessibilityRole="button"
            style={{ padding: 12 }}
            onPress={() => {
              if (generation === getAuthGeneration()) setChoice(action);
            }}
          >
            <ThemedText>{t(`agreementActions.${action}`)}</ThemedText>
          </Pressable>
        ))}
      {choice && (
        <>
          <ThemedText>
            {t(`agreementActions.${choice}`)} · {record.title}
          </ThemedText>
          <ThemedText>{t(`agreementActions.help_${choice}`)}</ThemedText>
          {choice === "send" && (
            <ThemedText>
              {record.signerName} · {record.signerEmail}
            </ThemedText>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={locked}
            style={{ padding: 12 }}
            onPress={() => {
              if (sent.current || generation !== getAuthGeneration()) return;
              void op.run(
                () => {
                  sent.current = true;
                  setAttempted(true);
                  return runAgreementAction(record, choice, generation);
                },
                onSaved,
                (cause) => setError(cause instanceof Error ? cause.message : String(cause))
              );
            }}
          >
            <ThemedText>{t("agreementActions.confirm")}</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={locked}
            style={{ padding: 12 }}
            onPress={() => setChoice(undefined)}
          >
            <ThemedText>{t("common.cancel")}</ThemedText>
          </Pressable>
        </>
      )}
      {op.busy && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {attempted && <ThemedText>{t("agreementActions.refreshHelp")}</ThemedText>}
    </View>
  );
}
