import { Injectable, Logger } from '@nestjs/common';

/**
 * Resolves legacy CN IP videos to a playable URL at request time.
 *
 * Background: the CN migration stored video `external_url`s as
 * `https://banner.fizzspace.cn/<user>/project<id>/.../*.mp4`. That host is the
 * image CDN — it has the covers but NOT the videos, so those URLs 404. The
 * legacy videos live in a private bucket (`fizzdragon-vedio.fizzspace.cn`) and
 * are only reachable via a SIGNED, 1-hour-expiry URL minted by the Java content
 * service: `POST {JAVA_CONTENT_URL}/vedio/play/project/getLink` (form `id=<projectId>`).
 *
 * Because the URL is signed + expiring it cannot be stored; we mint it on each
 * detail read. The Java API only signs a project's MAIN video (its
 * `client_project.video_link`) — per-episode signing is not available — so we
 * only swap a URL when the freshly-signed path MATCHES it, never substituting a
 * different file (a multi-episode IP keeps its un-signable episode URLs rather
 * than showing the wrong video).
 *
 * Scope: CN legacy only — it triggers solely on `banner.fizzspace.cn/...mp4`
 * URLs, which never appear in `.com` data, so this is a no-op outside CN.
 */
@Injectable()
export class LegacyCnVideoResolverService {
  private readonly logger = new Logger(LegacyCnVideoResolverService.name);
  private readonly cache = new Map<
    string,
    { url: string | null; exp: number }
  >();
  private readonly ttlMs = 50 * 60 * 1000; // < the 1h signature expiry
  // banner.fizzspace.cn/<user>/project<projectId>/.../<file>.mp4
  private readonly legacyVideoRe =
    /^https?:\/\/banner\.fizzspace\.cn\/\d+\/project(\d+)\/.+\.mp4(\?.*)?$/i;

  /** Mutates `dto` in place, replacing resolvable legacy CN video URLs. */
  async resolveDtoVideos<T>(dto: T): Promise<T> {
    const base = process.env.JAVA_CONTENT_URL?.replace(/\/+$/, '');
    if (!base || dto == null) return dto;

    const urls = new Set<string>();
    walkStrings(dto, (s) => {
      if (this.legacyVideoRe.test(s)) urls.add(s);
    });
    if (urls.size === 0) return dto;

    const signedByProject = new Map<string, string | null>();
    const replacements = new Map<string, string>();
    for (const url of urls) {
      const projectId = url.match(this.legacyVideoRe)![1];
      if (!signedByProject.has(projectId)) {
        signedByProject.set(
          projectId,
          await this.signProjectVideo(base, projectId),
        );
      }
      const signed = signedByProject.get(projectId);
      if (signed && samePath(signed, url)) replacements.set(url, signed);
    }
    if (replacements.size) replaceStrings(dto, replacements);
    return dto;
  }

  private async signProjectVideo(
    base: string,
    projectId: string,
  ): Promise<string | null> {
    const cached = this.cache.get(projectId);
    if (cached && cached.exp > Date.now()) return cached.url;

    let url: string | null = null;
    try {
      const res = await fetch(`${base}/vedio/play/project/getLink`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: `id=${encodeURIComponent(projectId)}`,
        signal: AbortSignal.timeout(5000),
      });
      const json = (await res.json()) as { code?: number; data?: unknown };
      const data = typeof json?.data === 'string' ? json.data : null;
      // code 200 + a real path (project-with-no-video returns a "/videoLink" placeholder).
      if (json?.code === 200 && data && !/\/videoLink(\?|$)/i.test(data))
        url = data;
    } catch (err) {
      this.logger.warn(
        `getLink failed for project ${projectId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.cache.set(projectId, { url, exp: Date.now() + this.ttlMs });
    return url;
  }
}

function samePath(a: string, b: string): boolean {
  try {
    return (
      decodeURIComponent(new URL(a).pathname) ===
      decodeURIComponent(new URL(b).pathname)
    );
  } catch {
    return false;
  }
}

function walkStrings(node: unknown, fn: (s: string) => void): void {
  if (typeof node === 'string') return fn(node);
  if (Array.isArray(node)) {
    for (const item of node) walkStrings(item, fn);
    return;
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node)) walkStrings(value, fn);
  }
}

function replaceStrings(node: unknown, map: Map<string, string>): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      if (typeof item === 'string') {
        const next = map.get(item);
        if (next) node[i] = next;
      } else replaceStrings(item, map);
    });
    return;
  }
  if (node && typeof node === 'object') {
    for (const key of Object.keys(node as Record<string, unknown>)) {
      const value = (node as Record<string, unknown>)[key];
      if (typeof value === 'string') {
        const next = map.get(value);
        if (next) (node as Record<string, unknown>)[key] = next;
      } else replaceStrings(value, map);
    }
  }
}
