import IconBolt from "@tabler/icons-react-native/IconBolt";
import IconCheck from "@tabler/icons-react-native/IconCheck";
import IconCoins from "@tabler/icons-react-native/IconCoins";
import IconCrown from "@tabler/icons-react-native/IconCrown";
import IconSparkles from "@tabler/icons-react-native/IconSparkles";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import {
  ActivityIndicator,
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

import { useAuth } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { appEnv, resolveAssetUrl } from "@/config";
import { Colors, Spacing } from "@/constants/theme";
import { fetchCommunityPointBalance } from "@/data/ip-api";
import { toHref } from "@/lib/navigation";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations, type MessageKey } from "@/i18n";

import {
  COMPUTE_RECHARGE_DEFAULT,
  COMPUTE_RECHARGE_PRESETS,
  communityPointsUseBillingApi,
  computeCustomProduct,
  computeRechargeCurrencySymbol,
  isCnComputeRecharge,
  isMembershipCategory,
  parseComputeRechargeAmount,
  productsForCategory,
  yearlySavePercent,
} from "../lib/catalog";
import { currentCheckoutChannel, type CheckoutChannel } from "../lib/checkout-channel";
import { useComputeWalletBalance } from "../lib/use-compute-wallet-balance";
import {
  resolvePaywallCategory,
  PAYWALL_CATEGORIES,
  type PaywallCategory,
} from "../lib/paywall-store";
import {
  listCommunityPointPackages,
  listMembershipPrices,
  paywallBillingCurrency,
} from "../lib/billing-api";
import { isPurchaseCancelled, purchaseProduct, restorePurchases } from "../lib/purchase";
import { syncRevenueCatPurchases } from "../lib/revenuecat-sync";
import { followWechatOrderUntilSettled } from "../lib/wechat-order-follow";
import { communityPackProduct, membershipProduct } from "../lib/wechat";
import { sanitizeAppWebPath } from "../lib/web-checkout";
import { usePaywallSelection } from "../lib/use-paywall-selection";
import { WechatScanPay } from "./wechat-scan-pay";
import type { PaywallProduct } from "../lib/catalog";

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

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return String(error);
}

function accountDisplayName(
  user:
    | {
        nickName?: string;
        nickname?: string;
        userName?: string;
        name?: string;
        email?: string;
        phone?: string;
      }
    | null
    | undefined,
  fallback: string
): string {
  return (
    user?.nickName?.trim() ||
    user?.nickname?.trim() ||
    user?.userName?.trim() ||
    user?.name?.trim() ||
    user?.email?.trim() ||
    user?.phone?.trim() ||
    fallback
  );
}

function accountAvatarUrl(
  user: { avatar?: string; headImg?: string; headImgUrl?: string } | null | undefined
): string | undefined {
  const raw = user?.avatar ?? user?.headImg ?? user?.headImgUrl;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  return resolveAssetUrl(raw, appEnv.assets.userBaseUrl);
}

function CommunityAccountRow({
  name,
  label,
  balance,
}: {
  name: string;
  label: string;
  balance: string;
}) {
  const avatarUrl = accountAvatarUrl(useAuth().user);
  return (
    <View style={styles.userCard}>
      <View style={styles.avatar}>
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <IconCoins size={20} color={BRAND} strokeWidth={1.8} />
        )}
      </View>
      <View style={styles.userCopy}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {name}
        </ThemedText>
        <View style={styles.balanceRow}>
          <IconCoins size={14} color={BRAND} strokeWidth={1.8} />
          <ThemedText type="small" themeColor="textSecondary">
            {label}
          </ThemedText>
          <ThemedText type="smallBold">{balance}</ThemedText>
        </View>
      </View>
    </View>
  );
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
  const { generation } = useAuth();
  return <PaywallSession key={generation} />;
}

function PaywallSession() {
  const params = useLocalSearchParams<{
    category?: string | string[];
    returnPath?: string | string[];
  }>();
  const initialCategory = resolvePaywallCategory(paramValue(params.category));
  const returnPath = paramValue(params.returnPath);
  const t = useTranslations();
  const locale = useLocale();
  const auth = useAuth();
  const sessionGeneration = auth.generation;
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isCurrentSession = useCallback(
    () => mounted.current && getAuthGeneration() === sessionGeneration,
    [sessionGeneration]
  );
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { selected, setSelected, productId, setProductId, computeAmount, setComputeAmount } =
    usePaywallSelection(initialCategory);
  const {
    balance: computeBalance,
    error: computeError,
    loading: computeLoading,
    refresh: refreshCompute,
  } = useComputeWalletBalance();
  const [communityBalance, setCommunityBalance] = useState<string | null>(null);
  const [communityError, setCommunityError] = useState<string | null>(null);
  const [communityLoading, setCommunityLoading] = useState(false);
  const communityRead = useRef(0);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [communityPacks, setCommunityPacks] = useState<
    ReturnType<typeof communityPackProduct>[] | null
  >(null);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [communityPackError, setCommunityPackError] = useState<string | null>(null);
  const [membershipPlans, setMembershipPlans] = useState<PaywallProduct[] | null>(null);
  const [membershipPlanError, setMembershipPlanError] = useState<string | null>(null);
  const [scan, setScan] = useState<{
    orderId: string;
    codeUrl: string;
    amountLabel: string;
  } | null>(null);
  const channel = useMemo(() => currentCheckoutChannel(), []);
  const unsupported = channel === "web";
  const membership = isMembershipCategory(selected);
  const computePoints = selected === "compute_points";
  const apiCommunityMembership = selected === "community_membership";
  const catalogProducts = productsForCategory(selected);
  const membershipProducts = apiCommunityMembership ? (membershipPlans ?? []) : catalogProducts;
  const products = apiCommunityMembership ? membershipProducts : catalogProducts;
  const savePercent = yearlySavePercent(products);
  const apiCommunity = communityPointsUseBillingApi(channel) && selected === "community_points";
  const catalogProduct = products.find((item) => item.id === productId) ?? products[0];
  const computeProduct = computePoints ? computeCustomProduct(computeAmount) : null;
  const wechatPack =
    communityPacks?.find((item) => item.id === productId) ?? communityPacks?.[0] ?? null;
  const membershipPick =
    membershipProducts.find((item) => item.id === productId) ?? membershipProducts[0] ?? null;
  const product = apiCommunity
    ? wechatPack
    : apiCommunityMembership
      ? membershipPick
      : computePoints
        ? computeProduct
        : catalogProduct;
  const pointsCheckout = selected === "community_points" || selected === "compute_points";
  const stackedFooter = membership || pointsCheckout;

  useEffect(() => {
    if (!communityPointsUseBillingApi(channel)) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const prices = await listCommunityPointPackages(
          paywallBillingCurrency(),
          controller.signal
        );
        if (controller.signal.aborted || !isCurrentSession()) return;
        const storeIap = channel === "apple_iap" || channel === "google_play_iap";
        const next = prices
          .map(communityPackProduct)
          .filter(
            (item) =>
              !storeIap || item.storeProductId.startsWith("com.fizzdragon.community.credits.")
          );
        if (controller.signal.aborted || !isCurrentSession()) return;
        setCommunityPackError(null);
        setCommunityPacks(next);
      } catch (error: unknown) {
        if (controller.signal.aborted || !isCurrentSession()) return;
        setCommunityPacks([]);
        setCommunityPackError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      controller.abort();
    };
  }, [channel, isCurrentSession, catalogRevision]);

  // Nest packs arrive after first paint — keep productId on a real row.
  useEffect(() => {
    if (!apiCommunity || !communityPacks?.length) return;
    if (communityPacks.some((item) => item.id === productId)) return;
    setProductId(communityPacks[0]!.id);
  }, [apiCommunity, communityPacks, productId, setProductId]);

  useEffect(() => {
    // Keep the Nest membership catalog off until that tab is visible again.
    if (selected !== "community_membership") return;
    const controller = new AbortController();
    void (async () => {
      try {
        const prices = await listMembershipPrices(
          {
            productType: "community_membership_plan",
            currency: paywallBillingCurrency(),
          },
          controller.signal
        );
        if (controller.signal.aborted || !isCurrentSession()) return;
        const next = prices
          .filter((price) => price.isActive !== false)
          .map((price) => membershipProduct(price, "community_membership"));
        if (controller.signal.aborted || !isCurrentSession()) return;
        setMembershipPlanError(null);
        setMembershipPlans(next);
      } catch (error: unknown) {
        if (controller.signal.aborted || !isCurrentSession()) return;
        setMembershipPlans([]);
        setMembershipPlanError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      controller.abort();
    };
  }, [isCurrentSession, selected, catalogRevision]);

  // Nest plans arrive after first paint — pick yearly → monthly → one_time → first.
  useEffect(() => {
    if (!apiCommunityMembership || !membershipPlans?.length) return;
    if (membershipPlans.some((item) => item.id === productId)) return;
    const preferred =
      membershipPlans.find((item) => item.interval === "year") ??
      membershipPlans.find((item) => item.interval === "month") ??
      membershipPlans.find((item) => item.interval === "one_time") ??
      membershipPlans[0];
    if (preferred) setProductId(preferred.id);
  }, [apiCommunityMembership, membershipPlans, productId, setProductId]);

  const refreshCommunity = useCallback(
    async (signal?: AbortSignal) => {
      if (signal?.aborted || !isCurrentSession()) return;
      const request = ++communityRead.current;
      const current = () =>
        !signal?.aborted && isCurrentSession() && request === communityRead.current;
      setCommunityLoading(true);
      setCommunityError(null);
      try {
        const balance = await fetchCommunityPointBalance(signal);
        if (current()) setCommunityBalance(balance);
      } catch (cause) {
        if (current()) {
          setCommunityBalance(null);
          setCommunityError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (current()) setCommunityLoading(false);
      }
    },
    [isCurrentSession]
  );
  useEffect(() => {
    if (!communityPointsUseBillingApi(channel)) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      void refreshCommunity(controller.signal);
    });
    return () => controller.abort();
  }, [channel, refreshCommunity]);

  const canRestore = channel === "apple_iap" || channel === "google_play_iap";
  const actionsLocked = busy || restoring;
  // React state disables the UI on the next render; serialize dispatch now.
  const paymentActionInFlight = useRef(false);
  /** Cancels on-screen WeChat settle UI only — background follow keeps running. */
  const wechatFollowGeneration = useRef(0);
  const wechatPaidRef = useRef(false);
  const scanOrderRef = useRef<string | null>(null);

  const refreshWallets = useCallback(async () => {
    if (!isCurrentSession()) return;
    refreshCompute();
    await refreshCommunity();
  }, [isCurrentSession, refreshCompute, refreshCommunity]);

  // Closing the QR must not drop a payment that settles a moment later.
  // Nest reconciles WeChat on each order read. Follow continues off-screen;
  // Alert / CTA takeover only if this paywall session is still mounted.
  const settleWechatAfterDismiss = useCallback(
    (orderId: string, alreadyPaid: boolean) => {
      void (async () => {
        const followGen = ++wechatFollowGeneration.current;

        if (alreadyPaid) {
          if (!isCurrentSession()) return;
          paymentActionInFlight.current = true;
          setBusy(true);
          setConfirming(true);
          try {
            await refreshWallets();
          } finally {
            if (wechatFollowGeneration.current === followGen) {
              paymentActionInFlight.current = false;
              if (isCurrentSession()) {
                setConfirming(false);
                setBusy(false);
              }
            }
          }
          return;
        }

        const result = await followWechatOrderUntilSettled(orderId);
        if (result !== "fulfilled") return;
        if (!isCurrentSession() || wechatFollowGeneration.current !== followGen) return;

        paymentActionInFlight.current = true;
        setBusy(true);
        setConfirming(true);
        try {
          await refreshWallets();
          if (!isCurrentSession() || wechatFollowGeneration.current !== followGen) return;
          Alert.alert(t("paywall.purchaseOkTitle"), t("paywall.wechat.success"));
        } finally {
          if (wechatFollowGeneration.current === followGen) {
            paymentActionInFlight.current = false;
            if (isCurrentSession()) {
              setConfirming(false);
              setBusy(false);
            }
          }
        }
      })();
    },
    [isCurrentSession, refreshWallets, t]
  );

  useEffect(() => {
    scanOrderRef.current = scan?.orderId ?? null;
  }, [scan]);

  useEffect(
    () => () => {
      wechatFollowGeneration.current += 1;
      // Leaving with the QR still open (or mid-settle): keep reconciling off-screen.
      const orderId = scanOrderRef.current;
      if (orderId) void followWechatOrderUntilSettled(orderId);
    },
    []
  );

  const buy = async () => {
    if (!isCurrentSession() || !product || actionsLocked || paymentActionInFlight.current) return;
    paymentActionInFlight.current = true;
    setBusy(true);
    try {
      const result = await purchaseProduct(product);
      if (result.wechatScan) {
        // QR UI only makes sense on this screen.
        if (!isCurrentSession()) return;
        wechatPaidRef.current = false;
        setScan({
          orderId: result.wechatScan.orderId,
          codeUrl: result.wechatScan.codeUrl,
          amountLabel: product.displayPrice,
        });
        return;
      }
      const storeIap = channel === "apple_iap" || channel === "google_play_iap";
      if (storeIap) {
        // Store already charged. Sync must finish even if the user left —
        // Java only grants points after /user/pay/rc/sync (no webhook).
        // Spinner +「积分到账中」covers sync + wallet refresh (post-StoreKit fulfillment).
        if (isCurrentSession()) setConfirming(true);
        if (!result.mocked) {
          await syncRevenueCatPurchases();
        } else if (isCurrentSession() && process.env.VITEST !== "true") {
          await new Promise((resolve) => setTimeout(resolve, 1_400));
        }
        if (!isCurrentSession()) return;
        await refreshWallets();
        if (!isCurrentSession()) return;
        Alert.alert(t("paywall.purchaseOkTitle"), t("paywall.purchaseOkSuccess"));
      } else {
        if (!isCurrentSession()) return;
        if (!result.mocked) {
          Alert.alert(
            t("paywall.purchaseOkTitle"),
            channel === "wechat" ? t("paywall.wechat.success") : t("paywall.purchaseOkLive")
          );
        }
        await refreshWallets();
      }
    } catch (error: unknown) {
      if (!isCurrentSession() || isPurchaseCancelled(error)) return;
      Alert.alert(t("paywall.purchaseFailed"), errorMessage(error));
    } finally {
      paymentActionInFlight.current = false;
      if (isCurrentSession()) {
        setConfirming(false);
        setBusy(false);
      }
    }
  };

  const restore = async () => {
    if (!isCurrentSession() || actionsLocked || paymentActionInFlight.current) return;
    paymentActionInFlight.current = true;
    setRestoring(true);
    try {
      const result = await restorePurchases();
      if (!isCurrentSession()) return;
      Alert.alert(
        t("paywall.restoreOkTitle"),
        result.mocked ? t("paywall.restoreOkMock") : t("paywall.restoreOkLive")
      );
    } catch (error: unknown) {
      if (!isCurrentSession()) return;
      Alert.alert(t("paywall.restoreFailed"), errorMessage(error));
    } finally {
      paymentActionInFlight.current = false;
      if (isCurrentSession()) setRestoring(false);
    }
  };

  const goWeb = () => {
    router.push(
      toHref(`/pay/community?returnPath=${encodeURIComponent(sanitizeAppWebPath(returnPath))}`)
    );
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
            disabled={actionsLocked}
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
        disabled={!product || actionsLocked}
        onPress={() => void buy()}
        style={[
          styles.payButton,
          stackedFooter && styles.payButtonFull,
          (!product || actionsLocked) && styles.payButtonDisabled,
        ]}
      >
        <View style={styles.payLabelRow}>
          {actionsLocked ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
          <ThemedText type="smallBold" style={styles.payLabel}>
            {confirming
              ? t("paywall.confirming")
              : pointsCheckout
                ? t("paywall.buyNow")
                : membership
                  ? `${t("paywall.membership.subscribe")} · ${product?.displayPrice ?? ""}`
                  : `${t("paywall.payNow")} ${product?.displayPrice ?? ""}`}
          </ThemedText>
        </View>
      </Pressable>
      {membership && canRestore ? (
        <Pressable
          accessibilityRole="button"
          disabled={actionsLocked}
          onPress={() => void restore()}
          style={styles.restore}
        >
          <ThemedText type="small" themeColor="textSecondary" style={styles.restoreLabel}>
            {t("paywall.restore")}
          </ThemedText>
        </Pressable>
      ) : null}
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
          <Pressable accessibilityRole="button" onPress={goWeb} style={styles.payButton}>
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
            {apiCommunity ? (
              <View>
                {communityError && (
                  <View>
                    <ThemedText type="small" accessibilityRole="alert">
                      {communityError}
                    </ThemedText>
                    <Pressable
                      accessibilityRole="button"
                      disabled={communityLoading}
                      onPress={() => void refreshCommunity()}
                      style={{ paddingVertical: 8 }}
                    >
                      <ThemedText type="small">{t("common.retry")}</ThemedText>
                    </Pressable>
                  </View>
                )}
                <CommunityAccountRow
                  balance={
                    communityBalance == null
                      ? communityLoading
                        ? "…"
                        : "—"
                      : formatAmount(communityBalance, locale)
                  }
                  label={t("paywall.communityBalance")}
                  name={accountDisplayName(auth.user, t("paywall.category.communityPoints"))}
                />
              </View>
            ) : null}
            {computePoints ? (
              <View>
                {computeError && (
                  <View>
                    <ThemedText type="small" accessibilityRole="alert">
                      {computeError}
                    </ThemedText>
                    <Pressable
                      accessibilityRole="button"
                      disabled={computeLoading}
                      onPress={refreshCompute}
                      style={{ paddingVertical: 8 }}
                    >
                      <ThemedText>{t("common.retry")}</ThemedText>
                    </Pressable>
                  </View>
                )}
                <ComputeRechargePanel
                  amount={computeAmount}
                  balance={computeBalance}
                  locale={locale}
                  onChangeAmount={setComputeAmount}
                />
              </View>
            ) : null}
          </View>
          {apiCommunity ? (
            <ScrollView
              style={styles.packList}
              contentContainerStyle={styles.packListContent}
              keyboardShouldPersistTaps="handled"
            >
              {communityPacks === null ? (
                <ActivityIndicator color={BRAND} style={styles.packLoading} />
              ) : communityPacks.length === 0 ? (
                <View style={styles.packError}>
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    accessibilityRole={communityPackError ? "alert" : undefined}
                  >
                    {communityPackError ?? t("paywall.wechat.noPacks")}
                  </ThemedText>
                  <Pressable
                    accessibilityRole="button"
                    style={{ paddingVertical: 8 }}
                    onPress={() => {
                      setCommunityPacks(null);
                      setCommunityPackError(null);
                      setCatalogRevision((value) => value + 1);
                    }}
                  >
                    <ThemedText type="small">{t("common.retry")}</ThemedText>
                  </Pressable>
                </View>
              ) : (
                communityPacks.map((item) => {
                  const on = item.id === product?.id;
                  const points =
                    item.grantsPoints != null
                      ? fillTemplate(t("paywall.hero.points"), {
                          amount: formatAmount(item.grantsPoints, locale),
                        })
                      : item.name;
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      onPress={() => setProductId(item.id)}
                      style={[styles.packCard, on ? styles.packCardOn : styles.packCardOff]}
                    >
                      <View style={styles.packCardCopy}>
                        <ThemedText type="smallBold">{item.name || points}</ThemedText>
                        {item.name ? (
                          <ThemedText type="small" themeColor="textSecondary">
                            {points}
                          </ThemedText>
                        ) : null}
                      </View>
                      <ThemedText type="smallBold" style={styles.packCardPrice}>
                        {item.displayPrice}
                      </ThemedText>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          ) : (
            <View style={styles.hero}>
              <ThemedText type="subtitle" style={styles.heroPoints}>
                {heroPoints}
              </ThemedText>
              <ThemedText type="smallBold" style={styles.heroPrice}>
                {product?.displayPrice ?? "—"}
              </ThemedText>
            </View>
          )}
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
              {apiCommunityMembership && membershipPlans === null ? (
                <ActivityIndicator
                  color={BRAND}
                  style={{ flex: 1, paddingVertical: Spacing.six }}
                />
              ) : apiCommunityMembership && products.length === 0 ? (
                <View style={{ flex: 1 }}>
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    accessibilityRole={membershipPlanError ? "alert" : undefined}
                  >
                    {membershipPlanError ?? t("paywall.membership.noPlan")}
                  </ThemedText>
                  <Pressable
                    accessibilityRole="button"
                    style={{ paddingVertical: 8 }}
                    onPress={() => {
                      setMembershipPlans(null);
                      setMembershipPlanError(null);
                      setCatalogRevision((value) => value + 1);
                    }}
                  >
                    <ThemedText type="small">{t("common.retry")}</ThemedText>
                  </Pressable>
                </View>
              ) : (
                products.map((item) => {
                  const on = item.id === product?.id;
                  const yearly = item.interval === "year";
                  const oneTime = item.interval === "one_time";
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
                        {oneTime
                          ? t("paywall.membership.oneTime")
                          : yearly
                            ? t("paywall.membership.yearly")
                            : t("paywall.membership.monthly")}
                      </ThemedText>
                      <ThemedText type="smallBold" style={styles.planPrice}>
                        {item.displayPrice}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {oneTime
                          ? t("paywall.membership.perPass")
                          : yearly
                            ? t("paywall.membership.perYear")
                            : t("paywall.membership.perMonth")}
                      </ThemedText>
                    </Pressable>
                  );
                })
              )}
            </View>
          </ScrollView>
          {footer}
        </>
      )}
      {scan ? (
        <WechatScanPay
          orderId={scan.orderId}
          codeUrl={scan.codeUrl}
          amountLabel={scan.amountLabel}
          onClose={() => {
            const orderId = scan.orderId;
            const alreadyPaid = wechatPaidRef.current;
            wechatPaidRef.current = false;
            setScan(null);
            settleWechatAfterDismiss(orderId, alreadyPaid);
          }}
          onPaid={() => {
            wechatPaidRef.current = true;
            void refreshWallets();
          }}
        />
      ) : null}
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
  packList: {
    flex: 1,
  },
  packListContent: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
  },
  packLoading: {
    marginTop: Spacing.six,
  },
  packCard: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  packCardOn: {
    backgroundColor: SURFACE,
    borderColor: BRAND,
  },
  packCardOff: {
    backgroundColor: SURFACE,
    borderColor: LINE,
  },
  packCardCopy: {
    flex: 1,
    gap: Spacing.one,
  },
  packCardPrice: {
    color: BRAND,
  },
  packError: {
    marginTop: Spacing.three,
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
    alignItems: "center",
    alignSelf: "center",
    paddingVertical: Spacing.two,
  },
  restoreLabel: {
    textAlign: "center",
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
