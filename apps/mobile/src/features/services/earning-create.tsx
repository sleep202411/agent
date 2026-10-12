import { useEffect, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { uuid } from "expo-modules-core";
import { ActivityIndicator, Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { isChinaRegion } from "@/config/app-env";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { TaskMentionPicker } from "./task-mention-picker";
import {
  createEarning,
  earningAmountMinor,
  fetchEarningCreateAccess,
  manualEarningSources,
  newEarning,
  type NewEarning,
} from "./earning-create-api";
import { formatFinanceMoney } from "./crew-finance-api";
type Props = { crewId: string; userId: string; generation: number; onSaved: () => void };
export function EarningCreate(props: Props) {
  const t = useTranslations();
  const [allowed, setAllowed] = useState(false),
    [open, setOpen] = useState(false),
    [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchEarningCreateAccess(props.crewId, props.userId, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setAllowed(value);
      },
      (cause) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => controller.abort();
  }, [props.crewId, props.userId, props.generation]);
  return (
    <>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {allowed && (
        <Pressable
          accessibilityRole="button"
          style={{ padding: 12 }}
          onPress={() => {
            if (props.generation === getAuthGeneration()) setOpen(true);
          }}
        >
          <ThemedText>{t("earningCreate.add")}</ThemedText>
        </Pressable>
      )}
      {open && <Form {...props} onClose={() => setOpen(false)} />}
    </>
  );
}
function Form(props: Props & { onClose: () => void }) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(props.crewId, true);
  const currency = isChinaRegion ? "CNY" : "USD";
  const [recipient, setRecipient] = useState<{
      crewMemberId: string;
      userId: string;
      label: string;
    }>(),
    [picking, setPicking] = useState(false);
  const [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [amount, setAmount] = useState("");
  const [source, setSource] = useState<NewEarning["sourceType"]>("milestone_bonus"),
    [review, setReview] = useState(false),
    [error, setError] = useState<string>();
  const [attempted, setAttempted] = useState(false);
  const request = useRef<NewEarning | null>(null),
    finished = useRef(false);
  const amountMinor = earningAmountMinor(amount);
  const valid =
    !!recipient &&
    !!amountMinor &&
    !!title.trim() &&
    title.trim().length <= 180 &&
    description.trim().length <= 10000;
  const close = () => {
    if (!op.busy && props.generation === getAuthGeneration()) props.onClose();
  };
  const save = () => {
    if (
      !valid ||
      !review ||
      !recipient ||
      finished.current ||
      props.generation !== getAuthGeneration()
    )
      return;
    void op.run(
      async () => {
        if (!request.current)
          request.current = newEarning.parse({
            crewMemberId: recipient.crewMemberId,
            sourceType: source,
            title,
            description: description.trim() || undefined,
            currency,
            amountMinor,
            idempotencyKey: uuid.v4(),
          });
        setAttempted(true);
        setError(undefined);
        return createEarning(
          props.crewId,
          recipient.userId,
          request.current,
          props.userId,
          props.generation
        );
      },
      () => {
        finished.current = true;
        props.onSaved();
        props.onClose();
      },
      (cause) => setError(cause instanceof Error ? cause.message : String(cause))
    );
  };
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
        {picking ? (
          <TaskMentionPicker
            crewId={props.crewId}
            userId={props.userId}
            generation={props.generation}
            excludedIds={[]}
            includeSelf
            title={t("crewFinance.recipient")}
            onSelectMember={(member) => {
              setRecipient(member);
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
          />
        ) : (
          <ScrollView
            automaticallyAdjustKeyboardInsets
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 20, gap: 12 }}
          >
            <ThemedText>{t("earningCreate.add")}</ThemedText>
            <ThemedText>{t("earningCreate.help")}</ThemedText>
            {review ? (
              <>
                <ThemedText>
                  {recipient?.label} · {recipient?.userId}
                </ThemedText>
                <ThemedText>{title.trim()}</ThemedText>
                <ThemedText>
                  {t(`crewFinance.source_${source}`)} · {formatFinanceMoney(amountMinor!, currency)}
                </ThemedText>
                {!!description.trim() && <ThemedText>{description.trim()}</ThemedText>}
                <Pressable
                  accessibilityRole="button"
                  disabled={op.busy}
                  style={{ padding: 12 }}
                  onPress={save}
                >
                  <ThemedText>
                    {t(attempted ? "earningCreate.retry" : "earningCreate.confirm")}
                  </ThemedText>
                </Pressable>
                {!attempted && (
                  <Pressable
                    accessibilityRole="button"
                    disabled={op.busy}
                    style={{ padding: 12 }}
                    onPress={() => setReview(false)}
                  >
                    <ThemedText>{t("earningCreate.edit")}</ThemedText>
                  </Pressable>
                )}
              </>
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  style={{ padding: 12 }}
                  onPress={() => setPicking(true)}
                >
                  <ThemedText>
                    {t("crewFinance.recipient")} * · {recipient?.label ?? t("earningCreate.select")}
                  </ThemedText>
                </Pressable>
                <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                  {manualEarningSources.map((value) => (
                    <Pressable
                      key={value}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: source === value }}
                      style={{ padding: 12 }}
                      onPress={() => setSource(value)}
                    >
                      <ThemedText>{t(`crewFinance.source_${value}`)}</ThemedText>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  accessibilityLabel={t("earningCreate.title")}
                  placeholder={`${t("earningCreate.title")} *`}
                  value={title}
                  onChangeText={setTitle}
                  maxLength={180}
                  style={{ padding: 12, color: theme.text }}
                />
                <ThemedText>
                  {t("earningCreate.amount")} * · {currency}
                </ThemedText>
                <TextInput
                  accessibilityLabel={t("earningCreate.amount")}
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  maxLength={20}
                  style={{ padding: 12, color: theme.text }}
                />
                {!!amount && !amountMinor && (
                  <ThemedText accessibilityRole="alert">
                    {t("earningCreate.invalidAmount")}
                  </ThemedText>
                )}
                <TextInput
                  accessibilityLabel={t("earningCreate.description")}
                  placeholder={t("earningCreate.description")}
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  maxLength={10000}
                  style={{ padding: 12, color: theme.text }}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={!valid}
                  style={{ padding: 12 }}
                  onPress={() => setReview(true)}
                >
                  <ThemedText>{t("earningCreate.review")}</ThemedText>
                </Pressable>
              </>
            )}
            {op.busy && <ActivityIndicator />}
            {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
            {attempted && <ThemedText>{t("earningCreate.retryHelp")}</ThemedText>}
            <Pressable
              accessibilityRole="button"
              disabled={op.busy}
              style={{ padding: 12 }}
              onPress={close}
            >
              <ThemedText>{t("crewTasks.back")}</ThemedText>
            </Pressable>
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}
