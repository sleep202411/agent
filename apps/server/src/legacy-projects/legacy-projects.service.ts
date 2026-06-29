import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  JAVA_STUDIO_URL,
  JAVA_REQUEST_TIMEOUT_MS,
} from '../integrations/java/java-config';

/**
 * Read the user's legacy Java projects via the Java studio HTTP API
 * (`POST {JAVA_STUDIO_URL}/api/user/world/list/myproduct`), forwarding the
 * viewer's sa-token cookie. This is the SAME endpoint the legacy art-studio
 * frontend calls, so "my projects" follows Java's real ownership model —
 * projects under the `world`s the viewer belongs to — NOT `project.admin_user_id`.
 *
 * (Earlier this read the MySQL `project` table directly and filtered by
 * `admin_user_id = me`; that missed every project the viewer owns through a
 * shared world but did not personally create, returning an empty list for
 * collaborators. Switched to the Java endpoint 2026-06-29.)
 *
 * `id` is a Java snowflake bigint beyond JS's safe integer range, but Java
 * already serializes it as a string, so it is carried through as-is.
 */
export interface LegacyProject {
  id: string;
  name: string;
  cover: string | null;
  aspectRatio: string | null;
  status: number;
  createdAt: string | null;
  updatedAt: string | null;
}

/** One row of Java's `myproduct` list (only the fields we map). */
interface JavaMyProductItem {
  id?: number | string;
  name?: string | null;
  imagePath?: string | null;
  aspectRatio?: string | null;
  status?: number | null;
  createTime?: string | null;
  updateTime?: string | null;
}

interface JavaMyProductEnvelope {
  success?: boolean;
  code?: string;
  message?: string;
  data?: {
    page?: number;
    totalCount?: number;
    list?: JavaMyProductItem[];
  } | null;
}

const MYPRODUCT_PATH = '/api/user/world/list/myproduct';

// Java returns offset-bearing ISO timestamps (e.g. `2026-06-23T01:31:39+08:00`);
// normalize to UTC `Z` to match the contract the frontend already consumes.
const toIso = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// Legacy project covers are object keys in the Java OSS bucket (e.g.
// `WORLD/20260129/x.jpg`, `history/img/72/.../y.jpeg`), public-read. Mirror
// apps/web's resolveAssetUrl: pass through already-absolute URLs, else prefix
// the OSS base. Env-overridable per region; defaults to the .com SG bucket.
const OSS_BASE = (
  process.env.LEGACY_OSS_BASE_URL ||
  'https://fizzstudio-sg.oss-ap-southeast-1.aliyuncs.com'
).replace(/\/+$/, '');

function resolveCover(path: string | null | undefined): string | null {
  const p = path?.trim();
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  return `${OSS_BASE}/${p.replace(/^\/+/, '')}`;
}

@Injectable()
export class LegacyProjectsService {
  private readonly logger = new Logger(LegacyProjectsService.name);

  /**
   * List the viewer's legacy projects. `cookie` is the viewer's raw cookie
   * string (carries the sa-token the Java endpoint authenticates against);
   * the global AuthGuard has already validated it before we get here.
   *
   * The frontend pages by limit/offset; Java pages by page/pageSize. Since the
   * caller always uses a fixed page size, `page = floor(offset / pageSize) + 1`
   * is an exact translation.
   */
  async listMyProjects(
    cookie: string,
    opts: { limit: number; offset: number },
  ): Promise<LegacyProject[]> {
    const pageSize = Math.min(100, Math.max(1, Math.trunc(opts.limit)));
    const offset = Math.max(0, Math.trunc(opts.offset));
    const page = Math.floor(offset / pageSize) + 1;

    const url = `${JAVA_STUDIO_URL}${MYPRODUCT_PATH}`;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      JAVA_REQUEST_TIMEOUT_MS,
    );

    let envelope: JavaMyProductEnvelope;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify({ page, pageSize }),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(`Java ${MYPRODUCT_PATH} returned HTTP ${res.status}`);
        throw new ServiceUnavailableException({
          message: 'Legacy projects service unavailable',
          upstream: 'java',
        });
      }
      envelope = (await res.json()) as JavaMyProductEnvelope;
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Java myproduct fetch failed: ${msg} (${url})`);
      throw new ServiceUnavailableException({
        message: 'Legacy projects service unavailable',
        upstream: 'java',
      });
    } finally {
      clearTimeout(timeout);
    }

    if (envelope.success !== true) {
      this.logger.warn(
        `Java ${MYPRODUCT_PATH} non-success: code=${envelope.code} msg=${envelope.message}`,
      );
      throw new ServiceUnavailableException({
        message: 'Legacy projects service error',
        upstream: 'java',
        upstreamCode: envelope.code,
      });
    }

    const list = envelope.data?.list ?? [];
    return list.map((r) => ({
      id: String(r.id),
      name: r.name?.trim() || 'Untitled',
      cover: resolveCover(r.imagePath),
      aspectRatio: r.aspectRatio?.trim() || null,
      status: Number(r.status ?? 0),
      createdAt: toIso(r.createTime),
      updatedAt: toIso(r.updateTime),
    }));
  }
}
