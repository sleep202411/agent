import { router } from "expo-router";
import { Pressable } from "react-native";
import { Tag } from "@/components/ui";
import type { IpDetail } from "@/data/types";
import { toHref } from "@/lib/navigation";

/** Labels alone are not identifiers. Only link an unambiguous server-provided code. */
export function IpTags({ ip }: { ip: Pick<IpDetail, "tags" | "typeTags" | "typeTagCodes"> }) {
  return (
    <>
      {ip.tags.map((label, index) => {
        const matches = ip.typeTags.flatMap((value, i) => (value === label ? [i] : []));
        const code =
          ip.typeTags.length === ip.typeTagCodes.length && matches.length === 1
            ? ip.typeTagCodes[matches[0]!]
            : undefined;
        return code?.trim() && code.length <= 80 ? (
          <Pressable
            key={`${label}:${index}`}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => router.push(toHref(`/tags/${encodeURIComponent(code)}`))}
          >
            <Tag label={label} />
          </Pressable>
        ) : (
          <Tag key={`${label}:${index}`} label={label} />
        );
      })}
    </>
  );
}
