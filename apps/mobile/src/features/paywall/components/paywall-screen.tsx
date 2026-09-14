import IconBolt from "@tabler/icons-react-native/icons/IconBolt";
import IconCheck from "@tabler/icons-react-native/icons/IconCheck";
import IconCoins from "@tabler/icons-react-native/icons/IconCoins";
import IconCrown from "@tabler/icons-react-native/icons/IconCrown";
import IconSparkles from "@tabler/icons-react-native/icons/IconSparkles";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations, type MessageKey } from "@/i18n";

import {
  COMPUTE_RECHARGE_DEFAULT,
  COMPUTE_RECHARGE_PRESETS,
  computeCustomProduct,
  computeRechargeCurrencySymbol,
  isCnComputeRecharge,
  isMembershipCategory,
  parseComputeRechargeAmount,
  productsForCategory,
  yearlySavePercent,
} from "../lib/catalog";
import { currentCheckoutChannel, type CheckoutChannel } from "../lib/checkout-channel";
import { fetchComputeWalletBalance } from "../lib/compute-wallet";
import { isPaywallCategory, PAYWALL_CATEGORIES, type PaywallCategory } from "../lib/paywall-store";

const BRAND = Colors.dark.brand;
const CANVAS = Colors.dark.background;
const SURFACE = Colors.dark.backgroundElement;
const LINE = Colors.dark.border;
const INK_MUTED = Colors.dark.textSecondary;

const CATEGORY_META: Record<
  PaywallCategory,
  {
    labelKey: MessageKey;
    titleKey: MessageKey;
    bodyKey: MessageKey;
    Icon: ComponentType<{ size: number; color: string; strokeWidth: number }>;
  }
> = {
  community_points: {
    labelKey: "paywall.category.communityPoints",
    titleKey: "paywall.screen.communityPoints",
    bodyKey: "paywall.body.communityPoints",
    Icon: IconCoins,
  },
  compute_points: {
    labelKey: "paywall.category.computePoints",
    titleKey: "paywall.screen.computePoints",
    bodyKey: "paywall.body.computePoints",
    Icon: IconBolt,
  },
  compute_membership: {
    labelKey: "paywall.category.computeMembership",
    titleKey: "paywall.screen.computeMembership",
    bodyKey: "paywall.body.computeMembership",
    Icon: IconSparkles,
  },
  community_membership: {
    labelKey: "paywall.category.communityMembership",
    titleKey: "paywall.screen.communityMembership",
    bodyKey: "paywall.body.communityMembership",
    Icon: IconCrown,
  },
};

const MEMBERSHIP_BENEFITS: Record<"community_membership" | "compute_membership", MessageKey[]> = {
  community_membership: [
    "paywall.membership.communityBenefitFreeViewing",
    "paywall.membership.communityBenefitDiscount",
    "paywall.membership.communityBenefitExclusive",
  ],
  compute_membership: [
    "paywall.membership.computeBenefitCredits",
    "paywall.membership.computeBenefitPriority",
  ],
};

const CHANNEL_COPY: Record<CheckoutChannel, MessageKey> = {
  apple_iap: "paywall.channel.apple",
  google_play_iap: "paywall.channel.play",
  wechat: "paywall.channel.wechat",
  web: "paywall.channel.web",
};

function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] === undefined ? `{${key}}` : String(vars[key])
  );
}

function formatAmount(value: string, locale: string): string {
  try {
    return BigInt(value).toLocaleString(locale);
  } catch {
    return value;
  }
}

function paramValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function ComputeRechargePanel({
  amount,
  balance,
  locale,
  onChangeAmount,
}: {
  amount: string;
  balance: string | null;
  locale: string;
  onChangeAmount: (value: string) => void;
}) {
  const t = useTranslations();
  const theme = useTheme();
  const cn = isCnComputeRecharge();
  const symbol = computeRechargeCurrencySymbol();
  const amountNum = parseComputeRechargeAmount(amount);

  return (
    <View style={styles.computePanel}>
      <ThemedText type="small" themeColor="textSecondary">
        {t("paywall.compute.availableBalance")}
      </ThemedText>
      <View style={styles.computeBalanceRow}>
        <IconBolt size={18} color={theme.text} strokeWidth={1.8} />
        <ThemedText type="smallBold" style={styles.computeBalanceCompact}>
          {balance == null ? "—" : formatAmount(balance, locale)}
        </ThemedText>
      </View>

      <View style={styles.computeChips}>
        {COMPUTE_RECHARGE_PRESETS.map((preset) => {
          const on = amountNum === preset;
          return (
            <Pressable
              key={preset}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => onChangeAmount(String(preset))}
              style={[styles.computeChip, on ? styles.computeChipOn : styles.computeChipOff]}
            >
              <ThemedText type="smallBold" style={{ color: on ? CANVAS : theme.text }}>
                {`${symbol}${preset}`}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        {t(cn ? "paywall.compute.amountCnyRange" : "paywall.compute.amountUsdRange")}
      </ThemedText>
      <View style={styles.computeAmountShell}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.computeAmountPrefix}>
          {symbol}
        </ThemedText>
        <TextInput
          accessibilityLabel={t(
            cn ? "paywall.compute.amountCnyRange" : "paywall.compute.amountUsdRange"
          )}
          editable
          inputMode="numeric"
          keyboardType="number-pad"
          maxLength={4}
          onChangeText={(value) => {
            const digits = value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
            onChangeAmount(digits.slice(0, 4));
          }}
          placeholder={COMPUTE_RECHARGE_DEFAULT}
          placeholderTextColor="rgba(255,255,255,0.34)"
          style={[styles.computeAmountInput, { color: theme.text }]}
          value={amount}
        />
      </View>
    </View>
  );
}

export function PaywallScreen() {
  const t = useTranslations();
  const locale = useLocale();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    category?: string | string[];
  }>();

  const rawCategory = paramValue(params.category);
  const initialCategory: PaywallCategory = isPaywallCategory(rawCategory)
    ? rawCategory
    : "community_points";
  const [selected, setSelected] = useState(initialCategory);
  const [computeBalance, setComputeBalance] = useState<string | null>(null);
  const [computeAmount, setComputeAmount] = useState(COMPUTE_RECHARGE_DEFAULT);
  const channel = useMemo(() => currentCheckoutChannel(), []);
  const unsupported = channel === "web";
  const membership = isMembershipCategory(selected);
  const computePoints = selected === "compute_points";
  const products = productsForCategory(selected);
  const savePercent = yearlySavePercent(products);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const catalogProduct = products.find((item) => item.id === productId) ?? products[0];
  const computeProduct = computePoints ? computeCustomProduct(computeAmount) : null;
  const product = computePoints ? computeProduct : catalogProduct;
  const pointsCheckout = selected === "community_points" || selected === "compute_points";
  const stackedFooter = membership || pointsCheckout;

  useEffect(() => {
    setSelected(initialCategory);
  }, [initialCategory]);

  useEffect(() => {
    const next = productsForCategory(selected);
    const yearly = next.find((item) => item.interval === "year");
    setProductId(yearly?.id ?? next[0]?.id ?? "");
  }, [selected]);

  useEffect(() => {
    if (selected === "compute_points") setComputeAmount(COMPUTE_RECHARGE_DEFAULT);
  }, [selected]);

  useEffect(() => {
    let cancelled = false;
    void fetchComputeWalletBalance().then((compute) => {
      if (!cancelled) setComputeBalance(compute);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const notifyUnavailable = () => {
    Alert.alert(t("paywall.tryAgainLater"), undefined, [{ text: t("common.ok") }]);
  };

  const heroPoints =
    product?.grantsPoints != null
      ? fillTemplate(t(computePoints ? "paywall.hero.credits" : "paywall.hero.points"), {
          amount: formatAmount(product.grantsPoints, locale),
        })
      : "—";

  const tabs = (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.tabs}
    >
      {PAYWALL_CATEGORIES.map((key) => {
        const on = key === selected;
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => setSelected(key)}
            style={[styles.tab, on ? styles.tabOn : styles.tabOff]}
          >
            <ThemedText type="smallBold" style={{ color: on ? BRAND : INK_MUTED }}>
              {t(CATEGORY_META[key].labelKey)}
            </ThemedText>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  const footer = (
    <View
      style={[
        styles.footer,
        stackedFooter && styles.footerStack,
        { paddingBottom: Math.max(insets.bottom, Spacing.four) },
      ]}
    >
      <View style={[styles.footerCopy, stackedFooter && styles.footerCopyStacked]}>
        <ThemedText type="small" themeColor="textSecondary">
          {t(CHANNEL_COPY[channel])}
        </ThemedText>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={!product}
        onPress={notifyUnavailable}
        style={[
          styles.payButton,
          stackedFooter && styles.payButtonFull,
          !product && styles.payButtonDisabled,
        ]}
      >
        <ThemedText type="smallBold" style={styles.payLabel}>
          {pointsCheckout
            ? t("paywall.buyNow")
            : membership
              ? `${t("paywall.membership.subscribe")} · ${product?.displayPrice ?? ""}`
              : `${t("paywall.payNow")} ${product?.displayPrice ?? ""}`}
        </ThemedText>
      </Pressable>
    </View>
  );

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t(CATEGORY_META[selected].titleKey),
          headerBackButtonDisplayMode: "minimal",
          headerStyle: { backgroundColor: CANVAS },
          headerTintColor: theme.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: CANVAS, flex: 1 },
        }}
      />

      {unsupported ? (
        <View style={[styles.unsupported, { paddingBottom: insets.bottom + Spacing.five }]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.unsupportedBody}>
            {t("paywall.unsupportedBody")}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={notifyUnavailable}
            style={styles.payButton}
          >
            <ThemedText type="smallBold" style={styles.payLabel}>
              {t("paywall.continueWeb")}
            </ThemedText>
          </Pressable>
        </View>
      ) : pointsCheckout ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.pointsPage}
        >
          <View style={styles.pointsTop}>
            {tabs}
            {computePoints ? (
              <ComputeRechargePanel
                amount={computeAmount}
                balance={computeBalance}
                locale={locale}
                onChangeAmount={setComputeAmount}
              />
            ) : null}
          </View>
          <View style={styles.hero}>
            <ThemedText type="subtitle" style={styles.heroPoints}>
              {heroPoints}
            </ThemedText>
            <ThemedText type="smallBold" style={styles.heroPrice}>
              {product?.displayPrice ?? "—"}
            </ThemedText>
          </View>
          {footer}
        </KeyboardAvoidingView>
      ) : (
        <>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            {tabs}
            <ThemedText type="small" themeColor="textSecondary">
              {t(CATEGORY_META[selected].bodyKey)}
            </ThemedText>
            <View style={styles.benefits}>
              {MEMBERSHIP_BENEFITS[
                selected === "compute_membership" ? "compute_membership" : "community_membership"
              ].map((key) => (
                <View key={key} style={styles.benefitRow}>
                  <IconSparkles size={16} color={BRAND} strokeWidth={1.8} />
                  <ThemedText type="small" style={styles.benefitText}>
                    {t(key)}
                  </ThemedText>
                </View>
              ))}
            </View>
            <View style={styles.planRow}>
              {products.map((item) => {
                const on = item.id === product?.id;
                const yearly = item.interval === "year";
                const badge =
                  yearly && savePercent > 0
                    ? fillTemplate(t("paywall.membership.save"), { percent: savePercent })
                    : undefined;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => setProductId(item.id)}
                    style={[styles.planCard, on ? styles.planOn : styles.planOff]}
                  >
                    {badge ? (
                      <View style={styles.planBadge}>
                        <ThemedText type="smallBold" style={styles.planBadgeText}>
                          {badge}
                        </ThemedText>
                      </View>
                    ) : null}
                    {on ? (
                      <View style={styles.check}>
                        <IconCheck size={12} color="#FFFFFF" strokeWidth={2.4} />
                      </View>
                    ) : null}
                    <ThemedText type="small" themeColor="textSecondary">
                      {yearly ? t("paywall.membership.yearly") : t("paywall.membership.monthly")}
                    </ThemedText>
                    <ThemedText type="smallBold" style={styles.planPrice}>
                      {item.displayPrice}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {yearly ? t("paywall.membership.perYear") : t("paywall.membership.perMonth")}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
          {footer}
        </>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: CANVAS,
    flex: 1,
  },
  scroll: {
    backgroundColor: CANVAS,
    flex: 1,
  },
  body: {
    gap: Spacing.four,
    paddingBottom: Spacing.six,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  pointsPage: {
    backgroundColor: CANVAS,
    flex: 1,
  },
  pointsTop: {
    gap: Spacing.four,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  hero: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: Spacing.four,
  },
  heroPoints: {
    fontSize: 40,
    fontWeight: "700",
    lineHeight: 48,
    textAlign: "center",
  },
  heroPrice: {
    color: BRAND,
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 34,
    marginTop: Spacing.two,
  },
  userCard: {
    alignItems: "center",
    backgroundColor: SURFACE,
    borderColor: LINE,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: Colors.dark.backgroundSelected,
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    overflow: "hidden",
    width: 44,
  },
  userCopy: {
    flex: 1,
    gap: Spacing.one,
    minWidth: 0,
  },
  balanceRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.one,
  },
  tabs: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  tab: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  tabOn: {
    backgroundColor: "rgba(229,34,39,0.14)",
    borderColor: BRAND,
  },
  tabOff: {
    backgroundColor: SURFACE,
    borderColor: LINE,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.three,
  },
  pack: {
    alignItems: "center",
    backgroundColor: "#1C1C1C",
    borderRadius: 16,
    gap: Spacing.two,
    minHeight: 156,
    overflow: "hidden",
    paddingBottom: Spacing.five,
    paddingHorizontal: Spacing.two,
    paddingTop: 36,
  },
  packPreset: {
    flex: 1,
  },
  packWide: {
    width: "100%",
  },
  packOn: {
    borderColor: BRAND,
    borderWidth: 2,
  },
  packOff: {
    borderColor: LINE,
    borderWidth: StyleSheet.hairlineWidth,
  },
  packTint: {
    ...StyleSheet.absoluteFill,
  },
  packEyebrow: {
    textAlign: "center",
  },
  check: {
    alignItems: "center",
    backgroundColor: BRAND,
    borderRadius: 10,
    height: 20,
    justifyContent: "center",
    position: "absolute",
    right: 8,
    top: 8,
    width: 20,
    zIndex: 2,
  },
  packAmount: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.one,
  },
  packPoints: {
    fontSize: 22,
    lineHeight: 26,
  },
  benefits: {
    gap: Spacing.two,
  },
  benefitRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: Spacing.two,
  },
  benefitText: {
    flex: 1,
  },
  planRow: {
    flexDirection: "row",
    gap: Spacing.three,
  },
  planCard: {
    alignItems: "center",
    backgroundColor: SURFACE,
    borderRadius: 16,
    flex: 1,
    gap: Spacing.two,
    overflow: "hidden",
    paddingBottom: Spacing.five,
    paddingHorizontal: Spacing.two,
    paddingTop: 36,
  },
  planOn: {
    borderColor: BRAND,
    borderWidth: 2,
  },
  planOff: {
    borderColor: LINE,
    borderWidth: StyleSheet.hairlineWidth,
  },
  planBadge: {
    alignSelf: "center",
    backgroundColor: "rgba(229,34,39,0.16)",
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    position: "absolute",
    top: 8,
  },
  planBadgeText: {
    color: BRAND,
    fontSize: 10,
  },
  planPrice: {
    fontSize: 22,
    lineHeight: 26,
  },
  footer: {
    alignItems: "flex-end",
    backgroundColor: CANVAS,
    borderTopColor: LINE,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: Spacing.three,
    justifyContent: "space-between",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  footerStack: {
    alignItems: "stretch",
    flexDirection: "column",
  },
  footerCopyStacked: {
    flexGrow: 0,
  },
  footerCopy: {
    flex: 1,
    gap: Spacing.one,
    minWidth: 0,
    paddingBottom: Spacing.one,
  },
  payButton: {
    alignItems: "center",
    backgroundColor: BRAND,
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 128,
    paddingHorizontal: Spacing.five,
  },
  payButtonFull: {
    minWidth: 0,
    width: "100%",
  },
  payButtonDisabled: {
    opacity: 0.7,
  },
  payLabel: {
    color: "#FFFFFF",
  },
  payLabelRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.one,
  },
  computePanel: {
    backgroundColor: SURFACE,
    borderColor: LINE,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.three,
    padding: Spacing.four,
  },
  computeTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.two,
  },
  computeBalanceRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.two,
    marginTop: -Spacing.one,
  },
  computeBalanceCompact: {
    fontVariant: ["tabular-nums"],
  },
  computeBalance: {
    fontSize: 28,
    lineHeight: 34,
  },
  computeChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  computeChip: {
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  computeChipOn: {
    backgroundColor: "#FFFFFF",
  },
  computeChipOff: {
    backgroundColor: Colors.dark.backgroundSelected,
  },
  computeAmountShell: {
    alignItems: "center",
    backgroundColor: CANVAS,
    borderColor: LINE,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 44,
    paddingHorizontal: Spacing.three,
  },
  computeAmountPrefix: {
    marginRight: Spacing.one,
  },
  computeAmountInput: {
    flex: 1,
    fontSize: 16,
    fontVariant: ["tabular-nums"],
    fontWeight: "600",
    paddingVertical: Spacing.two,
  },
  computeEstimate: {
    backgroundColor: Colors.dark.backgroundSelected,
    borderRadius: 12,
    gap: Spacing.one,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  computeEstimateValue: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.one,
  },
  computeEstimateAmount: {
    fontSize: 16,
    fontVariant: ["tabular-nums"],
  },
  restore: {
    alignSelf: "flex-start",
    paddingVertical: Spacing.one,
  },
  unsupported: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: Spacing.four,
  },
  unsupportedBody: {
    marginBottom: Spacing.five,
  },
});
