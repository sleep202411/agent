/** Stable task metadata, never translated titles or file counts, defines asset groups. */
export function taskAssetCategory(
  metadata: unknown,
  kind: string | null,
): string {
  const record =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  if (
    (kind === 'art' || kind == null) &&
    typeof record.assetCategory === 'string' &&
    ['characters', 'scenes', 'props', 'art'].includes(record.assetCategory)
  ) {
    return record.assetCategory;
  }
  if (
    (kind === 'art' || kind == null) &&
    record.assetCategory !== null &&
    record.templateKey === 'character_art'
  )
    return 'characters';
  if (
    (kind === 'art' || kind == null) &&
    record.assetCategory !== null &&
    record.templateKey === 'scene_art'
  )
    return 'scenes';
  if (kind === 'script') return 'scripts';
  if (kind === 'music') return 'music';
  if (kind === 'art') return 'art';
  if (['storyboard', 'edit', 'voice', 'qa'].includes(kind ?? ''))
    return 'production';
  return 'other';
}
