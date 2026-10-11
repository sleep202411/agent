import type {
  ExperienceAccessRequirement,
  ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";
import IconLock from "@tabler/icons-react-native/IconLock";
import { useFocusEffect } from "expo-router";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { getAuthGeneration, subscribeAuth } from "@/auth/auth-store";
import { getAuthSnapshot, openAuthSheet } from "@/auth";
import { openPaywall } from "@/features/paywall";
import { useTranslations } from "@/i18n";

import {
  fetchStoryCommunityAccessQuote,
  purchaseStoryCommunityAccess,
  type StoryCommunityAccessQuote,
} from "../api/story-community-access-api";
import { storyTopUpReturnStore } from "../lib/story-top-up-return";
import { buildExperiencePlayShareUrl } from "../lib/experience-share";
import type { ExperiencePlayerAccess } from "../lib/experience-player-access";
import { communityAccessDialogStyles as styles } from "./community-access-dialog-styles";

type AccessRequest = {
  requirement: ExperienceAccessRequirement;
  resolve: (allowed: boolean) => void;
};

/** H5 `useStoryCommunityAccess` — quote / purchase / recharge for published play. */
export function useStoryCommunityAccess(
  runtime: ExperienceRuntimeManifest,
  locale: string,
  chapterId?: string,
  published = true
): {
  access: ExperiencePlayerAccess;
  dialog: ReactNode;
} {
  const t = useTranslations();
  const [request, setRequest] = useState<AccessRequest | null>(null);
  const [quote, setQuote] = useState<StoryCommunityAccessQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AccessRequest | null>(null);
  const payingRef = useRef(false);
  const quoteCache = useRef<StoryCommunityAccessQuote | null>(null);
  const quoteGeneration = useRef(0);
  const mounted = useRef(false);
  const scopeKey = `${runtime.gameId}:${runtime.buildId}`;
  const scopeKeyRef = useRef(scopeKey);
  const scopeGeneration = useRef(0);
  const cacheAuthGeneration = useRef(getAuthGeneration());

  const finish = useCallback((allowed: boolean) => {
    quoteGeneration.current += 1;
    const current = pending.current;
    pending.current = null;
    setRequest(null);
    setError(null);
    setQuoteError(null);
    current?.resolve(allowed);
  }, []);

  useLayoutEffect(() => {
    mounted.current = true;
    scopeKeyRef.current = scopeKey;
    scopeGeneration.current += 1;
    let owner = getAuthGeneration();
    const reset = () => {
      quoteGeneration.current += 1;
      quoteCache.current = null;
      setQuote(null);
      setQuoteLoading(false);
      payingRef.current = false;
      setPaying(false);
      finish(false);
    };
    reset();
    const unsubscribe = subscribeAuth(() => {
      const next = getAuthGeneration();
      if (next === owner) return;
      owner = next;
      scopeGeneration.current += 1;
      reset();
    });
    return () => {
      mounted.current = false;
      scopeGeneration.current += 1;
      quoteGeneration.current += 1;
      quoteCache.current = null;
      pending.current?.resolve(false);
      pending.current = null;
      unsubscribe();
    };
  }, [scopeKey, finish]);

  const loadQuote = useCallback(async (): Promise<StoryCommunityAccessQuote | null> => {
    if (!mounted.current || scopeKeyRef.current !== scopeKey) return null;
    const generation = ++quoteGeneration.current;
    const currentRequest = pending.current;
    const owner = getAuthGeneration();
    const scope = scopeGeneration.current;
    const owns = () =>
      mounted.current &&
      scopeKeyRef.current === scopeKey &&
      owner === getAuthGeneration() &&
      scope === scopeGeneration.current &&
      generation === quoteGeneration.current &&
      pending.current === currentRequest;
    setQuoteLoading(true);
    setQuoteError(null);
    try {
      const latest = await fetchStoryCommunityAccessQuote(runtime.gameId, runtime.buildId);
      if (!owns()) return null;
      cacheAuthGeneration.current = owner;
      quoteCache.current = latest;
      setQuote(latest);
      return latest;
    } catch (failure) {
      if (!owns()) return null;
      const message = failure instanceof Error ? failure.message : t("play.communityAccess.failed");
      setQuoteError(message);
      return null;
    } finally {
      if (owns()) setQuoteLoading(false);
    }
  }, [runtime.buildId, runtime.gameId, scopeKey, t]);

  useFocusEffect(
    useCallback(() => {
      if (!published) return;
      const auth = getAuthSnapshot();
      const accountId =
        auth.status === "authenticated" ? String(auth.user?.userId ?? auth.user?.id ?? "") : "";
      if (accountId) {
        try {
          storyTopUpReturnStore(accountId).arrived(runtime.gameId, chapterId);
        } catch (error) {
          setError(error instanceof Error ? error.message : String(error));
        }
      }
      if (!pending.current) return;
      void loadQuote().then((latest) => {
        const current = pending.current;
        if (current && latest?.ownedKeys.includes(current.requirement.key)) finish(true);
      });
    }, [finish, loadQuote, runtime.gameId, chapterId, published])
  );

  const formatPrice = useCallback(
    (amount: number) => t("play.communityAccess.price").replace("{amount}", String(amount)),
    [t]
  );

  const access = useMemo<ExperiencePlayerAccess>(
    () => ({
      canAccess: (requirement) =>
        mounted.current &&
        scopeKeyRef.current === scopeKey &&
        cacheAuthGeneration.current === getAuthGeneration() &&
        (quoteCache.current?.ownedKeys.includes(requirement.key) ?? false),
      checkAccess: async (requirement) => {
        const latest = await loadQuote();
        return latest?.ownedKeys.includes(requirement.key) ?? false;
      },
      requestAccess: (requirement) =>
        new Promise<boolean>((resolve) => {
          if (!mounted.current || scopeKeyRef.current !== scopeKey) {
            resolve(false);
            return;
          }
          pending.current?.resolve(false);
          const next = { requirement, resolve };
          pending.current = next;
          setError(null);
          setRequest(next);
          void loadQuote().then((latest) => {
            if (pending.current === next && latest?.ownedKeys.includes(requirement.key))
              finish(true);
          });
        }),
      formatPrice,
    }),
    [finish, formatPrice, loadQuote, scopeKey]
  );

  const price =
    request &&
    (quote?.requirements.find((requirement) => requirement.key === request.requirement.key) ??
      request.requirement);
  const insufficient =
    Boolean(price) &&
    quote?.balance != null &&
    BigInt(quote.balance) < BigInt(price!.communityPointPrice);

  const purchase = async () => {
    if (!request || !price || payingRef.current || !mounted.current || pending.current !== request)
      return;
    const original = request;
    const owner = getAuthGeneration();
    const scope = scopeGeneration.current;
    const owns = () =>
      mounted.current &&
      owner === getAuthGeneration() &&
      scope === scopeGeneration.current &&
      pending.current === original;
    payingRef.current = true;
    setPaying(true);
    setError(null);
    try {
      await purchaseStoryCommunityAccess({
        projectId: runtime.gameId,
        buildId: runtime.buildId,
        key: price.key,
        expectedPrice: price.communityPointPrice,
      });
      if (!owns()) return;
      cacheAuthGeneration.current = owner;
      const nextOwned = [...new Set([...(quoteCache.current?.ownedKeys ?? []), price.key])];
      const nextQuote: StoryCommunityAccessQuote = quoteCache.current
        ? { ...quoteCache.current, ownedKeys: nextOwned }
        : {
            requirements: quote?.requirements ?? [price],
            ownedKeys: nextOwned,
            balance: quote?.balance ?? null,
            authenticated: true,
          };
      quoteCache.current = nextQuote;
      setQuote(nextQuote);
      finish(true);
    } catch (failure) {
      if (!owns()) return;
      setError(failure instanceof Error ? failure.message : t("play.communityAccess.failed"));
      void loadQuote();
    } finally {
      if (mounted.current && scope === scopeGeneration.current && owner === getAuthGeneration()) {
        payingRef.current = false;
        setPaying(false);
      }
    }
  };

  const title =
    price?.title[locale] ??
    price?.title[runtime.localization.defaultLocale] ??
    (price ? Object.values(price.title)[0] : undefined);

  const auth = getAuthSnapshot();
  const authenticated = quote?.authenticated ?? auth.status === "authenticated";

  const dialog = request ? (
    <View style={styles.backdrop}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => {
          if (!payingRef.current) finish(false);
        }}
      />
      <Pressable style={styles.card} onPress={(event) => event.stopPropagation()}>
        <View style={styles.lockBadge}>
          <IconLock size={20} color="#FFD84D" strokeWidth={1.8} />
        </View>
        <Text style={styles.title}>{t("play.communityAccess.title")}</Text>
        <Text style={styles.description}>{title ?? t("play.communityAccess.checking")}</Text>
        {quote && price ? (
          <>
            <Text style={styles.price}>{formatPrice(price.communityPointPrice)}</Text>
            <Text style={styles.hint}>{t("play.communityAccess.once")}</Text>
            {quote.balance != null ? (
              <Text style={styles.balance}>
                {t("play.communityAccess.balance").replace("{amount}", quote.balance)}
              </Text>
            ) : null}
          </>
        ) : (
          <View style={styles.checkingRow}>
            {quoteLoading ? <ActivityIndicator color="rgba(255,255,255,0.7)" /> : null}
            <Text style={styles.checking}>{t("play.communityAccess.checking")}</Text>
          </View>
        )}
        {error || quoteError ? <Text style={styles.error}>{error ?? quoteError}</Text> : null}
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={paying}
            onPress={() => finish(false)}
            style={styles.secondaryHit}
          >
            <Text style={styles.secondaryText}>{t("play.communityAccess.cancel")}</Text>
          </Pressable>
          {quoteError ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void loadQuote()}
              style={styles.primaryHit}
            >
              <Text style={styles.primaryText}>{t("play.communityAccess.retry")}</Text>
            </Pressable>
          ) : !authenticated ? (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                openAuthSheet({
                  mode: "login",
                  onAuthenticated: () => {
                    void loadQuote();
                  },
                })
              }
              style={styles.primaryHit}
            >
              <Text style={styles.primaryText}>{t("play.communityAccess.signIn")}</Text>
            </Pressable>
          ) : insufficient ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (
                  !mounted.current ||
                  scopeKeyRef.current !== scopeKey ||
                  cacheAuthGeneration.current !== getAuthGeneration() ||
                  pending.current !== request
                )
                  return;
                const auth = getAuthSnapshot();
                const accountId =
                  auth.status === "authenticated"
                    ? String(auth.user?.userId ?? auth.user?.id ?? "")
                    : "";
                if (!accountId) return;
                try {
                  storyTopUpReturnStore(accountId).remember(runtime.gameId, chapterId);
                  openPaywall({
                    category: "community_points",
                    communityReturnUrl: buildExperiencePlayShareUrl({
                      gameId: runtime.gameId,
                      locale,
                      chapterId,
                    }),
                  });
                } catch (error) {
                  setError(error instanceof Error ? error.message : String(error));
                }
              }}
              style={styles.primaryHit}
            >
              <Text style={styles.primaryText}>{t("play.communityAccess.recharge")}</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              disabled={!price || paying || quoteLoading}
              onPress={() => void purchase()}
              style={[
                styles.primaryHit,
                (!price || paying || quoteLoading) && styles.primaryHitDisabled,
              ]}
            >
              <Text style={styles.primaryText}>
                {t(paying ? "play.communityAccess.unlocking" : "play.communityAccess.unlock")}
              </Text>
            </Pressable>
          )}
        </View>
      </Pressable>
    </View>
  ) : null;

  return { access, dialog };
}
