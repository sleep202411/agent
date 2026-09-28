/**
 * KYC (实名认证) — Aliyun Cloudauth H5 flow.
 *
 * Three endpoints:
 *   - GET  /user/needAuth         → { needAuth, needRole } status probe
 *   - POST /user/certify/init/web → get Aliyun certifyUrl to redirect to
 *   - POST /user/certify/query    → confirm result after Aliyun redirects back
 *
 * Actual identity check (liveness + face + ID OCR) happens on Aliyun's
 * hosted page. Our side only collects 姓名 + 身份证号, gets a redirect URL
 * from the backend, and parses the `?response=...` payload when the user
 * comes back.
 */
import { api } from "@/src/lib/api";

// ─── Types ────────────────────────────────────────────

export interface KycAuthStatus {
  /** true = user still needs real-name verification. */
  needAuth?: boolean;
  /** true = user still needs role certification (separate flow). */
  needRole?: boolean;
}

export interface CertifyInitRequest {
  /** 真实姓名 */
  userName: string;
  /** 身份证号码 */
  certNo: string;
  /** Java user id (from /user/info). */
  userId: string | number;
  /** JSON-stringified result of window.getMetaInfo() from Aliyun SDK. */
  metaInfo: string;
  /** Absolute URL Aliyun redirects to after the user finishes / cancels. */
  returnUrl: string;
}

export interface CertifyInitResponse {
  certifyId: string;
  certifyUrl: string;
}

export interface CertifyQueryResponse {
  /** Aliyun terminal status — "T" = passed, other values = failed / pending. */
  status?: string;
  [key: string]: unknown;
}

// ─── API ──────────────────────────────────────────────

export const getNeedAuth = (signal?: AbortSignal) =>
  api.get<KycAuthStatus>("/user/needAuth", { signal });

export const certifyInit = (data: CertifyInitRequest) =>
  api.postForm<CertifyInitResponse>("/user/certify/init/web", {
    userName: data.userName,
    certNo: data.certNo,
    userId: String(data.userId),
    metaInfo: data.metaInfo,
    returnUrl: data.returnUrl,
  });

export const certifyQuery = (certifyId: string) =>
  api.postForm<CertifyQueryResponse>("/user/certify/query", { certifyId });
