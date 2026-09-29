import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { uuid } from "expo-modules-core";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { isChinaRegion } from "@/config/app-env";
import { type ExpenseRecord } from "./crew-expenses-api";
import {
  expenseAmount,
  expenseSaveInput,
  saveExpense,
  type ExpenseSaveInput,
} from "./expense-edit-api";
export function ExpenseEdit(props: {
  crewId: string;
  userId: string;
  generation: number;
  record?: ExpenseRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(props.crewId, true);
  const [id] = useState(() => props.record?.id ?? uuid.v4());
  const [definition, setDefinition] = useState<ExpenseSaveInput["definition"]>(
    () =>
      props.record?.definition ?? {
        category: "",
        purpose: "",
        occurredOn: null,
        currency: isChinaRegion ? "CNY" : "USD",
        amountMinor: null,
        evidenceNote: "",
      }
  );
  const [amount, setAmount] = useState(() => {
    const value = props.record?.definition.amountMinor;
    return value == null
      ? ""
      : `${BigInt(value) / 100n}.${(BigInt(value) % 100n).toString().padStart(2, "0")}`;
  });
  const [attempted, setAttempted] = useState(false),
    [dirty, setDirty] = useState(false),
    [discard, setDiscard] = useState(false),
    [error, setError] = useState<string>();
  const request = useRef<ExpenseSaveInput | null>(null),
    locked = attempted || op.busy || props.record?.submissionStatus === "pending";
  const edit = (patch: Partial<ExpenseSaveInput["definition"]>) => {
    setDefinition((old) => ({ ...old, ...patch }));
    setDirty(true);
  };
  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText>{t(props.record ? "mobileExpenses.edit" : "crewExpenses.new")}</ThemedText>
      <ThemedText>{t("mobileExpenses.saveHelp")}</ThemedText>
      {(["category", "purpose", "occurredOn", "evidenceNote"] as const).map((field) => {
        const label = t(
          `crewExpenses.${field === "occurredOn" ? "date" : field === "evidenceNote" ? "evidence" : field}`
        );
        return (
          <View key={field} style={{ gap: 6 }}>
            <ThemedText>
              {label}
              {field === "occurredOn" ? " (YYYY-MM-DD)" : ""}
            </ThemedText>
            <TextInput
              accessibilityLabel={label}
              value={definition[field] ?? ""}
              editable={!locked}
              maxLength={
                field === "category"
                  ? 120
                  : field === "purpose"
                    ? 2000
                    : field === "occurredOn"
                      ? 10
                      : 4000
              }
              multiline={field === "purpose" || field === "evidenceNote"}
              style={{
                color: theme.text,
                borderColor: theme.text,
                borderWidth: 1,
                borderRadius: 8,
                padding: 12,
              }}
              onChangeText={(value) =>
                edit({ [field]: field === "occurredOn" ? value || null : value })
              }
            />
          </View>
        );
      })}
      <ThemedText>{t("crewExpenses.currency")}</ThemedText>
      <View style={{ flexDirection: "row" }}>
        {(["USD", "CNY"] as const).map((currency) => (
          <Pressable
            key={currency}
            accessibilityRole="radio"
            accessibilityState={{ checked: definition.currency === currency }}
            disabled={locked}
            style={{ padding: 12 }}
            onPress={() => edit({ currency })}
          >
            <ThemedText>
              {definition.currency === currency ? "✓ " : ""}
              {currency}
            </ThemedText>
          </Pressable>
        ))}
      </View>
      <ThemedText>{t("crewExpenses.amount")}</ThemedText>
      <TextInput
        accessibilityLabel={t("crewExpenses.amount")}
        value={amount}
        editable={!locked}
        keyboardType="decimal-pad"
        maxLength={18}
        style={{
          color: theme.text,
          borderColor: theme.text,
          borderWidth: 1,
          borderRadius: 8,
          padding: 12,
        }}
        onChangeText={(value) => {
          setAmount(value);
          setDirty(true);
        }}
      />
      <ThemedText>
        {t("crewExpenses.receipts")} · {definition.receiptIds?.length ?? 0}
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        disabled={op.busy || props.record?.submissionStatus === "pending"}
        onPress={() => {
          if (props.generation !== getAuthGeneration()) return;
          void op.run(
            async () => {
              if (!request.current) {
                const parsed = expenseSaveInput.safeParse({
                  expectedVersion: props.record?.version ?? 0,
                  definition: { ...definition, amountMinor: expenseAmount(amount) },
                });
                if (!parsed.success) throw new Error(t("mobileExpenses.invalidDraft"));
                request.current = parsed.data;
              }
              setAttempted(true);
              return saveExpense(props.crewId, props.userId, id, request.current, props.generation);
            },
            props.onSaved,
            (e) => setError(e instanceof Error ? e.message : String(e))
          );
        }}
      >
        <ThemedText>{t(attempted ? "mobileExpenses.retrySave" : "crewExpenses.save")}</ThemedText>
      </Pressable>
      {op.busy && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {attempted && <ThemedText>{t("mobileExpenses.retrySaveHelp")}</ThemedText>}
      {discard && <ThemedText>{t("crewExpenses.unsaved")}</ThemedText>}
      <Pressable
        accessibilityRole="button"
        disabled={op.busy}
        style={{ padding: 12 }}
        onPress={() => {
          if (dirty && !discard) {
            setDiscard(true);
            return;
          }
          props.onClose();
        }}
      >
        <ThemedText>
          {t(discard ? "crewExpenses.discard" : "mobileExpenses.backToClaims")}
        </ThemedText>
      </Pressable>
    </ScrollView>
  );
}
