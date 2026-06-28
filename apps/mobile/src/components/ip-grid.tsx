import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { PosterImage, Tag } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import type { IpSummary } from "@/data/types";
import { toHref } from "@/lib/navigation";

function chunkPairs<T>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push(items.slice(i, i + 2));
  }
  return rows;
}

function cardMetaLabels(ip: IpSummary): string[] {
  const labels = [ip.regionLabel, ip.genres[0] ?? ip.typeTags[0]].filter(
    (label): label is string => !!label
  );
  return Array.from(new Set(labels)).slice(0, 2);
}

export function IpGrid({ ips }: { ips: IpSummary[] }) {
  return (
    <View style={styles.grid}>
      {chunkPairs(ips).map((row, rowIndex) => (
        <View key={rowIndex} style={styles.gridRow}>
          {row.map((ip) => (
            <View key={ip.id} style={styles.cardItem}>
              <IpGridCard ip={ip} />
            </View>
          ))}
          {row.length === 1 ? <View style={styles.cardItem} /> : null}
        </View>
      ))}
    </View>
  );
}

/** A single IP poster card. Self-contained so it can drop into a `numColumns`
 * FlatList cell (Home / All IPs) or the chunked `IpGrid` rows. */
export function IpGridCard({ ip }: { ip: IpSummary }) {
  const metaLabels = cardMetaLabels(ip);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(toHref(`/ip/${ip.id}`))}
      style={styles.cardItem}
    >
      {({ pressed }) => (
        <View style={[styles.card, pressed && styles.pressed]}>
          <PosterImage
            uri={ip.backdropUrl ?? ip.coverUrl}
            label={ip.title}
            radius={12}
            style={styles.cardCover}
          />
          <ThemedText type="smallBold" numberOfLines={1}>
            {ip.title}
          </ThemedText>
          <View style={styles.cardMetaRow}>
            {metaLabels.map((label) => (
              <Tag key={label} label={label} />
            ))}
          </View>
          {ip.synopsis ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {ip.synopsis}
            </ThemedText>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: Spacing.four,
  },
  gridRow: {
    flexDirection: "row",
    gap: Spacing.three,
  },
  cardItem: {
    flex: 1,
    minWidth: 0,
  },
  card: {
    gap: Spacing.one + 2,
  },
  cardMetaRow: {
    minHeight: 22,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.one,
  },
  cardCover: {
    width: "100%",
    aspectRatio: 16 / 10,
  },
  pressed: {
    opacity: 0.82,
  },
});
