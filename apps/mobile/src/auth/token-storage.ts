import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type { AuthSession } from "./types";

const STORAGE_KEY = "fizzdragon.mobile.auth.session.v1";
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: "fizzdragon.mobile.auth",
};

function canUseWebStorage() {
  return Platform.OS === "web" && typeof window !== "undefined" && !!window.localStorage;
}

export async function readStoredSession(): Promise<AuthSession | undefined> {
  const raw = canUseWebStorage()
    ? window.localStorage.getItem(STORAGE_KEY)
    : await SecureStore.getItemAsync(STORAGE_KEY, SECURE_STORE_OPTIONS);

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
  if (canUseWebStorage()) {
    window.localStorage.setItem(STORAGE_KEY, raw);
    return;
  }

  await SecureStore.setItemAsync(STORAGE_KEY, raw, SECURE_STORE_OPTIONS);
}

export async function clearStoredSession() {
  if (canUseWebStorage()) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }

  await SecureStore.deleteItemAsync(STORAGE_KEY, SECURE_STORE_OPTIONS);
}
