import {
  BadRequestException,
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
const MAX_WEBHOOK_TOLERANCE_SECONDS = 15 * 60;
const DEFAULT_ARCHIVE_MAX_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_MAX_BYTES = 250 * 1024 * 1024;
const EMBEDDED_SIGNING_LINK_TTL_MS = 15 * 60 * 1_000;

interface SendAgreementInput {
  agreementId: string;
  title: string;
  signerName: string;
  signerEmail: string;
}

export interface BoldSignAgreementDocument {
  documentId: string;
  status: string | null;
}

export interface BoldSignPdfArtifact {
  bytes: Buffer;
  contentType: 'application/pdf';
  filename: string;
}

export interface BoldSignSigningSession {
  signLink: string;
  expiresAt: Date;
}

@Injectable()
export class BoldSignAgreementProvider {
  isConfigured(): boolean {
    return Boolean(this.apiKey && this.templateId && this.webhookSecret);
  }

  canSync(): boolean {
    return Boolean(this.apiKey);
  }

  async sendFromTemplate(input: SendAgreementInput): Promise<string> {
    this.requireSendConfigured();
    const response = await this.request(
      `/v1/template/send?templateId=${encodeURIComponent(this.templateId!)}`,
      {
        method: 'POST',
        body: JSON.stringify({
          Title: input.title,
          Message: 'Please review and sign this crew agreement.',
          Roles: [
            {
              RoleIndex: this.roleIndex,
              SignerName: input.signerName,
              SignerEmail: input.signerEmail,
              SignerType: 'Signer',
              SignerOrder: 1,
              Locale: 'EN',
            },
          ],
          DisableEmails: false,
          DisableSMS: true,
          EnableSigningOrder: false,
          ExpiryDateType: 'Days',
          ExpiryValue: 30,
          ReminderSettings: {
            EnableAutoReminder: true,
            ReminderDays: 3,
            ReminderCount: 3,
          },
          MetaData: {
            FizzDragonAgreementId: input.agreementId,
          },
          Labels: [agreementLabel(input.agreementId)],
        }),
      },
    );
    const payload = (await response.json()) as {
      documentId?: unknown;
      DocumentId?: unknown;
    };
    const documentId =
      typeof payload.documentId === 'string'
        ? payload.documentId
        : typeof payload.DocumentId === 'string'
          ? payload.DocumentId
          : null;
    if (!documentId) {
      throw new BadGatewayException({
        message: 'BoldSign did not return a document id.',
      });
    }
    return documentId;
  }

  /**
   * Reconciles an ambiguous prior send before retrying. BoldSign does not
   * expose a request idempotency key for template sends, so every document is
   * tagged with a stable, whitespace-free agreement label and looked up before
   * another signature request is created.
   */
  async findDocumentForAgreement(
    agreementId: string,
  ): Promise<BoldSignAgreementDocument | null> {
    this.requireApiConfigured();
    const query = new URLSearchParams({
      page: '1',
      pageSize: '2',
    });
    query.append('labels', agreementLabel(agreementId));
    const response = await this.request(`/v1/document/list?${query}`, {
      method: 'GET',
    });
    const payload = (await response.json()) as {
      result?: Array<{
        documentId?: unknown;
        status?: unknown;
      }>;
    };
    const match = payload.result?.find(
      (item) =>
        typeof item.documentId === 'string' &&
        item.documentId.trim().length > 0,
    );
    if (!match || typeof match.documentId !== 'string') return null;
    return {
      documentId: match.documentId,
      status: typeof match.status === 'string' ? match.status : null,
    };
  }

  async getDocumentStatus(documentId: string): Promise<string> {
    this.requireApiConfigured();
    const response = await this.request(
      `/v1/document/properties?documentId=${encodeURIComponent(documentId)}`,
      { method: 'GET' },
    );
    const payload = (await response.json()) as { status?: unknown };
    if (typeof payload.status !== 'string' || !payload.status.trim()) {
      throw new BadGatewayException({
        message: 'BoldSign did not return a document status.',
      });
    }
    return payload.status;
  }

  /**
   * Creates a short-lived signer-specific URL after FizzDragon has verified
   * the authenticated user. Signing URLs are credentials: callers must never
   * persist, log, cache, or include them in notifications.
   */
  async getEmbeddedSigningLink(
    documentId: string,
    signerEmail: string,
    now = new Date(),
  ): Promise<BoldSignSigningSession> {
    this.requireApiConfigured();
    const expiresAt = new Date(now.getTime() + EMBEDDED_SIGNING_LINK_TTL_MS);
    const query = new URLSearchParams({
      documentId,
      signerEmail,
      signLinkValidTill: expiresAt.toISOString(),
    });
    const response = await this.request(
      `/v1/document/getEmbeddedSignLink?${query}`,
      { method: 'GET' },
    );
    const payload = (await response.json()) as { signLink?: unknown };
    if (typeof payload.signLink !== 'string' || !payload.signLink.trim()) {
      throw new BadGatewayException({
        message: 'BoldSign did not return an embedded signing link.',
      });
    }
    let parsed: URL;
    try {
      parsed = new URL(payload.signLink);
    } catch {
      throw new BadGatewayException({
        message: 'BoldSign returned an invalid embedded signing link.',
      });
    }
    if (parsed.protocol !== 'https:') {
      throw new BadGatewayException({
        message: 'BoldSign returned an insecure embedded signing link.',
      });
    }
    return { signLink: parsed.toString(), expiresAt };
  }

  downloadSignedDocument(documentId: string): Promise<BoldSignPdfArtifact> {
    return this.downloadPdf(
      `/v1/document/download?documentId=${encodeURIComponent(documentId)}`,
      'signed-agreement.pdf',
    );
  }

  downloadAuditTrail(documentId: string): Promise<BoldSignPdfArtifact> {
    return this.downloadPdf(
      `/v1/document/downloadAuditLog?documentId=${encodeURIComponent(documentId)}`,
      'agreement-audit-trail.pdf',
    );
  }

  /**
   * BoldSign signs `${timestamp}.${raw JSON body}` with HMAC-SHA256 and
   * supplies the digest as s0 (plus s1 while rotating a secret). The raw body
   * is mandatory: parsing and re-stringifying JSON changes the signature.
   */
  verifyWebhook(
    rawBody: Buffer,
    signatureHeader: string | undefined,
    nowMs: number = Date.now(),
  ): void {
    const secret = this.webhookSecret;
    if (!secret) {
      throw new ServiceUnavailableException({
        message:
          'BoldSign webhook verification is not configured. Set BOLDSIGN_WEBHOOK_SECRET.',
      });
    }
    const parsed = parseSignatureHeader(signatureHeader);
    const ageSeconds = Math.abs(Math.floor(nowMs / 1_000) - parsed.timestamp);
    if (ageSeconds > this.webhookToleranceSeconds) {
      throw new BadRequestException({
        message: 'BoldSign webhook timestamp is outside the accepted window.',
      });
    }
    const expected = createHmac('sha256', secret)
      .update(`${parsed.timestamp}.`)
      .update(rawBody)
      .digest();
    const matched = parsed.signatures.some((signature) => {
      const candidate = Buffer.from(signature, 'hex');
      return (
        candidate.length === expected.length &&
        timingSafeEqual(candidate, expected)
      );
    });
    if (!matched) {
      throw new BadRequestException({
        message: 'BoldSign webhook signature verification failed.',
      });
    }
  }

  private async downloadPdf(
    path: string,
    fallbackFilename: string,
  ): Promise<BoldSignPdfArtifact> {
    this.requireApiConfigured();
    const response = await this.request(
      path,
      {
        method: 'GET',
        headers: { Accept: 'application/pdf' },
      },
      30_000,
    );
    const declaredLength = Number(response.headers.get('content-length'));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > this.archiveMaxBytes
    ) {
      throw new BadGatewayException({
        message: `BoldSign artifact exceeds the configured ${this.archiveMaxBytes}-byte archive limit.`,
      });
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > this.archiveMaxBytes) {
      throw new BadGatewayException({
        message:
          bytes.length === 0
            ? 'BoldSign returned an empty agreement artifact.'
            : `BoldSign artifact exceeds the configured ${this.archiveMaxBytes}-byte archive limit.`,
      });
    }
    const contentType = response.headers.get('content-type')?.toLowerCase();
    if (
      !contentType?.startsWith('application/pdf') ||
      bytes.subarray(0, 5).toString('ascii') !== '%PDF-'
    ) {
      throw new BadGatewayException({
        message: 'BoldSign returned an invalid PDF agreement artifact.',
      });
    }
    return {
      bytes,
      contentType: 'application/pdf',
      filename:
        filenameFromContentDisposition(
          response.headers.get('content-disposition'),
        ) ?? fallbackFilename,
    };
  }

  private async request(
    path: string,
    init: RequestInit,
    timeoutMs = 15_000,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-API-KEY': this.apiKey!,
          ...init.headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new BadGatewayException({
        message: `BoldSign request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
    if (!response.ok) {
      const detail = await response.text();
      throw new BadGatewayException({
        message: detail || `BoldSign returned HTTP ${response.status}.`,
        status: response.status,
      });
    }
    return response;
  }

  private requireSendConfigured(): void {
    if (this.isConfigured()) return;
    throw new ServiceUnavailableException({
      message:
        'BoldSign agreement sending is not configured. Set BOLDSIGN_API_KEY, BOLDSIGN_CREW_AGREEMENT_TEMPLATE_ID, and BOLDSIGN_WEBHOOK_SECRET.',
    });
  }

  private requireApiConfigured(): void {
    if (this.apiKey) return;
    throw new ServiceUnavailableException({
      message: 'BoldSign API is not configured. Set BOLDSIGN_API_KEY.',
    });
  }

  private get apiKey(): string | null {
    return process.env.BOLDSIGN_API_KEY?.trim() || null;
  }

  private get templateId(): string | null {
    return process.env.BOLDSIGN_CREW_AGREEMENT_TEMPLATE_ID?.trim() || null;
  }

  private get webhookSecret(): string | null {
    return process.env.BOLDSIGN_WEBHOOK_SECRET?.trim() || null;
  }

  private get baseUrl(): string {
    return (
      process.env.BOLDSIGN_API_BASE_URL?.trim().replace(/\/+$/, '') ||
      'https://api.boldsign.com'
    );
  }

  private get roleIndex(): number {
    const parsed = Number.parseInt(
      process.env.BOLDSIGN_CREW_AGREEMENT_ROLE_INDEX ?? '1',
      10,
    );
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
      throw new ServiceUnavailableException({
        message:
          'BOLDSIGN_CREW_AGREEMENT_ROLE_INDEX must be an integer between 1 and 50.',
      });
    }
    return parsed;
  }

  private get webhookToleranceSeconds(): number {
    const raw = process.env.BOLDSIGN_WEBHOOK_TOLERANCE_SECONDS?.trim();
    if (!raw) return DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
    const parsed = Number(raw);
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < 30 ||
      parsed > MAX_WEBHOOK_TOLERANCE_SECONDS
    ) {
      throw new ServiceUnavailableException({
        message: `BOLDSIGN_WEBHOOK_TOLERANCE_SECONDS must be an integer between 30 and ${MAX_WEBHOOK_TOLERANCE_SECONDS}.`,
      });
    }
    return parsed;
  }

  private get archiveMaxBytes(): number {
    const raw = process.env.BOLDSIGN_ARCHIVE_MAX_BYTES?.trim();
    if (!raw) return DEFAULT_ARCHIVE_MAX_BYTES;
    const parsed = Number(raw);
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < 1_048_576 ||
      parsed > MAX_ARCHIVE_MAX_BYTES
    ) {
      throw new ServiceUnavailableException({
        message: `BOLDSIGN_ARCHIVE_MAX_BYTES must be an integer between 1048576 and ${MAX_ARCHIVE_MAX_BYTES}.`,
      });
    }
    return parsed;
  }
}

function agreementLabel(agreementId: string): string {
  return `fizzdragon-agreement-${agreementId}`;
}

function filenameFromContentDisposition(value: string | null): string | null {
  if (!value) return null;
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.replace(/^"|"$/g, ''));
    } catch {
      return null;
    }
  }
  const plain = value.match(/filename="?([^";]+)"?/i)?.[1]?.trim();
  return plain || null;
}

function parseSignatureHeader(value: string | undefined): {
  timestamp: number;
  signatures: string[];
} {
  if (!value) {
    throw new BadRequestException({
      message: 'BoldSign webhook signature header is missing.',
    });
  }
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of value.split(',')) {
    const [key, raw] = part.trim().split('=', 2);
    if (key === 't' && raw && /^\d+$/.test(raw)) {
      timestamp = Number(raw);
    } else if (
      (key === 's0' || key === 's1') &&
      raw &&
      /^[a-f\d]{64}$/i.test(raw)
    ) {
      signatures.push(raw);
    }
  }
  if (!Number.isSafeInteger(timestamp) || timestamp! <= 0) {
    throw new BadRequestException({
      message: 'BoldSign webhook signature timestamp is invalid.',
    });
  }
  if (signatures.length === 0) {
    throw new BadRequestException({
      message: 'BoldSign webhook signature is invalid.',
    });
  }
  return { timestamp: timestamp!, signatures };
}
