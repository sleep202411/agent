/** Extract identity only; never fetch a user-supplied URL. */
export function canvasImportProjectId(value: string, studioUrl: string): string | null {
  if (value.length > 2048 || /[\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value.trim());
    if (url.origin !== new URL(studioUrl).origin || url.username || url.password) return null;
    const match = url.pathname.match(
      /^\/(?:en-US\/|zh-CN\/|zh-HK\/)?story-studio\/projects\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/canvas\/?$/i
    );
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}
