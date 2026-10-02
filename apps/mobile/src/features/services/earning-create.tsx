import { useEffect, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
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
  return (
    <EarningCreateAccess
      key={JSON.stringify([props.crewId, props.userId, props.generation])}
      {...props}
    />
  );
}
function EarningCreateAccess(props: Props) {
  const t = useTranslations();
  const [allowed, setAllowed] = useState(false),
    [open, setOpen] = useState(false),
    [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
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
  }, [props.crewId, props.userId, props.generation, revision]);
  return (
    <>
      {error && (
        <View>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable
            accessibilityRole="button"
            style={{ padding: 12 }}
            onPress={() => {
              setError(undefined);
              setRevision((value) => value + 1);
            }}
          >
            <ThemedText>{t("earningCreate.retry")}</ThemedText>
          </Pressable>
        </View>
      )}
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
const pendingEarning = z
  .object({
    input: newEarning,
    recipient: z.object({
      crewMemberId: z.string().min(1),
      userId: z.string().min(1),
      label: z.string(),
    }),
  })
  .strict()
  .refine((value) => value.input.crewMemberId === value.recipient.crewMemberId);
type PendingEarning = z.infer<typeof pendingEarning>;
function Form(props: Props & { onClose: () => void }) {
  const t = useTranslations();
  const readRecovery = () => {
    try {
      const store = durableRecord("earning-create", props.userId, props.crewId);
      const raw = store.read();
      const value = raw ? JSON.parse(raw) : null;
      return {
        store,
        pending: value === null ? null : pendingEarning.parse(value),
        error: undefined,
      };
    } catch (cause) {
      return {
        store: undefined,
        pending: null,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  };
  const [recovery, setRecovery] = useState(readRecovery);
  if (recovery.store)
    return <EarningForm {...props} store={recovery.store} pending={recovery.pending} />;
  const error = recovery.error;
  return (
    <View style={{ gap: 12 }}>
      {error ? (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable
            accessibilityRole="button"
            style={{ padding: 12 }}
            onPress={() => setRecovery(readRecovery())}
          >
            <ThemedText>{t("earningCreate.retry")}</ThemedText>
          </Pressable>
        </>
      ) : (
        <ActivityIndicator />
      )}
      <Pressable accessibilityRole="button" style={{ padding: 12 }} onPress={props.onClose}>
        <ThemedText>{t("crewTasks.back")}</ThemedText>
      </Pressable>
    </View>
  );
}
function EarningForm(
  props: Props & { onClose: () => void; store: DurableRecord; pending: PendingEarning | null }
) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(props.crewId, true);
  const currency = isChinaRegion ? "CNY" : "USD";
  const [recipient, setRecipient] = useState<
      | {
          crewMemberId: string;
          userId: string;
          label: string;
        }
      | undefined
    >(props.pending?.recipient),
    [picking, setPicking] = useState(false);
  const [title, setTitle] = useState(props.pending?.input.title ?? ""),
    [description, setDescription] = useState(props.pending?.input.description ?? ""),
    [amount, setAmount] = useState(() => {
      const minor = props.pending?.input.amountMinor;
      return minor
        ? `${BigInt(minor) / 100n}.${String(BigInt(minor) % 100n).padStart(2, "0")}`
        : "";
    });
  const [source, setSource] = useState<NewEarning["sourceType"]>(
      props.pending?.input.sourceType ?? "milestone_bonus"
    ),
    [review, setReview] = useState(!!props.pending),
    [error, setError] = useState<string>();
  const [attempted, setAttempted] = useState(!!props.pending);
  const request = useRef<NewEarning | null>(props.pending?.input ?? null),
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
        const input =
          request.current ??
          newEarning.parse({
            crewMemberId: recipient.crewMemberId,
            sourceType: source,
            title,
            description: description.trim() || undefined,
            currency,
            amountMinor,
            idempotencyKey: uuid.v4(),
          });
        // Persist before dispatch: a lost response must retain the original retry key.
        props.store.write(JSON.stringify(pendingEarning.parse({ input, recipient })));
        request.current = input;
        setAttempted(true);
        setError(undefined);
        const result = await createEarning(
          props.crewId,
          recipient.userId,
          request.current,
          props.userId,
          props.generation
        );
        props.store.write("null");
        return result;
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
