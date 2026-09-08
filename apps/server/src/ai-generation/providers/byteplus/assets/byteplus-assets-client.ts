import { createHash, createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { BytePlusAssetsConfigService } from './byteplus-assets-config.service';

/**
 * BytePlus ModelArk ASSETS-plane client (design §2.2): asset groups, asset
 * registration, and visual-validate (liveness) sessions for the character
 * library. This is a DIFFERENT API from the Ark v3 inference REST surface —
 * TOP-gateway `POST /?Action=X&Version=2024-01-01` with Volcengine v4-style
 * HMAC-SHA256 request signing (AK/SK), NOT the Bearer inference key.
 *
 * Wire format verified against ModelArk docs 2333589 / 2318270-2318278 /
 * 2341606 (2026-07-02):
 *   POST /?Action=CreateAsset&Version=2024-01-01
 *   Host: ark.ap-southeast-1.byteplusapi.com
 *   X-Date: 20260328T000000Z
 *   X-Content-Sha256: <hex sha256 of body>
 *   Authorization: HMAC-SHA256 Credential={AK}/{date}/{region}/ark/request,
 *     SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=...
 *
 * GetAsset responses carry a PRESIGNED face-imagery URL (12h TTL) — callers
 * (the sync service) must persist only via `redactAssetRecord`, never raw.
 */

/** Provider literals for AiProviderAssetGroupType (schema stores lowercase). */
export const BYTEPLUS_GROUP_TYPE = {
  aigc: 'AIGC',
  liveness_face: 'LivenessFace',
} as const;

export type BytePlusAssetType = 'Image' | 'Video' | 'Audio';

export interface BytePlusVisualValidateSession {
  BytedToken: string;
  H5Link: string;
  CallbackURL: string;
}

export interface BytePlusAssetRecord {
  Id: string;
  Name?: string;
  /** PRESIGNED (12h TTL, face imagery) — never persist; see redactAssetRecord. */
  URL?: string;
  AssetType?: BytePlusAssetType;
  GroupId?: string;
  Status?: 'Processing' | 'Active' | 'Failed';
  Error?: { Code?: string; Message?: string };
  Moderation?: { Strategy?: string };
  CreateTime?: string;
  UpdateTime?: string;
  ProjectName?: string;
}

export interface BytePlusAssetGroupRecord {
  Id: string;
  Name?: string;
  Title?: string;
  Description?: string;
  GroupType?: 'AIGC' | 'LivenessFace';
  ProjectName?: string;
  CreateTime?: string;
  UpdateTime?: string;
}

/** Typed failure carrying the upstream action + error code for observability. */
export class BytePlusAssetsApiError extends Error {
  constructor(
    readonly action: string,
    readonly code: string,
    message: string,
    readonly httpStatus?: number,
    readonly requestId?: string,
  ) {
    super(`[${action}] ${code}: ${message}`);
    this.name = 'BytePlusAssetsApiError';
  }
}

/**
 * `providerResponse` persistence filter (design §1 ⟦R⟧): status / ids /
 * timings / error codes only — presigned URLs are stripped, never stored,
 * never shown in admin.
 */
export function redactAssetRecord(
  record: BytePlusAssetRecord,
): Record<string, unknown> {
  const safe = { ...record };
  delete safe.URL;
  return safe;
}

interface SignedRequestParts {
  headers: Record<string, string>;
  canonicalRequest: string;
  stringToSign: string;
}

/**
 * Volcengine/BytePlus v4-style signer, exported for spec pinning. Scope is
 * `{date}/{region}/{service}/request`; the HMAC chain starts from the RAW
 * secret key (no AWS4-style prefix).
 */
export function signBytePlusRequest(args: {
  accessKeyId: string;
  secretAccessKey: string;
  host: string;
  action: string;
  version: string;
  region: string;
  service: string;
  body: string;
  /** X-Date, `YYYYMMDDTHHMMSSZ`. Injectable for deterministic tests. */
  xDate: string;
}): SignedRequestParts {
  const contentType = 'application/json';
  const shortDate = args.xDate.slice(0, 8);
  const payloadHash = createHash('sha256').update(args.body).digest('hex');
  const canonicalQuery = `Action=${encodeURIComponent(args.action)}&Version=${encodeURIComponent(args.version)}`;
  const signedHeaders = 'content-type;host;x-content-sha256;x-date';
  const canonicalRequest = [
    'POST',
    '/',
    canonicalQuery,
    `content-type:${contentType}`,
    `host:${args.host}`,
    `x-content-sha256:${payloadHash}`,
    `x-date:${args.xDate}`,
    '',
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${shortDate}/${args.region}/${args.service}/request`;
  const stringToSign = [
    'HMAC-SHA256',
    args.xDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');
  const kDate = createHmac('sha256', args.secretAccessKey)
    .update(shortDate)
    .digest();
  const kRegion = createHmac('sha256', kDate).update(args.region).digest();
  const kService = createHmac('sha256', kRegion).update(args.service).digest();
  const kSigning = createHmac('sha256', kService).update('request').digest();
  const signature = createHmac('sha256', kSigning)
    .update(stringToSign)
    .digest('hex');
  return {
    headers: {
      'Content-Type': contentType,
      Host: args.host,
      'X-Date': args.xDate,
      'X-Content-Sha256': payloadHash,
      Authorization: `HMAC-SHA256 Credential=${args.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    canonicalRequest,
    stringToSign,
  };
}

@Injectable()
export class BytePlusAssetsClient {
  private readonly logger = new Logger(BytePlusAssetsClient.name);

  constructor(private readonly configService: BytePlusAssetsConfigService) {}

  // ── Visual validation (real-person liveness enrollment) ────────────────

  /** 3 QPS ACCOUNT-WIDE upstream — callers go through the token bucket. */
  createVisualValidateSession(
    callbackUrl: string,
  ): Promise<BytePlusVisualValidateSession> {
    return this.call('CreateVisualValidateSession', {
      CallbackURL: callbackUrl,
    });
  }

  /**
   * The SOLE completion authority (design §2.1): a server→provider pull by
   * the server-stored token. Returns the auto-created LivenessFace group.
   */
  getVisualValidateResult(bytedToken: string): Promise<{ GroupId: string }> {
    return this.call('GetVisualValidateResult', { BytedToken: bytedToken });
  }

  // ── Asset groups ────────────────────────────────────────────────────────

  /** AIGC groups only — LivenessFace groups are minted by the liveness flow. */
  createAssetGroup(args: {
    name: string;
    description?: string;
  }): Promise<{ Id: string }> {
    return this.call('CreateAssetGroup', {
      Name: args.name,
      ...(args.description ? { Description: args.description } : {}),
      GroupType: BYTEPLUS_GROUP_TYPE.aigc,
    });
  }

  getAssetGroup(id: string): Promise<BytePlusAssetGroupRecord> {
    return this.call('GetAssetGroup', { Id: id });
  }

  listAssetGroups(args: {
    groupType: 'AIGC' | 'LivenessFace';
    pageNumber: number;
    pageSize: number;
  }): Promise<{ Items: BytePlusAssetGroupRecord[]; TotalCount: number }> {
    return this.call('ListAssetGroups', {
      Filter: { GroupType: args.groupType },
      PageNumber: args.pageNumber,
      PageSize: args.pageSize,
    });
  }

  deleteAssetGroup(id: string): Promise<Record<string, never>> {
    return this.call('DeleteAssetGroup', { Id: id });
  }

  // ── Assets ──────────────────────────────────────────────────────────────

  /**
   * ASYNC upstream (Processing → Active|Failed via getAsset polls). 120 QPM
   * account-wide on ACR — callers go through the token bucket. URL must be a
   * PUBLIC fetchable URL (our durable CDN URLs); base64 is not accepted.
   */
  createAsset(args: {
    groupId: string;
    url: string;
    assetType: BytePlusAssetType;
    name?: string;
  }): Promise<{ Id: string }> {
    return this.call('CreateAsset', {
      GroupId: args.groupId,
      URL: args.url,
      AssetType: args.assetType,
      ...(args.name ? { Name: args.name } : {}),
      // Configurable because BytePlus baseline safety remains enforced even
      // when the optional Content Pre-filter review is skipped.
      Moderation: {
        Strategy: this.configService.config.assetModerationStrategy,
      },
    });
  }

  getAsset(id: string): Promise<BytePlusAssetRecord> {
    return this.call('GetAsset', { Id: id });
  }

  listAssets(args: {
    groupType: 'AIGC' | 'LivenessFace';
    groupIds?: string[];
    statuses?: Array<'Active' | 'Processing' | 'Failed'>;
    pageNumber: number;
    pageSize: number;
  }): Promise<{ Items: BytePlusAssetRecord[]; TotalCount: number }> {
    return this.call('ListAssets', {
      Filter: {
        GroupType: args.groupType,
        ...(args.groupIds?.length ? { GroupIds: args.groupIds } : {}),
        ...(args.statuses?.length ? { Statuses: args.statuses } : {}),
      },
      PageNumber: args.pageNumber,
      PageSize: args.pageSize,
    });
  }

  deleteAsset(id: string): Promise<Record<string, never>> {
    return this.call('DeleteAsset', { Id: id });
  }

  // ── Transport ───────────────────────────────────────────────────────────

  private async call<T>(
    action: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const config = this.configService.config;
    if (!config.accessKeyId || !config.secretAccessKey) {
      // Boot-time fail-loud covers the enabled path; this guards test/dev
      // callers reaching the client with the plane unconfigured.
      throw new BytePlusAssetsApiError(
        action,
        'NOT_CONFIGURED',
        'BYTEPLUS_ASSETS_AK/SK are not configured.',
      );
    }
    const host = new URL(config.endpoint).host;
    const payload = JSON.stringify({
      ...body,
      ProjectName: config.projectName,
    });
    const { headers } = signBytePlusRequest({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      host,
      action,
      version: config.apiVersion,
      region: config.region,
      service: config.service,
      body: payload,
      xDate: currentXDate(),
    });

    let response: Response;
    try {
      response = await fetch(
        `${config.endpoint}/?Action=${encodeURIComponent(action)}&Version=${encodeURIComponent(config.apiVersion)}`,
        {
          method: 'POST',
          headers,
          body: payload,
          signal: AbortSignal.timeout(config.requestTimeoutMs),
        },
      );
    } catch (err) {
      throw new BytePlusAssetsApiError(
        action,
        'NETWORK_ERROR',
        err instanceof Error ? err.message : String(err),
      );
    }

    const text = await response.text();
    let parsed: {
      ResponseMetadata?: {
        RequestId?: string;
        Error?: { Code?: string; Message?: string };
      };
      Result?: T;
    };
    try {
      parsed = text ? (JSON.parse(text) as typeof parsed) : {};
    } catch {
      throw new BytePlusAssetsApiError(
        action,
        'BAD_RESPONSE',
        `Non-JSON response (HTTP ${response.status}): ${text.slice(0, 200)}`,
        response.status,
      );
    }

    const upstreamError = parsed.ResponseMetadata?.Error;
    if (!response.ok || upstreamError) {
      const code = upstreamError?.Code ?? `HTTP_${response.status}`;
      const message = upstreamError?.Message ?? text.slice(0, 300);
      this.logger.warn(
        `${action} failed: ${code} (requestId=${parsed.ResponseMetadata?.RequestId ?? 'n/a'})`,
      );
      throw new BytePlusAssetsApiError(
        action,
        code,
        message,
        response.status,
        parsed.ResponseMetadata?.RequestId,
      );
    }
    return (parsed.Result ?? {}) as T;
  }
}

/** `YYYYMMDDTHHMMSSZ` for X-Date. */
function currentXDate(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}
