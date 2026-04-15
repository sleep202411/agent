import type { ReferenceMap, ReferenceMapEntry } from "./reference-map-context";

interface ReferenceItem {
  url?: string;
  path: string;
  label?: string;
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
 * - Items in reference group get valid=true with their 1-based index
 * - Mentions in prompt that are NOT in reference group get valid=false (gray + strikethrough)
 * - Named entities (character/scene/prop) keep their name
 * - Unnamed references get "参考图 N" label
 */
export function buildReferenceMap(
  referenceItems: ReferenceItem[],
  promptMentions: MentionInfo[],
  /** Label prefix for unnamed references, e.g. "参考图" → "参考图 1" */
  refPrefix = "参考图"
): ReferenceMap {
  const map: ReferenceMap = new Map();

  // Index all reference group items by url/path for quick lookup
  const refUrlSet = new Set<string>();
  for (const item of referenceItems) {
    if (item.url) refUrlSet.add(item.url);
    if (item.path) refUrlSet.add(item.path);
  }

  // Build entries for each mention in the prompt
  for (const mention of promptMentions) {
    const inRefGroup = refUrlSet.has(mention.imgUrl) || refUrlSet.has(mention.id);

    // Find index in reference group (1-based)
    let index = 0;
    if (inRefGroup) {
      const idx = referenceItems.findIndex(
        (r) => r.url === mention.imgUrl || r.path === mention.imgUrl || r.path === mention.id
      );
      if (idx >= 0) index = idx + 1;
    }

    // Determine display label:
    // 1. If the matched reference item has a label (name), use it
    // 2. Otherwise use position-based index
    const matchedItem = index > 0 ? referenceItems[index - 1] : null;
    const itemLabel = matchedItem?.label;
    const displayLabel = itemLabel
      ? itemLabel
      : index > 0
        ? `${refPrefix} ${index}`
        : mention.label;

    // Detect media type from URL
    const mediaType = detectMediaType(mention.imgUrl);

    const entry: ReferenceMapEntry = {
      index,
      valid: inRefGroup,
      mediaType,
      displayLabel,
    };

    // Use both id and imgUrl as keys for lookup flexibility
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
