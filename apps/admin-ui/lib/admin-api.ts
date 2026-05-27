import { getAdminApiBaseUrl, type AdminSiteCode } from "@/lib/sites";

export type AdminApiRequestOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | Record<string, unknown> | null;
};

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

export async function adminApiFetch<T>(
  site: AdminSiteCode,
  path: `/${string}`,
  options: AdminApiRequestOptions = {}
): Promise<T> {
  const { body, headers, ...init } = options;
  const isJsonBody =
    body !== null &&
    body !== undefined &&
    typeof body === "object" &&
    !(body instanceof Blob) &&
    !(body instanceof FormData) &&
    !(body instanceof URLSearchParams);
  const response = await fetch(`${getAdminApiBaseUrl(site)}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...(isJsonBody ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: isJsonBody ? JSON.stringify(body) : body,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new AdminApiError(
      typeof payload === "object" && payload && "message" in payload
        ? String((payload as { message: unknown }).message)
        : `Admin API request failed with ${response.status}`,
      response.status,
      payload
    );
  }

  return payload as T;
}
