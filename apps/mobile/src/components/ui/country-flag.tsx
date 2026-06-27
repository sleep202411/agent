import { memo } from "react";
import { View } from "react-native";
import { SvgXml } from "react-native-svg";
import * as flags from "country-flag-icons/string/1x1";

const FLAGS = flags as Record<string, string>;

/**
 * Bundled circular country flag — country-flag-icons' 1:1 (square) SVG rendered
 * via react-native-svg and clipped to a circle. Offline, vector, no network/CDN.
 * `code` is an ISO 3166-1 alpha-2 region code; unknown codes or server sentinels
 * like "GLOBAL" render nothing, so callers fall back gracefully.
 */
export const CountryFlag = memo(function CountryFlag({
  code,
  size = 14,
}: {
  code?: string;
  size?: number;
}) {
  const xml = code ? FLAGS[code.toUpperCase()] : undefined;
  if (!xml) return null;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden" }}>
      <SvgXml xml={xml} width={size} height={size} />
    </View>
  );
});
