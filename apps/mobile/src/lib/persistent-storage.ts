import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

function canUseWebStorage() {
  return Platform.OS === "web" && typeof window !== "undefined" && !!window.localStorage;
}

export async function getStoredString(
  key: string,
  options?: SecureStore.SecureStoreOptions
): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return typeof window === "undefined" ? null : (window.localStorage?.getItem(key) ?? null);
    } catch {
      return null;
    }
  }

  return SecureStore.getItemAsync(key, options);
}

export async function setStoredString(
  key: string,
  value: string,
  options?: SecureStore.SecureStoreOptions
): Promise<void> {
  if (canUseWebStorage()) {
    window.localStorage.setItem(key, value);
    return;
  }

  await SecureStore.setItemAsync(key, value, options);
}

export async function deleteStoredString(
  key: string,
  options?: SecureStore.SecureStoreOptions
): Promise<void> {
  if (canUseWebStorage()) {
    window.localStorage.removeItem(key);
    return;
  }

  await SecureStore.deleteItemAsync(key, options);
}
