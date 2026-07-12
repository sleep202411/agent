export type RunnerErrorCode =
  | "USAGE"
  | "MANIFEST_MISSING"
  | "MANIFEST_INVALID"
  | "ASSET_INVALID"
  | "CONFIG_MISSING"
  | "SECURITY_REJECTED"
  | "PROVIDER_REJECTED"
  | "PROVIDER_RESULT_UNKNOWN"
  | "DOWNLOAD_FAILED"
  | "OUTPUT_INVALID"
  | "JOURNAL_CONFLICT";

/**
 * The message on this error is safe to print and persist. Never construct one
 * with request headers, response bodies, signed URLs, or environment values.
 */
export class RunnerError extends Error {
  constructor(
    readonly code: RunnerErrorCode,
    safeMessage: string,
    readonly details?: Readonly<Record<string, string | number | boolean | null>>
  ) {
    super(safeMessage);
    this.name = "RunnerError";
  }
}

export function safeErrorForConsole(error: unknown): {
  code: RunnerErrorCode | "INTERNAL";
  message: string;
  details?: Readonly<Record<string, string | number | boolean | null>>;
} {
  if (error instanceof RunnerError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    };
  }

  return {
    code: "INTERNAL",
    message: "Unexpected internal runner failure. No provider credentials were printed.",
  };
}
