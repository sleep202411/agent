import * as SecureStore from "expo-secure-store";

import { deleteStoredString, getStoredString, setStoredString } from "@/lib/persistent-storage";
import type { AuthSession } from "./types";

const STORAGE_KEY = "fizzdragon.mobile.auth.session.v1";
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: "fizzdragon.mobile.auth",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function readStoredSession(): Promise<AuthSession | undefined> {
  const raw = await getStoredString(STORAGE_KEY, SECURE_STORE_OPTIONS);

  if (!raw) return undefined;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.user)) return undefined;
    if (parsed.region !== "global" && parsed.region !== "cn") return undefined;
    if (typeof parsed.updatedAt !== "string") return undefined;
    if (
      parsed.token !== undefined &&
      (!isRecord(parsed.token) ||
        typeof parsed.token.tokenName !== "string" ||
        !parsed.token.tokenName.trim() ||
        typeof parsed.token.tokenValue !== "string" ||
        !parsed.token.tokenValue.trim())
    )
      return undefined;
    return parsed as unknown as AuthSession;
  } catch {
    await clearStoredSession();
    return undefined;
  }
}

export async function writeStoredSession(session: AuthSession) {
  const raw = JSON.stringify(session);
  await setStoredString(STORAGE_KEY, raw, SECURE_STORE_OPTIONS);
}

export async function clearStoredSession() {
  await deleteStoredString(STORAGE_KEY, SECURE_STORE_OPTIONS);
}
