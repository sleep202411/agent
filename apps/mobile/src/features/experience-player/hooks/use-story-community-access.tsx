import type {
  ExperienceAccessRequirement,
  ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";
import IconLock from "@tabler/icons-react-native/IconLock";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { getAuthSnapshot, openAuthSheet } from "@/auth";
import { openPaywall } from "@/features/paywall";
import { useTranslations } from "@/i18n";

import {
  fetchStoryCommunityAccessQuote,
  purchaseStoryCommunityAccess,
  type StoryCommunityAccessQuote,
} from "../api/story-community-access-api";
import type { ExperiencePlayerAccess } from "../lib/experience-player-access";
import { communityAccessDialogStyles as styles } from "./community-access-dialog-styles";

type AccessRequest = {
  requirement: ExperienceAccessRequirement;
  resolve: (allowed: boolean) => void;
};

/** H5 `useStoryCommunityAccess` — quote / purchase / recharge for published play. */
export function useStoryCommunityAccess(
  runtime: ExperienceRuntimeManifest,
  locale: string
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

  const finish = useCallback((allowed: boolean) => {
    quoteGeneration.current += 1;
    const current = pending.current;
    pending.current = null;
    setRequest(null);
    setError(null);
    setQuoteError(null);
    current?.resolve(allowed);
  }, []);

  useEffect(
    () => () => {
      quoteGeneration.current += 1;
      pending.current?.resolve(false);
      pending.current = null;
    },
    []
  );

  const loadQuote = useCallback(async (): Promise<StoryCommunityAccessQuote | null> => {
    const generation = ++quoteGeneration.current;
    const currentRequest = pending.current;
    setQuoteLoading(true);
    setQuoteError(null);
    try {
      const latest = await fetchStoryCommunityAccessQuote(runtime.gameId, runtime.buildId);
      if (generation !== quoteGeneration.current || pending.current !== currentRequest) return null;
      quoteCache.current = latest;
      setQuote(latest);
      return latest;
    } catch (failure) {
      if (generation !== quoteGeneration.current || pending.current !== currentRequest) return null;
      const message = failure instanceof Error ? failure.message : t("play.communityAccess.failed");
      setQuoteError(message);
      return null;
    } finally {
      if (generation === quoteGeneration.current) setQuoteLoading(false);
    }
  }, [runtime.buildId, runtime.gameId, t]);

  useFocusEffect(
    useCallback(() => {
      if (!pending.current) return;
      void loadQuote().then((latest) => {
        const current = pending.current;
        if (current && latest?.ownedKeys.includes(current.requirement.key)) finish(true);
      });
    }, [finish, loadQuote])
  );

  const formatPrice = useCallback(
    (amount: number) => t("play.communityAccess.price").replace("{amount}", String(amount)),
    [t]
  );

  const access = useMemo<ExperiencePlayerAccess>(
    () => ({
      canAccess: (requirement) => quoteCache.current?.ownedKeys.includes(requirement.key) ?? false,
      checkAccess: async (requirement) => {
        try {
          const latest = await fetchStoryCommunityAccessQuote(runtime.gameId, runtime.buildId);
          quoteCache.current = latest;
          setQuote(latest);
          return latest.ownedKeys.includes(requirement.key);
        } catch {
          return false;
        }
      },
      requestAccess: (requirement) =>
        new Promise<boolean>((resolve) => {
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
    [finish, formatPrice, loadQuote, runtime.buildId, runtime.gameId]
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
    if (!request || !price || payingRef.current) return;
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
      setError(failure instanceof Error ? failure.message : t("play.communityAccess.failed"));
      void loadQuote();
    } finally {
      payingRef.current = false;
      setPaying(false);
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
              onPress={() => openPaywall({ category: "community_points" })}
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
