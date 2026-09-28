import type { ExperienceAccessRequirement } from "@repo/shared/experience-runtime";
import IconLock from "@tabler/icons-react-native/IconLock";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTranslations } from "@/i18n";

import type { ExperiencePlayerAccess } from "../lib/experience-player-access";
import { communityAccessDialogStyles as styles } from "./community-access-dialog-styles";

type AccessRequest = {
  requirement: ExperienceAccessRequirement;
  resolve: (allowed: boolean) => void;
};

/**
 * Local playtest unlock — Studio `useStoryPreviewAccess` parity.
 * Never calls the wallet or purchase API.
 */
export function useStoryPreviewAccess(locale: string): {
  access: ExperiencePlayerAccess;
  dialog: ReactNode;
} {
  const t = useTranslations();
  const unlocked = useRef(new Set<string>());
  const pending = useRef<AccessRequest | null>(null);
  const [request, setRequest] = useState<AccessRequest | null>(null);

  const finish = useCallback((allowed: boolean) => {
    const current = pending.current;
    pending.current = null;
    if (allowed && current) unlocked.current.add(current.requirement.key);
    setRequest(null);
    current?.resolve(allowed);
  }, []);

  useEffect(
    () => () => {
      pending.current?.resolve(false);
      pending.current = null;
    },
    []
  );

  const formatPrice = useCallback(
    (amount: number) => t("play.communityAccess.price").replace("{amount}", String(amount)),
    [t]
  );

  const access = useMemo<ExperiencePlayerAccess>(
    () => ({
      canAccess: (requirement) => unlocked.current.has(requirement.key),
      requestAccess: (requirement) =>
        new Promise<boolean>((resolve) => {
          pending.current?.resolve(false);
          const next = { requirement, resolve };
          pending.current = next;
          setRequest(next);
        }),
      formatPrice,
    }),
    [formatPrice]
  );

  const title =
    request?.requirement.title[locale] ??
    (request ? Object.values(request.requirement.title)[0] : undefined);

  const dialog = request ? (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => finish(false)} />
      <Pressable style={styles.card} onPress={(event) => event.stopPropagation()}>
        <View style={styles.lockBadge}>
          <IconLock size={20} color="#FFD84D" strokeWidth={1.8} />
        </View>
        <Text style={styles.title}>{t("play.communityAccess.title")}</Text>
        {title ? <Text style={styles.description}>{title}</Text> : null}
        {request ? (
          <Text style={styles.price}>{formatPrice(request.requirement.communityPointPrice)}</Text>
        ) : null}
        <Text style={styles.hint}>{t("play.communityAccess.chargeHint")}</Text>
        <Text style={styles.previewHint}>{t("play.communityAccess.previewHint")}</Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => finish(false)}
            style={styles.secondaryHit}
          >
            <Text style={styles.secondaryText}>{t("play.communityAccess.cancel")}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => finish(true)}
            style={styles.primaryHit}
          >
            <Text style={styles.primaryText}>{t("play.communityAccess.unlock")}</Text>
          </Pressable>
        </View>
      </Pressable>
    </View>
  ) : null;

  return { access, dialog };
}
