import * as SecureStore from "expo-secure-store";

import { deleteStoredString, getStoredString, setStoredString } from "@/lib/persistent-storage";
import type { AuthSession } from "./types";

const STORAGE_KEY = "fizzdragon.mobile.auth.session.v1";
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: "fizzdragon.mobile.auth",
};

export async function readStoredSession(): Promise<AuthSession | undefined> {
  const raw = await getStoredString(STORAGE_KEY, SECURE_STORE_OPTIONS);

  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed || typeof parsed !== "object" || !parsed.user) return undefined;
    return parsed;
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
