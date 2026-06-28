import { Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import {
  claimReferralReward,
  fetchReferralDashboard,
  type ReferralDashboard,
  type ReferralMilestone,
  type ReferralReward,
  type ReferralRewardStatus,
} from "@/data/referral-api";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations, type MessageKey } from "@/i18n";

export default function ReferralsScreen() {
  const auth = useAuth();
  const authGate = useAuthGate();
  const t = useTranslations();
  const locale = useLocale();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const isAuthed = auth.status === "authenticated";

  const [dashboard, setDashboard] = useState<ReferralDashboard>();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [shareOpen, setShareOpen] = useState(false);

  const refresh = async () => {
    if (!isAuthed) return;
    setRefreshing(true);
    setError(undefined);
    try {
      setDashboard(await fetchReferralDashboard());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("referrals.loadErrorFallback"));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    void fetchReferralDashboard()
      .then((nextDashboard) => {
        if (!active) return;
        setDashboard(nextDashboard);
        setError(undefined);
      })
      .catch((nextError: unknown) => {
        if (!active) return;
        setError(nextError instanceof Error ? nextError.message : t("referrals.loadErrorFallback"));
      });
    return () => {
      active = false;
    };
  }, [isAuthed, t]);

  const currency = dashboard?.currency ?? undefined;
  const recordedMinor = useMemo(
    () =>
      addMinorStrings(
        dashboard?.totals.pendingMinor ?? "0",
        dashboard?.totals.confirmedMinor ?? "0"
      ),
    [dashboard?.totals.confirmedMinor, dashboard?.totals.pendingMinor]
  );
  const inviteeCount = dashboard?.totals.inviteeCount ?? 0;
  const isInitialLoading = !dashboard && !error;

  const shareInvite = async () => {
    const code = dashboard?.inviteCode;
    if (!code) return;
    const url = dashboard?.inviteUrl;
    const message = `${t("referrals.shareMessageLine")} ${code}${url ? `\n${url}` : ""}`;
    await Share.share({
      title: t("referrals.shareTitle"),
      message,
      ...(url ? { url } : {}),
    });
  };

  if (!isAuthed) {
    return (
      <View
        style={[
          styles.root,
          styles.centered,
          { backgroundColor: theme.background, paddingTop: insets.top + Spacing.six },
        ]}
      >
        <Stack.Screen
          options={{
            headerShown: true,
            headerTitle: t("referrals.title"),
            headerBackButtonDisplayMode: "minimal",
            headerStyle: { backgroundColor: theme.background },
            headerTintColor: theme.text,
            headerShadowVisible: false,
          }}
        />
        <View style={[styles.centerIcon, { backgroundColor: theme.backgroundElement }]}>
          <SymbolView
            name={{ ios: "gift", android: "redeem", web: "redeem" }}
            size={34}
            tintColor={theme.textSecondary}
          />
        </View>
        <ThemedText type="subtitle" style={styles.centerTitle}>
          {t("referrals.guestTitle")}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.centerBody}>
          {t("referrals.guestBody")}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          onPress={() => authGate.openLogin()}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: theme.brand },
            pressed && styles.pressed,
          ]}
        >
          <ThemedText type="smallBold" style={styles.primaryButtonText}>
            {t("login.signIn")}
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("referrals.title"),
          headerBackButtonDisplayMode: "minimal",
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
          headerShadowVisible: false,
        }}
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={theme.text}
          />
        }
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.six }]}
      >
        <View style={[styles.hero, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.eyebrowRow}>
            <SymbolView
              name={{ ios: "gift", android: "redeem", web: "redeem" }}
              size={18}
              tintColor={theme.brand}
            />
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t("referrals.heroTitle")}
            </ThemedText>
          </View>

          <ThemedText type="code" themeColor="textSecondary">
            {t("referrals.totalReward")}
          </ThemedText>
          <ThemedText style={styles.amount}>
            {currency ? formatMoney(recordedMinor, currency, locale) : t("referrals.amountEmpty")}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {isInitialLoading ? t("referrals.loading") : t("referrals.simpleHeroBody")}
          </ThemedText>

          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <View style={styles.statsRow}>
            <Stat
              label={t("referrals.pending")}
              value={
                currency
                  ? formatMoney(dashboard?.totals.pendingMinor ?? "0", currency, locale)
                  : t("referrals.amountEmpty")
              }
            />
            <Stat
              label={t("referrals.confirmed")}
              value={
                currency
                  ? formatMoney(dashboard?.totals.confirmedMinor ?? "0", currency, locale)
                  : t("referrals.amountEmpty")
              }
            />
            <Stat label={t("referrals.invitees")} value={String(inviteeCount)} />
          </View>

          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <ThemedText type="code" themeColor="textSecondary">
            {t("referrals.yourCode")}
          </ThemedText>
          <View style={[styles.codeBox, { borderColor: theme.border }]}>
            <ThemedText style={styles.codeText} numberOfLines={1}>
              {dashboard?.inviteCode ?? "········"}
            </ThemedText>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={!dashboard?.inviteCode}
            onPress={() => setShareOpen(true)}
            style={({ pressed }) => (pressed ? styles.pressed : null)}
          >
            <View
              style={[
                styles.primaryButton,
                {
                  backgroundColor: dashboard?.inviteCode ? theme.brand : theme.backgroundSelected,
                },
              ]}
            >
              <SymbolView
                name={{ ios: "square.and.arrow.up", android: "share", web: "share" }}
                size={17}
                tintColor="#FFFFFF"
              />
              <ThemedText type="smallBold" style={styles.primaryButtonText}>
                {t("referrals.shareInvite")}
              </ThemedText>
            </View>
          </Pressable>
        </View>

        {error ? (
          <View style={[styles.notice, { borderColor: theme.border }]}>
            <View style={styles.noticeCopy}>
              <ThemedText type="smallBold">{t("referrals.loadErrorTitle")}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {error}
              </ThemedText>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => void refresh()}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <ThemedText type="code" style={{ color: theme.brand }}>
                {t("referrals.retry")}
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        {dashboard?.programAvailable === false ? (
          <View style={[styles.notice, { borderColor: theme.border }]}>
            <View style={styles.noticeCopy}>
              <ThemedText type="smallBold">{t("referrals.payoutUnavailable")}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t("referrals.programUnavailable")}
              </ThemedText>
            </View>
          </View>
        ) : null}

        {/* 被邀请人福利 (invitee benefit) section hidden for now — per request. */}

        <Section title={t("referrals.registrationMilestone")}>
          <RegistrationMilestones
            inviteeCount={inviteeCount}
            milestones={dashboard?.milestones ?? []}
            locale={locale}
          />
        </Section>

        <Section title={t("referrals.inviteFlow")}>
          <InviteFlowCard
            inviteCode={dashboard?.inviteCode ?? null}
            inviteUrl={dashboard?.inviteUrl ?? null}
            onShare={() => setShareOpen(true)}
          />
        </Section>

        <Section
          title={t("referrals.spendingRewards")}
          trailing={refreshing ? t("referrals.loading") : undefined}
        >
          {dashboard?.rewards.length ? (
            dashboard.rewards.map((reward) => (
              <RewardRow
                key={reward.id}
                reward={reward}
                locale={locale}
                onClaim={() => void refresh()}
              />
            ))
          ) : (
            <View style={[styles.emptyRewards, { borderColor: theme.border }]}>
              <SymbolView
                name={{ ios: "tray", android: "inbox", web: "inbox" }}
                size={28}
                tintColor={theme.textSecondary}
              />
              <ThemedText type="smallBold">{t("referrals.emptyRewardsTitle")}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                {t("referrals.emptyRewardsBody")}
              </ThemedText>
            </View>
          )}
        </Section>
      </ScrollView>

      <ShareInviteSheet
        visible={shareOpen}
        inviteCode={dashboard?.inviteCode ?? null}
        inviteUrl={dashboard?.inviteUrl ?? null}
        onClose={() => setShareOpen(false)}
        onShare={() => void shareInvite()}
      />
    </View>
  );
}

function Section({
  children,
  title,
  trailing,
}: {
  children: ReactNode;
  title: string;
  trailing?: string;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <ThemedText type="smallBold">{title}</ThemedText>
        {trailing ? (
          <ThemedText type="small" themeColor="textSecondary">
            {trailing}
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <ThemedText type="smallBold" numberOfLines={1}>
        {value}
      </ThemedText>
      <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
        {label}
      </ThemedText>
    </View>
  );
}

function milestoneRewardLabel(m: ReferralMilestone, daysSuffix: string, locale: string): string {
  if (m.payoutType.startsWith("membership")) return `${m.days}${daysSuffix}`;
  if (m.payoutType.startsWith("points")) return `+${m.amountMinor}`;
  return formatMoney(m.amountMinor, m.currency ?? "USD", locale, true);
}

function RegistrationMilestones({
  inviteeCount,
  milestones,
  locale,
}: {
  inviteeCount: number;
  milestones: ReferralMilestone[];
  locale: string;
}) {
  const theme = useTheme();
  const t = useTranslations();
  const daysSuffix = t("referrals.daysSuffix");
  const nextMilestone = milestones.find((milestone) => milestone.inviteeThreshold > inviteeCount);
  const target =
    nextMilestone?.inviteeThreshold ??
    milestones[milestones.length - 1]?.inviteeThreshold ??
    inviteeCount;
  const remaining = Math.max((nextMilestone?.inviteeThreshold ?? inviteeCount) - inviteeCount, 0);
  const activeIndex = milestones.reduce(
    (index, milestone, currentIndex) =>
      inviteeCount >= milestone.inviteeThreshold ? currentIndex : index,
    0
  );
  const progress = milestones.length > 1 ? activeIndex / (milestones.length - 1) : 0;

  return (
    <View style={[styles.milestoneCard, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.milestoneSummary}>
        <View style={styles.milestoneSummaryCopy}>
          <ThemedText type="smallBold">
            {`${t("referrals.validInvites")} ${inviteeCount} / ${target}`}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {nextMilestone
              ? `${t("referrals.inviteMorePrefix")} ${remaining} ${t(
                  "referrals.inviteMoreSuffix"
                )} ${milestoneRewardLabel(nextMilestone, daysSuffix, locale)}`
              : t("referrals.allMilestonesUnlocked")}
          </ThemedText>
        </View>
        <View style={[styles.milestoneBadge, { backgroundColor: `${theme.brand}22` }]}>
          <ThemedText type="code" style={{ color: theme.brand }}>
            {t("referrals.registrationReward")}
          </ThemedText>
        </View>
      </View>

      <View style={styles.milestoneTrack}>
        <View style={[styles.milestoneLine, { backgroundColor: theme.backgroundSelected }]} />
        <View
          style={[
            styles.milestoneLine,
            { backgroundColor: theme.brand, right: undefined, width: `${progress * 100}%` },
          ]}
        />
        <View style={styles.milestoneNodes}>
          {milestones.map((milestone) => {
            const complete = inviteeCount >= milestone.inviteeThreshold;
            const active = nextMilestone?.inviteeThreshold === milestone.inviteeThreshold;
            const color = complete ? theme.brand : active ? theme.text : theme.textSecondary;
            return (
              <View key={milestone.inviteeThreshold} style={styles.milestoneNodeWrap}>
                <View
                  style={[
                    styles.milestoneNode,
                    {
                      backgroundColor: complete ? theme.brand : theme.backgroundElement,
                      borderColor: complete || active ? color : theme.backgroundSelected,
                    },
                  ]}
                >
                  {complete ? (
                    <SymbolView
                      name={{ ios: "checkmark", android: "check", web: "check" }}
                      size={13}
                      tintColor="#FFFFFF"
                    />
                  ) : (
                    <View style={[styles.milestoneNodeDot, { backgroundColor: color }]} />
                  )}
                </View>
                <ThemedText type="code" style={{ color }} numberOfLines={1}>
                  {`${milestone.inviteeThreshold}${t("referrals.peopleUnit")}`}
                </ThemedText>
                <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
                  {milestoneRewardLabel(milestone, daysSuffix, locale)}
                </ThemedText>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function InviteFlowCard({
  inviteCode,
  inviteUrl,
  onShare,
}: {
  inviteCode: string | null;
  inviteUrl: string | null;
  onShare: () => void;
}) {
  const theme = useTheme();
  const t = useTranslations();
  const steps = [
    t("referrals.flowShare"),
    t("referrals.flowRegister"),
    t("referrals.flowCoupon"),
    t("referrals.flowSpend"),
  ];

  return (
    <View style={[styles.flowCard, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.flowList}>
        {steps.map((step, index) => (
          <View key={step} style={styles.flowStep}>
            <View style={[styles.flowIndex, { borderColor: theme.border }]}>
              <ThemedText type="code">{String(index + 1)}</ThemedText>
            </View>
            <ThemedText type="smallBold" style={styles.flowText}>
              {step}
            </ThemedText>
          </View>
        ))}
      </View>

      <View style={[styles.inviteLinkBox, { borderColor: theme.border }]}>
        <View style={styles.linkCopy}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {inviteCode ?? t("referrals.noInviteCode")}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {inviteUrl ?? t("referrals.inviteCodeHint")}
          </ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={!inviteCode}
          onPress={onShare}
          style={({ pressed }) => (pressed ? styles.pressed : null)}
        >
          <View
            style={[
              styles.copyButton,
              { backgroundColor: inviteCode ? theme.brand : theme.backgroundSelected },
            ]}
          >
            <SymbolView
              name={{ ios: "square.and.arrow.up", android: "share", web: "share" }}
              size={15}
              tintColor="#FFFFFF"
            />
            <ThemedText type="code" style={styles.copyButtonText}>
              {t("referrals.nativeShare")}
            </ThemedText>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

function RewardRow({
  locale,
  reward,
  onClaim,
}: {
  locale: string;
  reward: ReferralReward;
  onClaim: () => void;
}) {
  const theme = useTheme();
  const t = useTranslations();
  const [claiming, setClaiming] = useState(false);
  const color = statusColor(reward.status, theme.brand, theme.textSecondary);
  const status = t(statusLabelKey(reward.status));
  const value = reward.payoutType.startsWith("membership")
    ? `+${reward.days}${t("referrals.daysSuffix")}`
    : reward.payoutType.startsWith("points")
      ? `+${reward.amountMinor}`
      : formatMoney(reward.amountMinor, reward.currency ?? "USD", locale, true);

  const claim = async () => {
    if (claiming) return;
    setClaiming(true);
    try {
      await claimReferralReward(reward.id);
      onClaim();
    } catch {
      setClaiming(false);
    }
  };

  return (
    <View style={[styles.rewardRow, { borderBottomColor: theme.border }]}>
      <View style={styles.rewardCopy}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {reward.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {reward.subtitle ?? status}
        </ThemedText>
      </View>
      <View style={styles.rewardAmount}>
        <ThemedText type="smallBold" style={{ color }} numberOfLines={1}>
          {value}
        </ThemedText>
        {reward.claimable ? (
          <Pressable
            accessibilityRole="button"
            disabled={claiming}
            onPress={() => void claim()}
            style={({ pressed }) => (pressed ? styles.pressed : null)}
          >
            <View style={[styles.claimButton, { backgroundColor: theme.brand }]}>
              <ThemedText type="code" style={styles.claimText}>
                {claiming ? t("referrals.claiming") : t("referrals.claim")}
              </ThemedText>
            </View>
          </Pressable>
        ) : (
          <ThemedText type="code" style={{ color }} numberOfLines={1}>
            {status}
          </ThemedText>
        )}
      </View>
    </View>
  );
}

function ShareInviteSheet({
  inviteCode,
  inviteUrl,
  onClose,
  onShare,
  visible,
}: {
  inviteCode: string | null;
  inviteUrl: string | null;
  onClose: () => void;
  onShare: () => void;
  visible: boolean;
}) {
  const theme = useTheme();
  const t = useTranslations();
  const insets = useSafeAreaInsets();

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.sheetScrim} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: theme.backgroundElement,
            paddingBottom: insets.bottom + Spacing.four,
          },
        ]}
      >
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <ThemedText type="smallBold">{t("referrals.shareSheetTitle")}</ThemedText>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
            <SymbolView
              name={{ ios: "xmark", android: "close", web: "close" }}
              size={18}
              tintColor={theme.textSecondary}
            />
          </Pressable>
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {t("referrals.shareSheetBody")}
        </ThemedText>
        <View style={[styles.sheetLink, { borderColor: theme.border }]}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {inviteCode ?? t("referrals.noInviteCode")}
          </ThemedText>
          {inviteUrl ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {inviteUrl}
            </ThemedText>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={!inviteCode}
          onPress={onShare}
          style={({ pressed }) => (pressed ? styles.pressed : null)}
        >
          <View
            style={[
              styles.primaryButton,
              { backgroundColor: inviteCode ? theme.brand : theme.backgroundSelected },
            ]}
          >
            <SymbolView
              name={{ ios: "square.and.arrow.up", android: "share", web: "share" }}
              size={17}
              tintColor="#FFFFFF"
            />
            <ThemedText type="smallBold" style={styles.primaryButtonText}>
              {t("referrals.nativeShare")}
            </ThemedText>
          </View>
        </Pressable>
      </View>
    </Modal>
  );
}

function addMinorStrings(...values: string[]): string {
  return values.reduce((sum, value) => sum + BigInt(value), 0n).toString();
}

function formatMoney(value: string, currency: string, locale: string, signed = false): string {
  const minor = BigInt(value);
  const sign = minor < 0n ? "-" : signed && minor > 0n ? "+" : "";
  const amount = Number(minor < 0n ? -minor : minor) / 100;
  try {
    return `${sign}${new Intl.NumberFormat(locale, {
      currency,
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
      style: "currency",
    }).format(amount)}`;
  } catch {
    return `${sign}${currency} ${amount.toFixed(2)}`;
  }
}

function statusColor(status: ReferralRewardStatus, brand: string, muted: string): string {
  if (status === "accrued" || status === "paid_out") return "#16A34A";
  if (status === "qualified") return brand;
  if (status === "reversed" || status === "voided") return "#D97706";
  return muted;
}

function statusLabelKey(status: ReferralRewardStatus): MessageKey {
  if (status === "accrued") return "referrals.statusConfirmed";
  if (status === "qualified") return "referrals.statusSettling";
  if (status === "reversed") return "referrals.statusReversed";
  if (status === "voided") return "referrals.statusVoided";
  if (status === "paid_out") return "referrals.statusPaid";
  return "referrals.statusPending";
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    gap: Spacing.four,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  centered: {
    alignItems: "center",
    gap: Spacing.three,
    justifyContent: "center",
    paddingHorizontal: Spacing.six,
  },
  centerIcon: {
    alignItems: "center",
    borderRadius: 999,
    height: 72,
    justifyContent: "center",
    width: 72,
  },
  centerTitle: {
    fontSize: 24,
    lineHeight: 30,
    textAlign: "center",
  },
  centerBody: {
    textAlign: "center",
  },
  hero: {
    borderRadius: 8,
    gap: Spacing.three,
    overflow: "hidden",
    padding: Spacing.four,
  },
  eyebrowRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.two,
    minWidth: 0,
  },
  amount: {
    fontSize: 38,
    fontWeight: "700",
    lineHeight: 44,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  codeBox: {
    alignItems: "center",
    borderRadius: 10,
    borderStyle: "dashed",
    borderWidth: 1,
    justifyContent: "center",
    paddingVertical: Spacing.three,
  },
  codeText: {
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: 6,
  },
  statsRow: {
    flexDirection: "row",
    gap: Spacing.three,
  },
  stat: {
    flex: 1,
    gap: Spacing.half,
  },
  primaryButton: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: Spacing.two,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  primaryButtonText: {
    color: "#FFFFFF",
  },
  notice: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: Spacing.three,
    padding: Spacing.three,
  },
  noticeCopy: {
    flex: 1,
    gap: Spacing.half,
    minWidth: 0,
  },
  retryButton: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  section: {
    gap: Spacing.two,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sectionBody: {
    gap: Spacing.two,
  },
  linkCopy: {
    flex: 1,
    gap: Spacing.half,
    minWidth: 0,
  },
  benefit: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: Spacing.three,
    padding: Spacing.three,
  },
  benefitIcon: {
    alignItems: "center",
    borderRadius: 8,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  benefitCopy: {
    flex: 1,
    gap: Spacing.half,
    minWidth: 0,
  },
  milestoneCard: {
    borderRadius: 8,
    gap: Spacing.three,
    padding: Spacing.four,
  },
  milestoneSummary: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.three,
    justifyContent: "space-between",
  },
  milestoneSummaryCopy: {
    flex: 1,
    gap: Spacing.half,
    minWidth: 0,
  },
  milestoneBadge: {
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  milestoneTrack: {
    paddingTop: Spacing.three,
  },
  milestoneLine: {
    borderRadius: 999,
    height: 4,
    left: 10,
    position: "absolute",
    right: 10,
    top: 23,
  },
  milestoneNodes: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  milestoneNodeWrap: {
    alignItems: "center",
    gap: Spacing.one,
    width: 58,
  },
  milestoneNode: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 2,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  milestoneNodeDot: {
    borderRadius: 999,
    height: 7,
    width: 7,
  },
  flowCard: {
    borderRadius: 8,
    gap: Spacing.three,
    padding: Spacing.four,
  },
  flowList: {
    gap: Spacing.three,
  },
  flowStep: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.three,
  },
  flowIndex: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  flowText: {
    flex: 1,
  },
  inviteLinkBox: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: Spacing.three,
    padding: Spacing.three,
  },
  copyButton: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: Spacing.one,
    minHeight: 38,
    paddingHorizontal: Spacing.three,
  },
  copyButtonText: {
    color: "#FFFFFF",
  },
  rewardRow: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  claimButton: {
    alignItems: "center",
    borderRadius: 6,
    justifyContent: "center",
    minWidth: 56,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  claimText: {
    color: "#FFFFFF",
  },
  rewardCopy: {
    flex: 1,
    gap: Spacing.half,
    minWidth: 0,
  },
  rewardAmount: {
    alignItems: "flex-end",
    gap: Spacing.half,
  },
  emptyRewards: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
    padding: Spacing.five,
  },
  emptyText: {
    textAlign: "center",
  },
  sheetScrim: {
    backgroundColor: "rgba(0,0,0,0.58)",
    flex: 1,
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    bottom: 0,
    gap: Spacing.three,
    left: 0,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    position: "absolute",
    right: 0,
  },
  sheetHandle: {
    alignSelf: "center",
    backgroundColor: "rgba(255,255,255,0.24)",
    borderRadius: 999,
    height: 4,
    width: 38,
  },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sheetLink: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
  },
  pressed: {
    opacity: 0.72,
  },
});
