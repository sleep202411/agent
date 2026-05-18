import type { ReferenceMap, ReferenceMapEntry } from "./reference-map-context";

interface ReferenceItem {
  url?: string;
  path: string;
  label?: string;
  /** Explicit media kind; overrides URL-extension detection when present */
  kind?: "image" | "video" | "audio";
}

interface MentionInfo {
  id: string;
  type: string; // "character" | "scene" | "prop" | "reference"
  imgUrl: string;
  label: string;
}

/**
 * Build a reference map from current reference group items and prompt mentions.
 *
 * - Items in reference group get valid=true with their per-kind 1-based index
 * - Mentions in prompt that are NOT in reference group get valid=false (gray + strikethrough)
 * - Named entities (character/scene/prop) keep their name
 * - Unnamed references get "参考图 N" / "参考视频 N" / "参考音频 N" by kind
 *
 * `refPrefix` can be either a single string (same prefix for all kinds) or a record
 * keyed by kind. Per-kind numbering lets mixed buckets render naturally — e.g. a
 * bucket [img, img, video, img] shows "参考图 1/2/3" and "参考视频 1".
 */
export function buildReferenceMap(
  referenceItems: ReferenceItem[],
  promptMentions: MentionInfo[],
  refPrefix: string | Partial<Record<"image" | "video" | "audio", string>> = "Ref"
): ReferenceMap {
  const map: ReferenceMap = new Map();

  const resolvePrefix = (kind: "image" | "video" | "audio"): string => {
    if (typeof refPrefix === "string") return refPrefix;
    return refPrefix[kind] ?? refPrefix.image ?? "Ref";
  };

  const getKind = (item: ReferenceItem): "image" | "video" | "audio" =>
    item.kind ?? detectMediaType(item.url ?? item.path ?? "");

  // Assign per-kind 1-based index to each reference item
  const kindCounts: Record<"image" | "video" | "audio", number> = { image: 0, video: 0, audio: 0 };
  const itemKindIndex = new Map<number, { kind: "image" | "video" | "audio"; index: number }>();
  referenceItems.forEach((item, i) => {
    const kind = getKind(item);
    kindCounts[kind] += 1;
    itemKindIndex.set(i, { kind, index: kindCounts[kind] });
  });

  const refUrlSet = new Set<string>();
  for (const item of referenceItems) {
    if (item.url) refUrlSet.add(item.url);
    if (item.path) refUrlSet.add(item.path);
  }

  for (const mention of promptMentions) {
    const inRefGroup = refUrlSet.has(mention.imgUrl) || refUrlSet.has(mention.id);

    let globalIndex = 0;
    let kindIndex = 0;
    let kind: "image" | "video" | "audio" = detectMediaType(mention.imgUrl);
    if (inRefGroup) {
      const idx = referenceItems.findIndex(
        (r) => r.url === mention.imgUrl || r.path === mention.imgUrl || r.path === mention.id
      );
      if (idx >= 0) {
        globalIndex = idx + 1;
        const entry = itemKindIndex.get(idx);
        if (entry) {
          kind = entry.kind;
          kindIndex = entry.index;
        }
      }
    }

    const matchedItem = globalIndex > 0 ? referenceItems[globalIndex - 1] : null;
    const itemLabel = matchedItem?.label;
    const displayLabel = itemLabel
      ? itemLabel
      : kindIndex > 0
        ? `${resolvePrefix(kind)} ${kindIndex}`
        : mention.label;

    const entry: ReferenceMapEntry = {
      index: globalIndex,
      valid: inRefGroup,
      mediaType: kind,
      displayLabel,
    };

    map.set(mention.id, entry);
    if (mention.imgUrl) map.set(mention.imgUrl, entry);
  }

  return map;
}

export function detectMediaType(url: string): "image" | "video" | "audio" {
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) return "video";
  if (/\.(mp3|wav|ogg|aac|flac|m4a)(\?|$)/i.test(url)) return "audio";
  return "image";
}

/**
 * Extract mention info from prompt HTML string.
 */
export function extractMentionsFromHtml(html: string): MentionInfo[] {
  const regex = /<mention\s+([^>]*)>([^<]*)<\/mention>/gi;
  const mentions: MentionInfo[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const attrs = match[1];
    const label = match[2];

    const id = attrs.match(/id="([^"]*)"/)?.[1] ?? "";
    const type = attrs.match(/type="([^"]*)"/)?.[1] ?? "reference";
    const imgUrl = attrs.match(/imgUrl="([^"]*)"/i)?.[1] ?? "";

    mentions.push({ id, type, imgUrl, label });
  }

  return mentions;
}

/**
 * Auto-select references from prompt mentions based on mode's accepted media types.
 * Returns items to fill reference group, up to maxCount.
 */
export function autoSelectReferences(
  promptMentions: MentionInfo[],
  maxCount: number,
  acceptedTypes: Set<"image" | "video" | "audio"> = new Set(["image"])
): ReferenceItem[] {
  const selected: ReferenceItem[] = [];

  for (const mention of promptMentions) {
    if (selected.length >= maxCount) break;
    if (!mention.imgUrl || mention.imgUrl === "null") continue;

    const mediaType = detectMediaType(mention.imgUrl);
    if (!acceptedTypes.has(mediaType)) continue;

    // Avoid duplicates
    if (selected.some((r) => r.url === mention.imgUrl || r.path === mention.imgUrl)) continue;

    selected.push({
      url: mention.imgUrl,
      path: mention.imgUrl,
      label: mention.label,
    });
  }

  return selected;
}

/**
 * Remove <mention> tags from prompt HTML whose imgUrl matches any URL in the set.
 * Returns the original string unchanged (same reference) if nothing was removed.
 */
export function removeMentionsByUrls(html: string, urlsToRemove: Set<string>): string {
  if (urlsToRemove.size === 0 || !html.includes("<mention")) return html;

  const result = html.replace(
    /<mention\s+([^>]*)>[^<]*<\/mention>/gi,
    (fullMatch, attrs: string) => {
      const imgUrl = attrs.match(/imgUrl="([^"]*)"/i)?.[1] ?? "";
      if (imgUrl && urlsToRemove.has(imgUrl)) return "";
      return fullMatch;
    }
  );

  return result === html ? html : result;
}
