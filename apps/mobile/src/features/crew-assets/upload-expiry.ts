/** Only an authoritative reservation-expired response permits abandoning a checkpoint. */
export function isExpiredCrewUpload(error: unknown): boolean {
  if (
    !(error instanceof Error) ||
    !("status" in error) ||
    error.status !== 409 ||
    !("responseBody" in error) ||
    typeof error.responseBody !== "string"
  )
    return false;
  try {
    const body: unknown = JSON.parse(error.responseBody);
    return (
      !!body &&
      typeof body === "object" &&
      "code" in body &&
      body.code === "CREW_UPLOAD_RESERVATION_EXPIRED"
    );
  } catch {
    return false;
  }
}
