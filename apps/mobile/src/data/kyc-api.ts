import type { AuthUser } from "@/auth/types";
import { api } from "@/lib/api-client";

export const KYC_APPROVED_AUTH_STATUS = 5;

export interface KycAuthStatus {
  needAuth?: boolean;
  needRole?: boolean;
}

export interface CertifyInitRequest {
  certNo: string;
  metaInfo: string;
  returnUrl: string;
  userId: string | number;
  userName: string;
}

export interface CertifyInitResponse {
  certifyId?: string;
  certifyUrl?: string;
}

export interface CertifyQueryResponse {
  status?: string;
  [key: string]: unknown;
}

export type AliyunCertifyResponse = {
  code?: number | string;
  extInfo?: {
    certifyId?: string;
    [key: string]: unknown;
  };
  message?: string;
  reason?: string;
  [key: string]: unknown;
};

export function getKycUserId(user: AuthUser | undefined) {
  return user?.id ?? user?.userId;
}

export function isKycVerified(user: AuthUser | undefined) {
  return Number(user?.authStatus) === KYC_APPROVED_AUTH_STATUS;
}

export function getNeedAuth() {
  return api.get<KycAuthStatus>("/user/needAuth");
}

export function certifyInit(data: CertifyInitRequest) {
  return api.postForm<CertifyInitResponse>("/user/certify/init/web", {
    certNo: data.certNo,
    metaInfo: data.metaInfo,
    returnUrl: data.returnUrl,
    userId: String(data.userId),
    userName: data.userName,
  });
}

export function certifyQuery(certifyId: string) {
  return api.postForm<CertifyQueryResponse>("/user/certify/query", { certifyId });
}

export function parseAliyunCertifyResponse(rawResponse: string): AliyunCertifyResponse {
  const decoded = safeDecodeURIComponent(rawResponse);
  const parsed = JSON.parse(decoded) as AliyunCertifyResponse;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid Aliyun certification response");
  }

  return parsed;
}

export function isBackendCertifyPassed(response: CertifyQueryResponse | undefined) {
  if (!response?.status) return true;
  return response.status === "T";
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
