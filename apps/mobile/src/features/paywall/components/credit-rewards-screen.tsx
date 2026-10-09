import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Stack } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { useComputeWalletBalance } from "../lib/use-compute-wallet-balance";
import {
  listCreditCampaigns,
  voucherCodeSchema,
  type CreditCampaign,
} from "../lib/credit-rewards-api";

import { creditRewardCommands, type CreditRewardCommand } from "../lib/credit-rewards-commands";

import { CreditCheckIn } from "./credit-check-in";

export function CreditRewardsScreen() {
  const auth = useAuth(),
    gate = useAuthGate(),
    theme = useTheme(),
    t = useTranslations();
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("creditRewards.title"),
          headerBackButtonDisplayMode: "minimal",
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
          headerShadowVisible: false,
        }}
      />
      {auth.status === "hydrating" ? (
        <ActivityIndicator />
      ) : auth.status !== "authenticated" ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => gate.openLogin()}
          style={{ padding: 16 }}
        >
          <ThemedText>{t("login.signIn")}</ThemedText>
        </Pressable>
      ) : (
        <AccountCreditRewards
          key={auth.generation}
          generation={auth.generation}
          userId={String(auth.user?.id)}
        />
      )}
    </View>
  );
}
function AccountCreditRewards({ generation, userId }: { generation: number; userId: string }) {
  const commands = useMemo(() => creditRewardCommands(userId, generation), [userId, generation]);
  const [recovery, setRecovery] = useState<{ command: CreditRewardCommand | null; error?: string }>(
    () => {
      try {
        return { command: commands.read() };
      } catch (cause) {
        return { command: null, error: cause instanceof Error ? cause.message : String(cause) };
      }
    }
  );
  const active = useScreenActive(),
    theme = useTheme(),
    t = useTranslations(),
    locale = useLocale();
  const lifetime = useMemo(() => ({ active }), [active]);
  const controller = useRef<{ scope: typeof lifetime; value: AbortController } | null>(null);
  useLayoutEffect(() => {
    const value = new AbortController();
    controller.current = { scope: lifetime, value };
    return () => value.abort();
  }, [lifetime]);
  const current = () =>
    active &&
    controller.current?.scope === lifetime &&
    !controller.current.value.signal.aborted &&
    generation === getAuthGeneration();
  const wallet = useComputeWalletBalance();
  const [revision, setRevision] = useState(0);
  const [list, setList] = useState<{
    scope: typeof lifetime;
    revision: number;
    items: CreditCampaign[];
    error?: string;
  }>();
  const [code, setCode] = useState("");
  const pending = useRef<typeof lifetime | null>(null);
  const [operation, setOperation] = useState<{ scope: typeof lifetime; id: string }>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const busy = operation?.scope === lifetime;
  const snapshot = list?.scope === lifetime && list.revision === revision ? list : undefined;
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      try {
        setRecovery({ command: commands.read() });
      } catch (cause) {
        setRecovery({ command: null, error: String(cause) });
      }
    });
    void listCreditCampaigns(generation, controller.signal).then(
      (items) => {
        if (!controller.signal.aborted) setList({ scope: lifetime, revision, items });
      },
      (cause) => {
        if (!controller.signal.aborted)
          setList({
            scope: lifetime,
            revision,
            items: [],
            error: cause instanceof Error ? cause.message : String(cause),
          });
      }
    );
    return () => controller.abort();
  }, [generation, active, lifetime, revision, commands]);
  async function submit(campaign?: CreditCampaign, retry?: CreditRewardCommand) {
    if (!current() || pending.current === lifetime || campaign?.claimed || recovery.error) return;
    if (!retry && !campaign && !voucherCodeSchema.safeParse(code).success) return;
    pending.current = lifetime;
    setOperation({ scope: lifetime, id: campaign?.id ?? "voucher" });
    setError(undefined);
    setMessage(undefined);
    const submitted = code;
    try {
      const command: CreditRewardCommand =
        retry ??
        (campaign ? { kind: "campaign", id: campaign.id } : { kind: "voucher", code: submitted });
      const result = await commands.submit(command, controller.current!.value.signal);
      if (current()) setRecovery({ command: null });
      if (!current()) return;
      const already = "alreadyClaimed" in result ? result.alreadyClaimed : result.alreadyRedeemed;
      setMessage(
        already
          ? t("creditRewards.already")
          : t("creditRewards.success").replace(
              "{amount}",
              BigInt(result.granted.amount).toLocaleString(locale)
            )
      );
      if (!campaign && retry?.kind !== "campaign")
        setCode((value) => (value === submitted ? "" : value));
      wallet.refresh();
      setRevision((value) => value + 1);
    } catch (cause) {
      if (current()) {
        setError(cause instanceof Error ? cause.message : String(cause));
        try {
          setRecovery({ command: commands.read() });
        } catch (readError) {
          setRecovery({ command: null, error: String(readError) });
        }
      }
    } finally {
      if (pending.current === lifetime) pending.current = null;
      if (current()) setOperation(undefined);
    }
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 20 }}
    >
      <View style={{ gap: 4 }}>
        <ThemedText type="small" style={{ fontSize: 16, fontWeight: "600" }}>
          {t("mine.computePointsLabel")}
        </ThemedText>
        <ThemedText>
          {wallet.balance == null ? "—" : BigInt(wallet.balance).toLocaleString(locale)}
        </ThemedText>
        {wallet.error && (
          <>
            <ThemedText type="small" accessibilityRole="alert">
              {wallet.error}
            </ThemedText>
            <RewardButton
              label={t("common.retry")}
              onPress={wallet.refresh}
              disabled={wallet.loading}
            />
          </>
        )}
      </View>
      <CreditCheckIn generation={generation} onClaim={wallet.refresh} />
      {recovery.error && (
        <ThemedText type="small" accessibilityRole="alert">
          {recovery.error}
        </ThemedText>
      )}
      {recovery.command && (
        <View>
          <ThemedText type="small">{t("creditRewards.pending")}</ThemedText>
          <RewardButton
            label={t("common.retry")}
            onPress={() => void submit(undefined, recovery.command!)}
            disabled={busy || !active}
          />
          <RewardButton
            label={t("creditRewards.clear")}
            onPress={() => {
              try {
                commands.clear();
                setRecovery({ command: null });
                setError(undefined);
              } catch (cause) {
                setError(String(cause));
              }
            }}
            disabled={busy || !active}
          />
        </View>
      )}
      {error && (
        <ThemedText type="small" accessibilityRole="alert">
          {error}
        </ThemedText>
      )}
      {message && (
        <ThemedText type="small" accessibilityLiveRegion="polite">
          {message}
        </ThemedText>
      )}
      <View style={{ gap: 8 }}>
        <ThemedText type="small" style={{ fontSize: 16, fontWeight: "600" }}>
          {t("creditRewards.voucher")}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t("creditRewards.hint")}
        </ThemedText>
        <TextInput
          accessibilityLabel={t("creditRewards.code")}
          placeholder={t("creditRewards.code")}
          placeholderTextColor={theme.textSecondary}
          value={code}
          onChangeText={setCode}
          maxLength={40}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!busy && !recovery.command && !recovery.error}
          style={{
            color: theme.text,
            backgroundColor: theme.backgroundElement,
            borderRadius: 8,
            padding: 12,
          }}
        />
        <RewardButton
          label={t("creditRewards.redeem")}
          onPress={() => void submit()}
          disabled={
            busy ||
            !!recovery.command ||
            !!recovery.error ||
            !active ||
            !voucherCodeSchema.safeParse(code).success
          }
        />
      </View>
      <View style={{ gap: 8 }}>
        <ThemedText type="small" style={{ fontSize: 16, fontWeight: "600" }}>
          {t("creditRewards.campaigns")}
        </ThemedText>
        {!snapshot ? (
          <ActivityIndicator color={theme.textSecondary} />
        ) : snapshot.error ? (
          <>
            <ThemedText type="small" accessibilityRole="alert">
              {snapshot.error}
            </ThemedText>
            <RewardButton
              label={t("common.retry")}
              onPress={() => setRevision((value) => value + 1)}
              disabled={false}
            />
          </>
        ) : (
          <>
            {snapshot.items.length === 0 && (
              <ThemedText type="small" themeColor="textSecondary">
                {t("creditRewards.empty")}
              </ThemedText>
            )}
            {snapshot.items.map((campaign) => (
              <View
                key={campaign.id}
                style={{
                  backgroundColor: theme.backgroundElement,
                  borderRadius: 8,
                  padding: 12,
                  gap: 4,
                }}
              >
                <ThemedText>{campaign.name}</ThemedText>
                {!!campaign.description && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {campaign.description}
                  </ThemedText>
                )}
                <ThemedText type="small">
                  {t("creditRewards.amount").replace(
                    "{amount}",
                    campaign.computeCreditAmount.toLocaleString(locale)
                  )}
                </ThemedText>
                <RewardButton
                  label={t(campaign.claimed ? "creditRewards.claimed" : "creditRewards.claim")}
                  onPress={() => void submit(campaign)}
                  disabled={
                    busy || !!recovery.command || !!recovery.error || campaign.claimed || !active
                  }
                />
              </View>
            ))}
          </>
        )}
      </View>
    </ScrollView>
  );
}

function RewardButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ paddingVertical: 12, opacity: disabled ? 0.45 : 1 }}
    >
      <ThemedText type="small" style={{ color: theme.brand }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}
