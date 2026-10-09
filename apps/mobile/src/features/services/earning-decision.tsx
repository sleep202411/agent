import { useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import {
  fetchEarningDecisionAccess,
  decideEarning,
  type DecisionEarning,
  type EarningDecision as Decision,
} from "./earning-decision-api";
import { formatFinanceMoney } from "./crew-finance-api";
export function EarningDecision({
  record,
  userId,
  generation,
  onSaved,
}: {
  record: DecisionEarning;
  userId: string;
  generation: number;
  onSaved: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(`${record.id}:${record.version}`, true);
  const [access, setAccess] = useState<Awaited<ReturnType<typeof fetchEarningDecisionAccess>>>(),
    [error, setError] = useState<string>(),
    [choice, setChoice] = useState<Decision>(),
    [reason, setReason] = useState(""),
    [attempted, setAttempted] = useState(false);
  const sent = useRef(false),
    locked = attempted || op.busy;
  useEffect(() => {
    const controller = new AbortController();
    void fetchEarningDecisionAccess(record.crewId, userId, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted && generation === getAuthGeneration()) setAccess(value);
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => controller.abort();
  }, [record.crewId, userId, generation]);
  const choices: Decision[] =
    record.status === "pending" && access?.approve
      ? ["approve", "reject"]
      : record.status === "posted" && access?.reverse
        ? ["reverse"]
        : [];
  return (
    <View style={{ gap: 12 }}>
      {!choice &&
        choices.map((action) => (
          <Pressable
            key={action}
            accessibilityRole="button"
            style={{ padding: 12 }}
            onPress={() => {
              if (generation === getAuthGeneration()) setChoice(action);
            }}
          >
            <ThemedText>{t(`crewFinance.decision_${action}`)}</ThemedText>
          </Pressable>
        ))}
      {choice && (
        <>
          <ThemedText>
            {t(`crewFinance.decision_${choice}`)} · {record.title} ·{" "}
            {formatFinanceMoney(record.amountMinor, record.currency)}
          </ThemedText>
          <ThemedText>{t("crewFinance.decisionHelp")}</ThemedText>
          {choice !== "approve" && (
            <TextInput
              accessibilityLabel={t("crewFinance.decisionReason")}
              placeholder={t("crewFinance.decisionReason")}
              value={reason}
              onChangeText={setReason}
              editable={!locked}
              multiline
              maxLength={2000}
              style={{ padding: 12, color: theme.text }}
            />
          )}
          <Pressable
            accessibilityRole="button"
            disabled={locked || (choice !== "approve" && !reason.trim())}
            style={{ padding: 12 }}
            onPress={() => {
              if (sent.current || generation !== getAuthGeneration() || !choices.includes(choice))
                return;
              void op.run(
                () => {
                  sent.current = true;
                  setAttempted(true);
                  return decideEarning(record, choice, reason, userId, generation);
                },
                onSaved,
                (cause) => setError(cause instanceof Error ? cause.message : String(cause))
              );
            }}
          >
            <ThemedText>{t("crewFinance.confirmDecision")}</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={locked}
            style={{ padding: 12 }}
            onPress={() => {
              setChoice(undefined);
              setReason("");
            }}
          >
            <ThemedText>{t("episodeOrganization.cancel")}</ThemedText>
          </Pressable>
        </>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {attempted && <ThemedText>{t("crewFinance.decisionRefresh")}</ThemedText>}
    </View>
  );
}
