/**
 * Frozen build media is addressed as `/content` under its build, asset and
 * variant. Sibling endpoints answer about the same frozen media without
 * touching it: `/poster` serves an image-only frame, and `/playback` says
 * whether a ready adaptive (HLS) rendition stands in for the progressive file.
 */
export const BUILD_CONTENT_PATH =
  /\/story-projects\/[^/]+\/builds\/[^/]+\/assets\/[^/]+\/variants\/[^/]+\/content$/;

export type BuildMediaEndpointKind = "poster" | "playback";

/** Parses relative URIs; never part of a result. */
const PARSE_BASE = "http://localhost";
const CONTENT_SEGMENT = "content";

/**
 * The sibling endpoint of a frozen build clip, or null for any other media.
 *
 * Detection runs on the parsed path, so a query string or an absolute host
 * cannot hide a build URI. The answer is the declared URI with only its last
 * path segment replaced: an absolute URI stays absolute on its own host and a
 * relative one stays relative, which is what lets the same manifest work from
 * the web origin and from a published release.
 */
export function buildMediaEndpoint(uri: string, kind: BuildMediaEndpointKind): string | null {
  let pathname: string;
  try {
    pathname = new URL(uri, PARSE_BASE).pathname;
  } catch {
    return null;
  }
  if (!BUILD_CONTENT_PATH.test(pathname)) return null;
  const suffixAt = uri.search(/[?#]/);
  const path = suffixAt === -1 ? uri : uri.slice(0, suffixAt);
  if (!path.endsWith(`/${CONTENT_SEGMENT}`)) return null;
  const suffix = suffixAt === -1 ? "" : uri.slice(suffixAt);
  return `${path.slice(0, -CONTENT_SEGMENT.length)}${kind}${suffix}`;
}
