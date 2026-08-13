import "server-only";

export function javaAdminAuthHeaders(): Record<string, string> {
  const token = process.env.JAVA_ADMIN_API_TOKEN?.trim();
  if (!token) {
    throw new Error("Missing JAVA_ADMIN_API_TOKEN for the Java admin API.");
  }
  const header = process.env.JAVA_ADMIN_API_TOKEN_HEADER?.trim() || "X-Admin-Api-Token";
  return { [header]: token };
}
